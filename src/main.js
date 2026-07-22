/**
 * Face Filter GPGPU - Punto de entrada
 */
import { WebCamera } from './core/WebCamera.js';
import { Engine } from './core/Engine.js';
import { FaceTracker } from './core/FaceTracker.js';
import { HandTracker } from './core/HandTracker.js';
import { Controls } from './ui/Controls.js';

class App {
  constructor() {
    this.camera = null;
    this.engine = null;
    this.faceTracker = null;
    this.handTracker = null;
    this.controls = null;
    this.frameCount = 0;
  }

  async init() {
    try {
      // 1. Inicializar cámara
      console.log('Initializing camera...');
      this.camera = new WebCamera();
      await this.camera.init();

      // 2. Inicializar Face Tracker
      console.log('Initializing face tracker...');
      this.faceTracker = new FaceTracker();
      await this.faceTracker.init();

      // 3. Inicializar Hand Tracker
      console.log('Initializing hand tracker...');
      this.handTracker = new HandTracker();
      await this.handTracker.init();

      // 4. Inicializar engine
      console.log('Initializing engine...');
      const container = document.getElementById('container');
      this.engine = new Engine(container);
      await this.engine.init(this.camera.getVideo());

      // 5. Inicializar UI de selección de filtro
      this.controls = new Controls({
        onFilterChange: (filter) => this.handleFilterChange(filter)
      });

      // 6. Iniciar loop principal (cambiado a loop personalizado)
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

    // Ejecutar detección de rostro/manos (limitado a cada 3 frames)
    if (this.frameCount % 3 === 0) {
      const video = this.camera.getVideo();
      const timestamp = performance.now();
      this.faceTracker.detect(video, timestamp);
      this.handTracker.detect(video, timestamp);
    }

    // Actualizar objeto según posición del rostro (cada frame)
    const nose = this.faceTracker.getNose();
    this.engine.updateFacePosition(nose);

    // Actualizar matriz de transformación del rostro (para la máscara Vendetta)
    const faceMatrix = this.faceTracker.getTransformMatrix();
    this.engine.updateFaceTransform(faceMatrix);

    // Actualizar los landmarks del rostro (para el escaneo holográfico)
    this.engine.updateFaceLandmarks(this.faceTracker.getLandmarks());

    // Actualizar posición de las manos (cada frame)
    const leftPalm = this.handTracker.getLeftPalm();
    const rightPalm = this.handTracker.getRightPalm();
    this.engine.updateLeftHandPosition(leftPalm);
    this.engine.updateRightHandPosition(rightPalm);

    // Interacción de agarrar/soltar el accesorio facial con un gesto de pinza
    this.engine.updateHandGrab('Left', leftPalm, this.handTracker.isLeftPinching(), nose);
    this.engine.updateHandGrab('Right', rightPalm, this.handTracker.isRightPinching(), nose);

    // Actualizar y renderizar el engine
    this.engine.update();
    this.engine.render();
  }

  async handleFilterChange(filter) {
    this.controls.setDisabled(true);
    this.controls.setStatus('Cargando...');
    try {
      await this.engine.setFilter(filter);
      this.controls.setStatus('');
    } catch (error) {
      console.error('Filter switch failed:', error);
      this.controls.setStatus('Error al cargar el filtro');
    } finally {
      this.controls.setDisabled(false);
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

// Iniciar la app
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
