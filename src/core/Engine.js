/**
 * Engine - WebGPURenderer初期化とメインループ管理
 */
import * as THREE from 'three/webgpu';

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

    // フレームカウンター
    this.frameCount = 0;
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

    // テスト用の透過球体を追加
    this.createGlassSphere();

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
   * テスト用の透過球体を作成
   */
  createGlassSphere() {
    const geometry = new THREE.SphereGeometry(0.8, 64, 64);
    const material = new THREE.MeshPhysicalMaterial({
      transmission: 1,
      thickness: 0.5,
      roughness: 0.05,
      metalness: 0,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0,
      envMap: this.cubeRenderTarget.texture,
      envMapIntensity: 1.2,
      attenuationDistance: 2,
      attenuationColor: new THREE.Color(0.9, 0.95, 1.0),
      dispersion: 5,
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
    // 球体を少し回転（動作確認用）
    if (this.glassSphere) {
      this.glassSphere.rotation.y += 0.01;
    }
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

    // メインシーンをレンダリング
    this.renderer.render(this.scene, this.camera);
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
