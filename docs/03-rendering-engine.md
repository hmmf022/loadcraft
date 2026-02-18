# 03 - WebGPU レンダリングエンジン設計書

## 1. モジュール概要

本レンダリングエンジンは、コンテナ積載シミュレータの 3D 描画を担当するモジュールである。TypeScript + React + Vite の構成上で WebGPU API を用い、ブラウザ上でリアルタイム 3D レンダリングを行う。

### 設計方針: ハイブリッドレンダリング

データ層ではボクセル（1cm 解像度）を用いて積載計算・衝突判定を行うが、レンダリング層ではメッシュ（ボックスジオメトリ）を使用して滑らかな外観を実現する。これにより、計算精度と描画品質を両立させる。

### レンダリングパイプライン全体像

```
requestAnimationFrame ループ
  │
  ├─ カメラ Uniform 更新
  ├─ インスタンスバッファ更新（配置変更時のみ）
  │
  ├─ Pass 1: 荷物描画（不透明、インスタンス描画）
  │    └─ cargo.wgsl / depth write=true / cullMode=back
  │
  ├─ Pass 2: コンテナ壁描画（透過、2サブパス）
  │    ├─ Sub-pass A: 背面描画（外側から見た壁 → 透明）
  │    └─ Sub-pass B: 前面描画（内側から見た壁 → 不透明）
  │
  ├─ Pass 3: 床グリッド描画
  │    └─ grid.wgsl / procedural grid pattern
  │
  └─ コマンドバッファ submit
```

### サブモジュール構成

| モジュール | 責務 |
|---|---|
| `WebGPUContext` | WebGPU 初期化・デバイス管理 |
| `RenderPipeline` | 各パスのパイプライン構築・実行 |
| `ShaderManager` | WGSL シェーダーの読み込み・コンパイル |
| `OrbitCamera` | カメラ状態管理・行列計算 |
| `CameraController` | マウス/タッチ入力によるカメラ操作 |
| `Raycaster` | レイキャストによるオブジェクトピッキング |
| `LabelRenderer` | 3D→2D 投影による HTML ラベル表示 |
| `Renderer` | 全体統合・レンダーループ管理 |

---

## 2. WebGPU 初期化シーケンス

WebGPU の初期化は非同期処理であり、以下のステップを順に実行する。

### 初期化フロー

```
1. navigator.gpu の存在確認
2. requestAdapter() でアダプタ取得
3. adapter.requestDevice() でデバイス取得
4. canvas.getContext('webgpu') でコンテキスト取得
5. context.configure() でスワップチェーン設定
6. 深度テクスチャ作成
7. 初期化完了
```

### TypeScript 実装

```typescript
/**
 * WebGPU 初期化結果を保持する型
 */
interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  depthTexture: GPUTexture;
  canvas: HTMLCanvasElement;
}

/**
 * WebGPU 初期化エラー
 */
class WebGPUInitError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | 'not-supported'
      | 'adapter-failed'
      | 'device-failed'
      | 'context-failed',
  ) {
    super(message);
    this.name = 'WebGPUInitError';
  }
}

/**
 * WebGPU の初期化シーケンスを実行する。
 *
 * @param canvas - 描画対象の HTMLCanvasElement
 * @returns 初期化済みの WebGPUContext
 * @throws WebGPUInitError ブラウザが WebGPU 未対応の場合、またはリソース取得に失敗した場合
 */
async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext> {
  // Step 1: WebGPU サポート確認
  if (!navigator.gpu) {
    throw new WebGPUInitError(
      'このブラウザは WebGPU をサポートしていません。Chrome 113+ または Firefox Nightly をお使いください。',
      'not-supported',
    );
  }

  // Step 2: アダプタ取得
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new WebGPUInitError(
      'WebGPU アダプタの取得に失敗しました。GPU ドライバを更新してください。',
      'adapter-failed',
    );
  }

  // Step 3: デバイス取得
  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });

  // デバイスロストのハンドリング
  device.lost.then((info) => {
    console.error(`WebGPU device lost: ${info.message}`);
    if (info.reason !== 'destroyed') {
      // デバイスの再初期化を試行する
      console.warn('デバイスの再初期化を試行します...');
    }
  });

  // Step 4: キャンバスコンテキスト取得
  const context = canvas.getContext('webgpu');

  if (!context) {
    throw new WebGPUInitError(
      'WebGPU キャンバスコンテキストの取得に失敗しました。',
      'context-failed',
    );
  }

  // Step 5: コンテキスト設定
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  // Step 6: 深度テクスチャ作成
  const depthTexture = createDepthTexture(device, canvas.width, canvas.height);

  return {
    device,
    context,
    format,
    depthTexture,
    canvas,
  };
}

/**
 * 深度テクスチャを作成する。
 * リサイズ時にも呼び出される。
 */
function createDepthTexture(
  device: GPUDevice,
  width: number,
  height: number,
): GPUTexture {
  return device.createTexture({
    size: {
      width: Math.max(1, width),
      height: Math.max(1, height),
    },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
```

### React コンポーネントからの初期化

```typescript
import { useEffect, useRef, useState } from 'react';

function useWebGPU(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [gpuContext, setGpuContext] = useState<WebGPUContext | null>(null);
  const [error, setError] = useState<WebGPUInitError | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;

    initWebGPU(canvas)
      .then((ctx) => {
        if (!destroyed) {
          setGpuContext(ctx);
        }
      })
      .catch((err) => {
        if (!destroyed) {
          setError(
            err instanceof WebGPUInitError
              ? err
              : new WebGPUInitError(String(err), 'not-supported'),
          );
        }
      });

    return () => {
      destroyed = true;
      if (gpuContext) {
        gpuContext.depthTexture.destroy();
        gpuContext.device.destroy();
      }
    };
  }, [canvasRef]);

  return { gpuContext, error };
}
```

---

## 3. レンダーパイプライン設計

### 3.1 Pass 1: 荷物描画（不透明、インスタンス描画）

荷物（カーゴ）は全て直方体であり、インスタンス描画（instanced drawing）を用いて効率的に描画する。

#### 頂点バッファレイアウト

| 属性 | フォーマット | オフセット | サイズ |
|---|---|---|---|
| position | `float32x3` | 0 | 12 bytes |
| normal | `float32x3` | 12 | 12 bytes |
| **合計** | | | **24 bytes/vertex** |

#### ユニットキューブジオメトリ

インデックスバッファを使用した最適構成:

- 頂点数: 24（各面 4 頂点 x 6 面、法線が面ごとに異なるため頂点共有不可）
- インデックス数: 36（各面 2 三角形 x 3 インデックス x 6 面）

```typescript
/**
 * 法線付きユニットキューブの頂点データを生成する。
 * 原点中心、各辺長さ 1.0 の立方体。
 * インスタンスのモデル行列でスケーリング・移動する。
 */
function createUnitCubeGeometry(): {
  vertices: Float32Array;
  indices: Uint16Array;
} {
  // 各面 4 頂点、6 面 = 24 頂点
  // 各頂点: position(3) + normal(3) = 6 floats
  // prettier-ignore
  const vertices = new Float32Array([
    // +X face (right)
     0.5, -0.5, -0.5,   1, 0, 0,
     0.5,  0.5, -0.5,   1, 0, 0,
     0.5,  0.5,  0.5,   1, 0, 0,
     0.5, -0.5,  0.5,   1, 0, 0,
    // -X face (left)
    -0.5, -0.5,  0.5,  -1, 0, 0,
    -0.5,  0.5,  0.5,  -1, 0, 0,
    -0.5,  0.5, -0.5,  -1, 0, 0,
    -0.5, -0.5, -0.5,  -1, 0, 0,
    // +Y face (top)
    -0.5,  0.5, -0.5,   0, 1, 0,
    -0.5,  0.5,  0.5,   0, 1, 0,
     0.5,  0.5,  0.5,   0, 1, 0,
     0.5,  0.5, -0.5,   0, 1, 0,
    // -Y face (bottom)
    -0.5, -0.5,  0.5,   0,-1, 0,
    -0.5, -0.5, -0.5,   0,-1, 0,
     0.5, -0.5, -0.5,   0,-1, 0,
     0.5, -0.5,  0.5,   0,-1, 0,
    // +Z face (front)
    -0.5, -0.5,  0.5,   0, 0, 1,
     0.5, -0.5,  0.5,   0, 0, 1,
     0.5,  0.5,  0.5,   0, 0, 1,
    -0.5,  0.5,  0.5,   0, 0, 1,
    // -Z face (back)
     0.5, -0.5, -0.5,   0, 0,-1,
    -0.5, -0.5, -0.5,   0, 0,-1,
    -0.5,  0.5, -0.5,   0, 0,-1,
     0.5,  0.5, -0.5,   0, 0,-1,
  ]);

  // 各面 2 三角形、6 面 = 36 インデックス
  // prettier-ignore
  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3, // +X
     4,  5,  6,   4,  6,  7, // -X
     8,  9, 10,   8, 10, 11, // +Y
    12, 13, 14,  12, 14, 15, // -Y
    16, 17, 18,  16, 18, 19, // +Z
    20, 21, 22,  20, 22, 23, // -Z
  ]);

  return { vertices, indices };
}
```

