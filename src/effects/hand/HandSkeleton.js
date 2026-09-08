/**
 * HandSkeleton - Dibuja ambas manos como un "esqueleto de huesos": líneas entre
 * los 21 landmarks de MediaPipe Hand (topología estándar) + un punto en cada
 * articulación. Compartido por todas las experiencias que usan las manos
 * (metaball, máscara/casco agarrables, hamburguesas, plata, gimnasio, cubos).
 *
 * Vive en la escena principal y se posiciona con projectToWorld (mismo criterio
 * que HoloScan con los landmarks del rostro), así que basta con agregarlo una
 * vez a this.scene y togglear su visibilidad según el filtro activo.
 */
import * as THREE from 'three/webgpu';

// Huesos de la mano (pares de landmarks) según la topología estándar de MediaPipe
export const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],         // pulgar
  [0, 5], [5, 6], [6, 7], [7, 8],         // índice
  [5, 9], [9, 10], [10, 11], [11, 12],    // medio
  [9, 13], [13, 14], [14, 15], [15, 16],  // anular
  [13, 17], [17, 18], [18, 19], [19, 20], // meñique
  [0, 17]                                  // base de la palma
];
export const NUM_HAND_LANDMARKS = 21;

const SKELETON_COLOR = 0x00e5ff; // cian

export class HandSkeleton {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.skeletons = {};
    for (const hand of ['Left', 'Right']) {
      const boneGeo = new THREE.BufferGeometry();
      boneGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(HAND_BONES.length * 2 * 3), 3)
      );
      const boneMat = new THREE.LineBasicMaterial({
        color: SKELETON_COLOR,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false // el esqueleto siempre visible sobre la mano (no lo tapa el oclusor ni los cubos)
      });
      const bones = new THREE.LineSegments(boneGeo, boneMat);
      bones.frustumCulled = false;

      const jointGeo = new THREE.BufferGeometry();
      jointGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(NUM_HAND_LANDMARKS * 3), 3)
      );
      const jointMat = new THREE.PointsMaterial({
        color: SKELETON_COLOR,
        size: 0.07,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true
      });
      const joints = new THREE.Points(jointGeo, jointMat);
      joints.frustumCulled = false;

      const holder = new THREE.Group();
      holder.add(bones);
      holder.add(joints);
      this.group.add(holder);
      this.skeletons[hand] = { holder, bones, joints };
    }
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  _updateHand(hand, handLandmarks, projectFn) {
    const sk = this.skeletons[hand];
    if (!handLandmarks) {
      sk.holder.visible = false;
      return;
    }
    sk.holder.visible = true;

    const world = handLandmarks.map((lm) => projectFn(lm.x, lm.y, lm.z));

    const bonePos = sk.bones.geometry.attributes.position.array;
    for (let i = 0; i < HAND_BONES.length; i++) {
      const [a, b] = HAND_BONES[i];
      const pa = world[a];
      const pb = world[b];
      const o = i * 6;
      bonePos[o] = pa.x; bonePos[o + 1] = pa.y; bonePos[o + 2] = pa.z;
      bonePos[o + 3] = pb.x; bonePos[o + 4] = pb.y; bonePos[o + 5] = pb.z;
    }
    sk.bones.geometry.attributes.position.needsUpdate = true;

    const jointPos = sk.joints.geometry.attributes.position.array;
    for (let i = 0; i < NUM_HAND_LANDMARKS; i++) {
      jointPos[i * 3] = world[i].x;
      jointPos[i * 3 + 1] = world[i].y;
      jointPos[i * 3 + 2] = world[i].z;
    }
    sk.joints.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * @param {Object} params
   * @param {{Left:{landmarks:Array|null}, Right:{landmarks:Array|null}}} params.hands
   * @param {(x:number,y:number,z:number) => THREE.Vector3} params.projectFn
   */
  update({ hands, projectFn }) {
    if (!this.group.visible) return;
    this._updateHand('Left', hands.Left?.landmarks ?? null, projectFn);
    this._updateHand('Right', hands.Right?.landmarks ?? null, projectFn);
  }

  dispose() {
    for (const hand of ['Left', 'Right']) {
      const sk = this.skeletons[hand];
      sk.bones.geometry.dispose();
      sk.bones.material.dispose();
      sk.joints.geometry.dispose();
      sk.joints.material.dispose();
    }
  }
}
