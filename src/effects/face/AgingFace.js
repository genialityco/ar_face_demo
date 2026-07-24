/**
 * AgingFace - Deforma el video en vivo para que el rostro se vea envejecido,
 * según this.intensity (0 a 1). Todavía no tiene mecánica/historia asociada
 * (se agrega el filtro solo, para poder ver y ajustar el look primero).
 *
 * Misma técnica que FaceWarp/EffortFace (video sobre una grilla en espacio
 * NDC, UV fija, confinamiento radial al óvalo facial para no afectar pelo/
 * fondo), combinando:
 * 1. Caída por gravedad (desplazamiento LOCAL por puntos de control, mismo
 *    estilo que MoodWarp/EffortFace): mejillas/mandíbula caídas, bolsas bajo
 *    los ojos, comisuras de la boca hacia abajo.
 * 2. Arrugas (patrones de oscurecimiento periódico en vertex color, no
 *    geometría): líneas horizontales curvadas en la frente, entrecejo,
 *    "patas de gallo", surco nasogeniano, líneas de marioneta, "código de
 *    barras" sobre el labio superior y pliegues diagonales bajo el pómulo.
 *    Todas se acumulan con una curva asintótica (nunca satura de golpe) y se
 *    recortan por el óvalo facial real.
 * 3. Tono de piel envejecido: tinte amarillento/grisáceo, y ojeras
 *    (oscurecimiento con un leve tinte frío bajo los ojos).
 *
 * El surco nasogeniano y las líneas de marioneta se aproximan con la punta de
 * la nariz (landmark 1) y las comisuras de la boca, porque MediaPipe no tiene
 * landmarks dedicados para esas zonas — es una aproximación visual, no
 * anatómicamente exacta.
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const GRID_SEGMENTS_X = 220;
const GRID_SEGMENTS_Y = 180;

const FACE_WIDTH_LEFT = 234;
const FACE_WIDTH_RIGHT = 454;
const NOSE_TIP = 1;

const CONFINE_MARGIN = 0.12;

// Caída por gravedad (desplazamiento local, unidades relativas a faceScale).
// Subido en general (no solo cachetes): todos los puntos de control caen más
// y con radios más anchos, para que se note como una caída general de la piel
// y no como hundimientos puntuales aislados
const CHEEK_SAG_DY = -0.26;
const CHEEK_SAG_RADIUS = 0.36;
const EYE_BAG_DY = -0.08;
// Con offset -0.06 y radio 0.05 el borde cercano de la zona de ojeras quedaba
// a solo 0.01*faceScale del centro del ojo: se metía dentro del párpado
// inferior y lo estiraba hacia abajo junto con la piel de la ojera. Bajado
// más lejos del ojo para que el borde cercano quede claramente por debajo
const EYE_BAG_OFFSET_Y = -0.11;
const EYE_BAG_RADIUS = 0.05;
const MOUTH_CORNER_DY = -0.13;
const MOUTH_CORNER_DX_IN = 0.02;
const MOUTH_INFLUENCE_RADIUS = 0.1;

// Ojos caídos: párpado superior "abombado" hacia abajo (mirada cansada) +
// comisura externa del ojo (canto externo) caída, para una forma de ojo
// triste/envejecida en vez de solo ojeras debajo.
// Radios bien chicos a propósito: si son grandes (como estaban, 0.11/0.1)
// terminan solapándose entre sí y con la zona de ojeras, y arrastran el ojo
// entero hacia abajo como un bloque en vez de solo hundir el párpado/comisura
// — eso es lo que se veía como el ojo "distorsionándose"
const EYELID_DROOP_DY = -0.05;
const EYELID_DROOP_RADIUS = 0.05;
const OUTER_EYE_DROOP_DY = -0.04;
const OUTER_EYE_DROOP_RADIUS = 0.055;

// Tono de piel: mucho más sutil
const SKIN_TONE = { r: 1.0, g: 0.94, b: 0.86 };
const SKIN_TONE_AMOUNT = 0.35;

// Arrugas: más líneas, más finas, oscurecimiento más suave. Subido un poco
// respecto a 0.42 porque, sin la frente (se sacó, se veía mal), el resto de
// las marcas quedaba poco visible
const WRINKLE_DARKNESS = 0.58;

// Frente: unas pocas líneas cortas y onduladas (no rectas), sutiles. Se
// calculan en un espacio rotado según la inclinación real de la cabeza (roll),
// así que giran junto con el rostro al inclinar la cabeza a los costados
const FOREHEAD_LINE_COUNT = 3;
const FOREHEAD_LINE_LENGTH = 0.32;     // "corta": no llega de sien a sien
const FOREHEAD_LINE_THICKNESS = 0.05;
const FOREHEAD_WAVE_AMOUNT = 0.045;    // cuánto se ondula (irregularidad)
const FOREHEAD_WAVE_FREQ = 3.2;
const FOREHEAD_BAND_HEIGHT = 0.11;     // separación vertical entre líneas
const FOREHEAD_WEIGHT = 0.4;           // aporte relativo (sutil)

const CROWSFEET_LINE_COUNT = 4;
const CROWSFEET_LINE_HALF_WIDTH = 0.18;
const CROWSFEET_RADIUS = 0.17;
const CROWSFEET_FAN_HALF_ANGLE = (60 * Math.PI) / 180;

const NASOLABIAL_HALF_WIDTH = 0.016;
const NASOLABIAL_FADE = 0.12;

// Nuevas marcas
const GLABELLA_LINE_COUNT = 2;        // arrugas verticales del entrecejo
const GLABELLA_HALF_WIDTH = 0.16;
const GLABELLA_RADIUS_X = 0.07;
const GLABELLA_RADIUS_Y = 0.10;
const MARIONETTE_HALF_WIDTH = 0.014;  // líneas de marioneta (comisura → mandíbula)
const MARIONETTE_LEN = 0.16;
const UPPER_LIP_LINE_COUNT = 7;       // código de barras sobre el labio
const UPPER_LIP_HALF_WIDTH = 0.18;
const UPPER_LIP_RADIUS_X = 0.10;
const UPPER_LIP_RADIUS_Y = 0.045;
const NECK_CHEEK_LINE_COUNT = 1;      // pliegues de mejilla baja
const NECK_CHEEK_HALF_WIDTH = 0.14;
const NECK_CHEEK_RADIUS = 0.13;

// Ojeras: oscurecimiento adicional (con leve tinte frío) bajo los ojos
const EYE_BAG_DARKNESS = 0.32;
const EYE_BAG_TINT_RADIUS = 0.13;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function toNDC(landmark) {
  return { x: (landmark.x - 0.5) * 2, y: -(landmark.y - 0.5) * 2 };
}

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

// Punto más "arriba" (párpado superior) dentro de un conjunto de landmarks del
// ojo. En espacio de imagen crudo Y crece hacia abajo, así que "arriba" es el
// Y más chico
function topPoint(landmarks, indices) {
  let best = landmarks[indices[0]];
  for (const i of indices) {
    if (landmarks[i].y < best.y) best = landmarks[i];
  }
  return best;
}

// Distancia de un punto a un segmento (usado para el surco nasogeniano y las líneas de marioneta)
function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const abLen2 = abx * abx + aby * aby || 1e-9;
  let t = ((px - ax) * abx + (py - ay) * aby) / abLen2;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// Patrón de líneas finas repetidas a lo largo de un parámetro t (0..1 por celda), con perfil suave
function stripes(t, count, halfWidth) {
  const cell = 1 / count;
  const local = ((t % cell) + cell) % cell;
  const distFromCenter = Math.abs(local - cell / 2);
  const w = Math.max(0, 1 - distFromCenter / (halfWidth * cell));
  return smoothstep(w);
}

export class AgingFace {
  constructor() {
    this.intensity = 0; // 0 sin envejecer, 1 envejecimiento máximo

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
    // Landmarks aproximados de cachete/mandíbula (mismos que FaceWarp), usados
    // acá como puntos de control para la caída por gravedad, no para volumen
    this.cheekLeftIndices = [50, 116, 123];
    this.cheekRightIndices = [280, 345, 352];
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

    const faceLeft = toNDC(landmarks[FACE_WIDTH_LEFT]);
    const faceRight = toNDC(landmarks[FACE_WIDTH_RIGHT]);
    const faceScale = Math.hypot(faceRight.x - faceLeft.x, faceRight.y - faceLeft.y);

    // Ángulo de inclinación de la cabeza (roll), para rotar el patrón de
    // arrugas de la frente y que se incline junto con el rostro
    const faceRoll = Math.atan2(faceRight.y - faceLeft.y, faceRight.x - faceLeft.x);
    const rollCos = Math.cos(-faceRoll);
    const rollSin = Math.sin(-faceRoll);

    const ovalAngles = ovalPoints
      .map((p) => ({ angle: Math.atan2(p.y - cy, p.x - cx), radius: Math.hypot(p.x - cx, p.y - cy) }))
      .sort((a, b) => a.angle - b.angle);

    const leftBrow = this._averagePoint(landmarks, this.leftEyebrowIndices);
    const rightBrow = this._averagePoint(landmarks, this.rightEyebrowIndices);
    const browTopY = Math.max(leftBrow.y, rightBrow.y) + 0.04 * faceScale;

    const eyeL = this._averagePoint(landmarks, this.leftEyeIndices);
    const eyeR = this._averagePoint(landmarks, this.rightEyeIndices);
    const eyeLOuter = extremesByX(landmarks, this.leftEyeIndices);
    const eyeROuter = extremesByX(landmarks, this.rightEyeIndices);
    // El punto "externo" es el más alejado del centro de la cara en X (todo en espacio NDC)
    const eyeLMinNDC = toNDC(eyeLOuter.minPoint);
    const eyeLMaxNDC = toNDC(eyeLOuter.maxPoint);
    const cornerL = Math.abs(eyeLMinNDC.x - cx) > Math.abs(eyeLMaxNDC.x - cx) ? eyeLMinNDC : eyeLMaxNDC;
    const eyeRMinNDC = toNDC(eyeROuter.minPoint);
    const eyeRMaxNDC = toNDC(eyeROuter.maxPoint);
    const cornerR = Math.abs(eyeRMinNDC.x - cx) > Math.abs(eyeRMaxNDC.x - cx) ? eyeRMinNDC : eyeRMaxNDC;

    const mouth = extremesByX(landmarks, this.lipIndices);
    const mouthLeft = toNDC(mouth.minPoint);
    const mouthRight = toNDC(mouth.maxPoint);

    const noseTip = toNDC(landmarks[NOSE_TIP]);
    // Aproxima el punto de partida del surco nasogeniano cerca de cada ala de
    // la nariz, desplazando la punta de la nariz hacia cada lado
    const noseCornerL = { x: noseTip.x - 0.045 * faceScale, y: noseTip.y - 0.01 * faceScale };
    const noseCornerR = { x: noseTip.x + 0.045 * faceScale, y: noseTip.y - 0.01 * faceScale };

    const cheekL = this._averagePoint(landmarks, this.cheekLeftIndices);
    const cheekR = this._averagePoint(landmarks, this.cheekRightIndices);

    const eyeBagL = { x: eyeL.x, y: eyeL.y + EYE_BAG_OFFSET_Y * faceScale };
    const eyeBagR = { x: eyeR.x, y: eyeR.y + EYE_BAG_OFFSET_Y * faceScale };

    // Párpado superior (punto más alto de cada ojo): se hunde hacia abajo para
    // una mirada "caída"/cansada, en vez de solo oscurecer debajo
    const eyelidTopL = toNDC(topPoint(landmarks, this.leftEyeIndices));
    const eyelidTopR = toNDC(topPoint(landmarks, this.rightEyeIndices));

    const sagControls = [
      { x: cheekL.x, y: cheekL.y, dx: 0, dy: CHEEK_SAG_DY * faceScale * intensity, radius: CHEEK_SAG_RADIUS * faceScale },
      { x: cheekR.x, y: cheekR.y, dx: 0, dy: CHEEK_SAG_DY * faceScale * intensity, radius: CHEEK_SAG_RADIUS * faceScale },
      { x: eyeBagL.x, y: eyeBagL.y, dx: 0, dy: EYE_BAG_DY * faceScale * intensity, radius: EYE_BAG_RADIUS * faceScale },
      { x: eyeBagR.x, y: eyeBagR.y, dx: 0, dy: EYE_BAG_DY * faceScale * intensity, radius: EYE_BAG_RADIUS * faceScale },
      { x: eyelidTopL.x, y: eyelidTopL.y, dx: 0, dy: EYELID_DROOP_DY * faceScale * intensity, radius: EYELID_DROOP_RADIUS * faceScale },
      { x: eyelidTopR.x, y: eyelidTopR.y, dx: 0, dy: EYELID_DROOP_DY * faceScale * intensity, radius: EYELID_DROOP_RADIUS * faceScale },
      { x: cornerL.x, y: cornerL.y, dx: 0, dy: OUTER_EYE_DROOP_DY * faceScale * intensity, radius: OUTER_EYE_DROOP_RADIUS * faceScale },
      { x: cornerR.x, y: cornerR.y, dx: 0, dy: OUTER_EYE_DROOP_DY * faceScale * intensity, radius: OUTER_EYE_DROOP_RADIUS * faceScale },
      { x: mouthLeft.x, y: mouthLeft.y, dx: -MOUTH_CORNER_DX_IN * faceScale * intensity, dy: MOUTH_CORNER_DY * faceScale * intensity, radius: MOUTH_INFLUENCE_RADIUS * faceScale },
      { x: mouthRight.x, y: mouthRight.y, dx: MOUTH_CORNER_DX_IN * faceScale * intensity, dy: MOUTH_CORNER_DY * faceScale * intensity, radius: MOUTH_INFLUENCE_RADIUS * faceScale }
    ];

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

      // --- Caída por gravedad (desplazamiento local) ---
      let totalDx = 0, totalDy = 0;
      for (const c of sagControls) {
        const d = Math.hypot(vx - c.x, vy - c.y);
        if (d < c.radius) {
          const w = 1 - d / c.radius;
          const falloff = w * w;
          totalDx += c.dx * falloff;
          totalDy += c.dy * falloff;
        }
      }
      pos[i] = vx + totalDx;
      pos[i + 1] = vy + totalDy;

      // --- Arrugas (oscurecimiento periódico) ---
      let wrinkle = 0;

      // Frente: unas pocas líneas cortas y onduladas (no rectas), en un
      // espacio rotado según el roll de la cabeza para que giren con el rostro
      {
        const relX = vx - cx;
        const relY = vy - browTopY;
        const localX = relX * rollCos - relY * rollSin;
        const localY = relX * rollSin + relY * rollCos;

        const bandTotal = FOREHEAD_BAND_HEIGHT * FOREHEAD_LINE_COUNT * faceScale;
        if (localY > 0 && localY < bandTotal) {
          const lineIdx = Math.floor(localY / (FOREHEAD_BAND_HEIGHT * faceScale));
          const lineCenterY = (lineIdx + 0.5) * FOREHEAD_BAND_HEIGHT * faceScale;
          const seed = lineIdx * 17.31; // fase distinta por línea, para que no se repitan iguales
          const wx = (localX / faceScale) * FOREHEAD_WAVE_FREQ;
          const wave = (Math.sin(wx + seed) + Math.sin(wx * 2.3 + seed * 1.7) * 0.4)
            * FOREHEAD_WAVE_AMOUNT * faceScale;
          const distFromLine = Math.abs(localY - lineCenterY - wave);
          const thickness = FOREHEAD_LINE_THICKNESS * faceScale;
          const lengthFade = Math.max(0, 1 - Math.abs(localX) / (FOREHEAD_LINE_LENGTH * faceScale));
          if (distFromLine < thickness && lengthFade > 0) {
            const w = 1 - distFromLine / thickness;
            wrinkle += w * w * smoothstep(lengthFade) * FOREHEAD_WEIGHT;
          }
        }
      }

      // Entrecejo: dos líneas verticales cortas entre las cejas
      {
        const gx = (vx - cx) / (GLABELLA_RADIUS_X * faceScale);
        const gy = (vy - browTopY) / (GLABELLA_RADIUS_Y * faceScale);
        if (Math.abs(gx) < 1 && gy > -0.2 && gy < 1) {
          const fade = smoothstep(Math.max(0, 1 - Math.abs(gx))) *
                       smoothstep(Math.min(1, Math.max(0, Math.min((gy + 0.2) / 0.3, (1 - gy) / 0.4))));
          wrinkle += stripes((gx + 1) / 2, GLABELLA_LINE_COUNT, GLABELLA_HALF_WIDTH) * fade * 0.9;
        }
      }

      // Patas de gallo: abanico de líneas radiando desde la comisura externa de cada ojo
      for (const corner of [cornerL, cornerR]) {
        const cdx = vx - corner.x;
        const cdy = vy - corner.y;
        const cdist = Math.hypot(cdx, cdy);
        const radius = CROWSFEET_RADIUS * faceScale;
        if (cdist < radius) {
          const outDirSign = Math.sign(corner.x - cx) || 1;
          const baseAngle = outDirSign > 0 ? 0 : Math.PI;
          let relAngle = Math.atan2(cdy, cdx) - baseAngle;
          relAngle = Math.atan2(Math.sin(relAngle), Math.cos(relAngle)); // normaliza a [-PI, PI]
          if (Math.abs(relAngle) < CROWSFEET_FAN_HALF_ANGLE) {
            const angT = (relAngle + CROWSFEET_FAN_HALF_ANGLE) / (2 * CROWSFEET_FAN_HALF_ANGLE);
            const radialFade = 1 - cdist / radius;
            wrinkle += stripes(angT, CROWSFEET_LINE_COUNT, CROWSFEET_LINE_HALF_WIDTH) * radialFade * radialFade;
          }
        }
      }

      // Surco nasogeniano: banda oscura a lo largo del segmento nariz-comisura de la boca
      for (const seg of [
        { a: noseCornerL, b: mouthLeft },
        { a: noseCornerR, b: mouthRight }
      ]) {
        const { dist: segDist, t: segT } = distanceToSegment(vx, vy, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
        const width = NASOLABIAL_HALF_WIDTH * faceScale;
        if (segDist < width) {
          const endFade = Math.min(1, segT / NASOLABIAL_FADE, (1 - segT) / NASOLABIAL_FADE);
          const w = 1 - segDist / width;
          wrinkle += w * w * Math.max(0, endFade);
        }
      }

      // Líneas de marioneta: continúan desde la comisura hacia la mandíbula
      for (const m of [mouthLeft, mouthRight]) {
        const end = {
          x: m.x + Math.sign(m.x - cx) * 0.03 * faceScale,
          y: m.y - MARIONETTE_LEN * faceScale
        };
        const { dist: segDist, t: segT } = distanceToSegment(vx, vy, m.x, m.y, end.x, end.y);
        const width = MARIONETTE_HALF_WIDTH * faceScale;
        if (segDist < width) {
          const endFade = smoothstep(Math.min(1, Math.max(0, Math.min(segT / 0.15, (1 - segT) / 0.35))));
          wrinkle += smoothstep(1 - segDist / width) * endFade * 0.8;
        }
      }

      // "Código de barras": líneas verticales finas sobre el labio superior
      {
        const mouthCx = (mouthLeft.x + mouthRight.x) / 2;
        const mouthTopY = Math.max(mouthLeft.y, mouthRight.y);
        const lx = (vx - mouthCx) / (UPPER_LIP_RADIUS_X * faceScale);
        const ly = (vy - mouthTopY) / (UPPER_LIP_RADIUS_Y * faceScale);
        if (Math.abs(lx) < 1 && ly > 0 && ly < 1) {
          const fade = smoothstep(Math.max(0, 1 - Math.abs(lx))) * smoothstep(1 - ly);
          wrinkle += stripes((lx + 1) / 2, UPPER_LIP_LINE_COUNT, UPPER_LIP_HALF_WIDTH) * fade * 0.7;
        }
      }

      // Pliegues de mejilla baja (diagonales, bajo el pómulo)
      for (const ck of [cheekL, cheekR]) {
        const ox = vx - ck.x;
        const oy = vy - (ck.y - 0.05 * faceScale);
        const rad = NECK_CHEEK_RADIUS * faceScale;
        const d = Math.hypot(ox, oy);
        if (d < rad) {
          // proyecta sobre una diagonal (arriba-afuera → abajo-adentro)
          const sgn = Math.sign(ck.x - cx) || 1;
          const proj = (ox * sgn * 0.5 + oy * -0.866) / rad;
          const fade = smoothstep(1 - d / rad);
          wrinkle += stripes((proj + 1) / 2, NECK_CHEEK_LINE_COUNT, NECK_CHEEK_HALF_WIDTH) * fade * fade * 0.65;
        }
      }

      // Acumulación suave (nunca satura de golpe, tope asintótico en 1) y recorte por el óvalo
      wrinkle = 1 - Math.exp(-wrinkle * 1.4);
      wrinkle *= confinement;

      // --- Tono de piel envejecido ---
      const toneAmount = SKIN_TONE_AMOUNT * intensity * confinement;
      let r = 1 - toneAmount * (1 - SKIN_TONE.r);
      let g = 1 - toneAmount * (1 - SKIN_TONE.g);
      let b = 1 - toneAmount * (1 - SKIN_TONE.b);

      // Arrugas: oscurecen multiplicativamente sobre el tono base (confinamiento ya aplicado arriba)
      const darken = 1 - wrinkle * WRINKLE_DARKNESS * intensity;
      r *= darken; g *= darken; b *= darken;

      // Ojeras: oscurecimiento extra con un leve tinte frío bajo los ojos
      for (const bag of [eyeBagL, eyeBagR]) {
        const bdist = Math.hypot(vx - bag.x, vy - bag.y);
        const bagRadius = EYE_BAG_TINT_RADIUS * faceScale;
        if (bdist < bagRadius) {
          const w = 1 - bdist / bagRadius;
          const bagDarken = 1 - w * w * EYE_BAG_DARKNESS * intensity * confinement;
          r *= bagDarken;
          g *= bagDarken * 0.985;
          b *= bagDarken * 1.02;
        }
      }

      color[i] = r;
      color[i + 1] = g;
      color[i + 2] = b;
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