#### インスタンスデータ（Storage Buffer）

インスタンス属性ではなく Storage Buffer を使用する理由:

1. インスタンス属性は 1 頂点バッファあたり最大 16 属性に制限される
2. Storage Buffer は任意のサイズの構造体を格納可能
3. シェーダー内で `instance_index` を用いてランダムアクセスできる

```typescript
/**
 * 1 インスタンスあたりのデータレイアウト
 *
 * | フィールド    | 型         | サイズ   | オフセット |
 * |---------------|------------|----------|------------|
 * | modelMatrix   | mat4x4<f32>| 64 bytes | 0          |
 * | color         | vec4<f32>  | 16 bytes | 64         |
 * | 合計          |            | 80 bytes |            |
 */
interface CargoInstanceData {
  modelMatrix: Float32Array; // 16 floats (4x4 matrix)
  color: Float32Array; // 4 floats (RGBA)
}

const INSTANCE_BYTE_SIZE = 80; // 64 (mat4x4f) + 16 (vec4f)

/**
 * 全荷物のインスタンスデータを Storage Buffer 用に組み立てる。
 */
function buildInstanceBuffer(
  items: CargoInstanceData[],
): Float32Array {
  const data = new Float32Array(items.length * (INSTANCE_BYTE_SIZE / 4));

  for (let i = 0; i < items.length; i++) {
    const offset = i * 20; // 80 bytes / 4 = 20 floats per instance
    data.set(items[i].modelMatrix, offset);
    data.set(items[i].color, offset + 16);
  }

  return data;
}
```

#### パイプライン構成

```typescript
function createCargoPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
  instanceBindGroupLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const shaderModule = device.createShaderModule({
    label: 'cargo shader',
    code: cargoWGSL,
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      cameraBindGroupLayout,   // group 0: camera uniform
      instanceBindGroupLayout, // group 1: instance storage buffer
    ],
  });

  return device.createRenderPipeline({
    label: 'cargo pipeline',
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          // 頂点バッファ: position + normal
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            {
              // position: vec3f
              shaderLocation: 0,
              offset: 0,
              format: 'float32x3',
            },
            {
              // normal: vec3f
              shaderLocation: 1,
              offset: 12,
              format: 'float32x3',
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });
}
```

#### Bind Group Layout

```typescript
// Group 0: Camera Uniform
const cameraBindGroupLayout = device.createBindGroupLayout({
  label: 'camera bind group layout',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
  ],
});

// Group 1: Instance Storage Buffer
const instanceBindGroupLayout = device.createBindGroupLayout({
  label: 'instance bind group layout',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: 'read-only-storage',
      },
    },
  ],
});
```

---

### 3.2 Pass 2: コンテナ壁描画（透過、2サブパス）

コンテナの壁は以下の要件を満たす特殊な描画が必要:

- **外側から見た場合**: 壁は透明で、内部の荷物が見える
- **内側から見た場合**: 壁は不透明で、コンテナ内部空間が明確に視認できる

これを実現するため、カリングモードを切り替えた 2 つのサブパスで描画する。

#### 描画順序の重要性

透過オブジェクトは不透明オブジェクトの後に描画する必要がある。また、透過オブジェクト同士は奥から手前の順に描画する。この順序は以下のサブパス構成で自然に達成される。

```
Sub-pass A: 背面（cullMode: 'front'）→ 外から見える壁 → 透明
Sub-pass B: 前面（cullMode: 'back'）→ 内から見える壁 → 不透明
```

カメラから見て、背面は常に前面より奥にあるため、A → B の順で正しい描画順となる。

#### コンテナメッシュ

コンテナは壁厚を持つ単一のボックスメッシュとして構成する。外側の面と内側の面の両方を持ち、それぞれが独立した法線を持つ。

```typescript
/**
 * 壁厚付きコンテナメッシュを生成する。
 *
 * @param width  コンテナ内寸幅 (cm)
 * @param height コンテナ内寸高さ (cm)
 * @param depth  コンテナ内寸奥行き (cm)
 * @param wallThickness 壁厚 (cm)
 */
function createContainerMesh(
  width: number,
  height: number,
  depth: number,
  wallThickness: number,
): { vertices: Float32Array; indices: Uint16Array } {
  // 外側ボックスの半サイズ
  const ox = (width + wallThickness * 2) / 2;
  const oy = (height + wallThickness * 2) / 2;
  const oz = (depth + wallThickness * 2) / 2;

  // 内側ボックスの半サイズ
  const ix = width / 2;
  const iy = height / 2;
  const iz = depth / 2;

  // 外側面（法線は外向き）+ 内側面（法線は内向き）
  // 開口部（前面）は含めない
  // 頂点とインデックスを生成（実装省略、概念のみ示す）
  // ...

  return { vertices: new Float32Array([]), indices: new Uint16Array([]) };
}
```

#### Sub-pass A: 背面描画（透明壁）

```typescript
function createContainerTransparentPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
  containerBindGroupLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const shaderModule = device.createShaderModule({
    label: 'container shader',
    code: containerWGSL,
  });

  return device.createRenderPipeline({
    label: 'container transparent pipeline',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cameraBindGroupLayout, containerBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
          writeMask: GPUColorWrite.ALL,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'front', // 背面のみ描画（前面をカリング）
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false, // 透明オブジェクトは深度書き込みしない
      depthCompare: 'less',     // 深度テストは有効
    },
  });
}
```

#### Sub-pass B: 前面描画（不透明壁）

```typescript
function createContainerOpaquePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
  containerBindGroupLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const shaderModule = device.createShaderModule({
    label: 'container shader',
    code: containerWGSL,
  });

  return device.createRenderPipeline({
    label: 'container opaque pipeline',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cameraBindGroupLayout, containerBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          // ブレンド設定なし（不透明描画）
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back', // 前面のみ描画（背面をカリング）
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });
}
```

#### コンテナ Uniform

```typescript
/**
 * コンテナ描画用 Uniform
 * サブパスごとに alpha 値を切り替える
 */
interface ContainerUniform {
  modelMatrix: Float32Array; // mat4x4f (64 bytes)
  color: Float32Array;       // vec4f (16 bytes) - alpha はサブパスで上書き
}

const CONTAINER_TRANSPARENT_ALPHA = 0.3;
const CONTAINER_OPAQUE_ALPHA = 1.0;
```

---

### 3.3 Pass 3: 床グリッド描画

空間参照のために床面にグリッドパターンを描画する。フルスクリーンクワッドではなく、有限の平面メッシュを使用し、フラグメントシェーダーでプロシージャルにグリッドパターンを生成する。

#### グリッド平面の構成

```typescript
/**
 * 床グリッド用の平面メッシュを生成する。
 * Y=0 の水平面。
 */
function createGridPlane(size: number): {
  vertices: Float32Array;
  indices: Uint16Array;
} {
  const half = size / 2;

  // position(3) + uv(2) = 5 floats per vertex
  // prettier-ignore
  const vertices = new Float32Array([
    -half, 0,  half,   0, 0,
     half, 0,  half,   1, 0,
     half, 0, -half,   1, 1,
    -half, 0, -half,   0, 1,
  ]);

  // prettier-ignore
  const indices = new Uint16Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  return { vertices, indices };
}
```

