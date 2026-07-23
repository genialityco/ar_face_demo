/**
 * MoneyRain - Fajos de billetes que caen como lluvia desde arriba. La persona
 * los agarra con una "pinza" de toda la mano (misma técnica que HamburgerFeast)
 * y los lleva hacia una zona de "bolsillo" cerca de la parte inferior del
 * cuadro para guardarlos. El progreso (billetes guardados / total) lo usa
 * Engine para controlar MoodWarp, que deforma la boca/cejas en el video real
 * para pasar de una expresión triste a una feliz.
 *
 * Los billetes viven en la escena principal (posicionados con projectToWorld,
 * misma técnica que las hamburguesas), no en el maskScene.
 */
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MODEL_PATH = '/models/stacks-of-money.fbx';
const TEXTURE_PATH = '/models/stacks_diffuse_no_ao.jpg';
const NUM_MONEY = 6;
const TARGET_SIZE = 0.5; // tamaño (cayendo) en unidades de la escena principal

// Cuánto más grande que el largo de la palma se ve el billete al sostenerlo
const MONEY_TO_PALM_RATIO = 0.9;

// Velocidad de caída (unidades normalizadas de imagen por segundo)
const FALL_SPEED = 0.18;
// Distancia normalizada (0-1) para poder agarrar un billete cayendo
const GRAB_PROXIMITY = 0.13;
// Distancia normalizada para considerar que el billete llegó al bolsillo
const POCKET_PROXIMITY = 0.12;
// Zonas de "bolsillo" (coordenadas normalizadas de imagen)
const POCKET_SPOTS = [
  { x: 0.22, y: 0.92 },
  { x: 0.78, y: 0.92 }
];

// Margen de gracia (segundos) antes de soltar un billete si se pierde el
// seguimiento de la mano momentáneamente (ej. al mover la mano muy rápido,
// que suele causar motion blur y que MediaPipe pierda el tracking un instante).
// Mientras esté dentro de este margen, el billete se queda "congelado" en su
// última posición conocida en vez de soltarse.
const HAND_LOST_GRACE = 0.6;

// Índices de landmarks de la mano: muñeca, nudillo medio, puntas de índice/medio/anular
const WRIST = 0;
const MIDDLE_MCP = 9;
const FINGERTIPS = [8, 12, 16];

function gripPointOf(landmarks) {
  let x = 0, y = 0, z = 0;
  for (const i of FINGERTIPS) {
    x += landmarks[i].x;
    y += landmarks[i].y;
    z += landmarks[i].z;
  }
  return { x: x / FINGERTIPS.length, y: y / FINGERTIPS.length, z: z / FINGERTIPS.length };
}

export class MoneyRain {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.model = null;
    this.material = null;
    this.loaded = false;
    this.loadingPromise = null;
    this.maxDim = 1;

