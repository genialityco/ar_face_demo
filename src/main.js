/**
 * Face Filter GPGPU - Entry Point
 */
import { WebCamera } from './core/WebCamera.js';
import { Engine } from './core/Engine.js';
import { FaceTracker } from './core/FaceTracker.js';
import { HandTracker } from './core/HandTracker.js';

class App {
  constructor() {
    this.camera = null;
    this.engine = null;
    this.faceTracker = null;
    this.handTracker = null;
    this.frameCount = 0;
  }

  async init() {
    try {
      // 1. カメラ初期化
      console.log('Initializing camera...');
      this.camera = new WebCamera();
      await this.camera.init();

      // 2. Face Tracker初期化
      console.log('Initializing face tracker...');
      this.faceTracker = new FaceTracker();
      await this.faceTracker.init();

      // 3. Hand Tracker初期化
      console.log('Initializing hand tracker...');
      this.handTracker = new HandTracker();
      await this.handTracker.init();

      // 4. エンジン初期化
      console.log('Initializing engine...');
      const container = document.getElementById('container');
      this.engine = new Engine(container);
      await this.engine.init(this.camera.getVideo());

      // 5. メインループ開始（カスタムループに変更）
      console.log('Starting render loop...');
      this.animate();

    } catch (error) {
      console.error('App initialization failed:', error);
      this.showError(error.message);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.frameCount++;

    // 顔・手検出を実行（3フレームごとに制限）
    if (this.frameCount % 3 === 0) {
      const video = this.camera.getVideo();
      const timestamp = performance.now();
      this.faceTracker.detect(video, timestamp);
      this.handTracker.detect(video, timestamp);
    }

    // 顔位置でオブジェクトを更新（毎フレーム）
    const nose = this.faceTracker.getNose();
    this.engine.updateFacePosition(nose);

    // 手の位置を更新（毎フレーム）
    const leftPalm = this.handTracker.getLeftPalm();
    const rightPalm = this.handTracker.getRightPalm();
    this.engine.updateLeftHandPosition(leftPalm);
    this.engine.updateRightHandPosition(rightPalm);

    // エンジンの更新とレンダリング
    this.engine.update();
    this.engine.render();
  }

  showError(message) {
    const container = document.getElementById('container');
    container.innerHTML = `
      <div style="color: red; padding: 20px; text-align: center;">
        <h2>Error</h2>
        <p>${message}</p>
      </div>
    `;
  }
}

// アプリ起動
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