#### グリッドパイプライン

```typescript
function createGridPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const shaderModule = device.createShaderModule({
    label: 'grid shader',
    code: gridWGSL,
  });

  return device.createRenderPipeline({
    label: 'grid pipeline',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cameraBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 20, // 3 floats position + 2 floats uv
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none', // 両面描画
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  });
}
```

---

## 4. シェーダー設計（WGSL）

### 4.1 common.wgsl（共有型定義）

```wgsl
// ========================================
// common.wgsl - 共有型定義
// ========================================

// カメラ Uniform 構造体
// Binding: group(0), binding(0) で全パイプラインで共有
struct CameraUniform {
  viewProj: mat4x4f,    // ビュー * プロジェクション合成行列
  viewMatrix: mat4x4f,  // ビュー行列（ワールド → カメラ空間）
  projMatrix: mat4x4f,  // プロジェクション行列
  cameraPos: vec3f,     // カメラのワールド座標
  _padding: f32,        // 16バイトアライメント用パディング
};
```

対応する TypeScript 型とバッファサイズ:

```typescript
/**
 * CameraUniform のバッファレイアウト
 *
 * | フィールド   | 型         | サイズ    | オフセット |
 * |-------------|------------|-----------|-----------|
 * | viewProj    | mat4x4f   | 64 bytes  | 0         |
 * | viewMatrix  | mat4x4f   | 64 bytes  | 64        |
 * | projMatrix  | mat4x4f   | 64 bytes  | 128       |
 * | cameraPos   | vec3f     | 12 bytes  | 192       |
 * | _padding    | f32       | 4 bytes   | 204       |
 * | 合計        |           | 208 bytes |           |
 */
const CAMERA_UNIFORM_SIZE = 208;
```

### 4.2 cargo.wgsl（荷物シェーダー）

```wgsl
// ========================================
// cargo.wgsl - インスタンス荷物描画シェーダー
// ========================================

// カメラ Uniform
struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

// 1 インスタンスのデータ
struct InstanceData {
  modelMatrix: mat4x4f,  // モデル変換行列（位置・回転・スケール）
  color: vec4f,          // インスタンスカラー（RGBA）
};

// インスタンスデータ配列（Storage Buffer）
struct InstancesBuffer {
  instances: array<InstanceData>,
};

// バインドグループ
@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(1) @binding(0) var<storage, read> instancesBuffer: InstancesBuffer;

// 頂点シェーダー出力 / フラグメントシェーダー入力
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) worldPos: vec3f,
  @location(2) color: vec4f,
};

// ---- 頂点シェーダー ----
@vertex
fn vs_main(
  @location(0) localPos: vec3f,
  @location(1) localNormal: vec3f,
  @builtin(instance_index) instanceIdx: u32,
) -> VertexOutput {
  let instance = instancesBuffer.instances[instanceIdx];
  let modelMatrix = instance.modelMatrix;

  // ワールド座標に変換
  let worldPos = modelMatrix * vec4f(localPos, 1.0);

  // 法線の変換（スケーリング対応のため逆転置行列が必要だが、
  // 均一スケールの場合はモデル行列の 3x3 部分で十分）
  let worldNormal = normalize(
    (modelMatrix * vec4f(localNormal, 0.0)).xyz
  );

  // クリップ空間に変換
  let clipPos = camera.viewProj * worldPos;

  var output: VertexOutput;
  output.position = clipPos;
  output.worldNormal = worldNormal;
  output.worldPos = worldPos.xyz;
  output.color = instance.color;
  return output;
}

// ---- フラグメントシェーダー ----
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // ディレクショナルライト（Lambertian 拡散反射）
  let lightDir = normalize(vec3f(0.3, 1.0, 0.5));
  let ambientStrength = 0.3;
  let ambient = vec3f(ambientStrength);

  // 法線とライト方向の内積（ランバート反射）
  let NdotL = max(dot(normalize(input.worldNormal), lightDir), 0.0);
  let diffuse = vec3f(NdotL * 0.7);

  // 最終カラー = インスタンスカラー * (環境光 + 拡散光)
  let lighting = ambient + diffuse;
  let finalColor = input.color.rgb * lighting;

  return vec4f(finalColor, input.color.a);
}
```

### 4.3 container.wgsl（コンテナ壁シェーダー）

```wgsl
// ========================================
// container.wgsl - コンテナ壁描画シェーダー
// ========================================

// カメラ Uniform
struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

// コンテナ Uniform
struct ContainerUniform {
  modelMatrix: mat4x4f,  // コンテナのモデル変換行列
  color: vec4f,          // 壁の色（alpha はサブパスで切替）
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(1) @binding(0) var<uniform> container: ContainerUniform;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) worldPos: vec3f,
};

// ---- 頂点シェーダー ----
@vertex
fn vs_main(
  @location(0) localPos: vec3f,
  @location(1) localNormal: vec3f,
) -> VertexOutput {
  let worldPos = container.modelMatrix * vec4f(localPos, 1.0);
  let worldNormal = normalize(
    (container.modelMatrix * vec4f(localNormal, 0.0)).xyz
  );
  let clipPos = camera.viewProj * worldPos;

  var output: VertexOutput;
  output.position = clipPos;
  output.worldNormal = worldNormal;
  output.worldPos = worldPos.xyz;
  return output;
}

// ---- フラグメントシェーダー ----
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // 簡易ライティング
  let lightDir = normalize(vec3f(0.3, 1.0, 0.5));
  let ambientStrength = 0.4;
  let ambient = vec3f(ambientStrength);

  let NdotL = max(dot(normalize(input.worldNormal), lightDir), 0.0);
  let diffuse = vec3f(NdotL * 0.6);

  let lighting = ambient + diffuse;
  let finalColor = container.color.rgb * lighting;

  // container.color.a がサブパスごとに切り替わる
  // Sub-pass A (透明): alpha = 0.3
  // Sub-pass B (不透明): alpha = 1.0
  return vec4f(finalColor, container.color.a);
}
```

### 4.4 grid.wgsl（床グリッドシェーダー）

```wgsl
// ========================================
// grid.wgsl - プロシージャル床グリッドシェーダー
// ========================================

struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
};

// ---- 頂点シェーダー ----
@vertex
fn vs_main(
  @location(0) localPos: vec3f,
  @location(1) uv: vec2f,  // 未使用だが頂点レイアウト互換性のため受け取る
) -> VertexOutput {
  let worldPos = vec4f(localPos, 1.0);
  let clipPos = camera.viewProj * worldPos;

  var output: VertexOutput;
  output.position = clipPos;
  output.worldPos = localPos;
  return output;
}

// ---- フラグメントシェーダー ----
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // グリッド設定
  let gridSpacing = 100.0;     // グリッド間隔 (100cm = 1m)
  let lineWidth = 1.5;         // グリッド線の幅 (ピクセル相当)
  let gridColor = vec3f(0.5, 0.5, 0.5);  // グリッド線の色
  let bgColor = vec3f(0.9, 0.9, 0.9);    // 背景色

  // ワールド座標から繰り返しパターンを計算
  let coord = input.worldPos.xz / gridSpacing;

  // fract() でグリッドパターンを生成
  // 各軸について 0〜1 の繰り返し座標を得て、0 付近にライン描画
  let grid2d = abs(fract(coord - 0.5) - 0.5);

  // fwidth() で画面空間の偏微分を使いアンチエイリアスされた線幅を計算
  let fw = fwidth(coord);
  let gridLine = step(grid2d, fw * lineWidth);

  // 2 軸のグリッド線を合成
  let lineIntensity = max(gridLine.x, gridLine.y);

  // カメラからの距離に応じてフェードアウト
  let distFromCamera = length(input.worldPos.xyz - camera.cameraPos);
  let fadeStart = 3000.0;  // フェード開始距離 (cm)
  let fadeEnd = 5000.0;    // フェード終了距離 (cm)
  let fade = 1.0 - smoothstep(fadeStart, fadeEnd, distFromCamera);

  // 最終色の計算
  let color = mix(bgColor, gridColor, lineIntensity);
  let alpha = mix(0.0, 0.8, lineIntensity) * fade;

  // 背景部分も薄く塗る
  let bgAlpha = 0.3 * fade;
  let finalAlpha = max(alpha, bgAlpha);
  let finalColor = select(bgColor, color, lineIntensity > 0.01);

  return vec4f(finalColor, finalAlpha);
}
```

