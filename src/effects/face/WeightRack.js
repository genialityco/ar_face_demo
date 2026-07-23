/**
 * WeightRack - 4 mancuernas en el suelo (parte inferior del cuadro), de menor
 * a mayor peso, que la persona agarra con la misma "pinza" de toda la mano que
 * HamburgerFeast/MoneyRain. Mientras está en la mano, sigue la punta de los
 * dedos y se escala según el largo real de la mano (igual que las hamburguesas),
 * pero además cada mancuerna tiene su propio tamaño relativo y tinte de color
 * (más pesada = más grande y más "caliente" el color) para distinguir el peso
 * a simple vista sin necesitar texto.
 *
 * El "esfuerzo" se calcula en vivo: cuánto se levantó la mancuerna respecto a
 * su lugar de origen en el suelo (0 apoyada, 1 levantada por completo),
 * multiplicado por el factor de esfuerzo de ese peso. Engine usa ese valor
 * para manejar EffortFace (enrojecimiento + gesto de esfuerzo en el rostro).
 *
 * Igual que las hamburguesas/billetes, vive en la escena principal
 * (posicionada con projectToWorld), no en el maskScene.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/dumbbell.glb';

// De más liviana a más pesada: tamaño relativo (además del ajuste por tamaño de
// mano), cuánto contribuye al esfuerzo al levantarla del todo, y el tinte de
// color (mismo código de colores que las pesas de gimnasio reales)
const WEIGHT_TIERS = [
  { relativeSize: 0.95, effortFactor: 0.35, tint: 0x4a90d9 }, // liviana - azul
  { relativeSize: 1.2, effortFactor: 0.6, tint: 0x4caf50 },   // media - verde
  { relativeSize: 1.45, effortFactor: 0.8, tint: 0xff9800 },  // pesada - naranja
  { relativeSize: 1.75, effortFactor: 1.0, tint: 0xe53935 }   // muy pesada - roja
];

// Rotación fija (radianes) para mostrar la mancuerna de costado (barra horizontal,
// no mirando de frente al agarre). Depende de cómo esté modelado el .glb, así que
// puede necesitar ajuste si no se ve lateral: probá cambiar el eje (x/y/z) o el
// signo/ángulo hasta que quede de perfil
const DISPLAY_ROTATION = { x: 0, y: Math.PI / 2, z: 0 };

// Lugares de reposo en el suelo (coordenadas normalizadas de imagen)
const GROUND_SPOTS = [
  { x: 0.2, y: 0.86 },
  { x: 0.4, y: 0.86 },
  { x: 0.6, y: 0.86 },
  { x: 0.8, y: 0.86 }
];

const TARGET_SIZE = 0.75; // tamaño (en reposo) en unidades de la escena principal
// Cuánto más grande que el largo de la palma se ve la mancuerna al sostenerla
const DUMBBELL_TO_PALM_RATIO = 1.4;

// Distancia normalizada (0-1, espacio de imagen) para poder agarrar una mancuerna en reposo
const GRAB_PROXIMITY = 0.13;
// Cuánto (en Y normalizada) hay que levantar la mano respecto al suelo para
// contar como un levantamiento completo (esfuerzo = 1 para esa mancuerna)
const LIFT_RANGE = 0.32;
// Suavizado del esfuerzo reportado, para que no salte de golpe
const EFFORT_SMOOTHING = 0.2;

// Margen de gracia (segundos) antes de soltar una mancuerna si se pierde el
// seguimiento de la mano momentáneamente (mismo patrón que MoneyRain)
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

export class WeightRack {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.model = null;
    this.loaded = false;
    this.loadingPromise = null;
    this.maxDim = 1;

    this.dumbbells = [];
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;

    this.effort = 0; // 0-1, suavizado
  }

  async load() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._doLoad();
    await this.loadingPromise;
  }

  async _doLoad() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_PATH);
    this.model = gltf.scene;

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.maxDim = Math.max(size.x, size.y, size.z) || 1;
    console.log('Dumbbell loaded. Bounding box size:', size);

    for (let i = 0; i < WEIGHT_TIERS.length; i++) {
      const tier = WEIGHT_TIERS[i];
      const mesh = this.model.clone(true);
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.color = new THREE.Color(tier.tint);
        }
      });
      mesh.scale.setScalar((TARGET_SIZE * tier.relativeSize) / this.maxDim);
      this.group.add(mesh);
      this.dumbbells.push({
        mesh,
        tier,
        state: 'resting', // 'resting' | 'held'
        heldBy: null,
        spot: GROUND_SPOTS[i % GROUND_SPOTS.length],
        lostSince: null
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
   * Reinicia todas las mancuernas a su lugar de reposo
   */
  reset() {
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;
    this.effort = 0;
    for (const d of this.dumbbells) {
      d.state = 'resting';
      d.heldBy = null;
      d.lostSince = null;
      d.mesh.scale.setScalar((TARGET_SIZE * d.tier.relativeSize) / this.maxDim);
    }
  }

  /**
   * @returns {number} 0 (sin esfuerzo) a 1 (levantando la mancuerna más pesada al máximo)
   */
  getEffort() {
    return this.effort;
  }

  _fitToHand(mesh, tier, handLandmarks, projectFn) {
    if (!handLandmarks) return;
    const wristPos = projectFn(handLandmarks[WRIST].x, handLandmarks[WRIST].y, handLandmarks[WRIST].z);
    const mcpPos = projectFn(handLandmarks[MIDDLE_MCP].x, handLandmarks[MIDDLE_MCP].y, handLandmarks[MIDDLE_MCP].z);
    const palmLength = wristPos.distanceTo(mcpPos);
    const desiredSize = palmLength * DUMBBELL_TO_PALM_RATIO * tier.relativeSize;
    mesh.scale.setScalar(desiredSize / this.maxDim);
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
    const pincerReleased = {};
    for (const hand of ['Left', 'Right']) {
      const isPincerGrab = hands[hand]?.isPincerGrab ?? false;
      pincerStarted[hand] = isPincerGrab && !this.prevPincer[hand];
      pincerReleased[hand] = !isPincerGrab && this.prevPincer[hand];
      this.prevPincer[hand] = isPincerGrab;
    }

    let targetEffort = 0;

    for (const d of this.dumbbells) {
      if (d.state === 'resting') {
        const pos = projectFn(d.spot.x, d.spot.y, 0);
        d.mesh.position.copy(pos);
        d.mesh.rotation.set(DISPLAY_ROTATION.x, DISPLAY_ROTATION.y, DISPLAY_ROTATION.z);

        for (const hand of ['Left', 'Right']) {
          const handLm = hands[hand]?.landmarks;
          if (!handLm || !pincerStarted[hand]) continue;
          const grip = gripPointOf(handLm);
          const dx = grip.x - d.spot.x;
          const dy = grip.y - d.spot.y;
          if (Math.hypot(dx, dy) < GRAB_PROXIMITY) {
            d.state = 'held';
            d.heldBy = hand;
            d.lostSince = null;
            break;
          }
        }
      } else if (d.state === 'held') {
        const handLm = hands[d.heldBy]?.landmarks;

        if (!handLm) {
          // Tracking perdido momentáneamente: se congela en su lugar hasta agotar el margen de gracia
          if (d.lostSince === null) d.lostSince = time;
          if (time - d.lostSince > HAND_LOST_GRACE) {
            d.state = 'resting';
            d.heldBy = null;
            d.lostSince = null;
            d.mesh.scale.setScalar((TARGET_SIZE * d.tier.relativeSize) / this.maxDim);
          }
          continue;
        }
        d.lostSince = null;

        if (pincerReleased[d.heldBy]) {
          // Soltó la mancuerna a propósito: vuelve a su lugar en el suelo
          d.state = 'resting';
          d.heldBy = null;
          d.mesh.scale.setScalar((TARGET_SIZE * d.tier.relativeSize) / this.maxDim);
          continue;
        }

        const grip = gripPointOf(handLm);
        d.mesh.position.copy(projectFn(grip.x, grip.y, grip.z));
        this._fitToHand(d.mesh, d.tier, handLm, projectFn);
        d.mesh.rotation.set(DISPLAY_ROTATION.x, DISPLAY_ROTATION.y, DISPLAY_ROTATION.z);

        // Cuánto se levantó respecto al suelo (Y normalizada más chica = más arriba en pantalla)
        const liftFraction = Math.min(1, Math.max(0, (d.spot.y - grip.y) / LIFT_RANGE));
        const effortFromThis = liftFraction * d.tier.effortFactor;
        targetEffort = Math.max(targetEffort, effortFromThis);
      }
    }

    this.effort += (targetEffort - this.effort) * EFFORT_SMOOTHING;
  }

  dispose() {
    for (const d of this.dumbbells) {
      d.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
    }
  }
}
