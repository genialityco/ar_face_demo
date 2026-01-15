/**
 * MetaballEffect - TSLレイマーチングによるメタボール（屈折+Dispersion対応）
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  Loop,
  If,
  Break,
  uv,
  uniform,
  texture,
  cubeTexture,
  normalize,
  length,
  max,
  abs,
  mix,
  clamp,
  dot,
  reflect,
  refract
} from 'three/tsl';

export class MetaballEffect {
  constructor(options = {}) {
    // Uniform: 球体の位置と半径 (vec4: x, y, z, radius)
    // 0: 顔メイン, 1-3: 顔周回, 4-5: 左右の手
    this.sphere0 = uniform(new THREE.Vector4(0, 0, 0, 0.5));
    this.sphere1 = uniform(new THREE.Vector4(0.8, 0.3, 0, 0.25));
    this.sphere2 = uniform(new THREE.Vector4(-0.6, -0.2, 0.3, 0.2));
    this.sphere3 = uniform(new THREE.Vector4(0.2, -0.5, -0.2, 0.2));
    this.sphere4 = uniform(new THREE.Vector4(-100, 0, 0, 0));  // 左手（初期は画面外）
    this.sphere5 = uniform(new THREE.Vector4(100, 0, 0, 0));   // 右手（初期は画面外）

    // Uniform: メタボールのブレンド係数
    this.blendK = uniform(options.blendFactor ?? 0.4);

    // Uniform: カメラパラメータ
    this.cameraAspect = uniform(16 / 9);

    // Uniform: 屈折率 (IOR)
    this.ior = uniform(options.ior ?? 1.45);

    // Uniform: Dispersion (色収差の強さ)
    this.dispersion = uniform(options.dispersion ?? 0.03);

    // Uniform: フレネル強度
    this.fresnelStrength = uniform(options.fresnelStrength ?? 0.5);

    // Uniform: 屈折の歪み強度（thicknessに相当）
    this.refractionStrength = uniform(options.refractionStrength ?? 0.15);

    // 背景テクスチャ（後から設定）
    this.backgroundTexture = null;
    this.bgTextureUniform = null;

    // 環境マップ（CubeMap）
    this.envMapTexture = null;

    // メッシュとマテリアル
    this.mesh = null;
    this.material = null;
  }

  /**
   * 背景テクスチャを設定
   */
  setBackgroundTexture(tex) {
    this.backgroundTexture = tex;
  }

  /**
   * 環境マップ（CubeMap）を設定
   */
  setEnvMapTexture(tex) {
    this.envMapTexture = tex;
  }

  /**
   * フルスクリーンクワッドのマテリアルを作成
   */
  createMaterial() {
    const sphere0 = this.sphere0;
    const sphere1 = this.sphere1;
    const sphere2 = this.sphere2;
    const sphere3 = this.sphere3;
    const sphere4 = this.sphere4;
    const sphere5 = this.sphere5;
    const blendK = this.blendK;
    const cameraAspect = this.cameraAspect;
    const ior = this.ior;
    const dispersion = this.dispersion;
    const fresnelStrength = this.fresnelStrength;
    const refractionStrength = this.refractionStrength;
    const bgTex = this.backgroundTexture;
    const envTex = this.envMapTexture;

    // Smooth minimum関数
    const smin = (a, b, k) => {
      const h = clamp(float(0.5).add(float(0.5).mul(b.sub(a)).div(k)), 0.0, 1.0);
      return mix(b, a, h).sub(k.mul(h).mul(float(1.0).sub(h)));
    };

    // 球体のSDF
    const sphereSDF = (pos, sphereData) => {
      return length(pos.sub(sphereData.xyz)).sub(sphereData.w);
    };

    // シーン全体のSDF（顔4個 + 手2個 = 6個）
    const sceneSDF = Fn(([pos]) => {
      const d0 = sphereSDF(pos, sphere0);
      const d1 = sphereSDF(pos, sphere1);
      const d2 = sphereSDF(pos, sphere2);
      const d3 = sphereSDF(pos, sphere3);
      const d4 = sphereSDF(pos, sphere4);
      const d5 = sphereSDF(pos, sphere5);

      const m01 = smin(d0, d1, blendK);
      const m012 = smin(m01, d2, blendK);
      const m0123 = smin(m012, d3, blendK);
      const m01234 = smin(m0123, d4, blendK);
      const m012345 = smin(m01234, d5, blendK);

      return m012345;
    });

    // 法線計算
    const calcNormal = Fn(([pos]) => {
      const eps = float(0.001);
      const dx = sceneSDF(pos.add(vec3(eps, 0, 0))).sub(sceneSDF(pos.sub(vec3(eps, 0, 0))));
      const dy = sceneSDF(pos.add(vec3(0, eps, 0))).sub(sceneSDF(pos.sub(vec3(0, eps, 0))));
      const dz = sceneSDF(pos.add(vec3(0, 0, eps))).sub(sceneSDF(pos.sub(vec3(0, 0, eps))));
      return normalize(vec3(dx, dy, dz));
    });

    // フラグメントシェーダー
    const fragmentNode = Fn(() => {
      // UV座標を-1〜1に変換
      const screenUV = uv().sub(0.5).mul(2);
      const originalUV = uv();

      // レイの原点と方向
      const ro = vec3(0, 0, 5);
      const rd = normalize(
        vec3(
          screenUV.x.mul(cameraAspect),
          screenUV.y,
          float(-1.5)
        )
      );

      // レイマーチング
      const t = float(0).toVar();
      const hit = float(0).toVar();

      Loop(48, () => {
        const pos = ro.add(rd.mul(t));
        const d = sceneSDF(pos);

        If(d.lessThan(0.002), () => {
          hit.assign(1);
          Break();
        });

        If(t.greaterThan(15.0), () => {
          Break();
        });

        t.addAssign(d);
      });

      // 結果の色
      const finalColor = vec3(0, 0, 0).toVar();
      const alpha = float(0).toVar();

      If(hit.greaterThan(0.5), () => {
        const hitPos = ro.add(rd.mul(t));
        const normal = calcNormal(hitPos);

        // 入射角のコサイン
        const cosTheta = dot(normal, rd.negate());

        // フレネル効果
        const fresnel = float(1.0).sub(abs(cosTheta)).pow(3).mul(fresnelStrength);

        // === 屈折計算（Dispersion: RGB各色で異なるIOR） ===
        const eta = float(1.0).div(ior);

        // 各色チャンネルの屈折率をずらす
        const etaR = eta.sub(dispersion);
        const etaG = eta;
        const etaB = eta.add(dispersion);

        // 屈折方向を計算
        const refractDirR = refract(rd, normal, etaR);
        const refractDirG = refract(rd, normal, etaG);
        const refractDirB = refract(rd, normal, etaB);

        // 屈折方向からUVオフセットを計算
        // 屈折ベクトルのXY成分をUVオフセットとして使用（refractionStrength = thickness相当）

        // 凹レンズ効果: UVオフセットを反転
        const uvOffsetR = vec2(refractDirR.x, refractDirR.y.negate()).mul(refractionStrength).negate();
        const uvOffsetG = vec2(refractDirG.x, refractDirG.y.negate()).mul(refractionStrength).negate();
        const uvOffsetB = vec2(refractDirB.x, refractDirB.y.negate()).mul(refractionStrength).negate();

        // 背景をサンプリング（各色で異なるUV）
        const bgR = texture(bgTex, originalUV.add(uvOffsetR)).r;
        const bgG = texture(bgTex, originalUV.add(uvOffsetG)).g;
        const bgB = texture(bgTex, originalUV.add(uvOffsetB)).b;

        const refractedColor = vec3(bgR, bgG, bgB);

        // 反射方向を計算
        const reflectDir = reflect(rd, normal);

        // 環境反射: CubeMapがあれば使用、なければ擬似反射
        const envColor = envTex
          ? cubeTexture(envTex, reflectDir)
          : texture(bgTex, clamp(originalUV.add(vec2(reflectDir.x, reflectDir.y.negate()).mul(0.3)), 0.0, 1.0));

        // スペキュラハイライト
        const specular = max(dot(reflectDir, normalize(vec3(1, 1, 1))), 0.0).pow(32);

        // 最終色: 屈折 + フレネル反射（環境） + スペキュラ
        const baseColor = refractedColor.mul(float(1.0).sub(fresnel));
        const reflectColor = envColor.rgb.mul(fresnel).mul(0.8);
        const specColor = vec3(1.0, 1.0, 1.0).mul(specular.mul(0.3));

        finalColor.assign(baseColor.add(reflectColor).add(specColor));
        alpha.assign(1.0);
      });

      // ヒットしなかった場合は完全透明
      return vec4(finalColor, alpha);
    });

    // NodeMaterialを作成
    this.material = new THREE.NodeMaterial();
    this.material.fragmentNode = fragmentNode();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = false;
    this.material.side = THREE.DoubleSide;

    return this.material;
  }

  /**
   * フルスクリーンクワッド用のシーンとカメラを作成
   */
  createFullscreenQuad() {
    if (!this.material) {
      this.createMaterial();
    }

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.quadScene.add(this.mesh);

    return { scene: this.quadScene, camera: this.quadCamera };
  }

  /**
   * レンダリング
   */
  render(renderer) {
    if (this.quadScene && this.quadCamera) {
      renderer.autoClear = false;
      renderer.render(this.quadScene, this.quadCamera);
      renderer.autoClear = true;
    }
  }

  /**
   * 球体の位置を更新
   */
  setSpherePosition(index, position, radius = 0.3) {
    const spheres = [
      this.sphere0, this.sphere1, this.sphere2, this.sphere3,
      this.sphere4, this.sphere5
    ];
    if (index >= 0 && index < 6) {
      spheres[index].value.set(position.x, position.y, position.z, radius);
    }
  }

  /**
   * カメラパラメータを更新
   */
  updateCamera(camera) {
    this.cameraAspect.value = camera.aspect;
  }

  /**
   * ブレンド係数を設定
   */
  setBlendFactor(value) {
    this.blendK.value = value;
  }

  /**
   * IOR（屈折率）を設定
   */
  setIOR(value) {
    this.ior.value = value;
  }

  /**
   * Dispersion（色収差）を設定
   */
  setDispersion(value) {
    this.dispersion.value = value;
  }

  /**
   * フレネル強度を設定
   */
  setFresnelStrength(value) {
    this.fresnelStrength.value = value;
  }

  /**
   * 屈折の歪み強度を設定（thicknessに相当）
   * 0.05〜0.3程度が目安
   */
  setRefractionStrength(value) {
    this.refractionStrength.value = value;
  }
}