---

## 5. Camera システム

### 5.1 OrbitCamera クラス

OrbitCamera は球面座標系でカメラ位置を管理し、注視点を中心とした軌道カメラを実装する。

```typescript
import { mat4, vec3 } from 'gl-matrix';

/**
 * カメラの状態を表す型
 */
interface CameraState {
  theta: number;    // 方位角 (azimuth), ラジアン, Y 軸周り
  phi: number;      // 仰角 (elevation), ラジアン, XZ 平面からの角度
  radius: number;   // 注視点からの距離
  target: vec3;     // 注視点（look-at ポイント）
}

/**
 * カメラのパラメータ制約
 */
interface CameraLimits {
  minRadius: number;
  maxRadius: number;
  minPhi: number;  // ジンバルロック回避のための最小仰角
  maxPhi: number;  // ジンバルロック回避のための最大仰角
}

/**
 * 球面座標系による軌道カメラ
 *
 * 座標系:
 * - Y 軸が上方向
 * - theta: Y 軸周りの回転角（方位角）
 * - phi: XZ 平面からの仰角
 * - radius: 注視点からの距離
 */
class OrbitCamera {
  // カメラ状態
  private theta: number;
  private phi: number;
  private radius: number;
  private target: vec3;

  // 制約
  private limits: CameraLimits;

  // 計算済み行列（キャッシュ）
  private viewMatrix: mat4 = mat4.create();
  private projMatrix: mat4 = mat4.create();
  private viewProjMatrix: mat4 = mat4.create();
  private eyePosition: vec3 = vec3.create();

  // プロジェクションパラメータ
  private fov: number = (45 * Math.PI) / 180; // 45度
  private aspect: number = 1;
  private near: number = 0.1;
  private far: number = 10000;

  // ダーティフラグ
  private dirty: boolean = true;

  constructor(options?: Partial<CameraState & CameraLimits>) {
    this.theta = options?.theta ?? Math.PI / 4;
    this.phi = options?.phi ?? Math.PI / 4;
    this.radius = options?.radius ?? 2000;
    this.target = options?.target
      ? vec3.clone(options.target)
      : vec3.fromValues(0, 0, 0);

    this.limits = {
      minRadius: options?.minRadius ?? 100,
      maxRadius: options?.maxRadius ?? 8000,
      minPhi: options?.minPhi ?? 0.01,        // ジンバルロック回避
      maxPhi: options?.maxPhi ?? Math.PI - 0.01,
    };
  }

  /**
   * 球面座標からカメラの eye 位置を計算する
   */
  private computeEyePosition(): vec3 {
    const x =
      this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z =
      this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    vec3.set(
      this.eyePosition,
      this.target[0] + x,
      this.target[1] + y,
      this.target[2] + z,
    );

    return this.eyePosition;
  }

  /**
   * ビュー行列を計算する (lookAt)
   */
  private computeViewMatrix(): mat4 {
    this.computeEyePosition();
    const up = vec3.fromValues(0, 1, 0);
    mat4.lookAt(this.viewMatrix, this.eyePosition, this.target, up);
    return this.viewMatrix;
  }

  /**
   * プロジェクション行列を計算する (perspective)
   */
  private computeProjectionMatrix(): mat4 {
    mat4.perspective(
      this.projMatrix,
      this.fov,
      this.aspect,
      this.near,
      this.far,
    );
    return this.projMatrix;
  }

  /**
   * 行列を更新する（ダーティフラグが立っている場合のみ）
   */
  update(): void {
    if (!this.dirty) return;

    this.computeViewMatrix();
    this.computeProjectionMatrix();
    mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);

    this.dirty = false;
  }

  /**
   * カメラを回転する（マウスドラッグによる操作）
   */
  rotate(deltaTheta: number, deltaPhi: number): void {
    this.theta += deltaTheta;
    this.phi += deltaPhi;

    // phi のクランプ（ジンバルロック回避）
    this.phi = Math.max(
      this.limits.minPhi,
      Math.min(this.limits.maxPhi, this.phi),
    );

    this.dirty = true;
  }

  /**
   * カメラをズームする（マウスホイールによる操作）
   */
  zoom(delta: number): void {
    this.radius *= 1 + delta;
    this.radius = Math.max(
      this.limits.minRadius,
      Math.min(this.limits.maxRadius, this.radius),
    );

    this.dirty = true;
  }

  /**
   * 注視点を移動する（パン操作）
   */
  pan(deltaX: number, deltaY: number): void {
    // カメラのローカル座標系での右方向と上方向を求める
    const right = vec3.fromValues(
      this.viewMatrix[0] as number,
      this.viewMatrix[4] as number,
      this.viewMatrix[8] as number,
    );
    const up = vec3.fromValues(
      this.viewMatrix[1] as number,
      this.viewMatrix[5] as number,
      this.viewMatrix[9] as number,
    );

    // パン速度は距離に比例
    const panSpeed = this.radius * 0.001;

    vec3.scaleAndAdd(this.target, this.target, right, -deltaX * panSpeed);
    vec3.scaleAndAdd(this.target, this.target, up, deltaY * panSpeed);

    this.dirty = true;
  }

  /**
   * アスペクト比を設定する（リサイズ時に呼び出す）
   */
  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.dirty = true;
  }

  /**
   * カメラ状態を設定する（プリセットビュー切り替え時）
   */
  setState(state: Partial<CameraState>): void {
    if (state.theta !== undefined) this.theta = state.theta;
    if (state.phi !== undefined) this.phi = state.phi;
    if (state.radius !== undefined) this.radius = state.radius;
    if (state.target !== undefined) vec3.copy(this.target, state.target);
    this.dirty = true;
  }

  /**
   * 現在のカメラ状態を取得する
   */
  getState(): CameraState {
    return {
      theta: this.theta,
      phi: this.phi,
      radius: this.radius,
      target: vec3.clone(this.target),
    };
  }

  /**
   * GPU に送る Uniform データを取得する
   */
  getUniformData(): Float32Array {
    this.update();

    const data = new Float32Array(CAMERA_UNIFORM_SIZE / 4); // 52 floats
    data.set(this.viewProjMatrix as Float32Array, 0);       // offset 0
    data.set(this.viewMatrix as Float32Array, 16);           // offset 16
    data.set(this.projMatrix as Float32Array, 32);           // offset 32
    data.set(this.eyePosition as Float32Array, 48);          // offset 48
    // data[51] = 0 (padding, already zero-initialized)

    return data;
  }

  /**
   * ビュー・プロジェクション合成行列を取得する
   * （レイキャスト等で使用）
   */
  getViewProjMatrix(): mat4 {
    this.update();
    return this.viewProjMatrix;
  }

  /**
   * 逆ビュー・プロジェクション行列を取得する
   */
  getInverseViewProjMatrix(): mat4 {
    this.update();
    const inv = mat4.create();
    mat4.invert(inv, this.viewProjMatrix);
    return inv;
  }
}
```

### 5.2 Fixed Views（プリセットビュー）

