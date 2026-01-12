# プロジェクト設計書

## プロジェクト概要

**名前:** face_filter_gpgpu
**目的:** WebGPU + Three.js TSLを活用した豪華なリアルタイム顔フィルターアプリケーション
**技術スタック:**
- Three.js (WebGPURenderer + TSL)
- MediaPipe Face Mesh
- Vite

---

## ディレクトリ構造

```
face_filter_gpgpu/
├── index.html                  # エントリーHTML
├── vite.config.js              # Vite設定
├── package.json
│
├── docs/                       # ドキュメント
│   ├── RESEARCH.md             # 技術調査
│   └── ARCHITECTURE.md         # 本ファイル
│
├── src/
│   ├── main.js                 # アプリケーションエントリーポイント
│   │
│   ├── core/                   # コア機能
│   │   ├── Engine.js           # WebGPURenderer管理、メインループ
│   │   ├── WebCamera.js        # Webカメラ取得・管理
│   │   └── FaceTracker.js      # MediaPipe Face Mesh ラッパー
│   │
│   ├── effects/                # エフェクトシステム
│   │   ├── EffectManager.js    # エフェクトの登録・更新・合成
│   │   ├── EffectComposer.js   # ポストプロセスチェーン管理
│   │   │
│   │   ├── base/
│   │   │   └── BaseEffect.js   # エフェクト基底クラス
│   │   │
│   │   ├── face/               # 顔連動エフェクト
│   │   │   ├── NeonOutline.js      # 顔輪郭のネオンライン
│   │   │   ├── EyeGlow.js          # 目周りの発光
│   │   │   ├── MouthParticles.js   # 口からパーティクル噴出
│   │   │   └── FaceAura.js         # 顔周りのオーラ
│   │   │
│   │   └── screen/             # スクリーンエフェクト
│   │       ├── ChromaticAberration.js  # 色収差
│   │       ├── Glitch.js               # グリッチノイズ
│   │       ├── Bloom.js                # グロー効果
│   │       ├── Ripple.js               # 波紋歪み
│   │       └── Pixelate.js             # ピクセル化
│   │
│   ├── shaders/                # TSLシェーダー定義
│   │   ├── compute/            # コンピュートシェーダー
│   │   │   ├── particleInit.js     # パーティクル初期化
│   │   │   └── particleUpdate.js   # パーティクル更新
│   │   │
│   │   ├── materials/          # カスタムマテリアル
│   │   │   ├── neonLineMaterial.js
│   │   │   ├── glowMaterial.js
│   │   │   └── particleMaterial.js
│   │   │
│   │   └── postprocess/        # ポストプロセスノード
│   │       ├── chromaticNode.js
│   │       ├── glitchNode.js
│   │       └── rippleNode.js
│   │
│   ├── ui/                     # UI関連
│   │   ├── Controls.js         # パラメータ調整UI
│   │   └── DebugPanel.js       # FPS、デバッグ情報表示
│   │
│   ├── utils/                  # ユーティリティ
│   │   ├── math.js             # 数学ヘルパー
│   │   ├── landmarks.js        # ランドマークインデックス定義
│   │   └── easing.js           # イージング関数
│   │
│   └── config/
│       └── settings.js         # 設定値（定数、デフォルト値）
│
└── public/                     # 静的ファイル
    └── (必要に応じてアセット)
```

---

## コアクラス設計

### Engine.js

アプリケーション全体を統括するクラス。

```javascript
class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.clock = new THREE.Clock();
  }

  async init() {
    // WebGPURenderer初期化
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    await this.renderer.init();

    // シーン、カメラ設定
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(...);

    // コンテナに追加
    this.container.appendChild(this.renderer.domElement);
  }

  update(deltaTime) {
    // 毎フレーム更新
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    // リソース解放
  }
}
```

### WebCamera.js

Webカメラの取得と管理。

