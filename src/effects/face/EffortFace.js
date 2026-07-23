/**
 * EffortFace - Deforma el video en vivo para mostrar "esfuerzo físico" en el
 * rostro (cejas fruncidas, ojos entrecerrados, boca apretada) y un
 * enrojecimiento de la piel, según this.intensity (0 a 1).
 *
 * Misma técnica que FaceWarp/MoodWarp (video sobre una grilla en espacio NDC,
 * UV fija en la posición original): el enrojecimiento usa el mismo
 * confinamiento radial al óvalo facial que FaceWarp (para no teñir el pelo/
 * fondo), y el gesto usa desplazamiento LOCAL por puntos de control como
 * MoodWarp (cejas/comisuras de la boca) más un entrecerrado de ojos con
 * tirón FRACCIONAL hacia el centro del ojo (nunca cruza el centro, mismo
 * fix aplicado en FaceWarp para evitar que la malla se pliegue).
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const GRID_SEGMENTS_X = 60;
const GRID_SEGMENTS_Y = 45;

// Ancho (unidades NDC) de la franja donde el enrojecimiento se desvanece cerca
// del contorno facial, para que no se note un borde duro
const CONFINE_MARGIN = 0.12;

// Tinte cálido/rojizo (multiplicativo, no gris) y cuánto se mezcla como máximo
// hacia ese tinte cuando intensity=1
const RED_TINT = { r: 1.18, g: 0.75, b: 0.68 };
const MAX_REDNESS = 0.5;

// Cejas: se fruncen (bajan y se acercan un poco al centro) según intensity
const BROW_INFLUENCE_RADIUS = 0.18;
const BROW_FURROW_DY = -0.028;
const BROW_FURROW_DX_IN = 0.014;

// Boca: comisuras se aprietan (hacia el centro) y bajan un poco (tensión)
const MOUTH_INFLUENCE_RADIUS = 0.055;
const MOUTH_CLENCH_DX = -0.018;
const MOUTH_CLENCH_DY = -0.015;

// Ojos: entrecerrados con tirón fraccional hacia el centro (nunca cruza el centro)
const EYE_SQUINT_SIGMA = 0.09;
const EYE_SQUINT_AMOUNT = 0.22;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function toNDC(landmark) {
  return { x: (landmark.x - 0.5) * 2, y: -(landmark.y - 0.5) * 2 };
}

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

export class EffortFace {
  constructor() {
    this.intensity = 0; // 0 sin esfuerzo, 1 esfuerzo máximo

    this.geometry = new THREE.PlaneGeometry(2, 2, GRID_SEGMENTS_X, GRID_SEGMENTS_Y);
    this.restPositions = this.geometry.attributes.position.array.slice();

    const vertexCount = this.geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3).fill(1);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.MeshBasicMaterial({
      map: null,
      vertexColors: true,
      depthTest: false,
      depthWrite: false
    });
    this.material.toneMapped = false;

    this.mesh = new THREE.Mesh(this.geometry, this.material);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.ovalIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap((c) => [c.start, c.end])
    )];
    this.leftEyebrowIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW.flatMap((c) => [c.start, c.end])
    )];
    this.rightEyebrowIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW.flatMap((c) => [c.start, c.end])
    )];
    this.leftEyeIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYE.flatMap((c) => [c.start, c.end])
    )];
    this.rightEyeIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE.flatMap((c) => [c.start, c.end])
    )];
    this.lipIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LIPS.flatMap((c) => [c.start, c.end])
    )];
  }

  setBackgroundTexture(texture) {
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  _averagePoint(landmarks, indices) {
    let x = 0, y = 0;
    for (const i of indices) {
      const p = toNDC(landmarks[i]);
      x += p.x; y += p.y;
    }
    return { x: x / indices.length, y: y / indices.length };
  }

  _radiusAt(table, angle) {
    let lo = 0, hi = table.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid].angle < angle) lo = mid + 1; else hi = mid;
    }
    const after = table[lo % table.length];
    const before = table[(lo - 1 + table.length) % table.length];
    let span = after.angle - before.angle;
    if (span <= 0) span += Math.PI * 2;
    let da = angle - before.angle;
    if (da < 0) da += Math.PI * 2;
    const t = span > 0 ? da / span : 0;
    return before.radius + (after.radius - before.radius) * t;
  }

  update(landmarks) {
    if (!landmarks || this.intensity <= 0.001) {
      this._resetPositions();
      return;
    }

    const intensity = Math.min(1, Math.max(0, this.intensity));

    let cx = 0, cy = 0;
    const ovalPoints = this.ovalIndices.map((i) => {
      const p = toNDC(landmarks[i]);
      cx += p.x; cy += p.y;
      return p;
    });
    cx /= ovalPoints.length;
    cy /= ovalPoints.length;

    const ovalAngles = ovalPoints
      .map((p) => ({ angle: Math.atan2(p.y - cy, p.x - cx), radius: Math.hypot(p.x - cx, p.y - cy) }))
      .sort((a, b) => a.angle - b.angle);

    const leftBrow = extremesByX(landmarks, this.leftEyebrowIndices);
    const rightBrow = extremesByX(landmarks, this.rightEyebrowIndices);
    const faceCenterX = (leftBrow.minPoint.x + rightBrow.maxPoint.x) / 2;
    const leftInner = Math.abs(leftBrow.minPoint.x - faceCenterX) < Math.abs(leftBrow.maxPoint.x - faceCenterX)
      ? leftBrow.minPoint : leftBrow.maxPoint;
    const rightInner = Math.abs(rightBrow.minPoint.x - faceCenterX) < Math.abs(rightBrow.maxPoint.x - faceCenterX)
      ? rightBrow.minPoint : rightBrow.maxPoint;

    const mouth = extremesByX(landmarks, this.lipIndices);
    const mouthLeft = toNDC(mouth.minPoint);
    const mouthRight = toNDC(mouth.maxPoint);
    const leftInnerNDC = toNDC(leftInner);
    const rightInnerNDC = toNDC(rightInner);

    const controlPoints = [
      // Cejas: bajan y se acercan al centro (fruncido)
      { x: leftInnerNDC.x, y: leftInnerNDC.y, dx: BROW_FURROW_DX_IN * intensity, dy: BROW_FURROW_DY * intensity, radius: BROW_INFLUENCE_RADIUS },
      { x: rightInnerNDC.x, y: rightInnerNDC.y, dx: -BROW_FURROW_DX_IN * intensity, dy: BROW_FURROW_DY * intensity, radius: BROW_INFLUENCE_RADIUS },
      // Comisuras de la boca: se aprietan hacia el centro y bajan un poco
      { x: mouthLeft.x, y: mouthLeft.y, dx: -MOUTH_CLENCH_DX * intensity, dy: MOUTH_CLENCH_DY * intensity, radius: MOUTH_INFLUENCE_RADIUS },
      { x: mouthRight.x, y: mouthRight.y, dx: MOUTH_CLENCH_DX * intensity, dy: MOUTH_CLENCH_DY * intensity, radius: MOUTH_INFLUENCE_RADIUS }
    ];

    const eyeL = this._averagePoint(landmarks, this.leftEyeIndices);
    const eyeR = this._averagePoint(landmarks, this.rightEyeIndices);

    const posAttr = this.geometry.attributes.position;
    const colorAttr = this.geometry.attributes.color;
    const pos = posAttr.array;
    const color = colorAttr.array;
    const rest = this.restPositions;

    for (let i = 0; i < pos.length; i += 3) {
      const vx = rest[i];
      const vy = rest[i + 1];

      const dx = vx - cx;
      const dy = vy - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < 1e-5) {
        pos[i] = vx;
        pos[i + 1] = vy;
        color[i] = color[i + 1] = color[i + 2] = 1;
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const boundaryOrig = this._radiusAt(ovalAngles, angle);
      const confT = Math.min(1, Math.max(0, Math.max(0, dist - boundaryOrig) / CONFINE_MARGIN));
      const confinement = 1 - smoothstep(confT);

      let totalDx = 0, totalDy = 0;
      for (const c of controlPoints) {
        if (Math.abs(c.dx) < 1e-6 && Math.abs(c.dy) < 1e-6) continue;
        const d = Math.hypot(vx - c.x, vy - c.y);
        if (d < c.radius) {
          const w = 1 - d / c.radius;
          const falloff = w * w;
          totalDx += c.dx * falloff;
          totalDy += c.dy * falloff;
        }
      }

      // Entrecerrado de ojos: fracción de la distancia restante al centro, nunca lo cruza
      const dLx = vx - eyeL.x, dLy = vy - eyeL.y;
      const dRx = vx - eyeR.x, dRy = vy - eyeR.y;
      const wL = Math.exp(-(dLx * dLx + dLy * dLy) / (2 * EYE_SQUINT_SIGMA * EYE_SQUINT_SIGMA));
      const wR = Math.exp(-(dRx * dRx + dRy * dRy) / (2 * EYE_SQUINT_SIGMA * EYE_SQUINT_SIGMA));
      const factorL = EYE_SQUINT_AMOUNT * wL * intensity;
      const factorR = EYE_SQUINT_AMOUNT * wR * intensity;
      totalDx += -dLx * factorL - dRx * factorR;
      totalDy += -dLy * factorL - dRy * factorR;

      pos[i] = vx + totalDx;
      pos[i + 1] = vy + totalDy;

      const redness = MAX_REDNESS * intensity * confinement;
      color[i] = 1 + redness * (RED_TINT.r - 1);
      color[i + 1] = 1 + redness * (RED_TINT.g - 1);
      color[i + 2] = 1 + redness * (RED_TINT.b - 1);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  _resetPositions() {
    const posAttr = this.geometry.attributes.position;
    posAttr.array.set(this.restPositions);
    posAttr.needsUpdate = true;

    const colorAttr = this.geometry.attributes.color;
    colorAttr.array.fill(1);
    colorAttr.needsUpdate = true;
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