```typescript
/**
 * プリセットビューの定義
 */
interface PresetView {
  name: string;
  theta: number;   // 方位角
  phi: number;     // 仰角
  radius: number;  // 距離
}

/**
 * プリセットビュー一覧
 * theta: Y 軸周りの方位角（ラジアン）
 * phi: 仰角（ラジアン、0=真上、PI/2=水平、PI=真下）
 */
const PRESET_VIEWS: Record<string, PresetView> = {
  front: {
    name: '正面',
    theta: 0,
    phi: Math.PI / 2,
    radius: 2500,
  },
  back: {
    name: '背面',
    theta: Math.PI,
    phi: Math.PI / 2,
    radius: 2500,
  },
  left: {
    name: '左側面',
    theta: -Math.PI / 2,
    phi: Math.PI / 2,
    radius: 2500,
  },
  right: {
    name: '右側面',
    theta: Math.PI / 2,
    phi: Math.PI / 2,
    radius: 2500,
  },
  top: {
    name: '上面',
    theta: 0,
    phi: 0.01, // 真上（ジンバルロック回避のため微小値）
    radius: 3000,
  },
  isometric: {
    name: 'アイソメトリック',
    theta: Math.PI / 4,
    phi: Math.PI / 4,
    radius: 2800,
  },
};

/**
 * ビュー遷移アニメーション
 * 現在のカメラ状態からプリセットビューへ、線形補間で滑らかに遷移する。
 */
class ViewTransition {
  private startState: CameraState;
  private endState: CameraState;
  private startTime: number;
  private duration: number;
  private isActive: boolean = false;

  constructor(private camera: OrbitCamera) {
    this.startState = camera.getState();
    this.endState = camera.getState();
    this.startTime = 0;
    this.duration = 300; // ms
  }

  /**
   * プリセットビューへの遷移を開始する
   */
  transitionTo(preset: PresetView): void {
    this.startState = this.camera.getState();
    this.endState = {
      theta: preset.theta,
      phi: preset.phi,
      radius: preset.radius,
      target: this.camera.getState().target, // target は維持
    };
    this.startTime = performance.now();
    this.isActive = true;
  }

  /**
   * 毎フレーム呼び出し、アニメーションを進行させる
   * @returns アニメーションが進行中の場合 true
   */
  update(): boolean {
    if (!this.isActive) return false;

    const elapsed = performance.now() - this.startTime;
    const t = Math.min(elapsed / this.duration, 1.0);

    // Ease-out cubic: 1 - (1-t)^3
    const eased = 1 - Math.pow(1 - t, 3);

    // 球面座標の補間
    const theta = this.lerp(this.startState.theta, this.endState.theta, eased);
    const phi = this.lerp(this.startState.phi, this.endState.phi, eased);
    const radius = this.lerp(
      this.startState.radius,
      this.endState.radius,
      eased,
    );

    this.camera.setState({ theta, phi, radius });

    if (t >= 1.0) {
      this.isActive = false;
    }

    return true;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
}
```

---

## 6. CameraController

CameraController はマウスおよびタッチ入力を処理し、OrbitCamera の操作に変換するモジュールである。

```typescript
/**
 * マウス/タッチイベントによるカメラ操作コントローラ
 */
interface CameraControllerOptions {
  /** 回転感度 */
  rotateSensitivity: number;
  /** ズーム感度 */
  zoomSensitivity: number;
  /** パン感度 */
  panSensitivity: number;
}

const DEFAULT_OPTIONS: CameraControllerOptions = {
  rotateSensitivity: 0.005,
  zoomSensitivity: 0.001,
  panSensitivity: 1.0,
};

class CameraController {
  private options: CameraControllerOptions;
  private isDragging: boolean = false;
  private dragButton: number = -1;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // バインド済みイベントハンドラ（removeEventListener 用）
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onContextMenuBound: (e: Event) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: OrbitCamera,
    options?: Partial<CameraControllerOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // イベントハンドラをバインドして保存
    this.onMouseDownBound = this.onMouseDown.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseUpBound = this.onMouseUp.bind(this);
    this.onWheelBound = this.onWheel.bind(this);
    this.onContextMenuBound = (e: Event) => e.preventDefault();

    this.attach();
  }

  /**
   * イベントリスナーを登録する
   */
  private attach(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    this.canvas.addEventListener('wheel', this.onWheelBound, {
      passive: false,
    });
    this.canvas.addEventListener('contextmenu', this.onContextMenuBound);
  }

  /**
   * イベントリスナーを解除する（クリーンアップ時に呼び出す）
   */
  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
  }

  /**
   * マウスボタン押下
   */
  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.dragButton = e.button;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    e.preventDefault();
  }

  /**
   * マウス移動
   *
   * - 左ボタンドラッグ: 回転（delta → theta/phi）
   * - 右ボタンドラッグまたは中ボタンドラッグ: パン（target 移動）
   */
  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    switch (this.dragButton) {
      case 0: // 左ボタン: 回転
        this.camera.rotate(
          -deltaX * this.options.rotateSensitivity,
          -deltaY * this.options.rotateSensitivity,
        );
        break;

      case 1: // 中ボタン: パン
      case 2: // 右ボタン: パン
        this.camera.pan(
          deltaX * this.options.panSensitivity,
          deltaY * this.options.panSensitivity,
        );
        break;
    }
  }

  /**
   * マウスボタン解放
   */
  private onMouseUp(_e: MouseEvent): void {
    this.isDragging = false;
    this.dragButton = -1;
  }

  /**
   * マウスホイール: ズーム（radius 調整）
   */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY * this.options.zoomSensitivity;
    this.camera.zoom(delta);
  }
}
```

### タッチサポートの考慮事項

モバイルデバイスでの操作を想定し、以下のタッチジェスチャーを将来的にサポートする方針とする。

| ジェスチャー | 操作 | 対応するマウス操作 |
|---|---|---|
| 1 本指ドラッグ | 回転 | 左ボタンドラッグ |
| 2 本指ドラッグ | パン | 右ボタンドラッグ |
| ピンチイン/アウト | ズーム | ホイール |

v1 ではマウス操作のみの実装とし、タッチサポートは v2 以降の拡張とする。実装時は `TouchEvent` の `touches` リストから座標を取得し、`pointer events` API の使用を検討する。

---

## 7. Raycaster

Raycaster はスクリーン座標から 3D 空間にレイを飛ばし、荷物オブジェクトとの交差判定を行うモジュールである。ドラッグ & ドロップによるオブジェクトピッキングに使用する。

