# コンテナ積載シミュレータ -- アーキテクチャ概要

## 1. プロジェクト概要

本プロジェクトは、海上輸送用コンテナへの貨物積載をシミュレーションするための 3D ブラウザアプリケーションである。ユーザはコンテナのサイズを選択し、さまざまな形状・重量の貨物を作成したうえで、ドラッグ＆ドロップによりコンテナ内へ配置できる。内部データは 1cm 解像度のボクセルグリッドで管理し、描画にはメッシュベースの WebGPU レンダリングを採用する（ハイブリッド方式: データ=ボクセル、レンダリング=メッシュ）。

主な機能は以下のとおり。

- コンテナ選択: 20ft / 40ft プリセットおよびカスタムサイズ
- 貨物定義: GUI による作成、CSV / JSON インポート
- 配置操作: ドラッグ＆ドロップ、重力適用（浮遊禁止）、衝突判定
- カメラ: オービットカメラ + 固定ビュー（正面・側面・上面）
- 物理計算: 重量合計・重心位置の算出
- 履歴管理: Undo / Redo
- ファイル入出力: JSON 形式でのセーブ / ロード
- コンテナ壁の特殊描画: 内側から見ると不透明、外側から見ると半透明

技術スタックとして **TypeScript + React + Vite + WebGPU** を採用する。

---

## 2. 設計原則

| # | 原則 | 説明 |
|---|------|------|
| 1 | **Core 層は React・GPU に依存しない** | 純粋な TypeScript のみで実装し、Node.js 上でもテスト可能とする。ボクセル演算、重力判定、重量計算、履歴管理など、すべてのドメインロジックが Core 層に属する。 |
| 2 | **Zustand による状態管理と双方向バインディング** | UI → Store → Core → Store → Renderer の一方向データフローを基本とする。Zustand の `subscribe` 機構により、React コンポーネントと非 React モジュール（Renderer など）の双方がストア変更を検知できる。 |
| 3 | **Renderer はストアの購読者として独立** | WebGPU レンダリングエンジンは独立モジュールとして実装し、ストアの状態変更を `subscribe` で検知して再描画する。React のレンダリングサイクルとは切り離す。 |
| 4 | **関心の分離** | アプリケーションを以下の 4 層に明確に分離する。 |

```
core      ─ ドメインロジック（ボクセル、物理、履歴）
renderer  ─ WebGPU 描画パイプライン
ui        ─ React コンポーネント（表示・入力）
state     ─ Zustand ストア（状態の単一情報源）
```

---

## 3. モジュール構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                      UI Layer (React)                           │
│                                                                 │
│  App ─┬─ CanvasPanel          ─── WebGPU Canvas                 │
│       ├─ Sidebar                                                │
│       │   ├─ ContainerSelector                                  │
│       │   ├─ CargoEditor                                        │
│       │   ├─ CargoList                                          │
│       │   └─ PlacementControls                                  │
│       ├─ StatsPanel           ─── 重量・重心表示                │
│       ├─ ViewButtons          ─── カメラ切替                    │
│       └─ ToolBar              ─── Undo/Redo・ファイル操作       │
└────────────────────┬────────────────────────────────────────────┘
                     │ useStore()          ▲ UI イベント
                     ▼                    │
┌─────────────────────────────────────────────────────────────────┐
│                   State Layer (Zustand Store)                   │
│                                                                 │
│  ・containerConfig    ・cargoDefinitions    ・placements         │
│  ・selectedCargoId    ・cameraState         ・stats              │
│  ・history (undo/redo スタック)                                  │
│                                                                 │
│  Actions: addCargo / moveCargo / removeCargo / undo / redo      │
│           setContainer / importCSV / saveProject / loadProject  │
└──────┬──────────────────────────────────────┬───────────────────┘
       │ dispatch / read                      │ subscribe()
       ▼                                      ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│     Core Layer           │   │     Renderer Layer               │
│                          │   │                                  │
│  VoxelGrid               │   │  Renderer (メインループ)         │
│   ├─ occupy / release    │   │   ├─ CargoPipeline              │
│   └─ query / collides    │   │   ├─ ContainerPipeline          │
│                          │   │   └─ GridPipeline               │
│  Voxelizer               │   │                                  │
│   └─ meshToVoxels()      │   │  Camera                         │
│                          │   │  CameraController               │
│  GravityChecker          │   │   └─ orbit / fixed views        │
│   └─ hasSupport()        │   │                                  │
│                          │   │  Raycaster ──────────────┐       │
│  WeightCalculator        │   │   └─ pick()              │       │
│   └─ totalWeight()       │   │                          │       │
│   └─ centerOfGravity()   │   │  LabelRenderer           │       │
│                          │   │   └─ 寸法・重量ラベル    │       │
│  History                 │   └──────────────────────────┼───────┘
│   ├─ push() / undo()     │                              │
│   └─ redo()              │        raycasting 結果       │
└──────────────────────────┘        ──────────────────────┘
                                              │
                                              ▼
                                    Store へ dispatch
