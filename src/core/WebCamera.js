/**
 * WebCamera - Obtención y gestión de la imagen de la webcam
 */
export class WebCamera {
  constructor() {
    this.video = null;
    this.stream = null;
  }

  /**
   * Inicializa la cámara y empieza a obtener la imagen
   */
  async init() {
    // Crear el elemento video
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('muted', '');

    // Obtener el stream de la cámara
    const constraints = {
      video: {
        facingMode: 'user',  // Cámara frontal
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();

      console.log(`Camera ready: ${this.video.videoWidth}x${this.video.videoHeight}`);
    } catch (error) {
      console.error('Camera init failed:', error);
      throw error;
    }
  }

  /**
   * Obtiene el elemento video
   */
  getVideo() {
    return this.video;
  }

  /**
   * Obtiene el tamaño de la imagen
   */
  getSize() {
    if (!this.video) return { width: 0, height: 0 };
    return {
      width: this.video.videoWidth,
      height: this.video.videoHeight
    };
  }

  /**
   * Libera los recursos
   */
  dispose() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
