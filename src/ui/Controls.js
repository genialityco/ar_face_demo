/**
 * Controls - UI de selección de filtro y tamaño del cuadro de la cámara
 */
const CAMERA_SIZES = [
  { value: '320', label: 'Chico' },
  { value: '480', label: 'Mediano' },
  { value: '640', label: 'Grande' },
  { value: '900', label: 'Extra Grande' }
];
const DEFAULT_CAMERA_SIZE = '480';

// Descripción corta de cómo funciona cada filtro, mostrada debajo del selector
const FILTER_DESCRIPTIONS = {
  metaball: 'Esfera de vidrio con refracción que sigue tu rostro; esferas más chicas orbitan alrededor y otras dos siguen tus manos.',
  vendetta: 'Máscara de V de Vendetta que sigue el movimiento de tu rostro. Hacé un pellizco (pinza con el pulgar e índice) cerca de la cara para sacártela, y volvé a pellizcar para ponértela.',
  viking: 'Casco vikingo con reflejos metálicos que sigue tu rostro. Igual que la máscara, se puede sacar y poner con un pellizco cerca de la cara.',
  flower: 'Corona de flores y enredaderas 3D que sigue el movimiento de tu rostro.',
  raccoon: 'El mapache 3D oficial de la demo de MediaPipe: sigue la posición y rotación de tu cabeza y copia tus expresiones reales (parpadeo, sonrisa, boca abierta, cejas) en tiempo real.',
  holoscan: 'Líneas de escaneo holográfico que recorren los contornos de tu rostro en tiempo real.',
  eyeglow: 'Destellos y fuego en los ojos que reaccionan a tu expresión facial (cejas, sonrisa, etc.).',
  hamburger: 'Agarrá las hamburguesas flotantes con la mano (pinza con todos los dedos), llevalas a la boca y "comé" para ir infando tu cara. Una vez comidas todas, hacé sentadillas para volver a tu peso ideal.',
  money: 'Atrapá los billetes que caen con la mano y guardalos en tus bolsillos. A medida que guardás más, tu expresión pasa de triste a feliz.',
  gym: 'Levantá con la mano alguna de las 4 mancuernas del suelo (de menor a mayor peso): cuanto más pesada y más alto la levantes, más esfuerzo y enrojecimiento se nota en tu cara.',
  aging: 'Envejece tu rostro en vivo (arrugas, piel caída, tono de piel). Todavía sin mecánica de juego: se activa con el switch del panel de debug.',
  cubes: 'Modo AR: 3 cubos de Rubik 3D colocados sobre el video real, como si fueran parte del entorno (quietos, con sombra de contacto y oclusión: la mano puede pasar por delante y por detrás de un cubo). Tus manos se dibujan como un esqueleto de huesos: cerrá la mano en pinza (dedos juntos contra el pulgar) sobre un cubo para agarrarlo, movelo, y al soltarlo cae y se queda donde quedó.'
};

export class Controls {
  constructor({ onFilterChange, onSizeChange } = {}) {
    this.onFilterChange = onFilterChange;
    this.onSizeChange = onSizeChange;
    this.element = this._createElement();
    document.body.appendChild(this.element);
    document.body.appendChild(this.descriptionElement);
    this._updateDescription(this.select.value);

    this._onFsChange = () => this._syncFullscreenBtn();
    document.addEventListener('fullscreenchange', this._onFsChange);
    document.addEventListener('webkitfullscreenchange', this._onFsChange);
    this._syncFullscreenBtn();

    // Pantalla completa por defecto: el navegador exige un gesto del usuario,
    // así que se dispara en la primera interacción (click/tecla).
    this._armAutoFullscreen();
  }

  _createElement() {
    const wrapper = document.createElement('div');
    wrapper.id = 'filter-controls';

    const label = document.createElement('label');
    label.htmlFor = 'filter-select';
    label.textContent = 'Filtro';

    const select = document.createElement('select');
    select.id = 'filter-select';

    const options = [
      { value: 'metaball', label: 'Cristal (Metaball)' },
      { value: 'vendetta', label: 'Máscara Vendetta' },
      { value: 'viking', label: 'Casco Vikingo' },
      { value: 'flower', label: 'Cara de Flores' },
      { value: 'raccoon', label: 'Mapache (MediaPipe)' },
      { value: 'holoscan', label: 'Escaneo Holográfico' },
      { value: 'eyeglow', label: 'Fuego y Brillo en los Ojos' },
      //{ value: 'facewarp', label: 'Cara Inflada' },
      { value: 'hamburger', label: 'Comilona de Hamburguesas' },
      { value: 'money', label: 'Lluvia de Plata' },
      { value: 'gym', label: 'Levantamiento de Pesas' },
      { value: 'aging', label: 'Envejecimiento' },
      { value: 'cubes', label: 'Mover Cubos' }
    ];

    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }

    select.addEventListener('change', (e) => {
      this._updateDescription(e.target.value);
      this.onFilterChange?.(e.target.value);
    });

    const status = document.createElement('span');
    status.id = 'filter-status';

    this.descriptionElement = document.createElement('div');
    this.descriptionElement.id = 'filter-description';

    const sizeLabel = document.createElement('label');
    sizeLabel.htmlFor = 'size-select';
    sizeLabel.textContent = 'Tamaño';

    const sizeSelect = document.createElement('select');
    sizeSelect.id = 'size-select';