    this.bills = [];
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;
  }

  async load() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._doLoad();
    await this.loadingPromise;
  }

  async _doLoad() {
    const textureLoader = new THREE.TextureLoader();
    const diffuse = await textureLoader.loadAsync(TEXTURE_PATH);
    diffuse.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshStandardMaterial({
      map: diffuse,
      roughness: 0.85,
      metalness: 0
    });
    this.material = material;

    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(MODEL_PATH);
    this.model = fbx;

    fbx.traverse((child) => {
      if (child.isMesh) {
        child.material = material;
      }
    });

    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    this.maxDim = Math.max(size.x, size.y, size.z) || 1;
    console.log('Money stack loaded. Bounding box size:', size);

    for (let i = 0; i < NUM_MONEY; i++) {
      const mesh = fbx.clone(true);
      mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
      this.group.add(mesh);
      this.bills.push({
        mesh,
        state: 'falling', // 'falling' | 'held' | 'pocketed'
        heldBy: null,
        normX: Math.random(),
        normY: -Math.random() * 1.5, // arranca fuera de cuadro, escalonado (efecto lluvia)
        spinPhase: Math.random() * Math.PI * 2,
        lostSince: null // momento (segundos) en que se perdió el tracking de la mano, o null
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
   * Reinicia la lluvia de billetes (progreso = 0)
   */
  reset() {
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;
    for (const b of this.bills) {
      b.state = 'falling';
      b.heldBy = null;
      b.normX = Math.random();
      b.normY = -Math.random() * 1.5;
      b.lostSince = null;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
    }
  }

  /**
   * @returns {number} 0 (triste, nada guardado) a 1 (feliz, todo guardado)
   */
  getProgress() {
    if (this.bills.length === 0) return 0;
    const pocketed = this.bills.filter((b) => b.state === 'pocketed').length;
    return pocketed / this.bills.length;
  }

  _fitToHand(mesh, handLandmarks, projectFn) {
    if (!handLandmarks) return;
    const wristPos = projectFn(handLandmarks[WRIST].x, handLandmarks[WRIST].y, handLandmarks[WRIST].z);
    const mcpPos = projectFn(handLandmarks[MIDDLE_MCP].x, handLandmarks[MIDDLE_MCP].y, handLandmarks[MIDDLE_MCP].z);
    const palmLength = wristPos.distanceTo(mcpPos);
    mesh.scale.setScalar((palmLength * MONEY_TO_PALM_RATIO) / this.maxDim);
  }

  /**
   * @param {Object} params
   * @param {{Left:{landmarks:Array|null,isPincerGrab:boolean}, Right:{landmarks:Array|null,isPincerGrab:boolean}}} params.hands
   * @param {(x:number,y:number,z:number) => THREE.Vector3} params.projectFn
   * @param {number} params.time - segundos (performance.now()*0.001)
   */
  update({ hands, projectFn, time }) {
    if (!this.loaded) return;

    const dt = this._lastTime === null ? 0 : Math.min(0.1, time - this._lastTime);
    this._lastTime = time;

    const pincerStarted = {};
    for (const hand of ['Left', 'Right']) {
      const isPincerGrab = hands[hand]?.isPincerGrab ?? false;
      pincerStarted[hand] = isPincerGrab && !this.prevPincer[hand];
      this.prevPincer[hand] = isPincerGrab;
    }

    for (const b of this.bills) {
      if (b.state === 'falling') {
        b.normY += FALL_SPEED * dt;
        if (b.normY > 1.1) {
          // No lo agarraron a tiempo: vuelve a caer desde arriba (efecto lluvia continua)
          b.normY = -0.1;
          b.normX = Math.random();
        }

        const pos = projectFn(b.normX, b.normY, 0);
        b.mesh.position.copy(pos);
        b.mesh.rotation.y = time * 1.2 + b.spinPhase;
        b.mesh.rotation.x = Math.sin(time * 2 + b.spinPhase) * 0.3;

        for (const hand of ['Left', 'Right']) {
          const handLm = hands[hand]?.landmarks;
          if (!handLm || !pincerStarted[hand]) continue;
          const grip = gripPointOf(handLm);
          const dx = grip.x - b.normX;
          const dy = grip.y - b.normY;
          if (Math.hypot(dx, dy) < GRAB_PROXIMITY) {
            b.state = 'held';
            b.heldBy = hand;
            break;
          }
        }
      } else if (b.state === 'held') {
        const handLm = hands[b.heldBy]?.landmarks;
        if (!handLm) {
          // Tracking perdido momentáneamente (ej. mano movida muy rápido): se
          // queda "congelado" en su última posición hasta agotar el margen de gracia
          if (b.lostSince === null) b.lostSince = time;
          if (time - b.lostSince > HAND_LOST_GRACE) {
            b.state = 'falling';
            b.heldBy = null;
            b.lostSince = null;
          }
          continue;
        }
        b.lostSince = null;

        const grip = gripPointOf(handLm);
        b.mesh.position.copy(projectFn(grip.x, grip.y, grip.z));
        this._fitToHand(b.mesh, handLm, projectFn);

        for (const pocket of POCKET_SPOTS) {
          const dx = grip.x - pocket.x;
          const dy = grip.y - pocket.y;
          if (Math.hypot(dx, dy) < POCKET_PROXIMITY) {
            b.state = 'pocketed';
            b.mesh.visible = false;
            b.heldBy = null;
            break;
          }
        }
      }
      // 'pocketed': ya está oculto, no hace falta actualizar nada más
    }
  }

  dispose() {
    this.material?.map?.dispose();
    this.material?.dispose();
    for (const b of this.bills) {
      b.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
        }
      });
    }
  }
}
