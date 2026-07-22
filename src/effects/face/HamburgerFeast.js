/**
 * HamburgerFeast - Varias hamburguesas 3D flotando en la escena que la persona
 * puede agarrar con una "pinza" de toda la mano (dedos extendidos que se juntan
 * contra el pulgar, como tomar algo entre las puntas), llevar a la boca y "comer"
 * (gestos de masticar detectados con el blendshape jawOpen). Cada hamburguesa
 * comida incrementa el progreso (0 a 1), que el Engine usa para aumentar
 * gradualmente el efecto de FaceWarp ("cara inflada").
 *
 * Mientras está en la mano, la hamburguesa se posiciona en la punta de los
 * dedos (promedio de índice/medio/anular) en vez del centro de la palma, y su
 * tamaño se recalcula cada frame en proporción al largo real de la mano
 * (muñeca a nudillo del dedo medio, medido en espacio de mundo), para que se
 * vea proporcional a la mano sin importar la distancia a la cámara.
 *
 * A diferencia de VendettaMask/VikingHelmet/FlowerFace, las hamburguesas no
 * siguen al rostro: son props libres posicionadas con projectToWorld (misma
 * técnica que las esferas de la mano en Engine), así que viven en la escena
 * principal, no en el maskScene.
 *
 * Una vez comidas todas, entra en la "fase de sentadillas": se detecta cada
 * sentadilla siguiendo solo la altura del rostro en la imagen (sin usar
 * MediaPipe Pose) — cuando la cabeza baja y vuelve a subir, cuenta una
 * repetición. Cada SQUATS_PER_STEP repeticiones bajan un grado el efecto,
 * mostrando un mensaje flotante, hasta volver por completo al peso ideal.
 */
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const MODEL_PATH = '/models/hamburger.fbx';
const NUM_HAMBURGERS = 5;
const TARGET_SIZE = 0.8; // tamaño (mientras flota) en unidades de la escena principal

// Cuánto más grande que el largo de la palma se ve la hamburguesa al sostenerla
const BURGER_TO_PALM_RATIO = 1.3;

// Distancia normalizada (0-1, espacio de imagen) para poder agarrar una hamburguesa flotante
const GRAB_PROXIMITY = 0.14;
// Distancia normalizada para considerar que la mano llevó la hamburguesa a la boca
const MOUTH_PROXIMITY = 0.09;
// Umbral del blendshape jawOpen para contar como "boca abierta" (masticando)
const JAW_OPEN_THRESHOLD = 0.35;
// Cantidad de ciclos abrir/cerrar la boca antes de que la hamburguesa desaparezca
const CHEWS_REQUIRED = 3;
// Sentadillas necesarias para bajar un grado el efecto, una vez comidas todas las hamburguesas
const SQUATS_PER_STEP = 3;

// Índices de landmarks de la mano: muñeca, nudillo medio, puntas de índice/medio/anular
const WRIST = 0;
const MIDDLE_MCP = 9;
const FINGERTIPS = [8, 12, 16];

// Cuánto (en Y normalizada) tiene que bajar el rostro respecto a la altura de pie
// para contar como "agachado"; y qué fracción de eso hay que recuperar para
// contar que ya volvió a estar de pie (con margen para evitar rebotes)
const SQUAT_DOWN_DELTA = 0.07;
const SQUAT_UP_RECOVER_RATIO = 0.35;
// Suavizado de la altura de referencia ("de pie") mientras no está agachado
const STANDING_HEIGHT_SMOOTHING = 0.08;

// Posiciones de aparición (coordenadas normalizadas de imagen), repartidas alrededor del cuadro
const SPAWN_SPOTS = [
  { x: 0.1, y: 0.22 },
  { x: 0.9, y: 0.22 },
  { x: 0.08, y: 0.8 },
  { x: 0.92, y: 0.8 },
  { x: 0.5, y: 0.9 }
];

// Promedio de las puntas de índice/medio/anular: donde queda un objeto sostenido con la pinza
function gripPointOf(landmarks) {
  let x = 0, y = 0, z = 0;
  for (const i of FINGERTIPS) {
    x += landmarks[i].x;
    y += landmarks[i].y;
    z += landmarks[i].z;
  }
  return { x: x / FINGERTIPS.length, y: y / FINGERTIPS.length, z: z / FINGERTIPS.length };
}

export class HamburgerFeast {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.model = null;
    this.loaded = false;
    this.loadingPromise = null;
    this.maxDim = 1; // mayor dimensión del FBX (para recalcular la escala en cualquier momento)

    this.hamburgers = [];
    this.prevPincer = { Left: false, Right: false };

    // Fase de sentadillas (después de comer todas las hamburguesas)
    this.weightLossSteps = 0;
    this.squatProgress = 0;
    this.pendingMessage = null;
    this.standingFaceY = null;
    this.squatPhase = 'up'; // 'up' | 'down'

