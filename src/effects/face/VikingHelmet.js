/**
 * VikingHelmet - Casco vikingo PBR en FBX
 * Usa el facialTransformationMatrix de MediaPipe para seguir al rostro (cabeza)
 */
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ASSET_BASE = '/filters/viking-helmet';

export class VikingHelmet {
  constructor() {
    // Ancla que aplica directamente el facialTransformationMatrix de MediaPipe
    // (sistema de coordenadas que asume una cámara virtual en el origen mirando hacia -Z)
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.anchor.visible = false;

    // Grupo interno para corregir el desajuste propio del asset FBX
    // Bounding box medido: aprox. 27x42x22 (center: 0, 13.16, -8.11)
    // A diferencia de la máscara Vendetta, este FBX ya está exportado en unidades
    // equivalentes a centímetros, y el pivote ya está cerca del ancla de la cabeza,
    // así que arranca con scale=1 y sin offset
    this.calibration = {
      // z: en el sistema de coordenadas de MediaPipe, +Z es hacia la cámara (adelante),
      // -Z es hacia atrás (centro de la cabeza). Se ofsetea hacia atrás porque quedaba muy al frente
      position: new THREE.Vector3(0,-2, 0),
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
   * @param {THREE.Texture} envMap - Mapa de entorno para los reflejos (cubemap en vivo del Engine)
   */
  async load(envMap) {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._doLoad(envMap);
    await this.loadingPromise;
  }

  async _doLoad(envMap) {
    const textureLoader = new THREE.TextureLoader();
    const [diffuse, normalMap, metalnessMap, roughnessMap, aoMap] = await Promise.all([
      textureLoader.loadAsync(`${ASSET_BASE}/diffuse.jpg`),
      textureLoader.loadAsync(`${ASSET_BASE}/normal_map.jpg`),
      textureLoader.loadAsync(`${ASSET_BASE}/metalness.jpg`),
      textureLoader.loadAsync(`${ASSET_BASE}/roughness.jpg`),
      textureLoader.loadAsync(`${ASSET_BASE}/AO.jpg`)
    ]);
    diffuse.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap,
      metalnessMap,
      roughnessMap,
      aoMap,
      metalness: 1,   // Usa el valor de metalnessMap tal cual
      roughness: 1,   // Usa el valor de roughnessMap tal cual
      envMap: envMap ?? null,
      envMapIntensity: 1.2
    });

    const fbxLoader = new FBXLoader();
    const fbx = await fbxLoader.loadAsync(`${ASSET_BASE}/viking_helmet.fbx`);

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
    console.log('Viking Helmet loaded. Bounding box size:', size, 'center:', box.getCenter(new THREE.Vector3()));
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
      console.log('Viking Helmet first face transform - position:', pos, 'scale:', scale);
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
            child.material.metalnessMap?.dispose();
            child.material.roughnessMap?.dispose();
            child.material.aoMap?.dispose();
            child.material.dispose();
          }
        }
      });
    }
  }
}
