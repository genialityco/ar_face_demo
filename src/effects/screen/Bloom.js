/**
 * Bloom - Efecto de resplandor
 */
import { bloom as bloomNode } from 'three/addons/tsl/display/BloomNode.js';

export class Bloom {
  constructor(options = {}) {
    this.strength = options.strength ?? 1.0;   // Intensidad de la luz
    this.radius = options.radius ?? 0.4;       // Extensión del desenfoque (0-1)
    this.threshold = options.threshold ?? 0.5; // Umbral de brillo a partir del cual empieza a brillar
  }

  /**
   * Aplica el efecto
   * @param {TextureNode} inputNode - Texture node de entrada
   * @returns {Node} Node con el Bloom aplicado
   */
  apply(inputNode) {
    const bloomPass = bloomNode(inputNode, this.strength, this.radius, this.threshold);
    return inputNode.add(bloomPass);
  }

  /**
   * Actualiza los parámetros
   */
  setStrength(value) {
    this.strength = value;
  }

  setRadius(value) {
    this.radius = value;
  }

  setThreshold(value) {
    this.threshold = value;
  }
}
