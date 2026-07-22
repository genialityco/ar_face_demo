/**
 * VendettaMask - Máscara facial en FBX (estilo V de Vendetta)
 * Usa el facialTransformationMatrix de MediaPipe para seguir al rostro
 */
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ASSET_BASE = '/filters/vendetta-mask';

export class VendettaMask {
  constructor() {
    // Ancla que aplica directamente el facialTransformationMatrix de MediaPipe
    // (sistema de coordenadas que asume una cámara virtual en el origen mirando hacia -Z)
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.anchor.visible = false;

    // Grupo interno para corregir el desajuste propio del asset FBX
    // Ajustar estos valores si la máscara no encaja correctamente
    this.calibration = {
      // y+2.6 ≈ valor aproximado para desplazar 20px hacia arriba en pantalla
      // a una distancia del rostro de 28.5 (valor de log)
      // (2 * 28.5 * tan(31.5°) / equivalente a 270px de alto × 20px)
      position: new THREE.Vector3(0, 0, 2),
      rotationY: 0, // El FBX ya estaba orientado correctamente hacia la cámara, no hace falta rotar
      // El FBX está exportado en unidades de metro (medido: aprox. 10.4x14.2x7.5cm),
      // pero el facialTransformationMatrix de MediaPipe usa un sistema equivalente a centímetros,
      // por eso se multiplica x100. Además +30% de ajuste visual
      scale: 150
    };

    this.modelRoot = new THREE.Group();
    this.anchor.add(this.modelRoot);
    this._applyCalibration();

    this.model = null;
    this.loaded = false;
    this.loadingPromise = null;
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
    const [matcap, normalMap, multiplyMap] = await Promise.all([
      textureLoader.loadAsync(`${ASSET_BASE}/matcap_light.png`),
      textureLoader.loadAsync(`${ASSET_BASE}/normal_map.png`),
      textureLoader.loadAsync(`${ASSET_BASE}/multiply.png`)
    ]);
    matcap.colorSpace = THREE.SRGBColorSpace;
    multiplyMap.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshMatcapMaterial({
      matcap,
      normalMap,
      map: multiplyMap,
      side: THREE.DoubleSide // No se conoce la normal/orden de winding del FBX, esto evita que desaparezca por culling de una sola cara
    });

    const fbxLoader = new FBXLoader();
    const fbx = await fbxLoader.loadAsync(`${ASSET_BASE}/mask.fbx`);

    fbx.traverse((child) => {
      if (child.isMesh) {
        child.material = material;
        child.matrixAutoUpdate = true;
      }
    });

    this.model = fbx;
    this.modelRoot.add(fbx);
    this.loaded = true;

    // Log de diagnóstico para calibración (para confirmar el tamaño real del modelo)
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    console.log('Vendetta Mask loaded. Bounding box size:', size, 'center:', box.getCenter(new THREE.Vector3()));
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
      console.log('Vendetta Mask first face transform - position:', pos, 'scale:', scale);
    }
  }

  dispose() {
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (child.material) {
            child.material.map?.dispose();
            child.material.matcap?.dispose();
            child.material.normalMap?.dispose();
            child.material.dispose();
          }
        }
      });
    }
  }
}
