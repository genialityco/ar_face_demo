/**
 * DebugPanel - Panel pequeño de texto + switch para debug (ej. progreso de un
 * filtro y forzar el efecto al 100%/expresión feliz sin depender del progreso real)
 */
export class DebugPanel {
  constructor({ onToggle } = {}) {
    this.element = document.createElement('div');
    this.element.id = 'debug-panel';

    this.textEl = document.createElement('span');
    this.element.appendChild(this.textEl);

    this.toggleLabel = document.createElement('label');
    this.toggleLabel.id = 'debug-mood-toggle-label';

    this.toggleInput = document.createElement('input');
    this.toggleInput.type = 'checkbox';
    this.toggleInput.addEventListener('change', (e) => {
      onToggle?.(e.target.checked);
    });

    this.toggleText = document.createTextNode('');
    this.toggleLabel.appendChild(this.toggleInput);
    this.toggleLabel.appendChild(this.toggleText);
    this.element.appendChild(this.toggleLabel);

    document.body.appendChild(this.element);
  }

  show(text) {
    this.textEl.textContent = text;
    this.element.style.display = 'flex';
  }

  hide() {
    this.element.style.display = 'none';
    this.toggleInput.checked = false;
  }

  /**
   * Cambia el texto del switch (ej. " feliz (forzar)" o " 100% obeso (forzar)")
   * @param {string} text
   */
  setToggleLabel(text) {
    this.toggleText.textContent = text;
  }
}