```javascript
class WebCamera {
  constructor() {
    this.video = null;
    this.stream = null;
    this.facingMode = 'user';
  }

  async start(facingMode = 'user') {
    // カメラ取得
  }

  async switchCamera() {
    // 前面/背面切り替え
  }

  getVideoElement() {
    return this.video;
  }

  getTexture() {
    // THREE.VideoTexture を返す
  }

  dispose() {
    // ストリーム停止
  }
}
```

### FaceTracker.js

MediaPipe Face Meshのラッパー。

```javascript
class FaceTracker {
  constructor() {
    this.faceLandmarker = null;
    this.lastResult = null;
  }

  async init() {
    // MediaPipe初期化
  }

  detect(video, timestamp) {
    // 検出実行、結果を保存
    this.lastResult = this.faceLandmarker.detectForVideo(video, timestamp);
    return this.lastResult;
  }

  // ヘルパーメソッド
  getLandmarks() { ... }
  getBlendshapes() { ... }
  getFaceTransform() { ... }

  // 特定部位のランドマーク取得
  getLeftEye() { ... }
  getRightEye() { ... }
  getMouth() { ... }
  getFaceOutline() { ... }

  dispose() { ... }
}
```

---

## エフェクトシステム設計

### BaseEffect.js

全エフェクトの基底クラス。

```javascript
class BaseEffect {
  constructor(engine) {
    this.engine = engine;
    this.enabled = true;
    this.parameters = {};
  }

  // オーバーライド必須
  init() {
    throw new Error('init() must be implemented');
  }

  update(deltaTime, faceData) {
    throw new Error('update() must be implemented');
  }

  // ポストプロセス用ノードを返す（オプション）
  getPostProcessNode() {
    return null;
  }

  // 3Dオブジェクトを返す（オプション）
  getSceneObjects() {
    return [];
  }

  setParameter(key, value) {
    this.parameters[key] = value;
  }

  dispose() {
    // リソース解放
  }
}
```

### EffectManager.js

エフェクトの登録と管理。

```javascript
class EffectManager {
  constructor(engine) {
    this.engine = engine;
    this.effects = new Map();
  }

  register(name, EffectClass) {
    const effect = new EffectClass(this.engine);
    effect.init();
    this.effects.set(name, effect);
  }

  enable(name) {
    this.effects.get(name)?.enabled = true;
  }

  disable(name) {
    this.effects.get(name)?.enabled = false;
  }

  update(deltaTime, faceData) {
    for (const effect of this.effects.values()) {
      if (effect.enabled) {
        effect.update(deltaTime, faceData);
      }
    }
  }

  getPostProcessNodes() {
    // 有効なエフェクトのポストプロセスノードを収集
  }

  dispose() {
    for (const effect of this.effects.values()) {
      effect.dispose();
    }
  }
}
```

---

## データフロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        メインループ                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────┐    video    ┌─────────────┐
│  WebCamera  │ ──────────► │ FaceTracker │
└─────────────┘             └─────────────┘
       │                          │
       │ VideoTexture             │ FaceData
       ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EffectManager                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  NeonOutline │  │   EyeGlow    │  │ MouthParticles│  ...    │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ SceneObjects + PostProcessNodes
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EffectComposer                              │
│  Video → [Bloom] → [Chromatic] → [Glitch] → Output             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WebGPURenderer                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## FaceDataインターフェース

FaceTrackerから各エフェクトに渡されるデータ構造。

```typescript
interface FaceData {
  // 検出されたか
  detected: boolean;

  // 468点のランドマーク（正規化座標 0-1）
  landmarks: Array<{ x: number, y: number, z: number }>;

  // ブレンドシェイプ（表情）
  blendshapes: {
    mouthOpen: number;       // 0-1
    eyeBlinkLeft: number;
    eyeBlinkRight: number;
    mouthSmileLeft: number;
    mouthSmileRight: number;
    browDownLeft: number;
    browDownRight: number;
    // ... その他
  };

  // 顔の変換行列（位置・回転）
  transform: THREE.Matrix4;

  // 派生データ（ヘルパーで計算）
  faceBounds: { x, y, width, height };
  faceCenter: { x, y, z };
}
```