```

**データフロー方向:**

```
User Input ──► UI ──► Store ──► Core (検証・計算)
                                  │
                                  ▼
                              Store 更新 ──► Renderer (再描画)
                                         ──► UI (再レンダリング)

Renderer (Raycaster) ──► Store ──► Core ──► Store ──► Renderer / UI
```

---

## 4. プロジェクトディレクトリ構造

```
container-simulator/
├── docs/                        # 設計ドキュメント
│   └── 00-architecture-overview.md
├── public/
│   └── (静的アセット)
├── src/
│   ├── core/                    # Core エンジン（React / GPU 非依存）
│   │   ├── VoxelGrid.ts         #   ボクセルグリッド管理
│   │   ├── Voxelizer.ts         #   メッシュ→ボクセル変換
│   │   ├── GravityChecker.ts    #   重力・支持面チェック
│   │   ├── WeightCalculator.ts  #   重量・重心計算
│   │   ├── History.ts           #   Undo / Redo 履歴管理
│   │   ├── AutoPacker.ts        #   自動積載アルゴリズム
│   │   ├── OccupancyMap.ts      #   2D ハイトマップ (XZ平面)
│   │   ├── InterferenceChecker.ts #  AABB 干渉チェック
│   │   ├── StackChecker.ts      #   スタック重量制約チェック
│   │   ├── WallKick.ts          #   SRS 風オフセット試行
│   │   ├── SaveLoad.ts          #   保存・読み込み
│   │   ├── ImportParser.ts      #   CSV/JSON インポートパーサー
│   │   ├── ShapeCompressor.ts   #   ボクセル→矩形ブロック圧縮
│   │   ├── ShapeParser.ts       #   ShapeData バリデーション・変換
│   │   └── types.ts             #   共通型定義
│   ├── renderer/                # WebGPU レンダリング
│   │   ├── Renderer.ts          #   メインレンダラー・描画ループ
│   │   ├── Camera.ts            #   カメラ（射影・ビュー行列）
│   │   ├── CameraController.ts  #   カメラ操作（オービット・パン・ズーム）
│   │   ├── Raycaster.ts         #   レイキャスト（ピッキング）
│   │   ├── LabelRenderer.ts     #   2D ラベル描画（寸法・重量）
│   │   ├── pipelines/           #   レンダリングパイプライン
│   │   │   ├── CargoPipeline.ts       # 貨物描画
│   │   │   ├── ContainerPipeline.ts   # コンテナ壁描画（片面透過）
│   │   │   └── GridPipeline.ts        # グリッド線描画
│   │   └── shaders/             #   WGSL シェーダー
│   │       ├── common.wgsl            # 共通ユニフォーム・構造体
│   │       ├── cargo.wgsl             # 貨物シェーダー
│   │       ├── container.wgsl         # コンテナ壁シェーダー
│   │       └── grid.wgsl             # グリッド線シェーダー
│   ├── state/                   # Zustand ストア
│   │   └── store.ts             #   グローバル状態定義・アクション
│   ├── ui/                      # React コンポーネント
│   │   ├── App.tsx              #   ルートコンポーネント
│   │   ├── CanvasPanel.tsx      #   WebGPU キャンバスホスト
│   │   ├── Sidebar.tsx          #   サイドパネルレイアウト
│   │   ├── ContainerSelector.tsx #  コンテナ種別選択
│   │   ├── CargoEditor.tsx      #   貨物プロパティ編集
│   │   ├── CargoList.tsx        #   貨物一覧
│   │   ├── PlacementControls.tsx #  配置操作コントロール
│   │   ├── StatsPanel.tsx       #   統計情報（重量・重心・容積率）
│   │   ├── ViewButtons.tsx      #   カメラビュー切替ボタン
│   │   └── ToolBar.tsx          #   ツールバー（Undo/Redo・保存・読込）
│   ├── mcp/                     # MCP Server (シミュレータ操作)
│   │   ├── main.ts              #   エントリポイント
│   │   ├── session.ts           #   SimulatorSession
│   │   └── tools/               #   ツール登録 (27 tools)
│   ├── mcp-editor/              # MCP Editor Server (シェイプエディタ操作)
│   │   ├── main.ts              #   エントリポイント
│   │   ├── session.ts           #   EditorSession
│   │   └── tools/               #   ツール登録 (16 tools)
│   ├── utils/                   # ユーティリティ
│   │   ├── math.ts              #   ベクトル・行列演算
│   │   ├── fileIO.ts            #   JSON セーブ / ロード
│   │   └── csvParser.ts         #   CSV パース
│   ├── main.tsx                 #   エントリーポイント
│   └── index.html               #   HTML テンプレート
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## 5. 依存パッケージと選定理由

