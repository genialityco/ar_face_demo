/**
 * HoloScan - Efecto de escaneo holográfico usando los 468 landmarks del rostro
 * Dibuja un wireframe con los contornos oficiales de MediaPipe (ojos, cejas, labios,
 * óvalo facial) + una nube de puntos + una línea de escaneo animada.
 * A diferencia de VendettaMask/VikingHelmet/FlowerFace, este efecto no usa el
 * facialTransformationMatrix ni el maskScene: se posiciona con los landmarks 2D
 * normalizados directamente en la escena principal (misma técnica que la esfera
 * de la metaball).
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const NUM_LANDMARKS = 478; // 468 base + 10 de iris (izq/der) si el modelo los incluye
const SCAN_COLOR = 0x00e5ff; // cian holográfico

export class HoloScan {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.connections = [
      ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
      ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
      ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
      ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
      ...FaceLandmarker.FACE_LANDMARKS_LIPS
    ];

    this._buildWireframe();
    this._buildPoints();
    this._buildScanLine();
  }

  _buildWireframe() {
    const positions = new Float32Array(this.connections.length * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: SCAN_COLOR,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.wireframe = new THREE.LineSegments(geometry, material);
    this.group.add(this.wireframe);
  }

  _buildPoints() {
    const positions = new Float32Array(NUM_LANDMARKS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: SCAN_COLOR,
      size: 0.025,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(geometry, material);
    this.group.add(this.points);
  }

  _buildScanLine() {
    const geometry = new THREE.PlaneGeometry(1, 0.015);
    const material = new THREE.MeshBasicMaterial({
      color: SCAN_COLOR,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.scanLine = new THREE.Mesh(geometry, material);
    this.group.add(this.scanLine);
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * Actualiza la posición de todos los elementos según los landmarks del rostro
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks - Puntos normalizados del rostro
   * @param {(x:number,y:number,z:number) => THREE.Vector3} projectFn - Proyección a espacio de mundo
   */
  update(landmarks, projectFn) {
    if (!landmarks || landmarks.length === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const worldPoints = landmarks.map((lm) => projectFn(lm.x, lm.y, lm.z));

    // Nube de puntos (usa solo la cantidad de landmarks realmente recibida)
    const pointsAttr = this.points.geometry.attributes.position;
    const pointsPos = pointsAttr.array;
    const pointCount = Math.min(worldPoints.length, NUM_LANDMARKS);
    for (let i = 0; i < pointCount; i++) {
      pointsPos[i * 3] = worldPoints[i].x;
      pointsPos[i * 3 + 1] = worldPoints[i].y;
      pointsPos[i * 3 + 2] = worldPoints[i].z;
    }
    this.points.geometry.setDrawRange(0, pointCount);
    pointsAttr.needsUpdate = true;

    // Wireframe de contornos
    const linePos = this.wireframe.geometry.attributes.position.array;
    for (let i = 0; i < this.connections.length; i++) {
      const { start, end } = this.connections[i];
      const a = worldPoints[start];
      const b = worldPoints[end];
      const o = i * 6;
      linePos[o] = a.x;
      linePos[o + 1] = a.y;
      linePos[o + 2] = a.z;
      linePos[o + 3] = b.x;
      linePos[o + 4] = b.y;
      linePos[o + 5] = b.z;
    }
    this.wireframe.geometry.attributes.position.needsUpdate = true;

    // Bounding box del rostro para ubicar la línea de escaneo
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, avgZ = 0;
    for (const p of worldPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      avgZ += p.z;
    }
    avgZ /= worldPoints.length;

    const time = performance.now() * 0.001;
    const scanProgress = (Math.sin(time * 1.2) + 1) / 2; // vaivén 0-1
    const scanY = minY + (maxY - minY) * scanProgress;

    this.scanLine.position.set((minX + maxX) / 2, scanY, avgZ + 0.05);
    this.scanLine.scale.set(Math.max(maxX - minX, 0.01), 1, 1);
  }

  dispose() {
    this.wireframe.geometry.dispose();
    this.wireframe.material.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.scanLine.geometry.dispose();
    this.scanLine.material.dispose();
  }
}
