/**
 * Controls - UI de selección de filtro
 */
export class Controls {
  constructor({ onFilterChange } = {}) {
    this.onFilterChange = onFilterChange;
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
      { value: 'hamburger', label: 'Comilona de Hamburguesas' }
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

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(status);

    this.select = select;
    this.status = status;

    return wrapper;
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  setDisabled(disabled) {
    this.select.disabled = disabled;
  }
}
