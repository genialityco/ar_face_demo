/**
 * MessageOverlay - Mensaje flotante temporal sobre el video (ej. "¡Bajaste de peso!")
 */
export class MessageOverlay {
  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'message-overlay';
    document.body.appendChild(this.element);
    this._hideTimeout = null;
    this._fadeTimeout = null;
  }

  /**
   * @param {string} text
   * @param {number} durationMs - cuánto tiempo queda visible antes de desvanecerse
   */
  show(text, durationMs = 2500) {
    clearTimeout(this._hideTimeout);
    clearTimeout(this._fadeTimeout);

    this.element.textContent = text;
    this.element.style.display = 'block';
    // Reinicia la transición si ya estaba visible (forzando reflow)
    this.element.classList.remove('message-overlay-visible');
    void this.element.offsetWidth;
    this.element.classList.add('message-overlay-visible');

    this._hideTimeout = setTimeout(() => {
      this.element.classList.remove('message-overlay-visible');
      this._fadeTimeout = setTimeout(() => {
        this.element.style.display = 'none';
      }, 400);
    }, durationMs);
  }
}