```typescript
import { mat4, vec3, vec4 } from 'gl-matrix';

/**
 * レイの定義
 */
interface Ray {
  origin: vec3;    // レイの始点
  direction: vec3; // レイの方向（正規化済み）
}

/**
 * AABB（軸並行バウンディングボックス）
 */
interface AABB {
  min: vec3; // 最小座標
  max: vec3; // 最大座標
}

/**
 * レイキャスト結果
 */
interface RaycastHit {
  cargoId: string;       // ヒットした荷物の ID
  distance: number;      // レイの始点からの距離
  point: vec3;           // 交差点のワールド座標
}

class Raycaster {
  /**
   * スクリーン座標を NDC（正規化デバイス座標）に変換する
   *
   * スクリーン座標 (px) → NDC (-1 to 1):
   *   ndcX = (screenX / canvasWidth) * 2 - 1
   *   ndcY = -((screenY / canvasHeight) * 2 - 1)  // Y 軸反転
   *
   * @param screenX スクリーン X 座標 (px)
   * @param screenY スクリーン Y 座標 (px)
   * @param canvasWidth キャンバス幅 (px)
   * @param canvasHeight キャンバス高さ (px)
   * @returns NDC 座標 [x, y]
   */
  private screenToNDC(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
  ): [number, number] {
    const ndcX = (screenX / canvasWidth) * 2 - 1;
    const ndcY = -((screenY / canvasHeight) * 2 - 1);
    return [ndcX, ndcY];
  }

  /**
   * NDC 座標からワールド空間のレイを構築する
   *
   * 逆ビュー・プロジェクション行列を使って、
   * near plane と far plane 上の点をアンプロジェクトし、
   * それらを結ぶ方向ベクトルをレイの方向とする。
   *
   * @param ndcX NDC X 座標 (-1 to 1)
   * @param ndcY NDC Y 座標 (-1 to 1)
   * @param inverseViewProj 逆ビュー・プロジェクション行列
   * @returns ワールド空間のレイ
   */
  private constructRay(
    ndcX: number,
    ndcY: number,
    inverseViewProj: mat4,
  ): Ray {
    // Near plane 上の点 (z = -1 in NDC)
    const nearPoint = vec4.fromValues(ndcX, ndcY, -1, 1);
    // Far plane 上の点 (z = 1 in NDC)
    const farPoint = vec4.fromValues(ndcX, ndcY, 1, 1);

    // 逆射影でワールド座標に変換
    vec4.transformMat4(nearPoint, nearPoint, inverseViewProj);
    vec4.transformMat4(farPoint, farPoint, inverseViewProj);

    // w で除算してクリップ座標からカルテシアン座標へ
    const nearWorld = vec3.fromValues(
      nearPoint[0] / nearPoint[3],
      nearPoint[1] / nearPoint[3],
      nearPoint[2] / nearPoint[3],
    );

    const farWorld = vec3.fromValues(
      farPoint[0] / farPoint[3],
      farPoint[1] / farPoint[3],
      farPoint[2] / farPoint[3],
    );

    // レイの方向を計算して正規化
    const direction = vec3.create();
    vec3.subtract(direction, farWorld, nearWorld);
    vec3.normalize(direction, direction);

    return {
      origin: nearWorld,
      direction,
    };
  }

  /**
   * レイと AABB の交差判定（スラブ法）
   *
   * スラブ法（Slab Method）:
   * 各軸について、レイが AABB の 2 つの面（スラブ）に入る t 値と出る t 値を求め、
   * 全軸の「入り」の最大値 tMin と「出」の最小値 tMax を比較する。
   * tMin <= tMax かつ tMax >= 0 ならば交差している。
   *
   * @param ray レイ
   * @param aabb AABB
   * @returns 交差していれば距離 t、していなければ null
   */
  private intersectRayAABB(ray: Ray, aabb: AABB): number | null {
    let tMin = -Infinity;
    let tMax = Infinity;

    for (let axis = 0; axis < 3; axis++) {
      const origin = ray.origin[axis];
      const dir = ray.direction[axis];
      const bmin = aabb.min[axis];
      const bmax = aabb.max[axis];

      if (Math.abs(dir) < 1e-8) {
        // レイがこの軸に平行
        // レイの始点がスラブの外にあれば交差しない
        if (origin < bmin || origin > bmax) {
          return null;
        }
      } else {
        // スラブとの交差 t 値を計算
        const invDir = 1.0 / dir;
        let t1 = (bmin - origin) * invDir;
        let t2 = (bmax - origin) * invDir;

        // t1 <= t2 を保証
        if (t1 > t2) {
          const temp = t1;
          t1 = t2;
          t2 = temp;
        }

        // 全軸の交差区間の共通部分を求める
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);

        // 交差区間が空（交差しない）
        if (tMin > tMax) {
          return null;
        }
      }
    }

    // レイの始点より後方の交差のみ有効
    if (tMax < 0) {
      return null;
    }

    // tMin >= 0 ならレイの始点はボックスの外
    // tMin < 0 ならレイの始点はボックスの内部（tMax が交差点）
    return tMin >= 0 ? tMin : tMax;
  }

  /**
   * スクリーン座標から荷物のピッキングを行う
   *
   * 全荷物の AABB に対してレイ交差判定を行い、
   * 最も近い交差を返す。
   *
   * @param screenX スクリーン X 座標 (px)
   * @param screenY スクリーン Y 座標 (px)
   * @param canvasWidth キャンバス幅 (px)
   * @param canvasHeight キャンバス高さ (px)
   * @param inverseViewProj 逆ビュー・プロジェクション行列
   * @param cargoItems 荷物リスト（ID と AABB）
   * @returns 最も近いヒット結果、またはヒットなしの場合 null
   */
  pick(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    inverseViewProj: mat4,
    cargoItems: Array<{ id: string; aabb: AABB }>,
  ): RaycastHit | null {
    const [ndcX, ndcY] = this.screenToNDC(
      screenX,
      screenY,
      canvasWidth,
      canvasHeight,
    );
    const ray = this.constructRay(ndcX, ndcY, inverseViewProj);

    let closestHit: RaycastHit | null = null;
    let closestDistance = Infinity;

    for (const item of cargoItems) {
      const distance = this.intersectRayAABB(ray, item.aabb);

      if (distance !== null && distance < closestDistance) {
        closestDistance = distance;

        // 交差点を計算
        const point = vec3.create();
        vec3.scaleAndAdd(point, ray.origin, ray.direction, distance);

        closestHit = {
          cargoId: item.id,
          distance,
          point,
        };
      }
    }

    return closestHit;
  }
}
```

---

## 8. LabelRenderer

LabelRenderer は 3D ワールド座標を 2D スクリーン座標に投影し、HTML 要素によるラベルオーバーレイを実現するモジュールである。

