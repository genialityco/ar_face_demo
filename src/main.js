/**
 * Face Filter GPGPU - Punto de entrada
 */
import { WebCamera } from './core/WebCamera.js';
import { Engine } from './core/Engine.js';
import { FaceTracker } from './core/FaceTracker.js';
import { HandTracker } from './core/HandTracker.js';
import { Controls } from './ui/Controls.js';
import { MessageOverlay } from './ui/MessageOverlay.js';

class App {
  constructor() {
    this.camera = null;
    this.engine = null;
    this.faceTracker = null;
    this.handTracker = null;
    this.controls = null;
    this.messageOverlay = null;
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
      this.messageOverlay = new MessageOverlay();

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

    // Mostrar mensaje flotante pendiente (ej. "¡Bajaste de peso!")
    const pendingMessage = this.engine.consumePendingMessage();
    if (pendingMessage) {
      this.messageOverlay.show(pendingMessage);
    }

    // Actualizar objeto según posición del rostro (cada frame)
    const nose = this.faceTracker.getNose();
    this.engine.updateFacePosition(nose);

    // Actualizar matriz de transformación del rostro (para la máscara Vendetta)
    const faceMatrix = this.faceTracker.getTransformMatrix();
    this.engine.updateFaceTransform(faceMatrix);

    // Actualizar los landmarks del rostro (para el escaneo holográfico y el fuego/destellos en los ojos)
    const landmarks = this.faceTracker.getLandmarks();
    const blendshapes = this.faceTracker.getBlendshapes();
    this.engine.updateFaceLandmarks(landmarks);
    this.engine.updateFaceExpression(landmarks, blendshapes);

    // Actualizar posición de las manos (cada frame)
    const leftPalm = this.handTracker.getLeftPalm();
    const rightPalm = this.handTracker.getRightPalm();
    this.engine.updateLeftHandPosition(leftPalm);
    this.engine.updateRightHandPosition(rightPalm);

    const leftPinching = this.handTracker.isLeftPinching();
    const rightPinching = this.handTracker.isRightPinching();

    // Interacción de agarrar/soltar el accesorio facial con un gesto de pinza
    this.engine.updateHandGrab('Left', leftPalm, leftPinching, nose);
    this.engine.updateHandGrab('Right', rightPalm, rightPinching, nose);

    // Hamburguesas agarrables (pinza con toda la mano) que van aumentando la deformación de la cara al comerlas
    const hands = {
      Left: {
        palm: leftPalm,
        landmarks: this.handTracker.getLeftLandmarks(),
        isPincerGrab: this.handTracker.isLeftPincerGrab()
      },
      Right: {
        palm: rightPalm,
        landmarks: this.handTracker.getRightLandmarks(),
        isPincerGrab: this.handTracker.isRightPincerGrab()
      }
    };
    this.engine.updateHamburgerFeast(landmarks, blendshapes, hands);
    this.engine.updateFaceWarp(landmarks);

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
