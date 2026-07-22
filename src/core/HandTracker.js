/**
 * HandTracker - Wrapper del MediaPipe Hand Landmarker
 */
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.lastResult = null;
    this.isProcessing = false;
  }

  /**
   * Inicializa el MediaPipe Hand Landmarker
   */
  async init() {
    console.log('Initializing MediaPipe Hand Landmarker...');

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    console.log('Hand Landmarker ready');
  }

  /**
   * Ejecuta la detección de manos
   * @param {HTMLVideoElement} video
   * @param {number} timestamp
   */
  detect(video, timestamp) {
    if (!this.handLandmarker || this.isProcessing) return this.lastResult;

    this.isProcessing = true;
    this.lastResult = this.handLandmarker.detectForVideo(video, timestamp);
    this.isProcessing = false;

    return this.lastResult;
  }

  /**
   * Indica si se detectaron manos
   */
  hasHands() {
    return this.lastResult &&
           this.lastResult.landmarks &&
           this.lastResult.landmarks.length > 0;
  }

  /**
   * Obtiene la cantidad de manos detectadas
   */
  getHandCount() {
    if (!this.hasHands()) return 0;
    return this.lastResult.landmarks.length;
  }

  /**
   * Obtiene los landmarks (21 puntos) de una mano específica
   * @param {number} handIndex Índice de la mano (0 o 1)
   * @returns {Array|null} [{x, y, z}, ...]
   */
  getLandmarks(handIndex = 0) {
    if (!this.hasHands() || handIndex >= this.lastResult.landmarks.length) return null;
    return this.lastResult.landmarks[handIndex];
  }

  /**
   * Obtiene el tipo de mano (izquierda/derecha)
   * @param {number} handIndex Índice de la mano
   * @returns {string|null} 'Left' or 'Right'
   */
  getHandedness(handIndex = 0) {
    if (!this.lastResult?.handednesses?.[handIndex]?.[0]) return null;
    return this.lastResult.handednesses[handIndex][0].categoryName;
  }

  /**
   * Obtiene el centro de la palma (punto medio entre landmark 0: muñeca y 9: base del dedo medio)
   * @param {number} handIndex Índice de la mano
   */
  getPalmCenter(handIndex = 0) {
    const landmarks = this.getLandmarks(handIndex);
    if (!landmarks) return null;

    // El centro de la palma es el punto medio entre la muñeca (0) y la base del dedo medio (9)
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    return {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: (wrist.z + middleMcp.z) / 2
    };
  }

  /**
   * Obtiene el centro de la palma de la mano izquierda
   */
  getLeftPalm() {
    for (let i = 0; i < this.getHandCount(); i++) {
      if (this.getHandedness(i) === 'Left') {
        return this.getPalmCenter(i);
      }
    }
    return null;
  }

  /**
   * Obtiene el centro de la palma de la mano derecha
   */
  getRightPalm() {
    for (let i = 0; i < this.getHandCount(); i++) {
      if (this.getHandedness(i) === 'Right') {
        return this.getPalmCenter(i);
      }
    }
    return null;
  }

  /**
   * Libera los recursos
   */
  dispose() {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }
}
