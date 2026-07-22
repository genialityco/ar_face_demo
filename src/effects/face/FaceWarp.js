/**
 * FaceWarp - Deforma la cara en el video en vivo (efecto "cara inflada")
 * usando los landmarks del rostro, contenido estrictamente dentro del
 * contorno facial (no arrastra fondo/pelo/cuello).
 *
 * Técnica: el video se dibuja sobre un plano subdividido en una grilla fina
 * (en espacio NDC, igual que el quad de pantalla completa de MetaballEffect).
 * El óvalo facial (FACE_LANDMARKS_FACE_OVAL) define, para cada ángulo
 * alrededor del centro del rostro, un radio límite (el borde real de la cara
 * en esa dirección). Cada vértice de la grilla se remapea radialmente desde
 * ese centro: adentro del óvalo se infla hacia el borde (más cerca del borde,
 * más empuje), y justo afuera hay una franja de transición que también se
 * empuja un poco (con caída suave) para que el contorno se note ensanchado
 * sin dejar una costura entre la cara y el fondo/pelo circundante.
 * La UV de cada vértice queda fija en su posición original, así que el video
 * se estira hacia la nueva forma en vez de mostrar una costura.
 *
 * Además, el efecto solo se aplica por debajo de la boca (cachetes, mandíbula,
 * mentón): se calcula la altura de la boca y todo lo que queda por encima
 * (frente, ojos, cachetes superiores) se deja intacto, con una transición suave
 * justo en la línea de la boca para que no se note un corte brusco.
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const GRID_SEGMENTS_X = 60;
const GRID_SEGMENTS_Y = 45;

// Ancho (en unidades NDC) de la transición suave alrededor de la línea de la boca
const MOUTH_MASK_FADE = 0.08;

export class FaceWarp {
  constructor() {
    // Máxima "inflada" hacia el borde del óvalo (unidades NDC, -1 a 1)
    this.bulgeAmount = 0.12;

    this.geometry = new THREE.PlaneGeometry(2, 2, GRID_SEGMENTS_X, GRID_SEGMENTS_Y);
    this.restPositions = this.geometry.attributes.position.array.slice();

    this.material = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
    // Evita que el tonemapping del renderer altere el color del video (que se ve "crudo" en los demás filtros)
    this.material.toneMapped = false;

    this.mesh = new THREE.Mesh(this.geometry, this.material);

    // Mismo patrón que el quad de pantalla completa de MetaballEffect
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.controlIndices = [...new Set(
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap((c) => [c.start, c.end])
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

    // Centro del rostro (promedio del óvalo facial) en espacio NDC
    let cx = 0, cy = 0;
    const ovalPoints = this.controlIndices.map((i) => {
      const lm = landmarks[i];
      const x = (lm.x - 0.5) * 2;
      const y = -(lm.y - 0.5) * 2;
      cx += x; cy += y;
      return { x, y };
    });
    cx /= ovalPoints.length;
    cy /= ovalPoints.length;

    // Altura de la boca (promedio de sus landmarks) en espacio NDC: define el límite superior del efecto
    let mouthY = 0;
    for (const i of this.lipIndices) {
      mouthY += -(landmarks[i].y - 0.5) * 2;
    }
    mouthY /= this.lipIndices.length;

    // Radio del borde facial (óvalo) para cada ángulo alrededor del centro, ordenado por ángulo
    const ovalAngles = ovalPoints
      .map((p) => ({
        angle: Math.atan2(p.y - cy, p.x - cx),
        radius: Math.hypot(p.x - cx, p.y - cy)
      }))
      .sort((a, b) => a.angle - b.angle);
    const n = ovalAngles.length;

    // Interpola el radio del borde facial en un ángulo arbitrario (búsqueda binaria + lerp)
    const boundaryRadiusAt = (angle) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ovalAngles[mid].angle < angle) lo = mid + 1; else hi = mid;
      }
      const after = ovalAngles[lo % n];
      const before = ovalAngles[(lo - 1 + n) % n];
      let span = after.angle - before.angle;
      if (span <= 0) span += Math.PI * 2;
      let da = angle - before.angle;
      if (da < 0) da += Math.PI * 2;
      const t = span > 0 ? da / span : 0;
      return before.radius + (after.radius - before.radius) * t;
    };

    const posAttr = this.geometry.attributes.position;
    const pos = posAttr.array;
    const rest = this.restPositions;
    const bulge = this.bulgeAmount;
    // Franja justo afuera del óvalo que también se arrastra un poco, para que el
    // contorno se note ensanchado sin dejar una costura con el fondo/pelo
    const overflowWidth = bulge * 1.5;

    for (let i = 0; i < pos.length; i += 3) {
      const vx = rest[i];
      const vy = rest[i + 1];

      const dx = vx - cx;
      const dy = vy - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < 1e-5) {
        pos[i] = vx;
        pos[i + 1] = vy;
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const boundary = boundaryRadiusAt(angle);

      // Máscara: 1 por debajo de la boca, 0 por encima, con transición suave en el medio
      const maskRaw = (mouthY + MOUTH_MASK_FADE - vy) / (2 * MOUTH_MASK_FADE);
      const mask = Math.min(1, Math.max(0, maskRaw));

      let push = 0;
      if (mask > 0) {
        if (dist < boundary) {
          // Adentro del óvalo: empuja más fuerte cerca del borde
          const t = dist / boundary;
          push = bulge * t * t * mask;
        } else if (dist < boundary + overflowWidth) {
          // Justo afuera: arrastra un poco, con caída suave hasta el final de la franja
          const edgeT = (dist - boundary) / overflowWidth;
          push = bulge * (1 - edgeT) * mask;
        }
      }

      if (push <= 0) {
        pos[i] = vx;
        pos[i + 1] = vy;
      } else {
        const newDist = dist + push;
        const scale = newDist / dist;
        pos[i] = cx + dx * scale;
        pos[i + 1] = cy + dy * scale;
      }
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
