/**
 * HandTracker - MediaPipe Hand Landmarkerのラッパー
 */
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.lastResult = null;
    this.isProcessing = false;
  }

  /**
   * MediaPipe Hand Landmarkerを初期化
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
   * 手検出を実行
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
   * 手が検出されているか
   */
  hasHands() {
    return this.lastResult &&
           this.lastResult.landmarks &&
           this.lastResult.landmarks.length > 0;
  }

  /**
   * 検出された手の数を取得
   */
  getHandCount() {
    if (!this.hasHands()) return 0;
    return this.lastResult.landmarks.length;
  }

  /**
   * 特定の手のランドマーク（21点）を取得
   * @param {number} handIndex 手のインデックス（0または1）
   * @returns {Array|null} [{x, y, z}, ...]
   */
  getLandmarks(handIndex = 0) {
    if (!this.hasHands() || handIndex >= this.lastResult.landmarks.length) return null;
    return this.lastResult.landmarks[handIndex];
  }

  /**
   * 手の種類（左/右）を取得
   * @param {number} handIndex 手のインデックス
   * @returns {string|null} 'Left' or 'Right'
   */
  getHandedness(handIndex = 0) {
    if (!this.lastResult?.handednesses?.[handIndex]?.[0]) return null;
    return this.lastResult.handednesses[handIndex][0].categoryName;
  }

  /**
   * 掌の中心位置を取得（ランドマーク0: 手首、9: 中指の付け根の中間）
   * @param {number} handIndex 手のインデックス
   */
  getPalmCenter(handIndex = 0) {
    const landmarks = this.getLandmarks(handIndex);
    if (!landmarks) return null;

    // 手首(0)と中指の付け根(9)の中間を掌の中心とする
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    return {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: (wrist.z + middleMcp.z) / 2
    };
  }

  /**
   * 左手の掌中心を取得
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
   * 右手の掌中心を取得
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
   * リソース解放
   */
  dispose() {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }
}
