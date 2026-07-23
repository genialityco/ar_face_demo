/**
 * FaceWarp - Deforma la cara en el video en vivo para un efecto de "obesidad"
 * mucho más realista que un simple inflado radial uniforme desde el centro.
 *
 * Técnica:
 * 1. Múltiples centros de deformación DIRECCIONALES (cachetes, papada,
 *    submandibular, mentón, cuello) en vez de un único empuje radial desde
 *    el centro de la cara — el volumen se acumula donde realmente se acumula
 *    grasa (cada zona empuja en su propia mezcla de "lateral" y "abajo"), no
 *    como un globo simétrico.
 * 2. El contorno del óvalo facial también se ensancha, no solo el interior:
 *    se calcula un óvalo "objetivo" más ancho (más ancho cerca de cachetes/
 *    mandíbula, casi sin cambio cerca de la frente) y los píxeles del fondo
 *    justo afuera del óvalo original se COMPRIMEN hacia el nuevo borde en vez
 *    de estirarse desde el borde viejo (evita el "halo" de fondo estirado).
 * 3. Suavizado temporal (EMA) sobre los landmarks usados, para que el efecto
 *    no vibre con el ruido normal de MediaPipe.
 * 4. El bulge y los radios de influencia (sigma) se normalizan por el tamaño
 *    real de la cara en pantalla (ancho entre mejillas), así el efecto se ve
 *    igual sin importar qué tan cerca esté la persona de la cámara.
 * 5. Sombreado con tinte cálido de piel (no gris puro): resalte donde el
 *    campo de desplazamiento expande (piel más tensa), sombra en el margen
 *    donde el contorno original se comprime contra el nuevo borde.
 *
 * Sin implementar (cambio de arquitectura más grande, no incluido en esta
 * pasada): mapeo UV inverso en el fragment shader en vez de desplazar
 * vértices de una grilla. Eliminaría el stretching de triángulos y no
 * dependería de la densidad de la grilla, pero requiere reescribir el
 * material como NodeMaterial/TSL con muestreo inverso de UV.
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const GRID_SEGMENTS_X = 100;
const GRID_SEGMENTS_Y = 75;

// Landmarks usados para medir el ancho real de la cara en pantalla (entre
// mejillas), y así normalizar el bulge y los sigmas sin importar la distancia
// a la cámara
const FACE_WIDTH_LEFT = 234;
const FACE_WIDTH_RIGHT = 454;

// Suavizado temporal (EMA) de los landmarks usados: más alto = responde más
// rápido pero más vibración; más bajo = más estable pero con más lag
const EMA_ALPHA = 0.6;

// Ancho (relativo al ancho de cara) de la franja de transición donde el fondo
// se comprime hacia el nuevo contorno ensanchado, en vez de mostrar una costura.
// Más ancho = la compresión se reparte en más píxeles y se nota menos
const SILHOUETTE_MARGIN = 0.2;
// Cuánto se ensancha como máximo el contorno (además del inflado interior),
// escalado por la influencia local de cachetes/mandíbula en cada punto del óvalo
const SILHOUETTE_WIDEN = 0.55;

// Normaliza la intensidad del sombreado según bulgeAmount (0 = sin sombreado)
const SHADE_REFERENCE_BULGE = 0.14;
const HIGHLIGHT_STRENGTH = 0.12;
const SHADOW_STRENGTH = 0.14;

// Curva suave (S) usada para desvanecer confinamiento/transiciones sin
// generar un quiebre visible (derivada 0 en los dos extremos)
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
// Tinte cálido por canal (relativo, no gris puro): más alto = ese canal recibe
// más del resalte/sombra. Resalte dorado (rojo/verde suben más que el azul),
// sombra cálida (el azul cae más que el rojo, en vez de un gris frío)
const HIGHLIGHT_TINT = { r: 1.0, g: 0.85, b: 0.6 };
const SHADOW_TINT = { r: 0.7, g: 0.85, b: 1.0 };

// Zonas de deformación: cada una empuja en su propia dirección (mezcla de
// "lateral", alejándose del centro de la cara, y "hacia abajo") con su propio
// alcance (sigma) e intensidad, en vez de un único empuje radial simétrico
const DEFORMATION_ZONES = [
  // Cachetes: lateral + un poco hacia abajo
  { indices: [50, 116, 123], lateralWeight: 1.0, downWeight: 0.45, strength: 1.0, sigma: 0.26 },
  { indices: [280, 345, 352], lateralWeight: 1.0, downWeight: 0.45, strength: 1.0, sigma: 0.26 },
  // Papada: principalmente hacia abajo
  { indices: [152, 175, 199], lateralWeight: 0.1, downWeight: 1.0, strength: 0.9, sigma: 0.22 },
  // Submandibular: abajo + lateral en partes similares
  { indices: [172], lateralWeight: 0.7, downWeight: 0.7, strength: 0.6, sigma: 0.18 },
  { indices: [397], lateralWeight: 0.7, downWeight: 0.7, strength: 0.6, sigma: 0.18 },
  // Mentón: hacia abajo, sutil
  { indices: [152], lateralWeight: 0, downWeight: 1.0, strength: 0.3, sigma: 0.13 }
];

// Cuello: MediaPipe Face Mesh no tiene landmarks de cuello, así que se
// aproxima desplazando el ancla de la papada más abajo. A diferencia de las
// demás zonas, esta NO se confina al óvalo facial (afecta lo que se ve debajo
// de la cara)
const NECK_ZONE = {
  indices: [152, 176, 400],
  anchorDownOffset: 0.35,
  lateralWeight: 0.9,
  downWeight: 0.2,
  strength: 0.45,
  sigma: 0.32
};

// Encogimiento sutil alrededor de los ojos (la grasa periorbital hace que los
// párpados se vean más chicos). Es una FRACCIÓN (0..1) de la distancia
// restante al centro del ojo, no una magnitud fija — así nunca puede "pasarse"
// del centro y plegar la malla cuando el vértice ya está muy cerca
const EYE_SHRINK_AMOUNT = 0.3;
const EYE_SHRINK_SIGMA = 0.09;

export class FaceWarp {
  constructor() {
    // Máxima "inflada" (se normaliza por el ancho real de la cara en cada frame)
    this.bulgeAmount = 0.12;

    this.geometry = new THREE.PlaneGeometry(2, 2, GRID_SEGMENTS_X, GRID_SEGMENTS_Y);
    this.restPositions = this.geometry.attributes.position.array.slice();

    // Color por vértice para el sombreado falso (blanco = sin cambio)
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

    // Mismo patrón que el quad de pantalla completa de MetaballEffect
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.ovalIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap((c) => [c.start, c.end])
    )];
    this.leftEyeIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYE.flatMap((c) => [c.start, c.end])
    )];
    this.rightEyeIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE.flatMap((c) => [c.start, c.end])
    )];

    // Suavizado temporal (EMA) por índice de landmark, para no vibrar con el ruido de MediaPipe
    this._smoothed = new Map();
  }

  /**
   * Establece la textura de video a deformar
   * @param {THREE.Texture} texture
   */
  setBackgroundTexture(texture) {
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  // Convierte un landmark a espacio NDC y aplica suavizado temporal (EMA) por índice
  _smoothedNDC(landmarks, index) {
    const lm = landmarks[index];
    const rawX = (lm.x - 0.5) * 2;
    const rawY = -(lm.y - 0.5) * 2;
    let s = this._smoothed.get(index);
    if (!s) {
      s = { x: rawX, y: rawY };
      this._smoothed.set(index, s);
    } else {
      s.x += (rawX - s.x) * EMA_ALPHA;
      s.y += (rawY - s.y) * EMA_ALPHA;
    }
    return s;
  }

  _averagePoint(landmarks, indices) {
    let x = 0, y = 0;
    for (const i of indices) {
      const p = this._smoothedNDC(landmarks, i);
      x += p.x; y += p.y;
    }
    return { x: x / indices.length, y: y / indices.length };
  }

  // Interpola un valor de radio en un ángulo arbitrario dentro de una tabla
  // {angle, radius}[] ordenada por ángulo (búsqueda binaria + lerp)
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

  /**
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   */
  update(landmarks) {
    if (!landmarks) {
      this._resetPositions();
      return;
    }

    // Centro y puntos del óvalo facial (suavizados)
    let cx = 0, cy = 0;
    const ovalPoints = this.ovalIndices.map((i) => {
      const p = this._smoothedNDC(landmarks, i);
      cx += p.x; cy += p.y;
      return p;
    });
    cx /= ovalPoints.length;
    cy /= ovalPoints.length;

    // Ancho real de la cara en pantalla (entre mejillas): normaliza el bulge
    // y los sigmas sin importar la distancia a la cámara
    const faceLeft = this._smoothedNDC(landmarks, FACE_WIDTH_LEFT);
    const faceRight = this._smoothedNDC(landmarks, FACE_WIDTH_RIGHT);
    const faceScale = Math.hypot(faceRight.x - faceLeft.x, faceRight.y - faceLeft.y);

    const bulge = this.bulgeAmount * faceScale;
    // Progreso de intensidad del sombreado (0 sin efecto, 1 en bulgeAmount máximo)
    const shadeRatio = Math.min(1, this.bulgeAmount / SHADE_REFERENCE_BULGE);

    // Radio del óvalo original para cada ángulo (confinamiento + base del ensanchado)
    const ovalAngles = ovalPoints
      .map((p) => ({ angle: Math.atan2(p.y - cy, p.x - cx), radius: Math.hypot(p.x - cx, p.y - cy) }))
      .sort((a, b) => a.angle - b.angle);

    // Arma las zonas de deformación con ancla (suavizada), dirección resuelta
    // (lateral según el lado real respecto al centro) y sigma escalado por el
    // tamaño real de la cara
    const zones = DEFORMATION_ZONES.map((def) => {
      const anchor = this._averagePoint(landmarks, def.indices);
      const lateralSign = Math.sign(anchor.x - cx) || 1;
      const dirX = lateralSign * def.lateralWeight;
      const dirY = -def.downWeight; // "abajo" = Y negativo en este espacio
      const len = Math.hypot(dirX, dirY) || 1;
      return {
        x: anchor.x,
        y: anchor.y,
        dirX: dirX / len,
        dirY: dirY / len,
        strength: def.strength,
        sigma: def.sigma * faceScale
      };
    });

    const neckAnchor = this._averagePoint(landmarks, NECK_ZONE.indices);
    const neckZone = {
      x: neckAnchor.x,
      y: neckAnchor.y - NECK_ZONE.anchorDownOffset * faceScale,
      dirX: Math.sign(neckAnchor.x - cx) * NECK_ZONE.lateralWeight,
      dirY: -NECK_ZONE.downWeight,
      strength: NECK_ZONE.strength,
      sigma: NECK_ZONE.sigma * faceScale
    };
    {
      const len = Math.hypot(neckZone.dirX, neckZone.dirY) || 1;
      neckZone.dirX /= len;
      neckZone.dirY /= len;
    }

    const eyeL = this._averagePoint(landmarks, this.leftEyeIndices);
    const eyeR = this._averagePoint(landmarks, this.rightEyeIndices);
    const eyeSigma = EYE_SHRINK_SIGMA * faceScale;

    // Óvalo "objetivo" (ensanchado): en cada punto del óvalo original, se
    // ensancha en proporción a la influencia local de las zonas de cachete/
    // mandíbula ahí mismo (el contorno se ensancha donde hay volumen nuevo,
    // no parejo en todo el perímetro)
    const targetOvalAngles = ovalAngles.map((o, idx) => {
      const p = ovalPoints[idx];
      let influence = 0;
      for (const z of zones) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        influence += z.strength * Math.exp(-(d * d) / (2 * z.sigma * z.sigma));
      }
      influence = Math.min(1, influence);
      return { angle: o.angle, radius: o.radius + SILHOUETTE_WIDEN * bulge * influence };
    });

    const margin = SILHOUETTE_MARGIN * faceScale;

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
      const boundaryTarget = this._radiusAt(targetOvalAngles, angle);

      // --- Paso 1: ensanchado del contorno (silueta) ---
      // La franja de transición usa un empalme Hermite (C1): coincide en valor
      // Y en pendiente con el reescalado interior (en boundaryOrig) y con la
      // identidad del fondo sin tocar (en boundaryOrig+margin). Un empalme
      // solo por valor (lineal) deja un quiebre de pendiente ahí mismo, que se
      // ve como un contorno/costura dibujado alrededor de la cara.
      let silhouetteDist = dist;
      const innerSlope = boundaryTarget / boundaryOrig;
      if (dist <= boundaryOrig) {
        // Adentro: reescala proporcionalmente para llenar el nuevo contorno
        silhouetteDist = dist * innerSlope;
      } else if (dist <= boundaryOrig + margin) {
        const t = (dist - boundaryOrig) / margin;
        const t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        // m0/m1 son las derivadas respecto a t (no a dist), por eso van *margin
        silhouetteDist = h00 * boundaryTarget + h10 * (innerSlope * margin)
          + h01 * (boundaryOrig + margin) + h11 * margin;
      }

      let px = cx + dx * (silhouetteDist / dist);
      let py = cy + dy * (silhouetteDist / dist);

      // Confinamiento de las zonas direccionales: 1 adentro del óvalo original,
      // se desvanece suavemente en el margen (el cuello se maneja aparte, sin confinar)
      const confT = Math.min(1, Math.max(0, Math.max(0, dist - boundaryOrig) / margin));
      const confinement = 1 - smoothstep(confT);

      // --- Paso 2: volumen direccional (cachetes, papada, submandibular, mentón) ---
      let addX = 0, addY = 0;
      let expandInfluence = 0;
      for (const z of zones) {
        const zdx = vx - z.x;
        const zdy = vy - z.y;
        const d2 = zdx * zdx + zdy * zdy;
        const w = z.strength * Math.exp(-d2 / (2 * z.sigma * z.sigma));
        addX += z.dirX * bulge * w;
        addY += z.dirY * bulge * w;
        expandInfluence += w;
      }

      // Cuello: no se confina al óvalo (se ve debajo de la cara)
      {
        const zdx = vx - neckZone.x;
        const zdy = vy - neckZone.y;
        const d2 = zdx * zdx + zdy * zdy;
        const w = neckZone.strength * Math.exp(-d2 / (2 * neckZone.sigma * neckZone.sigma));
        px += neckZone.dirX * bulge * w;
        py += neckZone.dirY * bulge * w;
      }

      // Encogimiento sutil alrededor de los ojos (grasa periorbital): tira una
      // fracción de la distancia restante hacia cada centro de ojo, así el
      // vértice nunca cruza el centro sin importar qué tan cerca ya esté
      {
        const dLx = vx - eyeL.x, dLy = vy - eyeL.y;
        const dRx = vx - eyeR.x, dRy = vy - eyeR.y;
        const wL = Math.exp(-(dLx * dLx + dLy * dLy) / (2 * eyeSigma * eyeSigma));
        const wR = Math.exp(-(dRx * dRx + dRy * dRy) / (2 * eyeSigma * eyeSigma));
        const factorL = EYE_SHRINK_AMOUNT * wL * shadeRatio;
        const factorR = EYE_SHRINK_AMOUNT * wR * shadeRatio;
        addX += -dLx * factorL - dRx * factorR;
        addY += -dLy * factorL - dRy * factorR;
      }

      pos[i] = px + addX * confinement;
      pos[i + 1] = py + addY * confinement;

      // --- Sombreado: resalte donde el campo expande, sombra en el margen comprimido ---
      const highlight = HIGHLIGHT_STRENGTH * Math.min(1, expandInfluence) * confinement * shadeRatio;
      const compression = dist > boundaryOrig
        ? Math.min(1, Math.max(0, (dist - boundaryOrig) / margin))
        : 0;
      const shadow = SHADOW_STRENGTH * Math.sin(Math.PI * compression) * shadeRatio;

      const shade = 1 + highlight - shadow;
      if (shade >= 1) {
        const s = shade - 1;
        color[i] = 1 + s * HIGHLIGHT_TINT.r;
        color[i + 1] = 1 + s * HIGHLIGHT_TINT.g;
        color[i + 2] = 1 + s * HIGHLIGHT_TINT.b;
      } else {
        const s = 1 - shade;
        color[i] = 1 - s * SHADOW_TINT.r;
        color[i + 1] = 1 - s * SHADOW_TINT.g;
        color[i + 2] = 1 - s * SHADOW_TINT.b;
      }
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
