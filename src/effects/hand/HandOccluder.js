/**
 * HandOccluder - Oclusor de profundidad invisible con la forma aproximada de la
 * mano (una esfera por cada uno de los 21 landmarks de MediaPipe), para que los
 * cubos se ocluyan de verdad: la parte de la mano que está delante de un cubo
 * tapa al cubo (se ve la mano real del video), y la parte que está detrás queda
 * tapada por el cubo. Así se puede "atravesar" un cubo con la mano.
 *
 * Mismo truco que HeadOccluder: MeshBasicMaterial con colorWrite:false +
 * renderOrder bajo, así escribe profundidad antes que los cubos sin pintar nada.
 *
 * La profundidad de cada esfera se calcula por landmark: se proyecta el punto al
 * plano de los cubos (z≈0) y se le suma un offset según el z de MediaPipe
 * (negativo = más cerca de la cámara). Ese z es aproximado, así que Z_SCALE y
 * Z_BIAS permiten calibrar cuánto "sobresale" la mano hacia la cámara.
 */
import * as THREE from 'three/webgpu';

const NUM_LM = 21;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Landmarks de la palma/muñeca (esferas más grandes); el resto son dedos
const PALM_LM = new Set([0, 1, 2, 5, 9, 13, 17]);
const PALM_RADIUS_RATIO = 0.45;
const FINGER_RADIUS_RATIO = 0.22;

// Calibración de profundidad (z de mundo; la cámara está en z=5 mirando -Z, así
// que "hacia la cámara" = z más grande). Con MediaPipe, landmark.z negativo = más
// cerca de la cámara.
const Z_SCALE = 4.0;   // cuánto pesa el z de MediaPipe
const Z_BIAS = 0.0;    // empuje global hacia la cámara (sube si la mano no ocluye lo suficiente)

// Poné true para ver el volumen del oclusor (wireframe magenta) mientras calibrás
const DEBUG_SHOW = false;

export class HandOccluder {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this._geo = new THREE.SphereGeometry(1, 12, 10);
    this._mat = DEBUG_SHOW
      ? new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
      : new THREE.MeshBasicMaterial({ colorWrite: false });

    this.hands = {};
    for (const hand of ['Left', 'Right']) {
      const holder = new THREE.Group();
      holder.visible = false;
      const spheres = [];
      for (let i = 0; i < NUM_LM; i++) {
        const m = new THREE.Mesh(this._geo, this._mat);
        m.renderOrder = -1; // escribe su profundidad antes que los cubos (renderOrder 0)
        m.frustumCulled = false;
        holder.add(m);
        spheres.push(m);
      }
      this.group.add(holder);
      this.hands[hand] = { holder, spheres };
    }
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * @param {Object} params
   * @param {{Left:{landmarks:Array|null}, Right:{landmarks:Array|null}}} params.hands
   * @param {(x:number,y:number,z:number) => THREE.Vector3} params.projectFn - proyección imagen->mundo (cámara principal)
   */
  update({ hands, projectFn }) {
    if (!this.group.visible) return;

    for (const hand of ['Left', 'Right']) {
      const lm = hands[hand]?.landmarks;
      const h = this.hands[hand];

      if (!lm) {
        h.holder.visible = false;
        continue;
      }
      h.holder.visible = true;

      // Escala de la mano (muñeca -> nudillo medio) para dimensionar las esferas
      const wristP = projectFn(lm[WRIST].x, lm[WRIST].y, 0);
      const mcpP = projectFn(lm[MIDDLE_MCP].x, lm[MIDDLE_MCP].y, 0);
      const palmLen = wristP.distanceTo(mcpP) || 0.5;

      for (let i = 0; i < NUM_LM; i++) {
        const p = projectFn(lm[i].x, lm[i].y, 0);
        // Profundidad propia por landmark (z de MediaPipe: negativo = más cerca)
        p.z += -lm[i].z * Z_SCALE + Z_BIAS;

        const ratio = PALM_LM.has(i) ? PALM_RADIUS_RATIO : FINGER_RADIUS_RATIO;
        const sphere = h.spheres[i];
        sphere.position.copy(p);
        sphere.scale.setScalar(Math.max(0.02, ratio * palmLen));
      }
    }
  }

  dispose() {
    this._geo.dispose();
    this._mat.dispose();
  }
}