    for (const opt of CAMERA_SIZES) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      sizeSelect.appendChild(option);
    }
    sizeSelect.value = DEFAULT_CAMERA_SIZE;

    sizeSelect.addEventListener('change', (e) => {
      this.onSizeChange?.(Number(e.target.value));
    });

    const mirrorLabel = document.createElement('label');
    mirrorLabel.id = 'mirror-label';
    mirrorLabel.title = 'Invertir la cámara (espejo)';
    const mirrorInput = document.createElement('input');
    mirrorInput.type = 'checkbox';
    mirrorInput.id = 'mirror-toggle';
    mirrorLabel.appendChild(mirrorInput);
    mirrorLabel.appendChild(document.createTextNode('Espejo'));

    const savedMirror = this._readMirrorPref();
    mirrorInput.checked = savedMirror;
    this._applyMirror(savedMirror);
    mirrorInput.addEventListener('change', (e) => {
      const on = e.target.checked;
      this._applyMirror(on);
      try {
        localStorage.setItem('mirror', on ? '1' : '0');
      } catch (_) {
        /* almacenamiento no disponible */
      }
    });

    // Modo "fondo completo": la cámara llena la ventana del navegador sin fullscreen
    const bgFullLabel = document.createElement('label');
    bgFullLabel.id = 'bgfull-label';
    bgFullLabel.title = 'La cámara llena toda la ventana del navegador (sin pantalla completa)';
    const bgFullInput = document.createElement('input');
    bgFullInput.type = 'checkbox';
    bgFullInput.id = 'bgfull-toggle';
    bgFullLabel.appendChild(bgFullInput);
    bgFullLabel.appendChild(document.createTextNode('Fondo'));

    const savedBgFull = this._readBgFullPref();
    bgFullInput.checked = savedBgFull;
    this._applyBgFull(savedBgFull);
    bgFullInput.addEventListener('change', (e) => {
      const on = e.target.checked;
      this._applyBgFull(on);
      try {
        localStorage.setItem('bgFull', on ? '1' : '0');
      } catch (_) {
        /* almacenamiento no disponible */
      }
    });

    // Mostrar/ocultar el texto de descripción del filtro (oculto por defecto)
    const descLabel = document.createElement('label');
    descLabel.id = 'desc-label';
    descLabel.title = 'Mostrar la descripción del filtro';
    const descInput = document.createElement('input');
    descInput.type = 'checkbox';
    descInput.id = 'desc-toggle';
    descLabel.appendChild(descInput);
    descLabel.appendChild(document.createTextNode('Info'));

    const savedDesc = this._readDescPref();
    descInput.checked = savedDesc;
    this._applyDescVisible(savedDesc);
    descInput.addEventListener('change', (e) => {
      const on = e.target.checked;
      this._applyDescVisible(on);
      try {
        localStorage.setItem('descVisible', on ? '1' : '0');
      } catch (_) {
        /* almacenamiento no disponible */
      }
    });

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.id = 'fullscreen-btn';
    fullscreenBtn.type = 'button';
    fullscreenBtn.textContent = '⛶';
    fullscreenBtn.title = 'Pantalla completa';
    fullscreenBtn.addEventListener('click', () => this._toggleFullscreen());

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(status);
    wrapper.appendChild(sizeLabel);
    wrapper.appendChild(sizeSelect);
    wrapper.appendChild(mirrorLabel);
    wrapper.appendChild(bgFullLabel);
    wrapper.appendChild(descLabel);
    wrapper.appendChild(fullscreenBtn);

    this.select = select;
    this.status = status;
    this.sizeSelect = sizeSelect;
    this.mirrorInput = mirrorInput;
    this.bgFullInput = bgFullInput;
    this.descInput = descInput;
    this.fullscreenBtn = fullscreenBtn;

    return wrapper;
  }

  _readDescPref() {
    try {
      return localStorage.getItem('descVisible') === '1';
    } catch (_) {
      return false;
    }
  }

  _applyDescVisible(on) {
    if (this.descriptionElement) this.descriptionElement.style.display = on ? '' : 'none';
  }

  _readBgFullPref() {
    try {
      return localStorage.getItem('bgFull') === '1';
    } catch (_) {
      return false;
    }
  }

  _applyBgFull(on) {
    const container = document.getElementById('container');
    if (container) container.classList.toggle('page-full', on);
  }

  _readMirrorPref() {
    // Espejo activado por defecto; sólo se desactiva si el usuario lo guardó así
    try {
      const v = localStorage.getItem('mirror');
      return v === null ? true : v === '1';
    } catch (_) {
      return true;
    }
  }

  _applyMirror(on) {
    const container = document.getElementById('container');
    if (container) container.classList.toggle('mirrored', on);
  }

  _enterFullscreen() {
    const el = document.documentElement;
    try {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
      p?.catch?.(() => {});
    } catch (_) {
      /* bloqueado sin gesto de usuario */
    }
  }

  _armAutoFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const go = () => {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      this._enterFullscreen();
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
    this._enterFullscreen(); // intento inmediato (kiosco / contextos que lo permiten)
  }

  _toggleFullscreen() {
    const doc = document;
    const active = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!active) {
      this._enterFullscreen();
    } else {
      (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc);
    }
  }

  _syncFullscreenBtn() {
    if (!this.fullscreenBtn) return;
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    this.fullscreenBtn.textContent = active ? '🗗' : '⛶';
    this.fullscreenBtn.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  }

  _updateDescription(filter) {
    this.descriptionElement.textContent = FILTER_DESCRIPTIONS[filter] ?? '';
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  setDisabled(disabled) {
    this.select.disabled = disabled;
  }
}
