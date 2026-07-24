/**
 * RaccoonFace - El modelo de mapache (raccoon_head.glb) del demo oficial de
 * MediaPipe Face Landmarker, con el mismo comportamiento que en esa página:
 * 1. Sigue la cabeza por completo (posición/rotación/escala) aplicando
 *    directamente el facialTransformationMatrix, igual que VendettaMask/
 *    VikingHelmet/FlowerFace.
 * 2. Además, el modelo tiene morph targets (blend shapes) con los mismos 52
 *    nombres que las categorías de blendshapes de MediaPipe (jawOpen,
 *    mouthSmileLeft, eyeBlinkLeft, browInnerUp, etc.) — por eso no hace falta
 *    mapear nada a mano: para cada morph target del modelo, si existe una
 *    categoría de blendshape con ese mismo nombre, su score se usa tal cual
 *    como influencia. Así la cara del mapache imita la expresión real
 *    (parpadeo, sonrisa, boca abierta, cejas) igual que en la demo de MediaPipe.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/raccoon_head.glb';

// Algunas categorías de blendshapes de MediaPipe casi nunca llegan a un score
// de 1.0 aunque el gesto sea completo (ej. un parpadeo con los ojos bien
// cerrados suele dar ~0.6-0.8), así que sin amplificar el modelo se queda a
// medio camino (entrecerrado en vez de cerrado del todo). Estos
// multiplicadores se aplican antes de usar el score como influencia (recortado
// a 1) — solo a las categorías que lo necesitan, el resto queda sin cambios
const BLENDSHAPE_GAIN = {
  eyeBlinkLeft: 1.8,
  eyeBlinkRight: 1.8
};

export class RaccoonFace {
  constructor() {
    // Ancla que aplica directamente el facialTransformationMatrix de MediaPipe
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.anchor.visible = false;

    // El asset oficial de MediaPipe ya está pensado para usarse tal cual con
    // el facialTransformationMatrix (sin la corrección de escala/unidades que
    // sí hacen falta con los FBX de vendetta/viking, que vienen en metros)
    this.calibration = {
      position: new THREE.Vector3(0, 0, 1),
      rotationY: 0,
      scale: 30
    };

    this.modelRoot = new THREE.Group();
    this.anchor.add(this.modelRoot);
    this._applyCalibration();

    this.model = null;
    this.morphMeshes = [];
    this.loaded = false;
    this.loadingPromise = null;
    this._loggedFirstTransform = false;
  }

  _applyCalibration() {
    this.modelRoot.position.copy(this.calibration.position);
    this.modelRoot.rotation.set(0, this.calibration.rotationY, 0);
    this.modelRoot.scale.setScalar(this.calibration.scale);
  }

  /**
   * Carga el modelo (se ejecuta una sola vez, al elegir el filtro por primera vez)
   */
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

    this.morphMeshes = [];
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.matrixAutoUpdate = true;
        if (child.morphTargetDictionary && child.morphTargetInfluences) {
          this.morphMeshes.push(child);
        }
      }
    });

    this.modelRoot.add(this.model);
    this.loaded = true;

    // Log de diagnóstico: tamaño real del modelo y qué morph targets se encontraron
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const morphNames = this.morphMeshes.flatMap((m) => Object.keys(m.morphTargetDictionary));
    console.log('Raccoon Face loaded. Bounding box size:', size, 'center:', box.getCenter(new THREE.Vector3()));
    console.log('Raccoon Face morph targets found:', [...new Set(morphNames)]);
  }

  addToScene(scene) {
    scene.add(this.anchor);
  }

  setVisible(visible) {
    this.anchor.visible = visible && this.loaded;
  }

  /**
   * Aplica la matriz de transformación del rostro
   * @param {Float32Array|number[]|null} matrixData - facialTransformationMatrixes[0].data de MediaPipe (16 elementos)
   */
  updateTransform(matrixData) {
    if (!this.loaded || !matrixData) {
      this.anchor.visible = false;
      return;
    }

    this.anchor.visible = true;
    this.anchor.matrix.fromArray(matrixData);
    // Con matrixAutoUpdate=false, reescribir matrix directamente no activa
    // matrixWorldNeedsUpdate, así que hay que setearlo explícitamente
    this.anchor.matrixWorldNeedsUpdate = true;

    if (!this._loggedFirstTransform) {
      this._loggedFirstTransform = true;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      this.anchor.matrix.decompose(pos, quat, scale);
      console.log('Raccoon Face first face transform - position:', pos, 'scale:', scale);
    }
  }

  /**
   * Aplica las expresiones (blendshapes) del rostro real a los morph targets
   * del modelo, emparejando por nombre de categoría (jawOpen, eyeBlinkLeft, etc.)
   * @param {Object|null} blendshapes - { categoryName: score (0-1), ... }
   */
  updateBlendshapes(blendshapes) {
    if (!this.loaded || !blendshapes) return;

    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      for (const name in dict) {
        const raw = blendshapes[name] ?? 0;
        const gain = BLENDSHAPE_GAIN[name] ?? 1;
        influences[dict[name]] = Math.min(1, raw * gain);
      }
    }
  }

  dispose() {
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              mat.map?.dispose();
              mat.normalMap?.dispose();
              mat.metalnessMap?.dispose();
              mat.roughnessMap?.dispose();
              mat.dispose();
            }
          }
        }
      });
    }
  }
}
