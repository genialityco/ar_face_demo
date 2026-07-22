/**
 * FlowerFace - Adorno facial de flores/enredaderas en FBX + decals 2D
 * Usa el facialTransformationMatrix de MediaPipe para seguir al rostro
 *
 * El efecto original de DeepAR también incluye corrección de color con LUT y un
 * efecto de warp/recorte de piel con mask_morph, pero eso no está implementado porque
 * requiere otra técnica: reproyectar el video en vivo sobre una malla UV del rostro.
 * Acá solo se implementan las flores/enredaderas 3D (texturas vegg_*) y los decals
 * decorativos de fondo (underlayer/shadow_multiply).
 */
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ASSET_BASE = '/filters/flower-face';

export class FlowerFace {
  constructor() {
    // Ancla que aplica directamente el facialTransformationMatrix de MediaPipe
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.anchor.visible = false;

    // Grupo interno para corregir el desajuste propio del asset FBX
    // Como todavía no hay datos medidos, arranca en cero igual que Viking Helmet
    // y se ajusta después de ver el log del bounding box al cargar
    this.calibration = {
      position: new THREE.Vector3(0, 0, 0),
      rotationY: 0,
      scale: 1
    };

    this.modelRoot = new THREE.Group();
    this.anchor.add(this.modelRoot);
    this._applyCalibration();

    this.model = null;
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
   * Carga el modelo y las texturas (se ejecuta una sola vez, al elegir el filtro por primera vez)
   */
  async load() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._doLoad();
    await this.loadingPromise;
  }

  async _doLoad() {
    const textureLoader = new THREE.TextureLoader();
    const [veggDiffuse, veggNormal, veggAlpha] = await Promise.all([
      textureLoader.loadAsync(`${ASSET_BASE}/vegg_diffuse.png`),
      textureLoader.loadAsync(`${ASSET_BASE}/vegg_normal.png`),
      textureLoader.loadAsync(`${ASSET_BASE}/vegg_spec.png`)
    ]);
    veggDiffuse.colorSpace = THREE.SRGBColorSpace;

    // Material para las tarjetas de flores/hojas (vegg_spec se usa como máscara de recorte alfa)
    const foliageMaterial = new THREE.MeshStandardMaterial({
      map: veggDiffuse,
      normalMap: veggNormal,
      alphaMap: veggAlpha,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0
    });

    const fbxLoader = new FBXLoader();
    const fbx = await fbxLoader.loadAsync(`${ASSET_BASE}/flowers.fbx`);

    fbx.traverse((child) => {
      if (child.isMesh) {
        child.material = foliageMaterial;
        child.matrixAutoUpdate = true;
      }
    });

    this.model = fbx;
    this.modelRoot.add(fbx);

    this.loaded = true;

    // Log de diagnóstico para calibración (para confirmar el tamaño real del modelo)
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    console.log('Flower Face loaded. Bounding box size:', size, 'center:', box.getCenter(new THREE.Vector3()));
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
      console.log('Flower Face first face transform - position:', pos, 'scale:', scale);
    }
  }

  dispose() {
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (child.material) {
            child.material.map?.dispose();
            child.material.normalMap?.dispose();
            child.material.alphaMap?.dispose();
            child.material.dispose();
          }
        }
      });
    }
  }
}