### 本番依存 (dependencies)

| パッケージ | バージョン目安 | 選定理由 |
|-----------|---------------|---------|
| `react` | ^18.x | UI フレームワーク。コンポーネントベースの宣言的 UI 構築に使用する。 |
| `react-dom` | ^18.x | React の DOM レンダリング。 |
| `zustand` | ^4.x | 軽量な状態管理ライブラリ。Boilerplate が少なく、React 外部（Renderer 層）からの `subscribe` に対応しているため、本アーキテクチャのデータフローに最適。 |
| `papaparse` | ^5.x | CSV パースライブラリ。貨物データの CSV インポートに使用する。堅牢なパーサーで、ストリーミング・ヘッダー自動検出に対応。 |

### 開発依存 (devDependencies)

| パッケージ | バージョン目安 | 選定理由 |
|-----------|---------------|---------|
| `typescript` | ^5.x | 型安全性の確保。大規模なボクセル演算やパイプライン構造において型によるバグ防止効果が高い。 |
| `vite` | ^5.x | 高速な開発サーバーとビルドツール。ネイティブ ES Modules によるホットリロードが高速で、WebGPU 開発との相性が良い。 |
| `vitest` | ^1.x | Vite ネイティブのテストフレームワーク。Vite の設定をそのまま共有でき、Core 層の単体テストに使用する。 |
| `@webgpu/types` | latest | WebGPU の TypeScript 型定義。`navigator.gpu` 等の API に対する型補完を提供する。 |
| `@types/react` | ^18.x | React の TypeScript 型定義。 |
| `@types/react-dom` | ^18.x | ReactDOM の TypeScript 型定義。 |

### 行列・ベクトル演算について

`gl-matrix` は広く使われているが、本プロジェクトでは必要な演算が限定的（4x4 行列、vec3、クォータニオン程度）であるため、`src/utils/math.ts` にカスタム軽量実装を置く方針とする。これにより以下の利点がある。

- バンドルサイズの削減
- TypeScript の型との完全な統合
- WebGPU のバッファレイアウト（列優先）に合わせた最適化

ただし、開発速度を優先する場合は `gl-matrix` の導入を排除しない。

---

## 6. ビルド・開発環境設定

### Vite 設定 (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',        // WebGPU API は ES2022 環境を前提
  },
  server: {
    headers: {
      // SharedArrayBuffer を使用する場合に必要
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  assetsInclude: ['**/*.wgsl'],  // WGSL シェーダーを静的アセットとしてインポート可能にする
});
```

### TypeScript 設定 (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "types": ["@webgpu/types", "vite/client"],
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

### WebGPU 型の設定

`@webgpu/types` をインストールし、`tsconfig.json` の `types` フィールドに追加することで、`navigator.gpu`、`GPUDevice`、`GPUBuffer` 等の型補完が有効になる。

```bash
npm install -D @webgpu/types
```

### Vitest 設定 (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',     // Core 層テストはブラウザ不要
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],  // Core 層のカバレッジを重視
    },
  },
});
```

### 開発サーバー

```bash
npm run dev     # Vite 開発サーバー起動（デフォルト: http://localhost:5173）
npm run build   # プロダクションビルド
npm run test    # Vitest 実行
npm run preview # ビルド結果のプレビュー
```

WebGPU は HTTPS またはローカルホストでのみ動作する。Vite の開発サーバーはデフォルトで `localhost` を使用するため、追加設定なしで WebGPU を利用可能である。

---

## 7. データフロー概要

アプリケーション全体のデータフローは、単方向循環を基本とする。

### 7.1 基本フロー

```
① ユーザ操作 (UI)
    │
    ▼
② Zustand Store 更新 (dispatch action)
    │
    ├──► ③ Core エンジン処理
    │        ├─ VoxelGrid: ボクセル占有判定・衝突検出
    │        ├─ GravityChecker: 支持面検証
    │        ├─ WeightCalculator: 重量・重心再計算
    │        └─ History: 操作履歴スタックへ push
    │        │
    │        ▼
    │    ④ Store 状態更新（計算結果の反映）
    │        │
    │        ├──► ⑤-a Renderer 再描画 (subscribe 経由)
    │        │         メッシュ更新 → WebGPU コマンド発行 → Canvas に描画
    │        │
    │        └──► ⑤-b UI 再レンダリング (useStore 経由)
    │                  統計パネル・貨物リスト等の更新
    │
    └──► (直接 UI のみに関わる操作は Core を経由しない)
```

