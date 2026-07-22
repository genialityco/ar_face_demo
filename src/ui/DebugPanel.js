/**
 * DebugPanel - Panel pequeño de texto + switch para debug (ej. progreso de un filtro
 * y forzar la expresión triste/feliz sin depender del progreso real)
 */
export class DebugPanel {
  constructor({ onMoodToggle } = {}) {
    this.element = document.createElement('div');
    this.element.id = 'debug-panel';

    this.textEl = document.createElement('span');
    this.element.appendChild(this.textEl);

    this.toggleLabel = document.createElement('label');
    this.toggleLabel.id = 'debug-mood-toggle-label';

    this.toggleInput = document.createElement('input');
    this.toggleInput.type = 'checkbox';
    this.toggleInput.addEventListener('change', (e) => {
      onMoodToggle?.(e.target.checked);
    });

    this.toggleLabel.appendChild(this.toggleInput);
    this.toggleLabel.appendChild(document.createTextNode(' feliz (forzar)'));
    this.element.appendChild(this.toggleLabel);

    document.body.appendChild(this.element);
  }

  show(text) {
    this.textEl.textContent = text;
    this.element.style.display = 'flex';
  }

  hide() {
    this.element.style.display = 'none';
  }
}
