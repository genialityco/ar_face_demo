/**
 * HeadOccluder - Oclusor de profundidad invisible que aproxima la cabeza
 * Al no escribir color y escribir solo profundidad, permite que las partes de un
 * asset AR que quedan detrás de la cabeza se oculten mostrando el video real (oclusión)
 */
import * as THREE from 'three/webgpu';

export class HeadOccluder {
  constructor() {
    // Ancla que aplica directamente el facialTransformationMatrix de MediaPipe
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.anchor.visible = false;

    // Calibración del elipsoide que aproxima la cabeza. Ajustar según el tamaño/posición real de la cabeza
    this.calibration = {
      position: new THREE.Vector3(0, 2, -6),
      radius: new THREE.Vector3(9, 11, 10) // Radios x, y, z (equivalente a cm)
    };

    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const material = new THREE.MeshBasicMaterial({ colorWrite: false });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = -1; // Escribe su profundidad antes que los demás assets AR
    this.mesh.position.copy(this.calibration.position);
    this.mesh.scale.copy(this.calibration.radius);

    this.anchor.add(this.mesh);
  }

  addToScene(scene) {
    scene.add(this.anchor);
  }

  setVisible(visible) {
    this.anchor.visible = visible;
  }

  /**
   * @param {Float32Array|number[]|null} matrixData - facialTransformationMatrixes[0].data
   */
  updateTransform(matrixData) {
    if (!matrixData) {
      this.anchor.visible = false;
      return;
    }

    this.anchor.matrix.fromArray(matrixData);
    this.anchor.matrixWorldNeedsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
