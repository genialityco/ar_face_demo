/**
 * Face Filter GPGPU - Entry Point
 */
import { WebCamera } from './core/WebCamera.js';
import { Engine } from './core/Engine.js';

class App {
  constructor() {
    this.camera = null;
    this.engine = null;
  }

  async init() {
    try {
      // 1. カメラ初期化
      console.log('Initializing camera...');
      this.camera = new WebCamera();
      await this.camera.init();

      // 2. エンジン初期化
      console.log('Initializing engine...');
      const container = document.getElementById('container');
      this.engine = new Engine(container);
      await this.engine.init(this.camera.getVideo());

      // 3. メインループ開始
      console.log('Starting render loop...');
      this.engine.start();

    } catch (error) {
      console.error('App initialization failed:', error);
      this.showError(error.message);
    }
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