---

## エフェクト実装例

### NeonOutline.js（顔輪郭ネオン）

```javascript
import { BaseEffect } from './base/BaseEffect.js';
import { neonLineMaterial } from '../shaders/materials/neonLineMaterial.js';
import { FACE_OUTLINE_INDICES } from '../utils/landmarks.js';

class NeonOutline extends BaseEffect {
  init() {
    this.parameters = {
      color: 0x00ffff,
      intensity: 1.0,
      width: 2.0
    };

    // ラインジオメトリ作成
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(FACE_OUTLINE_INDICES.length * 3);
    this.geometry.setAttribute('position',
      new THREE.BufferAttribute(this.positions, 3)
    );

    // TSLマテリアル
    this.material = neonLineMaterial({
      color: this.parameters.color,
      intensity: this.parameters.intensity
    });

    this.line = new THREE.Line(this.geometry, this.material);
  }

  update(deltaTime, faceData) {
    if (!faceData.detected) {
      this.line.visible = false;
      return;
    }

    this.line.visible = true;

    // ランドマークから輪郭の位置を更新
    FACE_OUTLINE_INDICES.forEach((idx, i) => {
      const lm = faceData.landmarks[idx];
      this.positions[i * 3] = lm.x * 2 - 1;     // -1 to 1
      this.positions[i * 3 + 1] = -(lm.y * 2 - 1);
      this.positions[i * 3 + 2] = lm.z;
    });

    this.geometry.attributes.position.needsUpdate = true;
  }

  getSceneObjects() {
    return [this.line];
  }
}
```

---

## 設定ファイル

### config/settings.js

```javascript
export const SETTINGS = {
  // カメラ
  camera: {
    width: 1280,
    height: 720,
    facingMode: 'user'
  },

  // レンダラー
  renderer: {
    antialias: true,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
  },

  // MediaPipe
  faceTracker: {
    maxFaces: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  },

  // エフェクトデフォルト値
  effects: {
    neonOutline: {
      enabled: true,
      color: 0x00ffff,
      intensity: 1.0
    },
    bloom: {
      enabled: true,
      strength: 0.5,
      radius: 0.4
    },
    chromatic: {
      enabled: false,
      offset: 0.005
    }
  }
};
```

---

## 実装フェーズ

### Phase 1: 基盤構築
- [x] プロジェクト構造作成
- [ ] Engine.js 実装
- [ ] WebCamera.js 実装
- [ ] 映像をWebGPUで表示

### Phase 2: 顔トラッキング
- [ ] FaceTracker.js 実装
- [ ] ランドマークの可視化（デバッグ用）
- [ ] FaceDataインターフェース確立

### Phase 3: 基本エフェクト
- [ ] BaseEffect.js 実装
- [ ] EffectManager.js 実装
- [ ] Bloom エフェクト（TSLポストプロセス）

### Phase 4: 顔連動エフェクト
- [ ] NeonOutline.js
- [ ] EyeGlow.js

### Phase 5: 高度なエフェクト
- [ ] コンピュートシェーダーによるパーティクル
- [ ] MouthParticles.js
- [ ] スクリーンエフェクト各種

### Phase 6: 仕上げ
- [ ] UI/コントロール
- [ ] パフォーマンス最適化
- [ ] WebGLフォールバック確認

---

## 技術的考慮事項

### パフォーマンス
1. MediaPipeは別スレッド（WASM）で動作するが、結果取得はメインスレッド
2. コンピュートシェーダーの呼び出し回数を最小限に
3. ポストプロセスパスの数に注意（各パスでフルスクリーン描画）

### 互換性
1. WebGPU非対応時のフォールバック戦略
2. コンピュートシェーダーはWebGL未対応
3. iOSサポート（Safari 17+）

### デバッグ
1. `forceWebGL: true`でWebGL動作確認
2. FPS、メモリ使用量の表示
3. 各エフェクトの個別ON/OFF
