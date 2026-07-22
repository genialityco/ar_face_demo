/**
 * MoodWarp - Deforma la boca y las cejas en el video en vivo para que la
 * expresión pase de triste a feliz según this.progress (0 a 1).
 *
 * Misma técnica que FaceWarp (video sobre una grilla en espacio NDC, UV fija
 * en la posición original para que el video se estire hacia la nueva forma),
 * pero con desplazamiento LOCAL alrededor de puntos de control (comisuras de
 * la boca, interior/exterior de cada ceja) en vez de un inflado radial desde
 * el centro del rostro.
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const GRID_SEGMENTS_X = 60;
const GRID_SEGMENTS_Y = 45;

// Radio de influencia (unidades NDC) alrededor de cada punto de control.
// El de la boca es chico a propósito: si fuera tan grande como el de las cejas,
// las dos comisuras se solapan en el medio de la boca y empujan todo el labio
// (superior e inferior juntos) como un solo bloque hacia arriba, "comiéndose"
// el espacio con la nariz en vez de levantar solo las puntas.
const BROW_INFLUENCE_RADIUS = 0.18;
const MOUTH_INFLUENCE_RADIUS = 0.055;

// Desplazamiento vertical (unidades NDC, +arriba/-abajo) de las comisuras de la boca
// (feliz más pronunciado que triste, para que la sonrisa se note claramente y no
// se confunda con una expresión neutra)
const MOUTH_CORNER_SAD = -0.05;
const MOUTH_CORNER_HAPPY = 0.08;
// Desplazamiento horizontal (alejando cada comisura del centro de la boca) al
// sonreír, para "alargar" los labios en vez de solo levantar las puntas
const MOUTH_STRETCH_HAPPY = 0.035;
// Cejas: triste = interior sube y exterior baja (cejas preocupadas); feliz = ambas
// suben un poco (cejas alegres/elevadas) en vez de volver a una posición neutral
const BROW_INNER_SAD = 0.03;
const BROW_OUTER_SAD = -0.018;
const BROW_HAPPY = 0.022;

// Encuentra los dos landmarks más extremos en X dentro de un conjunto de índices
function extremesByX(landmarks, indices) {
  let minPoint = landmarks[indices[0]];
  let maxPoint = landmarks[indices[0]];
  for (const i of indices) {
    const p = landmarks[i];
    if (p.x < minPoint.x) minPoint = p;
    if (p.x > maxPoint.x) maxPoint = p;
  }
  return { minPoint, maxPoint };
}

function toNDC(landmark) {
  return { x: (landmark.x - 0.5) * 2, y: -(landmark.y - 0.5) * 2 };
}

export class MoodWarp {
  constructor() {
    this.progress = 0; // 0 triste, 1 feliz

    this.geometry = new THREE.PlaneGeometry(2, 2, GRID_SEGMENTS_X, GRID_SEGMENTS_Y);
    this.restPositions = this.geometry.attributes.position.array.slice();

    this.material = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
    this.material.toneMapped = false;

    this.mesh = new THREE.Mesh(this.geometry, this.material);

    // Mismo patrón que el quad de pantalla completa de FaceWarp/MetaballEffect
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.leftEyebrowIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW.flatMap((c) => [c.start, c.end])
    )];
    this.rightEyebrowIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW.flatMap((c) => [c.start, c.end])
    )];
    this.lipIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LIPS.flatMap((c) => [c.start, c.end])
    )];
  }

  /**
   * Establece la textura de video a deformar
   * @param {THREE.Texture} texture
   */
  setBackgroundTexture(texture) {
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  /**
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   */
  update(landmarks) {
    if (!landmarks) {
      this._resetPositions();
      return;
    }

    const leftBrow = extremesByX(landmarks, this.leftEyebrowIndices);
    const rightBrow = extremesByX(landmarks, this.rightEyebrowIndices);
    const mouth = extremesByX(landmarks, this.lipIndices);

    // El punto de cada ceja más cercano al centro de la cara es el "interior"
    const faceCenterX = (leftBrow.minPoint.x + rightBrow.maxPoint.x) / 2;
    const leftInner = Math.abs(leftBrow.minPoint.x - faceCenterX) < Math.abs(leftBrow.maxPoint.x - faceCenterX)
      ? leftBrow.minPoint : leftBrow.maxPoint;
    const leftOuter = leftInner === leftBrow.minPoint ? leftBrow.maxPoint : leftBrow.minPoint;
    const rightInner = Math.abs(rightBrow.minPoint.x - faceCenterX) < Math.abs(rightBrow.maxPoint.x - faceCenterX)
      ? rightBrow.minPoint : rightBrow.maxPoint;
    const rightOuter = rightInner === rightBrow.minPoint ? rightBrow.maxPoint : rightBrow.minPoint;

    const mouthCornerDy = THREE.MathUtils.lerp(MOUTH_CORNER_SAD, MOUTH_CORNER_HAPPY, this.progress);
    const mouthStretch = THREE.MathUtils.lerp(0, MOUTH_STRETCH_HAPPY, this.progress);
    const browInnerDy = THREE.MathUtils.lerp(BROW_INNER_SAD, BROW_HAPPY, this.progress);
    const browOuterDy = THREE.MathUtils.lerp(BROW_OUTER_SAD, BROW_HAPPY, this.progress);

    const mouthLeft = toNDC(mouth.minPoint);
    const mouthRight = toNDC(mouth.maxPoint);

    const controlPoints = [
      // Comisuras de la boca: suben y además se alejan del centro (estiran los labios)
      { ...mouthLeft, dx: -mouthStretch, dy: mouthCornerDy, radius: MOUTH_INFLUENCE_RADIUS },
      { ...mouthRight, dx: mouthStretch, dy: mouthCornerDy, radius: MOUTH_INFLUENCE_RADIUS },
      { ...toNDC(leftInner), dx: 0, dy: browInnerDy, radius: BROW_INFLUENCE_RADIUS },
      { ...toNDC(leftOuter), dx: 0, dy: browOuterDy, radius: BROW_INFLUENCE_RADIUS },
      { ...toNDC(rightInner), dx: 0, dy: browInnerDy, radius: BROW_INFLUENCE_RADIUS },
      { ...toNDC(rightOuter), dx: 0, dy: browOuterDy, radius: BROW_INFLUENCE_RADIUS }
    ];

    const posAttr = this.geometry.attributes.position;
    const pos = posAttr.array;
    const rest = this.restPositions;

    for (let i = 0; i < pos.length; i += 3) {
      const vx = rest[i];
      const vy = rest[i + 1];

      let totalDx = 0;
      let totalDy = 0;
      for (const c of controlPoints) {
        if (Math.abs(c.dy) < 1e-5 && Math.abs(c.dx) < 1e-5) continue;
        const dist = Math.hypot(vx - c.x, vy - c.y);
        if (dist < c.radius) {
          const w = 1 - dist / c.radius;
          const falloff = w * w;
          totalDx += c.dx * falloff;
          totalDy += c.dy * falloff;
        }
      }

      pos[i] = vx + totalDx;
      pos[i + 1] = vy + totalDy;
    }

    posAttr.needsUpdate = true;
  }

  _resetPositions() {
    const posAttr = this.geometry.attributes.position;
    posAttr.array.set(this.restPositions);
    posAttr.needsUpdate = true;
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
