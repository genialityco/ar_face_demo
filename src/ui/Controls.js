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
  aging: 'Envejece tu rostro en vivo (arrugas, piel caída, tono de piel). Todavía sin mecánica de juego: se activa con el switch del panel de debug.'
};

export class Controls {
  constructor({ onFilterChange, onSizeChange } = {}) {
    this.onFilterChange = onFilterChange;
    this.onSizeChange = onSizeChange;
    this.element = this._createElement();
    document.body.appendChild(this.element);
    document.body.appendChild(this.descriptionElement);
    this._updateDescription(this.select.value);
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
      { value: 'aging', label: 'Envejecimiento' }
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

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(status);
    wrapper.appendChild(sizeLabel);
    wrapper.appendChild(sizeSelect);

    this.select = select;
    this.status = status;
    this.sizeSelect = sizeSelect;

    return wrapper;
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
