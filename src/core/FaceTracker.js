/**
 * FaceTracker - Wrapper del MediaPipe Face Landmarker
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class FaceTracker {
  constructor() {
    this.faceLandmarker = null;
    this.lastResult = null;
    this.isProcessing = false;
  }

  /**
   * Inicializa el MediaPipe Face Landmarker
   */
  async init() {
    console.log('Initializing MediaPipe Face Landmarker...');

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true
    });

    console.log('Face Landmarker ready');
  }

  /**
   * Ejecuta la detección de rostro
   * @param {HTMLVideoElement} video
   * @param {number} timestamp
   */
  detect(video, timestamp) {
    if (!this.faceLandmarker || this.isProcessing) return this.lastResult;

    this.isProcessing = true;
    this.lastResult = this.faceLandmarker.detectForVideo(video, timestamp);
    this.isProcessing = false;

    return this.lastResult;
  }

  /**
   * Indica si se detectó un rostro
   */
  hasFace() {
    return this.lastResult &&
           this.lastResult.faceLandmarks &&
           this.lastResult.faceLandmarks.length > 0;
  }

  /**
   * Obtiene los landmarks (468 puntos)
   * @returns {Array|null} [{x, y, z}, ...]
   */
  getLandmarks() {
    if (!this.hasFace()) return null;
    return this.lastResult.faceLandmarks[0];
  }

  /**
   * Obtiene los blendshapes (expresiones faciales)
   * @returns {Object|null} { mouthOpen: 0.5, eyeBlinkLeft: 0.1, ... }
   */
  getBlendshapes() {
    if (!this.lastResult?.faceBlendshapes?.[0]) return null;

    const blendshapes = {};
    for (const shape of this.lastResult.faceBlendshapes[0].categories) {
      blendshapes[shape.categoryName] = shape.score;
    }
    return blendshapes;
  }

  /**
   * Obtiene la matriz de transformación del rostro
   * @returns {Array|null} 4x4 matrix
   */
  getTransformMatrix() {
    if (!this.lastResult?.facialTransformationMatrixes?.[0]) return null;
    return this.lastResult.facialTransformationMatrixes[0].data;
  }

  /**
   * Obtiene un landmark específico
   * @param {number} index Índice del landmark
   */
  getLandmark(index) {
    const landmarks = this.getLandmarks();
    if (!landmarks || index >= landmarks.length) return null;
    return landmarks[index];
  }

  /**
   * Obtiene la punta de la nariz (centro del rostro)
   */
  getNose() {
    return this.getLandmark(1); // Punta de la nariz
  }

  /**
   * Libera los recursos
   */
  dispose() {
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
  }
}
