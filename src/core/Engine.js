/**
 * Engine - WebGPURenderer初期化とメインループ管理
 */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { Bloom } from '../effects/screen/Bloom.js';
import { MetaballEffect } from '../effects/raymarching/MetaballEffect.js';

export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.videoTexture = null;
    this.isRunning = false;

    // 環境マップ用
    this.cubeRenderTarget = null;
    this.cubeCamera = null;
    this.envScene = null;

    // テスト用透過オブジェクト
    this.glassSphere = null;
    this.targetPosition = new THREE.Vector3();
    this.smoothingFactor = 0.55;  // 追従のスムージング（0-1、大きいほど速く追従）

    // 手の追従用
    this.leftHandTarget = new THREE.Vector3(-100, 0, 0);
    this.rightHandTarget = new THREE.Vector3(100, 0, 0);
    this.leftHandCurrent = new THREE.Vector3(-100, 0, 0);
    this.rightHandCurrent = new THREE.Vector3(100, 0, 0);
    this.handSphereRadius = 0.96;  // 手の球体サイズ（0.8 × 1.2）

    // メタボールエフェクト
    this.metaballEffect = null;
    this.useMetaball = true;  // true: レイマーチングメタボール, false: ガラス球

    // 座標変換用パラメータ
    this.distance = 5;  // カメラからの基準距離

    // フレームカウンター
    this.frameCount = 0;

    // ポストプロセス
    this.postProcessing = null;
    this.chromaticOffset = null;
  }

  /**
   * エンジンを初期化
   * @param {HTMLVideoElement} video - カメラ映像のvideo要素
   */
  async init(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const aspect = width / height;

    // WebGPURenderer初期化
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 必須: WebGPUの非同期初期化
    await this.renderer.init();

    this.container.appendChild(this.renderer.domElement);

    // シーン作成
    this.scene = new THREE.Scene();

    // カメラ作成（パースペクティブ）
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.01, 1000);
    this.camera.position.z = 5;

    // VideoTextureを作成
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;

    // 背景に設定
    this.scene.background = this.videoTexture;

    // 環境マップをセットアップ（transmission用）
    this.setupEnvironmentMap();

    // ライトをセットアップ
    this.setupLights();

    // メタボールまたはガラス球を追加
    if (this.useMetaball) {
      this.setupMetaball();
    } else {
      this.createGlassSphere();
    }

    // ポストプロセスをセットアップ
    this.setupPostProcessing();

    // リサイズ対応
    window.addEventListener('resize', () => this.handleResize(video));

    console.log('Engine initialized with WebGPU');
  }

  /**
   * 環境マップをセットアップ（transmission屈折用）
   */
  setupEnvironmentMap() {
    // CubeRenderTarget作成（解像度を512に下げてテスト）
    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      colorSpace: THREE.SRGBColorSpace
    });

    // CubeCamera作成
    this.cubeCamera = new THREE.CubeCamera(0.1, 100, this.cubeRenderTarget);

    // 環境マップ用シーン（videoTextureを内側に貼った球体）
    this.envScene = new THREE.Scene();
    const envMaterial = new THREE.MeshBasicMaterial({
      map: this.videoTexture,
      side: THREE.BackSide
    });
    const envSphere = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 32),
      envMaterial
    );
    this.envScene.add(envSphere);
  }

  /**
   * メタボールエフェクトをセットアップ
   */
  setupMetaball() {
    this.metaballEffect = new MetaballEffect({
      blendFactor: 0.4,
      ior: 1.45,           // ガラスの屈折率
      dispersion: 0.08,    // 色収差の強さ
      fresnelStrength: 0.9, // 反射強度（上げた）
      refractionStrength: 0.1
    });

    // 背景テクスチャ（カメラ映像）を設定
    this.metaballEffect.setBackgroundTexture(this.videoTexture);

    // 環境マップ（CubeMap）を設定
    this.metaballEffect.setEnvMapTexture(this.cubeRenderTarget.texture);

    // フルスクリーンクワッドを作成（シーンには追加しない）
    this.metaballEffect.createFullscreenQuad();

    // カメラパラメータを設定
    this.metaballEffect.updateCamera(this.camera);

    // 初期位置を設定（メイン球 + 周回する小球）- サイズ2.25倍（1.5 x 1.5）
    this.metaballEffect.setSpherePosition(0, new THREE.Vector3(0, 0, 0), 1.125);
    this.metaballEffect.setSpherePosition(1, new THREE.Vector3(0.8, 0.3, 0), 0.5625);
    this.metaballEffect.setSpherePosition(2, new THREE.Vector3(-0.6, -0.2, 0.3), 0.45);
    this.metaballEffect.setSpherePosition(3, new THREE.Vector3(0.2, -0.5, -0.2), 0.45);

    console.log('Metaball effect initialized with refraction');
  }

  /**
   * ライトをセットアップ
   */
  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);

    const rimLight = new THREE.DirectionalLight(0x88ccff, 0.4);
    rimLight.position.set(-5, 5, -5);
    this.scene.add(rimLight);
  }

  /**
   * ポストプロセスをセットアップ（Bloom）
   */
  setupPostProcessing() {
    // シーンパスを作成
    const scenePass = pass(this.scene, this.camera);

    // scenePassからテクスチャノードを取得
    const scenePassColor = scenePass.getTextureNode('output');

    // Bloomエフェクトを作成・適用
    this.bloomEffect = new Bloom({
      strength: 0.6,    // 光の強さ
      radius: 0.4,      // ぼかしの広がり (0-1)
      threshold: 0.7    // 光り始める明るさの閾値
    });
    const finalPass = this.bloomEffect.apply(scenePassColor);

    // PostProcessingを作成
    this.postProcessing = new THREE.PostProcessing(this.renderer);
    this.postProcessing.outputNode = finalPass;
  }

  /**
   * テスト用の透過球体を作成
   */
  createGlassSphere() {
    const geometry = new THREE.SphereGeometry(1.2, 64, 64);
    const material = new THREE.MeshPhysicalMaterial({
      transmission: 1,
      thickness: 0.6,
      roughness: 0.05,
      metalness: 0,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0,
      envMap: this.cubeRenderTarget.texture,
      envMapIntensity: 1.2,
      attenuationDistance: 2,
      attenuationColor: new THREE.Color(0.9, 0.95, 1.0),
      dispersion: 8,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide
    });

    this.glassSphere = new THREE.Mesh(geometry, material);
    this.glassSphere.position.set(0, 0, 0);
    this.scene.add(this.glassSphere);
  }

  /**
   * メインループ開始
   */
  start() {
    this.isRunning = true;
    this.animate();
  }

  /**
   * メインループ停止
   */
  stop() {
    this.isRunning = false;
  }

  /**
   * アニメーションループ
   */
  animate() {
    if (!this.isRunning) return;

    requestAnimationFrame(() => this.animate());
    this.update();
    this.render();
  }

  /**
   * 更新処理
   */
  update() {
    if (this.useMetaball && this.metaballEffect) {
      // メタボールモード: メイン球を顔に追従、小球は周回
      const time = performance.now() * 0.001;

      // メイン球（インデックス0）を顔位置に追従
      // targetPositionをスムーズに追従
      if (!this.currentPosition) {
        this.currentPosition = new THREE.Vector3();
      }
      this.currentPosition.lerp(this.targetPosition, this.smoothingFactor);
      this.metaballEffect.setSpherePosition(0, this.currentPosition, 1.125);

      // 小球を周回させる
      const orbitRadius = 0.8;
      for (let i = 1; i < 4; i++) {
        const angle = time * (1.5 - i * 0.3) + (i * Math.PI * 2 / 3);
        const offsetX = Math.cos(angle) * orbitRadius;
        const offsetY = Math.sin(angle * 0.7) * 0.3;
        const offsetZ = Math.sin(angle) * orbitRadius * 0.5;

        const pos = this.currentPosition.clone().add(
          new THREE.Vector3(offsetX, offsetY, offsetZ)
        );
        this.metaballEffect.setSpherePosition(i, pos, 0.45 + i * 0.1125);
      }

      // 手の球体を更新（インデックス4: 左手、5: 右手）
      this.leftHandCurrent.lerp(this.leftHandTarget, this.smoothingFactor);
      this.rightHandCurrent.lerp(this.rightHandTarget, this.smoothingFactor);
      this.metaballEffect.setSpherePosition(4, this.leftHandCurrent, this.handSphereRadius);
      this.metaballEffect.setSpherePosition(5, this.rightHandCurrent, this.handSphereRadius);
    } else if (this.glassSphere) {
      // ガラス球モード
      this.glassSphere.rotation.y += 0.01;
      this.glassSphere.position.lerp(this.targetPosition, this.smoothingFactor);
    }
  }

  /**
   * MediaPipeの正規化座標をThree.js 3D座標に変換
   * @param {number} x - 正規化X座標（0-1）
   * @param {number} y - 正規化Y座標（0-1）
   * @param {number} z - 相対Z座標
   */
  projectToWorld(x, y, z = 0) {
    // NDC座標に変換（-1 to 1）
    // Xは反転しない（映像が既に鏡像）
    const ndcX = (x - 0.5) * 2;
    const ndcY = -(y - 0.5) * 2;

    // NDCからワールド座標に変換
    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(this.camera);

    // カメラからの方向を計算
    const dir = vector.sub(this.camera.position).normalize();

    // Z値を考慮した距離
    const dist = this.distance - z * 3;

    // 最終位置を計算
    return this.camera.position.clone().add(dir.multiplyScalar(dist));
  }

  /**
   * 顔のランドマークで球体位置を更新
   * @param {Object} landmark - {x, y, z}
   */
  updateFacePosition(landmark) {
    if (!landmark) {
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);

    // オフセット: x=右、y=上、z=手前
    worldPos.x += 0;    // 右にずらす
    worldPos.y += 0.5;  // 上にずらす（顔の上に球体）
    worldPos.z += 0;    // 手前にずらす

    this.targetPosition.copy(worldPos);
  }

  /**
   * 左手の位置を更新
   * @param {Object|null} landmark - {x, y, z} or null
   */
  updateLeftHandPosition(landmark) {
    if (!landmark) {
      // 手が検出されない場合は画面外に
      this.leftHandTarget.set(-100, 0, 0);
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);
    this.leftHandTarget.copy(worldPos);
  }

  /**
   * 右手の位置を更新
   * @param {Object|null} landmark - {x, y, z} or null
   */
  updateRightHandPosition(landmark) {
    if (!landmark) {
      // 手が検出されない場合は画面外に
      this.rightHandTarget.set(100, 0, 0);
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);
    this.rightHandTarget.copy(worldPos);
  }

  /**
   * レンダリング
   */
  render() {
    this.frameCount++;

    // 環境マップを更新（2フレームごと）
    if (this.frameCount % 2 === 0) {
      this.cubeCamera.update(this.renderer, this.envScene);
    }

    if (this.useMetaball && this.metaballEffect) {
      // メタボールモード: 背景をレンダリング後、メタボールをオーバーレイ
      this.renderer.render(this.scene, this.camera);
      this.metaballEffect.render(this.renderer);
    } else {
      // ガラス球モード: PostProcessingでレンダリング（Bloom適用）
      this.postProcessing.render();
    }
  }

  /**
   * リサイズ処理
   */
  handleResize(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * リソース解放
   */
  dispose() {
    this.stop();
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