    this.lipIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LIPS.flatMap((c) => [c.start, c.end])
    )];
  }

  async load() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._doLoad();
    await this.loadingPromise;
  }

  async _doLoad() {
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(MODEL_PATH);
    this.model = fbx;

    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    this.maxDim = Math.max(size.x, size.y, size.z) || 1;
    console.log('Hamburger loaded. Bounding box size:', size);

    for (let i = 0; i < NUM_HAMBURGERS; i++) {
      const mesh = fbx.clone(true);
      mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
      this.group.add(mesh);
      this.hamburgers.push({
        mesh,
        state: 'floating', // 'floating' | 'held' | 'eating' | 'eaten'
        heldBy: null,
        chewCount: 0,
        wasJawOpen: false,
        spawn: SPAWN_SPOTS[i % SPAWN_SPOTS.length],
        bobPhase: Math.random() * Math.PI * 2
      });
    }

    this.loaded = true;
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible && this.loaded;
  }

  /**
   * Reinicia todas las hamburguesas a su estado flotante inicial (progreso = 0)
   */
  reset() {
    this.prevPincer = { Left: false, Right: false };
    this.weightLossSteps = 0;
    this.squatProgress = 0;
    this.pendingMessage = null;
    this.standingFaceY = null;
    this.squatPhase = 'up';
    for (const h of this.hamburgers) {
      h.state = 'floating';
      h.heldBy = null;
      h.chewCount = 0;
      h.wasJawOpen = false;
      h.mesh.visible = true;
      h.mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
    }
  }

  _eatenCount() {
    return this.hamburgers.filter((h) => h.state === 'eaten').length;
  }

  /**
   * @returns {number} 0 (peso ideal / sin comer nada) a 1 (todas comidas, sin bajar nada aún)
   */
  getProgress() {
    if (this.hamburgers.length === 0) return 0;
    const effective = Math.max(0, this._eatenCount() - this.weightLossSteps);
    return effective / this.hamburgers.length;
  }

  /**
   * Ya se comieron todas las hamburguesas (independientemente de las sentadillas hechas)
   */
  isEatingComplete() {
    return this.hamburgers.length > 0 && this._eatenCount() === this.hamburgers.length;
  }

  /**
   * Se bajaron todos los grados: volvió al peso ideal
   */
  isFullyRecovered() {
    return this.weightLossSteps >= this.hamburgers.length;
  }

  /**
   * Está en la fase donde hace falta hacer sentadillas (ya comió todo, todavía no bajó todo)
   */
  isWeightLossPhase() {
    return this.isEatingComplete() && !this.isFullyRecovered();
  }

  /**
   * Sigue la altura del rostro para detectar sentadillas (sin usar MediaPipe Pose):
   * cuando la cabeza baja lo suficiente respecto a la altura "de pie" y vuelve a
   * subir, cuenta una repetición. Cada SQUATS_PER_STEP repeticiones bajan un grado.
   * @param {number} faceY - posición Y normalizada del rostro (0 arriba, 1 abajo)
   */
  _updateSquatDetection(faceY) {
    if (faceY == null) return;

    if (this.standingFaceY === null) {
      this.standingFaceY = faceY;
      return;
    }

    if (this.squatPhase === 'up') {
      // Sigue calibrando la altura de referencia mientras está de pie
      this.standingFaceY += (faceY - this.standingFaceY) * STANDING_HEIGHT_SMOOTHING;

      if (faceY - this.standingFaceY > SQUAT_DOWN_DELTA) {
        this.squatPhase = 'down';
      }
    } else {
      const recoveredThreshold = this.standingFaceY + SQUAT_DOWN_DELTA * SQUAT_UP_RECOVER_RATIO;
      if (faceY < recoveredThreshold) {
        this.squatPhase = 'up';
        this._registerSquatRep();
      }
    }
  }

  _registerSquatRep() {
    if (!this.isWeightLossPhase()) return;

    this.squatProgress++;
    if (this.squatProgress >= SQUATS_PER_STEP) {
      this.squatProgress -= SQUATS_PER_STEP;
      this.weightLossSteps++;
      this.pendingMessage = this.isFullyRecovered()
        ? '¡Volviste a tu peso ideal!'
        : '¡Bajaste de peso!';
    }
  }

  /**
   * Devuelve y limpia el mensaje pendiente (o null si no hay ninguno)
   */
  consumePendingMessage() {
    const message = this.pendingMessage;
    this.pendingMessage = null;
    return message;
  }

  _mouthCenter(landmarks) {
    let mx = 0, my = 0;
    for (const i of this.lipIndices) {
      mx += landmarks[i].x;
      my += landmarks[i].y;
    }
    return { x: mx / this.lipIndices.length, y: my / this.lipIndices.length };
  }

  // Ajusta la escala de la hamburguesa al largo real de la mano (muñeca a nudillo medio),
  // medido en espacio de mundo para que ya incluya la perspectiva de la cámara
  _fitToHand(mesh, handLandmarks, projectFn) {
    if (!handLandmarks) return;
    const wristPos = projectFn(handLandmarks[WRIST].x, handLandmarks[WRIST].y, handLandmarks[WRIST].z);
    const mcpPos = projectFn(handLandmarks[MIDDLE_MCP].x, handLandmarks[MIDDLE_MCP].y, handLandmarks[MIDDLE_MCP].z);
    const palmLength = wristPos.distanceTo(mcpPos);
    const desiredSize = palmLength * BURGER_TO_PALM_RATIO;
    mesh.scale.setScalar(desiredSize / this.maxDim);
  }

  /**
   * @param {Object} params
   * @param {Array<{x:number,y:number,z:number}>|null} params.landmarks - landmarks del rostro
   * @param {Object|null} params.blendshapes
   * @param {{Left:{palm:Object|null,landmarks:Array|null,isPincerGrab:boolean}, Right:{palm:Object|null,landmarks:Array|null,isPincerGrab:boolean}}} params.hands
   * @param {(x:number,y:number,z:number) => THREE.Vector3} params.projectFn
   * @param {number} params.time - segundos (performance.now()*0.001)
   */
  update({ landmarks, blendshapes, hands, projectFn, time }) {
    if (!this.loaded) return;

    if (this.isWeightLossPhase()) {
      this._updateSquatDetection(landmarks?.[1]?.y ?? null); // landmark 1: punta de la nariz
      return;
    }

    const pincerStarted = {};
    for (const hand of ['Left', 'Right']) {
      const isPincerGrab = hands[hand]?.isPincerGrab ?? false;
      pincerStarted[hand] = isPincerGrab && !this.prevPincer[hand];
      this.prevPincer[hand] = isPincerGrab;
    }

    const mouthPoint = landmarks ? this._mouthCenter(landmarks) : null;
    const jawOpen = blendshapes?.jawOpen ?? 0;
    const isJawOpen = jawOpen > JAW_OPEN_THRESHOLD;

    for (const h of this.hamburgers) {
      if (h.state === 'floating') {
        const bob = Math.sin(time * 1.5 + h.bobPhase) * 0.05;
        const pos = projectFn(h.spawn.x, h.spawn.y, 0);
        pos.y += bob;
        h.mesh.position.copy(pos);
        h.mesh.rotation.y = time * 0.6 + h.bobPhase;
        h.mesh.rotation.x = 0.3;

        for (const hand of ['Left', 'Right']) {
          const handLm = hands[hand]?.landmarks;
          if (!handLm || !pincerStarted[hand]) continue;
          const grip = gripPointOf(handLm);
          const dx = grip.x - h.spawn.x;
          const dy = grip.y - h.spawn.y;
          if (Math.hypot(dx, dy) < GRAB_PROXIMITY) {
            h.state = 'held';
            h.heldBy = hand;
            break;
          }
        }
      } else if (h.state === 'held') {
        const handLm = hands[h.heldBy]?.landmarks;
        if (!handLm) {
          // Se perdió el seguimiento de la mano: vuelve a flotar en su lugar de aparición
          h.state = 'floating';
          h.heldBy = null;
          h.mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
          continue;
        }

        const grip = gripPointOf(handLm);
        h.mesh.position.copy(projectFn(grip.x, grip.y, grip.z));
        this._fitToHand(h.mesh, handLm, projectFn);

        if (mouthPoint) {
          const dx = grip.x - mouthPoint.x;
          const dy = grip.y - mouthPoint.y;
          if (Math.hypot(dx, dy) < MOUTH_PROXIMITY) {
            h.state = 'eating';
            h.chewCount = 0;
            h.wasJawOpen = false;
          }
        }
      } else if (h.state === 'eating') {
        const handLm = hands[h.heldBy]?.landmarks;
        if (handLm) {
          const grip = gripPointOf(handLm);
          h.mesh.position.copy(projectFn(grip.x, grip.y, grip.z));
          this._fitToHand(h.mesh, handLm, projectFn);
        }

        if (isJawOpen && !h.wasJawOpen) {
          h.chewCount++;
        }
        h.wasJawOpen = isJawOpen;

        if (h.chewCount >= CHEWS_REQUIRED) {
          h.state = 'eaten';
          h.mesh.visible = false;
          h.heldBy = null;
        }
      }
      // 'eaten': ya está oculta, no hace falta actualizar nada más
    }
  }

  dispose() {
    for (const h of this.hamburgers) {
      h.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
        }
      });
    }
  }
}
