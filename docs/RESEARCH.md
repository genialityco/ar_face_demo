# Three.js TSL + WebGPU 調査レポート

調査日: 2026-01-13

## 概要

WebGPUとThree.js TSL（Three Shading Language）を使用した顔フィルターアプリケーション開発のための技術調査。

---

## 1. Three.js TSL (Three Shading Language)

### TSLとは

TSLはNode基盤のシェーダー抽象化で、JavaScriptで記述する。従来のGLSL文字列ではなく、JavaScriptの関数呼び出しでシェーダーを構築する。

**主な特徴:**
- JavaScriptライクな構文
- WebGPU（WGSL）とWebGL（GLSL）両方に自動変換
- Tree Shaking対応
- ノードベースで再利用性が高い

### 基本的なノード型

| ノード | 説明 |
|--------|------|
| `uniform()` | GPUに渡す変数（色、時間、変換など） |
| `attribute()` | ジオメトリ属性へのアクセス |
| `varying()` | 頂点→フラグメント間の補間値 |
| `texture()` | テクスチャサンプリング |
| `storage()` | コンピュートシェーダー用ストレージ |

### TSL関数の定義

```javascript
import { Fn, float, vec3, sin, time } from 'three/tsl';

const myShaderFn = Fn(() => {
  const t = time.mul(2.0);
  const color = vec3(sin(t), 0.5, 1.0);
  return color;
});
```

### NodeMaterial

従来のMaterialに対応するNodeMaterial:
- `MeshBasicMaterial` → `MeshBasicNodeMaterial`
- `MeshStandardMaterial` → `MeshStandardNodeMaterial`
- `ShaderMaterial` → `NodeMaterial`

---

## 2. WebGPURenderer

### セットアップ

```javascript
import * as THREE from 'three/webgpu';
import { uniform, time, sin } from 'three/tsl';

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init(); // 必須！非同期初期化
```

### Vite設定

```javascript
// vite.config.js
export default {
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext'
  }
};
```

### WebGLフォールバック

```javascript
const renderer = new THREE.WebGPURenderer({
  antialias: true,
  forceWebGL: true  // 開発時のWebGL動作確認用
});
```

WebGPU非対応ブラウザでは自動的にWebGLにフォールバックする。

---

## 3. コンピュートシェーダー

### 基本構造

```javascript
import { compute, storage, instanceIndex } from 'three/tsl';

// ストレージバッファ
const positionBuffer = storage(
  new THREE.StorageBufferAttribute(positions, 3),
  'vec3',
  count
);

// コンピュートシェーダー定義
const computeShader = Fn(() => {
  const index = instanceIndex;
  const pos = positionBuffer.element(index);

  // 位置更新ロジック
  pos.x.addAssign(0.01);

  positionBuffer.element(index).assign(pos);
});

// コンピュートノード作成
const computeNode = compute(computeShader, count);

// 毎フレーム実行
renderer.compute(computeNode);
```

### パーティクルシステムへの応用

従来（WebGL）:
1. CPUでパーティクル位置計算
2. 毎フレームGPUにアップロード
3. ボトルネック発生

WebGPUコンピュートシェーダー:
1. GPU上で直接計算
2. データがGPUメモリに留まる
3. 100万パーティクルも可能

---

## 4. ポストプロセッシング

### 基本的なポストプロセス

```javascript
import { pass, bloom, PostProcessing } from 'three/tsl';

const scenePass = pass(scene, camera);
const bloomPass = bloom(scenePass, 0.5, 0.4);

const postProcessing = new THREE.PostProcessing(renderer);
postProcessing.outputNode = bloomPass;

// レンダリング
postProcessing.render();
```

### カスタムエフェクト

```javascript
import { Fn, texture, uv, vec4 } from 'three/tsl';

const chromaticAberration = Fn(([inputTexture, offset]) => {
  const uvCoord = uv();

  const r = texture(inputTexture, uvCoord.add(vec2(offset, 0))).r;
  const g = texture(inputTexture, uvCoord).g;
  const b = texture(inputTexture, uvCoord.sub(vec2(offset, 0))).b;

  return vec4(r, g, b, 1.0);
});
```

---

## 5. MediaPipe Face Mesh

### 概要

- 468点の3D顔ランドマークをリアルタイム検出
- Blendshape（表情係数）も出力可能
- WASM + GPU delegate で動作（WebGPUではない）

### セットアップ

```javascript
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
);

const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    delegate: 'GPU'
  },
  runningMode: 'VIDEO',
  numFaces: 1,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true
});
```

### 出力データ

```javascript
const result = faceLandmarker.detectForVideo(video, timestamp);

// ランドマーク (468点 × 3座標)
result.faceLandmarks[0]  // [{x, y, z}, ...]

// ブレンドシェイプ（表情）
result.faceBlendshapes[0].categories
// [{ categoryName: 'mouthOpen', score: 0.8 }, ...]

// 変換行列
result.facialTransformationMatrixes[0]
```

### 主要なBlendshape

| 名前 | 説明 |
|------|------|
| `eyeBlinkLeft/Right` | 瞬き |
| `mouthOpen` | 口の開き |
| `mouthSmileLeft/Right` | 笑顔 |
| `browDownLeft/Right` | 眉を下げる |
| `jawOpen` | 顎を開く |

---

## 6. 参考リソース

### 公式

- [Three.js GitHub Wiki - TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [Three.js Examples (WebGPU)](https://threejs.org/examples/?q=webgpu)
- [MediaPipe Face Landmarker Web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)

### チュートリアル

- [Maxime Heckel - Field Guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Three.js Roadmap - Galaxy Simulation](https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders)
- [Wawa Sensei - GPGPU Particles](https://wawasensei.dev/courses/react-three-fiber/lessons/tsl-gpgpu)
- [NiksCourses - Getting to grips with TSL](https://niklever.com/tutorials/getting-to-grips-with-threejs-shading-language-tsl/)

### GitHubリポジトリ

- [cmhhelgeson/Threejs_TSL_Tutorials](https://github.com/cmhhelgeson/Threejs_TSL_Tutorials)
- [boytchev/tsl-textures](https://github.com/boytchev/tsl-textures)

---

## 7. 注意事項

### 技術的制約

1. **ブラウザ対応**
   - Chrome/Edge: 完全対応
   - Safari: iOS 17+, macOS Sonoma+ で対応
   - Firefox: 開発中

2. **Three.jsバージョン**
   - r171以降を推奨
   - 現在の安定版: r182

3. **ドキュメント不足**
   - TSLは公式ドキュメントが不完全
   - Three.jsのexamplesを参照することが重要

### パフォーマンス考慮

1. コンピュートシェーダーは毎フレーム実行のコストがある
2. ストレージバッファのサイズに注意
3. WebGLフォールバック時はコンピュートシェーダー使用不可
