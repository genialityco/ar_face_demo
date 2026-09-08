/**
 * CubeMover - Cubos de Rubik 3D colocados en la escena real (fondo = video de la
 * cámara) como si fueran parte del entorno: quietos, apoyados sobre un plano de
 * suelo virtual, con perspectiva de la cámara principal y una sombra de contacto
 * que los ancla. No flotan ni giran solos. Con un gesto de "pinza" de toda la
 * mano se agarra un cubo, se lo mueve, y al soltarlo cae y se queda donde quedó.
 *
 * Posiciones en coordenadas de mundo reales (no de pantalla), así que mantienen
 * su tamaño y perspectiva como un objeto físico.
 *
 * Estados de cada cubo:
 *  - 'resting' : quieto sobre el suelo. Agarrable.
 *  - 'held'    : sigue la mano que lo sostiene.
 *  - 'falling' : recién soltado, cae hasta apoyarse en el suelo -> vuelve a 'resting'.
 *
 * El esqueleto de huesos de las manos lo dibuja HandSkeleton (compartido).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/cubo/cubo_rubik3x3.glb';

const NUM_CUBES = 3;
const TARGET_SIZE = 0.6; // arista del cubo en unidades de mundo

// Altura (y de mundo) del plano de suelo virtual donde se apoyan los cubos.
// La cámara principal está en z=5 mirando -Z; este valor deja los cubos en la
// franja inferior del cuadro, como apoyados en una mesa/piso frente a la persona.
const FLOOR_Y = -1.9;

// Posiciones de reposo iniciales sobre el piso (x, z de mundo). La y se calcula
// para que el cubo quede apoyado (mitad de su alto sobre el piso).
const REST_SPOTS = [
  { x: -1.7, z: 0.1 },
  { x: 0.0, z: -0.4 },
  { x: 1.7, z: 0.1 }
];

// Límites (x de mundo) para que un cubo soltado no termine fuera del piso visible
const FLOOR_X_LIMIT = 4;

// Distancia en pantalla (NDC, -1..1 en cada eje) entre la mano y el cubo para agarrarlo
const GRAB_NDC = 0.22;

// Margen de gracia (segundos) antes de soltar un cubo si se pierde el seguimiento
// de la mano momentáneamente (mismo patrón que MoneyRain / WeightRack)
const HAND_LOST_GRACE = 0.6;

// Caída al soltar
const FALL_GRAVITY = 12;   // unidades/seg^2
const FALL_MAX_SPEED = 9;

// Sombra de contacto
const SHADOW_BASE_RADIUS = 0.55;

// Índices de landmarks de la mano (puntas de índice/medio/anular = punto de agarre)
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

export class CubeMover {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.model = null;
    this.loaded = false;
    this.loadingPromise = null;
    this.maxDim = 1;
    this.restY = FLOOR_Y + TARGET_SIZE / 2;

    this.cubes = [];
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;

    this._shadowTexture = this._makeShadowTexture();
    this._tmpVec = new THREE.Vector3();
  }

  // Textura radial (blanco al centro -> transparente) para la sombra de contacto
  _makeShadowTexture() {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // --- Carga del modelo --------------------------------------------------

  async load(envMap) {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this._doLoad(envMap);
    await this.loadingPromise;
  }

  async _doLoad(envMap) {
    const gltf = await new GLTFLoader().loadAsync(MODEL_PATH);
    this.model = gltf.scene;

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.maxDim = Math.max(size.x, size.y, size.z) || 1;
    console.log('Rubik cube loaded. Bounding box size:', size);

    for (let i = 0; i < NUM_CUBES; i++) {
      const mesh = this.model.clone(true);
      const mats = [];
      mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material = child.material.clone();
          if (envMap && 'envMap' in child.material) {
            child.material.envMap = envMap;
            child.material.envMapIntensity = 0.6;
          }
          mats.push(child.material);
        }
      });
      mesh.scale.setScalar(TARGET_SIZE / this.maxDim);
      // Un giro fijo distinto por cubo, para que no se vean clonados
      mesh.rotation.y = i * 0.7;
      this.group.add(mesh);

      // Sombra de contacto: sprite plano que mira a la cámara (una elipse oscura
      // achatada a la altura del piso). Un quad apoyado en el piso se vería de
      // canto con la cámara nivelada, así que se usa este truco de "blob shadow".
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this._shadowTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0.5
        })
      );
      shadow.renderOrder = -1;
      this.group.add(shadow);

      const spot = REST_SPOTS[i % REST_SPOTS.length];
      const cube = {
        mesh,
        mats,
        shadow,
        state: 'resting', // 'resting' | 'held' | 'falling'
        heldBy: null,
        baseYaw: mesh.rotation.y,
        vy: 0,
        lostSince: null
      };
      this._placeAt(cube, spot.x, spot.z);
      this.cubes.push(cube);
    }

    this.loaded = true;
  }

  _placeAt(cube, x, z) {
    cube.mesh.position.set(x, this.restY, z);
    cube.vy = 0;
    this._updateShadow(cube);
  }

  _updateShadow(cube) {
    const p = cube.mesh.position;
    const lift = Math.min(1, Math.max(0, (p.y - this.restY) / 2.5)); // 0 apoyado, ~1 bien alto
    // Se queda a la altura del piso; crece y se aclara a medida que el cubo sube
    cube.shadow.position.set(p.x, FLOOR_Y + 0.04, p.z);
    const w = SHADOW_BASE_RADIUS * (1.7 + lift * 2.0);
    cube.shadow.scale.set(w, w * 0.4, 1);
    cube.shadow.material.opacity = 0.5 * (1 - lift * 0.7);
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible && this.loaded;
  }

  /** Reinicia todos los cubos a sus posiciones de reposo */
  reset() {
    this.prevPincer = { Left: false, Right: false };
    this._lastTime = null;
    for (let i = 0; i < this.cubes.length; i++) {
      const cube = this.cubes[i];
      const spot = REST_SPOTS[i % REST_SPOTS.length];
      cube.state = 'resting';
      cube.heldBy = null;
      cube.lostSince = null;
      cube.mesh.rotation.set(0, cube.baseYaw, 0);
      this._placeAt(cube, spot.x, spot.z);
    }
  }

  // NDC (x,y en -1..1) del punto de agarre de la mano
  _gripNDC(grip) {
    return { x: (grip.x - 0.5) * 2, y: -(grip.y - 0.5) * 2 };
  }

  /**
   * @param {Object} params
   * @param {{Left:{landmarks:Array|null,isPincerGrab:boolean}, Right:{landmarks:Array|null,isPincerGrab:boolean}}} params.hands
   * @param {(x:number,y:number,z:number) => THREE.Vector3} params.projectFn - proyección imagen->mundo (cámara principal)
   * @param {THREE.Camera} params.camera - cámara principal, para el test de agarre en pantalla
   * @param {number} params.time - segundos (performance.now()*0.001)
   */
  update({ hands, projectFn, camera, time }) {
    if (!this.loaded) return;

    const dt = this._lastTime === null ? 0 : Math.min(0.05, time - this._lastTime);
    this._lastTime = time;

    const pincerStarted = {};
    const pincerReleased = {};
    for (const hand of ['Left', 'Right']) {
      const isPincer = hands[hand]?.isPincerGrab ?? false;
      pincerStarted[hand] = isPincer && !this.prevPincer[hand];
      pincerReleased[hand] = !isPincer && this.prevPincer[hand];
      this.prevPincer[hand] = isPincer;
    }

    // Sólo se puede sostener un cubo a la vez (entre las dos manos)
    let holding = this.cubes.some((c) => c.state === 'held');

    for (const cube of this.cubes) {
      if (cube.state === 'resting' || cube.state === 'falling') {
        if (cube.state === 'falling') {
          cube.vy = Math.max(-FALL_MAX_SPEED, cube.vy - FALL_GRAVITY * dt);
          cube.mesh.position.y += cube.vy * dt;
          if (cube.mesh.position.y <= this.restY) {
            cube.mesh.position.y = this.restY;
            cube.vy = 0;
            cube.state = 'resting';
          }
        }

        // Agarre: la mano en pinza cae sobre el cubo (test en pantalla).
        // Sólo si no hay ya otro cubo en la mano.
        if (camera && !holding) {
          const cubeNDC = this._tmpVec.copy(cube.mesh.position).project(camera);
          for (const hand of ['Left', 'Right']) {
            const handLm = hands[hand]?.landmarks;
            if (!handLm || !pincerStarted[hand]) continue;
            const g = this._gripNDC(gripPointOf(handLm));
            if (Math.hypot(g.x - cubeNDC.x, g.y - cubeNDC.y) < GRAB_NDC) {
              cube.state = 'held';
              cube.heldBy = hand;
              cube.lostSince = null;
              cube.vy = 0;
              holding = true;
              break;
            }
          }
        }
      } else if (cube.state === 'held') {
        const handLm = hands[cube.heldBy]?.landmarks;

        if (!handLm) {
          if (cube.lostSince === null) cube.lostSince = time;
          if (time - cube.lostSince > HAND_LOST_GRACE) {
            cube.state = 'falling';
            cube.heldBy = null;
            cube.lostSince = null;
          }
          this._updateShadow(cube);
          continue;
        }
        cube.lostSince = null;

        const grip = gripPointOf(handLm);
        const world = projectFn(grip.x, grip.y, grip.z);
        world.x = Math.max(-FLOOR_X_LIMIT, Math.min(FLOOR_X_LIMIT, world.x));
        world.y = Math.max(this.restY, world.y);
        cube.mesh.position.copy(world);

        if (pincerReleased[cube.heldBy]) {
          cube.state = 'falling';
          cube.heldBy = null;
          cube.vy = 0;
        }
      }

      this._updateShadow(cube);
    }
  }

  dispose() {
    this._shadowTexture.dispose();
    for (const c of this.cubes) {
      c.mesh.traverse((child) => {
        if (child.isMesh) child.geometry?.dispose();
      });
      for (const m of c.mats) {
        m.map?.dispose();
        m.dispose();
      }
      c.shadow.geometry.dispose();
      c.shadow.material.dispose();
    }
  }
}
