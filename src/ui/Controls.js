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

export class Controls {
  constructor({ onFilterChange, onSizeChange } = {}) {
    this.onFilterChange = onFilterChange;
    this.onSizeChange = onSizeChange;
    this.element = this._createElement();
    document.body.appendChild(this.element);
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
      this.onFilterChange?.(e.target.value);
    });

    const status = document.createElement('span');
    status.id = 'filter-status';

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

  setStatus(text) {
    this.status.textContent = text;
  }

  setDisabled(disabled) {
    this.select.disabled = disabled;
  }
}