```typescript
/**
 * ラベル定義
 */
interface Label3D {
  id: string;
  text: string;
  worldPosition: vec3;  // ラベルの 3D ワールド座標
  visible: boolean;
}

/**
 * 3D→2D 投影によるラベルレンダリング
 *
 * ワールド座標を viewProj 行列で投影し、
 * CSS transform で HTML div を配置する。
 */
class LabelRenderer {
  private container: HTMLDivElement;
  private labelElements: Map<string, HTMLDivElement> = new Map();
  private labels: Map<string, Label3D> = new Map();

  constructor(parentElement: HTMLElement) {
    // ラベルオーバーレイ用コンテナを作成
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
    `;
    parentElement.appendChild(this.container);
  }

  /**
   * ラベルを追加する
   */
  addLabel(label: Label3D): void {
    this.labels.set(label.id, label);

    const el = document.createElement('div');
    el.className = 'label-3d';
    el.textContent = label.text;
    el.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      transform: translate(-50%, -100%);
      background: rgba(0, 0, 0, 0.75);
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      will-change: transform;
    `;
    this.container.appendChild(el);
    this.labelElements.set(label.id, el);
  }

  /**
   * ラベルを削除する
   */
  removeLabel(id: string): void {
    const el = this.labelElements.get(id);
    if (el) {
      this.container.removeChild(el);
      this.labelElements.delete(id);
    }
    this.labels.delete(id);
  }

  /**
   * ワールド座標をスクリーン座標に投影する
   *
   * 手順:
   * 1. viewProj 行列でクリップ座標に変換
   * 2. w で除算して NDC に変換
   * 3. NDC (-1 to 1) をスクリーン座標 (px) に変換
   *
   * @returns スクリーン座標 [x, y] と可視性（カメラの背後にある場合 false）
   */
  private projectToScreen(
    worldPos: vec3,
    viewProjMatrix: mat4,
    canvasWidth: number,
    canvasHeight: number,
  ): { x: number; y: number; visible: boolean } {
    // ワールド座標をクリップ座標に変換
    const clipCoord = vec4.fromValues(
      worldPos[0],
      worldPos[1],
      worldPos[2],
      1.0,
    );
    vec4.transformMat4(clipCoord, clipCoord, viewProjMatrix);

    // w が 0 以下ならカメラの背後
    if (clipCoord[3] <= 0) {
      return { x: 0, y: 0, visible: false };
    }

    // NDC に変換（w で除算）
    const ndcX = clipCoord[0] / clipCoord[3];
    const ndcY = clipCoord[1] / clipCoord[3];
    const ndcZ = clipCoord[2] / clipCoord[3];

    // NDC 範囲外なら非表示
    if (
      ndcX < -1.2 || ndcX > 1.2 ||
      ndcY < -1.2 || ndcY > 1.2 ||
      ndcZ < 0 || ndcZ > 1
    ) {
      return { x: 0, y: 0, visible: false };
    }

    // スクリーン座標に変換
    const screenX = ((ndcX + 1) / 2) * canvasWidth;
    const screenY = ((1 - ndcY) / 2) * canvasHeight; // Y 軸反転

    return { x: screenX, y: screenY, visible: true };
  }

  /**
   * 全ラベルの位置を更新する
   *
   * カメラが変更されたタイミングでのみ呼び出すことで
   * パフォーマンスを維持する。
   */
  update(
    viewProjMatrix: mat4,
    cameraPos: vec3,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const maxDistance = 5000; // ラベルが非表示になる距離 (cm)

    for (const [id, label] of this.labels) {
      const el = this.labelElements.get(id);
      if (!el) continue;

      // カメラからの距離を計算
      const dist = vec3.distance(label.worldPosition, cameraPos);

      // 距離が遠すぎる場合は非表示
      if (dist > maxDistance || !label.visible) {
        el.style.display = 'none';
        continue;
      }

      // 3D→2D 投影
      const screen = this.projectToScreen(
        label.worldPosition,
        viewProjMatrix,
        canvasWidth,
        canvasHeight,
      );

      if (!screen.visible) {
        el.style.display = 'none';
        continue;
      }

      // CSS transform で位置を更新
      // translate(-50%, -100%) はラベルの中央下端をアンカーポイントにする
      el.style.display = 'block';
      el.style.transform = `translate(calc(${screen.x}px - 50%), calc(${screen.y}px - 100%))`;

      // 距離に応じてフェードアウト
      const fadeStart = 3000;
      const fadeEnd = maxDistance;
      const opacity =
        dist < fadeStart
          ? 1.0
          : 1.0 - (dist - fadeStart) / (fadeEnd - fadeStart);
      el.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }
  }

  /**
   * クリーンアップ
   */
  dispose(): void {
    this.container.remove();
    this.labelElements.clear();
    this.labels.clear();
  }
}
```

---

## 9. バッファ更新戦略

### 概要

GPU バッファは用途に応じて異なる更新頻度と戦略を持つ。

| バッファ | 種類 | 更新頻度 | usage フラグ |
|---|---|---|---|
| カメラ Uniform | Uniform Buffer | 毎フレーム | `UNIFORM \| COPY_DST` |
| インスタンス Storage | Storage Buffer | 配置変更時 | `STORAGE \| COPY_DST` |
| 頂点バッファ | Vertex Buffer | 初期化時のみ | `VERTEX \| COPY_DST` |
| インデックスバッファ | Index Buffer | 初期化時のみ | `INDEX \| COPY_DST` |
| コンテナ Uniform | Uniform Buffer | コンテナ変更時 | `UNIFORM \| COPY_DST` |

### カメラ Uniform の更新（毎フレーム）

```typescript
/**
 * カメラ Uniform バッファの作成と更新
 */
class CameraUniformManager {
  private buffer: GPUBuffer;
  private data: Float32Array;

  constructor(private device: GPUDevice) {
    this.data = new Float32Array(CAMERA_UNIFORM_SIZE / 4);
    this.buffer = device.createBuffer({
      label: 'camera uniform buffer',
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * 毎フレーム呼び出し、カメラデータを GPU バッファに書き込む
   */
  update(camera: OrbitCamera): void {
    this.data = camera.getUniformData();
    this.device.queue.writeBuffer(this.buffer, 0, this.data);
  }

  getBuffer(): GPUBuffer {
    return this.buffer;
  }
}
```

### インスタンス Storage Buffer の更新（配置変更時）

v1 ではシンプルにフルリビルド戦略を採用する。荷物の配置が変更されるたびに、全インスタンスデータを再構築して GPU に送信する。

```typescript
/**
 * インスタンス Storage Buffer の管理
 */
class InstanceBufferManager {
  private buffer: GPUBuffer | null = null;
  private instanceCount: number = 0;

  constructor(private device: GPUDevice) {}

  /**
   * 配置変更時に呼び出し、全インスタンスデータを再構築する
   *
   * v1 戦略: フルリビルド
   * - 全荷物のインスタンスデータを新しい Float32Array に組み立てる
   * - バッファサイズが変わった場合は再作成する
   * - バッファサイズが同じ場合は writeBuffer で上書きする
   */
  rebuild(items: CargoInstanceData[]): void {
    const data = buildInstanceBuffer(items);
    const byteSize = data.byteLength;

    this.instanceCount = items.length;

    if (byteSize === 0) {
      // 荷物が 0 個の場合、最小サイズのバッファを確保
      if (!this.buffer) {
        this.buffer = this.device.createBuffer({
          label: 'instance storage buffer',
          size: INSTANCE_BYTE_SIZE,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      return;
    }

    if (!this.buffer || this.buffer.size < byteSize) {
      // バッファが未作成またはサイズ不足の場合、再作成
      this.buffer?.destroy();
      this.buffer = this.device.createBuffer({
        label: 'instance storage buffer',
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    this.device.queue.writeBuffer(this.buffer, 0, data);
  }

  getBuffer(): GPUBuffer | null {
    return this.buffer;
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }
}
```

### 将来の最適化: ダーティフラグ + 部分更新

v2 以降で検討する最適化:

```typescript
/**
 * 将来実装: 差分更新方式
 *
 * - 各インスタンスにダーティフラグを持たせる
 * - 変更されたインスタンスのみ writeBuffer の offset 指定で部分更新
 * - バッファの再作成を回避し、writeBuffer の転送量を最小化
 */
interface DirtyTrackingInstance {
  data: CargoInstanceData;
  dirty: boolean;
  bufferOffset: number; // バッファ内のオフセット (bytes)
}

// 部分更新の例:
// device.queue.writeBuffer(
//   buffer,
//   instance.bufferOffset,
//   instanceData,
//   0,
//   INSTANCE_BYTE_SIZE
// );
```

---

## 10. Renderer クラス統合

Renderer クラスは上記全モジュールを統合し、レンダーループを管理する中枢モジュールである。

```typescript
import { create } from 'zustand';

/**
 * メインレンダラー
 *
 * 責務:
 * - WebGPU リソースのライフサイクル管理
 * - レンダーループの実行
 * - Zustand ストアとの連携
 * - リサイズハンドリング
 */
class Renderer {
  // WebGPU コンテキスト
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture!: GPUTexture;
  private canvas!: HTMLCanvasElement;

  // パイプライン
  private cargoPipeline!: GPURenderPipeline;
  private containerTransparentPipeline!: GPURenderPipeline;
  private containerOpaquePipeline!: GPURenderPipeline;
  private gridPipeline!: GPURenderPipeline;

  // バッファマネージャ
  private cameraUniformManager!: CameraUniformManager;
  private instanceBufferManager!: InstanceBufferManager;

  // ジオメトリバッファ
  private cubeVertexBuffer!: GPUBuffer;
  private cubeIndexBuffer!: GPUBuffer;
  private containerVertexBuffer!: GPUBuffer;
  private containerIndexBuffer!: GPUBuffer;
  private gridVertexBuffer!: GPUBuffer;
  private gridIndexBuffer!: GPUBuffer;

  // Bind Groups
  private cameraBindGroup!: GPUBindGroup;
  private instanceBindGroup!: GPUBindGroup;
  private containerBindGroup!: GPUBindGroup;

  // サブシステム
  private camera!: OrbitCamera;
  private cameraController!: CameraController;
  private viewTransition!: ViewTransition;
  private raycaster!: Raycaster;
  private labelRenderer!: LabelRenderer;

  // 状態
  private animationFrameId: number = 0;
  private isRunning: boolean = false;
  private cubeIndexCount: number = 0;
  private containerIndexCount: number = 0;

  // Zustand ストアの購読解除関数
  private unsubscribe: (() => void) | null = null;

  /**
   * 初期化
   */
  async init(canvas: HTMLCanvasElement, parentElement: HTMLElement): Promise<void> {
    // WebGPU 初期化
    const gpuCtx = await initWebGPU(canvas);
    this.device = gpuCtx.device;
    this.context = gpuCtx.context;
    this.format = gpuCtx.format;
    this.depthTexture = gpuCtx.depthTexture;
    this.canvas = gpuCtx.canvas;

    // カメラ初期化
    this.camera = new OrbitCamera({
      theta: Math.PI / 4,
      phi: Math.PI / 4,
      radius: 2500,
    });
    this.camera.setAspect(canvas.width / canvas.height);

    // カメラコントローラ初期化
    this.cameraController = new CameraController(canvas, this.camera);
    this.viewTransition = new ViewTransition(this.camera);

    // レイキャスター初期化
    this.raycaster = new Raycaster();

    // ラベルレンダラー初期化
    this.labelRenderer = new LabelRenderer(parentElement);

    // バッファマネージャ初期化
    this.cameraUniformManager = new CameraUniformManager(this.device);
    this.instanceBufferManager = new InstanceBufferManager(this.device);

    // ジオメトリ作成
    this.createGeometryBuffers();

    // パイプライン作成
    this.createPipelines();

    // Bind Groups 作成
    this.createBindGroups();

    // リサイズオブザーバー設定
    this.setupResizeObserver();

    // Zustand ストアの購読
    this.subscribeToStore();
  }

  /**
   * ジオメトリバッファの作成
   */
  private createGeometryBuffers(): void {
    // ユニットキューブ
    const cube = createUnitCubeGeometry();
    this.cubeIndexCount = cube.indices.length;

    this.cubeVertexBuffer = this.device.createBuffer({
      label: 'cube vertex buffer',
      size: cube.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cubeVertexBuffer, 0, cube.vertices);

    this.cubeIndexBuffer = this.device.createBuffer({
      label: 'cube index buffer',
      size: cube.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cubeIndexBuffer, 0, cube.indices);

    // グリッド平面
    const grid = createGridPlane(10000);

    this.gridVertexBuffer = this.device.createBuffer({
      label: 'grid vertex buffer',
      size: grid.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridVertexBuffer, 0, grid.vertices);

    this.gridIndexBuffer = this.device.createBuffer({
      label: 'grid index buffer',
      size: grid.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridIndexBuffer, 0, grid.indices);
  }

  /**
   * パイプラインの作成（省略: 前述の各 create*Pipeline 関数を呼び出す）
   */
  private createPipelines(): void {
    // Bind Group Layouts は各パイプライン間で共有
    // 実装は前述の各パイプライン作成関数を参照
  }

  /**
   * Bind Groups の作成
   */
  private createBindGroups(): void {
    // カメラ Bind Group（全パイプラインで共有）
    this.cameraBindGroup = this.device.createBindGroup({
      label: 'camera bind group',
      layout: this.cargoPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.cameraUniformManager.getBuffer(),
          },
        },
      ],
    });
  }

  /**
   * リサイズオブザーバーの設定
   */
  private setupResizeObserver(): void {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        const canvasWidth = Math.max(1, Math.floor(width * dpr));
        const canvasHeight = Math.max(1, Math.floor(height * dpr));

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;

        // 深度テクスチャを再作成
        this.depthTexture.destroy();
        this.depthTexture = createDepthTexture(
          this.device,
          canvasWidth,
          canvasHeight,
        );

        // プロジェクション行列のアスペクト比を更新
        this.camera.setAspect(canvasWidth / canvasHeight);
      }
    });

    observer.observe(this.canvas);
  }

  /**
   * Zustand ストアの変更を購読してレンダリングをトリガーする
   */
  private subscribeToStore(): void {
    // ストアの荷物配置が変更されたらインスタンスバッファを再構築
    // this.unsubscribe = useContainerStore.subscribe(
    //   (state) => state.placements,
    //   (placements) => {
    //     const instanceData = placements.map(placementToInstanceData);
    //     this.instanceBufferManager.rebuild(instanceData);
    //     // Bind Group も再作成が必要（バッファが再作成された場合）
    //     this.rebuildInstanceBindGroup();
    //   }
    // );
  }

  /**
   * レンダーループを開始する
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.renderLoop();
  }

  /**
   * レンダーループを停止する
   */
  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
  }

  /**
   * レンダーループ（requestAnimationFrame ベース）
   */
  private renderLoop = (): void => {
    if (!this.isRunning) return;

    // ビュー遷移アニメーションの更新
    this.viewTransition.update();

    // カメラ Uniform の更新（毎フレーム）
    this.cameraUniformManager.update(this.camera);

    // ラベル位置の更新
    this.labelRenderer.update(
      this.camera.getViewProjMatrix(),
      this.camera.getState().target, // 簡易実装: cameraPos は別途取得が必要
      this.canvas.width,
      this.canvas.height,
    );

    // 描画
    this.render();

    // 次フレームをスケジュール
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * 1 フレームの描画を実行する
   *
   * コマンドエンコーダーを作成し、3 つのレンダーパスを順に実行して
   * コマンドバッファを GPU に送信する。
   */
  private render(): void {
    // 現在のスワップチェーンテクスチャを取得
    const textureView = this.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();

    // コマンドエンコーダーの作成
    const commandEncoder = this.device.createCommandEncoder({
      label: 'main command encoder',
    });

    // === Pass 1: 荷物描画（不透明） ===
    {
      const passEncoder = commandEncoder.beginRenderPass({
        label: 'cargo render pass',
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0.95, g: 0.95, b: 0.95, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      const instanceCount = this.instanceBufferManager.getInstanceCount();
      if (instanceCount > 0) {
        passEncoder.setPipeline(this.cargoPipeline);
        passEncoder.setBindGroup(0, this.cameraBindGroup);
        passEncoder.setBindGroup(1, this.instanceBindGroup);
        passEncoder.setVertexBuffer(0, this.cubeVertexBuffer);
        passEncoder.setIndexBuffer(this.cubeIndexBuffer, 'uint16');
        passEncoder.drawIndexed(this.cubeIndexCount, instanceCount);
      }

      passEncoder.end();
    }

    // === Pass 2: コンテナ壁描画（透過、2 サブパス） ===
    {
      const passEncoder = commandEncoder.beginRenderPass({
        label: 'container render pass',
        colorAttachments: [
          {
            view: textureView,
            loadOp: 'load', // Pass 1 の結果を保持
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load', // Pass 1 の深度を保持
          depthStoreOp: 'store',
        },
      });

      // Sub-pass A: 背面（透明壁、外側から見える壁）
      // container uniform の alpha を 0.3 に設定して writeBuffer 済み
      passEncoder.setPipeline(this.containerTransparentPipeline);
      passEncoder.setBindGroup(0, this.cameraBindGroup);
      passEncoder.setBindGroup(1, this.containerBindGroup);
      passEncoder.setVertexBuffer(0, this.containerVertexBuffer);
      passEncoder.setIndexBuffer(this.containerIndexBuffer, 'uint16');
      passEncoder.drawIndexed(this.containerIndexCount);

      // Sub-pass B: 前面（不透明壁、内側から見える壁）
      // container uniform の alpha を 1.0 に切り替えて描画
      // 注意: 同一レンダーパス内で uniform を切り替えるため、
      //       2 つの bind group を事前に用意するか、
      //       または別のレンダーパスに分割する
      passEncoder.setPipeline(this.containerOpaquePipeline);
      // containerOpaqueBindGroup は alpha=1.0 の uniform を持つ
      // passEncoder.setBindGroup(1, this.containerOpaqueBindGroup);
      passEncoder.drawIndexed(this.containerIndexCount);

      passEncoder.end();
    }

    // === Pass 3: 床グリッド描画 ===
    {
      const passEncoder = commandEncoder.beginRenderPass({
        label: 'grid render pass',
        colorAttachments: [
          {
            view: textureView,
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });

      passEncoder.setPipeline(this.gridPipeline);
      passEncoder.setBindGroup(0, this.cameraBindGroup);
      passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
      passEncoder.setIndexBuffer(this.gridIndexBuffer, 'uint16');
      passEncoder.drawIndexed(6); // 2 三角形

      passEncoder.end();
    }

    // コマンドバッファを GPU に送信
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * プリセットビューに切り替える
   */
  setPresetView(viewName: keyof typeof PRESET_VIEWS): void {
    const preset = PRESET_VIEWS[viewName];
    if (preset) {
      this.viewTransition.transitionTo(preset);
    }
  }

  /**
   * スクリーン座標から荷物をピックする
   */
  pickCargo(
    screenX: number,
    screenY: number,
    cargoItems: Array<{ id: string; aabb: AABB }>,
  ): RaycastHit | null {
    return this.raycaster.pick(
      screenX,
      screenY,
      this.canvas.width,
      this.canvas.height,
      this.camera.getInverseViewProjMatrix(),
      cargoItems,
    );
  }

  /**
   * リソースの解放
   */
  dispose(): void {
    this.stop();

    // Zustand 購読解除
    this.unsubscribe?.();

    // サブシステム解放
    this.cameraController.dispose();
    this.labelRenderer.dispose();

    // GPU リソース解放
    this.cubeVertexBuffer.destroy();
    this.cubeIndexBuffer.destroy();
    this.containerVertexBuffer.destroy();
    this.containerIndexBuffer.destroy();
    this.gridVertexBuffer.destroy();
    this.gridIndexBuffer.destroy();
    this.cameraUniformManager.getBuffer().destroy();
    this.instanceBufferManager.getBuffer()?.destroy();
    this.depthTexture.destroy();

    this.device.destroy();
  }
}
```

### React コンポーネントとの統合

```typescript
import { useEffect, useRef } from 'react';

function ContainerView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = new Renderer();
    rendererRef.current = renderer;

    renderer
      .init(canvas, container)
      .then(() => {
        renderer.start();
      })
      .catch((err) => {
        console.error('Renderer initialization failed:', err);
      });

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```
