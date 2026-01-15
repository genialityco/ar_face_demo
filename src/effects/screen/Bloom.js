/**
 * Bloom - 発光エフェクト
 */
import { bloom as bloomNode } from 'three/addons/tsl/display/BloomNode.js';

export class Bloom {
  constructor(options = {}) {
    this.strength = options.strength ?? 1.0;   // 光の強さ
    this.radius = options.radius ?? 0.4;       // ぼかしの広がり (0-1)
    this.threshold = options.threshold ?? 0.5; // 光り始める明るさの閾値
  }

  /**
   * エフェクトを適用
   * @param {TextureNode} inputNode - 入力テクスチャノード
   * @returns {Node} Bloom適用後のノード
   */
  apply(inputNode) {
    const bloomPass = bloomNode(inputNode, this.strength, this.radius, this.threshold);
    return inputNode.add(bloomPass);
  }

  /**
   * パラメータを更新
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