### 7.2 レイキャスト (ピッキング) フロー

```
① Canvas 上でマウスクリック
    │
    ▼
② Renderer.Raycaster がスクリーン座標 → ワールド座標のレイを生成
    │
    ▼
③ VoxelGrid / 貨物バウンディングボックスとのレイ交差判定
    │
    ▼
④ 交差した貨物 ID を Store に dispatch (selectCargo)
    │
    ▼
⑤ UI がハイライト表示、Sidebar が選択貨物の情報を表示
```

### 7.3 Undo / Redo フロー

```
① ユーザが Undo ボタン押下 (ToolBar)
    │
    ▼
② Store action: history.undo() を実行
    │
    ▼
③ History モジュールが前回のスナップショットを返却
    │
    ▼
④ Store 全体が復元されたスナップショットで上書き
    │
    ▼
⑤ Renderer / UI が新しい状態を反映
```

### 7.4 ファイル入出力フロー

```
保存: Store.getState() → JSON.stringify() → Blob → ダウンロード
読込: File 選択 → JSON.parse() → Store.setState() → Core 再計算 → Renderer / UI 更新
CSV : File 選択 → papaparse → CargoDefinition[] 生成 → Store に追加
```

---

## 8. 技術的制約と前提条件

### 8.1 WebGPU ブラウザサポート

WebGPU は比較的新しい API であり、利用可能なブラウザは限定される。

| ブラウザ | サポート状況 |
|---------|-------------|
| Chrome 113+ | 正式サポート |
| Edge 113+ | 正式サポート（Chromium ベース） |
| Firefox Nightly | フラグ有効で利用可能（実験的） |
| Safari 18+ | 部分サポート（WebKit 実装） |

アプリケーション起動時に `navigator.gpu` の存在チェックを行い、未対応ブラウザではエラーメッセージを表示する。WebGL へのフォールバックは本プロジェクトのスコープ外とする。

### 8.2 メモリ制約（ボクセルグリッド）

1cm 解像度のボクセルグリッドは大量のメモリを消費する。各ボクセルに 1 バイト（貨物 ID またはフラグ）を格納する場合の概算は以下のとおり。

| コンテナ種別 | 内寸 (W x H x L) | ボクセル数 | メモリ使用量 |
|------------|------------------|-----------|-------------|
| 20ft 標準 | 235cm x 239cm x 590cm | 約 33,150,000 | 約 31.6 MB |
| 40ft 標準 | 235cm x 239cm x 1,203cm | 約 67,570,000 | 約 64.4 MB |
| 40ft ハイキューブ | 235cm x 269cm x 1,203cm | 約 76,050,000 | 約 72.5 MB |

**注意:** 貨物 ID を 2 バイト（`Uint16Array`）で管理する場合、上記の約 2 倍のメモリが必要となる。

メモリ使用量の最適化として以下の戦略を検討する。

- **ビットフラグ方式:** 占有の有無のみを 1 ビットで管理し、貨物 ID は別のインデックスで引く
- **チャンク分割:** グリッドを小ブロックに分割し、空チャンクはメモリ確保しない
- **TypedArray の活用:** `Uint8Array` / `Uint16Array` でメモリレイアウトを最適化

### 8.3 動作前提

- **シングルユーザ・デスクトップ向け:** 複数ユーザの同時編集やモバイル対応は想定しない
- **サーバサイド不要:** すべての処理はクライアントサイドで完結する。データの永続化はブラウザのファイルシステム API（ダウンロード / アップロード）のみとする
- **オフライン動作可能:** 初回ロード後はネットワーク接続を必要としない

### 8.4 パフォーマンス目標

| 指標 | 目標値 |
|------|-------|
| 描画フレームレート | 60 FPS（貨物 50 個以下の標準的なシーン） |
| 貨物配置レスポンス | 100ms 以内（ドラッグ中のプレビュー更新） |
| ボクセル衝突判定 | 16ms 以内（1 フレーム内に完了） |
| 初回ロード | 3 秒以内（開発サーバー） |

### 8.5 今後の拡張に対する設計上の考慮

以下の機能は初期スコープ外だが、アーキテクチャ設計時に拡張性を考慮しておく。

- 複数コンテナの同時管理
- 積載プランの PDF / 画像エクスポート
- Web Worker を用いたボクセル演算のオフロード
- WebGPU Compute Shader による衝突判定の GPU 並列化

> **注**: 自動積載アルゴリズム（AutoPacker）は実装済み。OccupancyMap ベースのハイトマップ方式で、ボリューム降順・6方向回転候補の配置探索を行う。
