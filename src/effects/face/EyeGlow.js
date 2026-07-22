/**
 * EyeGlow - Fuego en los ojos al fruncir el ceño, destellos al sonreír
 * Usa los blendshapes de MediaPipe (browDownLeft/Right, mouthSmileLeft/Right)
 * para controlar la intensidad de cada efecto en tiempo real.
 * Al igual que HoloScan, se posiciona con landmarks 2D en la escena principal
 * (no usa facialTransformationMatrix ni el maskScene).
 */
import * as THREE from 'three/webgpu';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  Fn, vec3, vec4, float, uv, uniform, time,
  sin, pow, smoothstep, mix, abs, length, clamp
} from 'three/tsl';

const FIRE_SIZE = 0.35;
const SPARKLE_SIZE = 0.12;
const SPARKLES_PER_EYE = 3;

// Suaviza/umbraliza un valor 0-1 para evitar parpadeo con blendshapes ruidosos
function smoothThreshold(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createFireMaterial() {
  const intensity = uniform(0);

  const fragmentNode = Fn(() => {
    const p = uv();
    const t = time;

    // Tambaleo horizontal de la llama (dos frecuencias combinadas)
    const wobble = sin(p.y.mul(14).add(t.mul(7))).mul(0.05).mul(float(1).sub(p.y));
    const wobble2 = sin(p.y.mul(23).sub(t.mul(11))).mul(0.025).mul(float(1).sub(p.y));
    const cx = p.x.sub(0.5).add(wobble).add(wobble2);

    // La llama se angosta hacia arriba
    const halfWidth = pow(float(1).sub(p.y), 0.55).mul(0.42).add(0.02);
    const core = float(1).sub(smoothstep(halfWidth.mul(0.35), halfWidth, abs(cx)));

    // Desvanecido arriba (punta) y abajo (base)
    const vFadeTop = smoothstep(float(1.0), float(0.5), p.y);
    const vFadeBottom = smoothstep(float(0.0), float(0.1), p.y);
    const shape = core.mul(vFadeTop).mul(vFadeBottom);

    // Degradado de color: amarillo (base) -> naranja -> rojo (punta)
    const colorLow = vec3(1.0, 0.95, 0.55);
    const colorMid = vec3(1.0, 0.45, 0.05);
    const colorHigh = vec3(0.6, 0.05, 0.0);
    const c1 = mix(colorLow, colorMid, smoothstep(float(0.0), float(0.5), p.y));
    const flameColor = mix(c1, colorHigh, smoothstep(float(0.5), float(1.0), p.y));

    return vec4(flameColor, shape.mul(intensity));
  });

  const material = new THREE.NodeMaterial();
  material.fragmentNode = fragmentNode();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData.intensityUniform = intensity;
  return material;
}

function createSparkleMaterial(phase) {
  const intensity = uniform(0);

  const fragmentNode = Fn(() => {
    const d = uv().sub(0.5);
    const t = time;
    const twinkle = sin(t.mul(4).add(float(phase))).mul(0.5).add(0.5);

    // Resplandor central suave + dos rayos cruzados (destello de 4 puntas)
    const glow = pow(float(1).sub(clamp(length(d).mul(2), 0.0, 1.0)), 3);
    const rayH = pow(float(1).sub(clamp(abs(d.x).mul(40), 0.0, 1.0)), 1).mul(
      pow(float(1).sub(clamp(abs(d.y).mul(3), 0.0, 1.0)), 1)
    );
    const rayV = pow(float(1).sub(clamp(abs(d.y).mul(40), 0.0, 1.0)), 1).mul(
      pow(float(1).sub(clamp(abs(d.x).mul(3), 0.0, 1.0)), 1)
    );
    const shape = glow.mul(0.5).add(rayH).add(rayV);

    const color = vec3(1.0, 1.0, 1.0);
    return vec4(color, shape.mul(twinkle).mul(intensity));
  });

  const material = new THREE.NodeMaterial();
  material.fragmentNode = fragmentNode();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData.intensityUniform = intensity;
  return material;
}

export class EyeGlow {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.geometry = new THREE.PlaneGeometry(1, 1);

    // Fuego: uno por ojo
    this.fireMeshes = [0, 1].map(() => {
      const mesh = new THREE.Mesh(this.geometry, createFireMaterial());
      mesh.scale.set(FIRE_SIZE, FIRE_SIZE * 1.4, 1);
      this.group.add(mesh);
      return mesh;
    });

    // Destellos: varios por ojo, con fase y offset fijos al azar
    this.sparkleMeshes = [0, 1].map(() => {
      const meshes = [];
      for (let i = 0; i < SPARKLES_PER_EYE; i++) {
        const phase = Math.random() * Math.PI * 2;
        const mesh = new THREE.Mesh(this.geometry, createSparkleMaterial(phase));
        const s = SPARKLE_SIZE * (0.6 + Math.random() * 0.6);
        mesh.scale.set(s, s, 1);
        mesh.userData.offset = new THREE.Vector2(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.2
        );
        this.group.add(mesh);
        meshes.push(mesh);
      }
      return meshes;
    });
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  // Centro de un ojo = promedio de los landmarks de su contorno oficial de MediaPipe
  _eyeCenter(landmarks, connections, projectFn) {
    const seen = new Set();
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const { start, end } of connections) {
      for (const idx of [start, end]) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const lm = landmarks[idx];
        sx += lm.x; sy += lm.y; sz += lm.z;
        count++;
      }
    }
    return projectFn(sx / count, sy / count, sz / count);
  }

  /**
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   * @param {Object|null} blendshapes - { browDownLeft, browDownRight, mouthSmileLeft, mouthSmileRight, ... }
   * @param {(x:number,y:number,z:number) => THREE.Vector3} projectFn
   * @param {THREE.Camera} camera - para orientar los quads hacia la cámara
   */
  update(landmarks, blendshapes, projectFn, camera) {
    if (!landmarks || !blendshapes) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const frown = ((blendshapes.browDownLeft ?? 0) + (blendshapes.browDownRight ?? 0)) / 2;
    const smile = ((blendshapes.mouthSmileLeft ?? 0) + (blendshapes.mouthSmileRight ?? 0)) / 2;

    const fireIntensity = smoothThreshold(0.25, 0.7, frown);
    const sparkleIntensity = smoothThreshold(0.2, 0.6, smile);

    const eyeCenters = [
      this._eyeCenter(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, projectFn),
      this._eyeCenter(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, projectFn)
    ];

    for (let eye = 0; eye < 2; eye++) {
      const center = eyeCenters[eye];

      const fireMesh = this.fireMeshes[eye];
      fireMesh.position.set(center.x, center.y + FIRE_SIZE * 0.5, center.z);
      fireMesh.quaternion.copy(camera.quaternion);
      fireMesh.material.userData.intensityUniform.value = fireIntensity;

      for (const sparkleMesh of this.sparkleMeshes[eye]) {
        const offset = sparkleMesh.userData.offset;
        sparkleMesh.position.set(center.x + offset.x, center.y + offset.y, center.z);
        sparkleMesh.quaternion.copy(camera.quaternion);
        sparkleMesh.material.userData.intensityUniform.value = sparkleIntensity;
      }
    }
  }

  dispose() {
    this.geometry.dispose();
    for (const mesh of [...this.fireMeshes, ...this.sparkleMeshes.flat()]) {
      mesh.material.dispose();
    }
  }
}
