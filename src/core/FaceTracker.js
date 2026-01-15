/**
 * FaceTracker - MediaPipe Face Landmarkerのラッパー
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class FaceTracker {
  constructor() {
    this.faceLandmarker = null;
    this.lastResult = null;
    this.isProcessing = false;
  }

  /**
   * MediaPipe Face Landmarkerを初期化
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
   * 顔検出を実行
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
   * 顔が検出されているか
   */
  hasFace() {
    return this.lastResult &&
           this.lastResult.faceLandmarks &&
           this.lastResult.faceLandmarks.length > 0;
  }

  /**
   * ランドマーク（468点）を取得
   * @returns {Array|null} [{x, y, z}, ...]
   */
  getLandmarks() {
    if (!this.hasFace()) return null;
    return this.lastResult.faceLandmarks[0];
  }

  /**
   * ブレンドシェイプ（表情）を取得
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
   * 顔の変換行列を取得
   * @returns {Array|null} 4x4 matrix
   */
  getTransformMatrix() {
    if (!this.lastResult?.facialTransformationMatrixes?.[0]) return null;
    return this.lastResult.facialTransformationMatrixes[0].data;
  }

  /**
   * 特定のランドマークを取得
   * @param {number} index ランドマークインデックス
   */
  getLandmark(index) {
    const landmarks = this.getLandmarks();
    if (!landmarks || index >= landmarks.length) return null;
    return landmarks[index];
  }

  /**
   * 鼻先（顔の中心）を取得
   */
  getNose() {
    return this.getLandmark(1); // 鼻先
  }

  /**
   * リソース解放
   */
  dispose() {
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
  }
}
