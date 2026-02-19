# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Container loading simulator with WebGPU 3D visualization. Users define cargo items in a sidebar, place them into shipping containers, and view the result in a real-time 3D scene. All units are in centimeters.

## Commands

- `npm run dev` — Start dev server (Vite, serves on localhost with COOP/COEP headers for SharedArrayBuffer)
- `npm run build` — TypeScript check + production build (`tsc -b && vite build`)
- `npm run lint` — ESLint
- `npm test` — Run all tests (`vitest run`)
- `npm run test:watch` — Watch mode
- `npx vitest run src/core/__tests__/VoxelGrid.test.ts` — Run a single test file

## Architecture

### Three-Layer Design

1. **Core (`src/core/`)** — Data layer. VoxelGrid (collision detection at 1cm resolution), types, History (undo/redo command pattern), Voxelizer, WeightCalculator, GravityChecker, SaveLoad, ImportParser. No DOM or GPU dependencies (SaveLoad の `downloadJson` のみ DOM 使用).
2. **Renderer (`src/renderer/`)** — WebGPU rendering. Shaders (WGSL), camera, pipelines. Receives data from store, outputs to canvas. No React dependencies.
3. **UI + State (`src/ui/`, `src/state/`)** — React components + Zustand store. Store is the single source of truth, bridges Core and Renderer.

### Data Flow

```
UI action → Zustand store → VoxelGrid (collision) + History (undo)
                          → renderVersion++ → Renderer subscribes → GPU buffer rebuild
```

### Key Concepts

**VoxelGrid** (`src/core/VoxelGrid.ts`): Flat `Uint16Array` where each cell stores a cargo instanceId (0=empty, 1-65534=cargo). Index formula: `x + width * (y + height * z)`. Lives outside the store as a mutable singleton (`src/core/voxelGridSingleton.ts`) — too large for immutable state (~63-145MB depending on container size).

**renderVersion** (`src/state/store.ts`): Integer counter incremented on any placement/container change. The Renderer subscribes to the store (non-React subscription via `useAppStore.subscribe()`) and checks this counter to know when to rebuild the GPU instance buffer.

**Instance Buffer**: Each placed cargo becomes 80 bytes in a GPU storage buffer (mat4x4 modelMatrix + vec4 color). `Renderer.updateInstances()` rebuilds this from placements + cargo definitions.

**Render Passes** (3-pass pipeline in `Renderer.render()`):
1. Cargo — instanced draw, opaque, clears framebuffer
2. Container wireframe — `line-list` topology, 12 edges (8 vertices + 24 indices), single pipeline
3. Floor grid — procedural via fract()/fwidth() in WGSL

### Initialization Order

`main.tsx` creates VoxelGrid from store's default container before React mounts. `CanvasPanel` initializes WebGPU asynchronously in useEffect, then subscribes to store.

## TypeScript Constraints

- `erasableSyntaxOnly: true` — No constructor parameter properties (`private x: number` in constructor params). Use class fields instead.
- `noUncheckedIndexedAccess: true` — Array/object index access returns `T | undefined`. Use `!` postfix when you know the index is valid.
- Avoid explicit `Float32Array` return type annotations on functions that create new typed arrays — let TS infer `Float32Array<ArrayBuffer>` to avoid `ArrayBufferLike` incompatibility with WebGPU types.
- WGSL shaders are imported as strings via `?raw` suffix (configured in `vite.config.ts` with `assetsInclude: ['**/*.wgsl']`).

## 実装状況と設計書との差分

Phase 1-2-3-4-5 完了。設計書 (`docs/`) は全Phase分の完全仕様を記述しているため、現時点の実装との差分を以下に記録する。

### 既知の制限事項（次Phase以降で修正必要）

**auto-placement (`src/ui/CargoList.tsx` findPlacementPosition)**:
- サイドバーの「配置」ボタン経由の自動配置は回転未対応（常に rotationDeg={0,0,0} で配置）
- 1cm ステップで探索するが、回転荷物の自動配置は未実装
- ※ D&D 経由の配置は `snapPosition` で回転対応済み

**Container 描画 (`src/renderer/pipelines/ContainerPipeline.ts`)**:
- 設計書では壁厚付き box (inner/outer faces) だが、内部視認性のためワイヤーフレーム（12辺 line-list）に変更済み
- シェーダーは法線/ライティングなしの単色描画、パイプラインは1つに統合

**カメラプリセット切替**:
- Phase 5 で `ViewTransition` による 300ms ease-out アニメーション遷移を実装済み

### Store: 設計書アクションの実装状況

設計書 `docs/04-state-management.md` に定義されたアクション/プロパティはすべて実装済み。

実装済み (Phase 2): ~~`moveCargo`~~, ~~`dragState`/`setDragState`~~, ~~`selectedInstanceId`/`setSelectedInstanceId`~~, ~~`updateCargoDef`~~

実装済み (Phase 3): ~~`rotateCargo`~~, ~~`cameraView`/`setCameraView`~~, ~~`showGrid`/`toggleGrid`~~, ~~`snapToGrid`/`toggleSnap`~~, ~~`gridSizeCm`/`setGridSize`~~

実装済み (Phase 4): ~~`saveState`/`loadState`~~, ~~`weightResult`~~, ~~`cogDeviation`~~, ~~`supportResults`~~, ~~`importCargoDefs`~~

### Core: モジュール実装状況

設計書 `docs/02-core-engine.md` のモジュールはすべて実装済み。

実装済み (Phase 3): ~~`Voxelizer`~~ (`src/core/Voxelizer.ts` — voxelize, isAxisAligned, computeRotatedAABB(exact フラグ対応)。高速パス/低速パス分岐)

実装済み (Phase 4): ~~`WeightCalculator`~~ (`src/core/WeightCalculator.ts` — computeWeight, computeCogDeviation), ~~`GravityChecker`~~ (`src/core/GravityChecker.ts` — checkSupport, checkAllSupports。底面ボクセル走査、閾値0.8)

### Renderer: サブシステム実装状況

実装済み (Phase 2): ~~`Raycaster`~~ (`src/renderer/Raycaster.ts` — ray-AABB pick, floor intersection, screenToRay)

実装済み (Phase 5): ~~`LabelRenderer`~~ (`src/renderer/LabelRenderer.ts` — HTML オーバーレイラベル、3D→2D 射影、距離フェード)、~~`ViewTransition`~~ (`src/renderer/ViewTransition.ts` — 300ms ease-out cubic カメラアニメーション)

### UI: コンポーネント実装状況

設計書 `docs/05-ui-components.md` のコンポーネントはすべて実装済み。

実装済み (Phase 2): ~~`ErrorBoundary`~~, ~~`WebGPUFallback`~~, ~~`PlacementControls`~~, ~~`ToolBar`~~, ~~`HelpOverlay`~~

実装済み (Phase 3): ~~`ViewButtons`~~ (`src/ui/ViewButtons.tsx` — 6種カメラプリセットボタン)

実装済み (Phase 4): ~~`StatsPanel`~~ (`src/ui/StatsPanel.tsx` — 重量/充填率プログレスバー、重心位置、警告リスト)

### Phase 2 で追加された主要機能

- **D&D 配置**: サイドバーからキャンバスへのドラッグ&ドロップ。`snapPosition` による重力スタッキング（VoxelGrid 下方走査で最初の空きYを検出）
- **3D 選択**: クリックで荷物を選択（ray-AABB ピッキング）、選択ハイライト表示
- **3D 移動**: 選択した荷物を左ドラッグで移動。ゴースト表示 + 衝突判定。移動中は自身を `excludeInstanceId` で除外
- **3D 自由回転**: Shift+左ドラッグで選択荷物を自由回転。水平→Y軸、垂直→X軸。回転時の床面クリッピングを自動補正
- **選択ハイライト**: cargo シェーダで `selectedInstanceId` に一致するインスタンスを明るく表示
- **PlacementControls**: 選択中荷物の情報パネル（名前・位置・寸法・重量）+ 削除/選択解除ボタン
- **ToolBar**: キャンバス下部フローティングツールバー（Undo/Redo + 将来機能の disabled ボタン）
- **HelpOverlay**: キャンバス右上に常時表示する半透明の操作ガイド（`pointer-events: none`）

### Phase 3 で追加された主要機能

- **Voxelizer** (`src/core/Voxelizer.ts`): 任意回転対応のボクセル化エンジン。軸整列時は高速パス（AABB のみ、`fillBox` 使用）、任意角度は低速パス（逆回転でローカル判定）
- **任意回転**: Y-X-Z 順の回転行列。History 全コマンドを `VoxelizeResult` ベースに統一。`RotateCommand` 追加
- **回転 UI**: PlacementControls に各軸 +90° ボタン。R/Shift+R（Y軸）、T（X軸）、F（Z軸）キーボードショートカット
- **D&D 中回転**: ドラッグ中に R/T/F キーで ghost の回転変更、回転状態のまま配置
- **カメラプリセット**: ViewButtons（Front/Back/Left/Right/Top/Iso）。オービット操作で自動的に 'free' にリセット
- **カスタムコンテナ**: ContainerSelector に「カスタム」オプション追加。幅/高さ/奥行を 10-2000cm で指定
- **Grid 表示切替**: ToolBar の Grid ボタンでフロアグリッドの表示/非表示切替
- **スナップ**: ToolBar の Snap ボタン + サイズ選択（1/5/10cm）。有効時に配置の X/Z をグリッドに吸着
- **回転対応モデル行列**: `M = T(pos) × Rz × Rx × Ry × T(center) × S(size)`。回転なし時は従来と同等のパフォーマンス

### Phase 4 で追加された主要機能

- **WeightCalculator** (`src/core/WeightCalculator.ts`): 総重量・重心(CoG)・充填率・過積載判定。`computeRotatedAABB` の AABB 中心で各貨物中心を算出、重量加重平均で重心計算。`CogDeviation` でコンテナ中心からの偏りを各軸10%閾値で判定
- **GravityChecker** (`src/core/GravityChecker.ts`): 底面ボクセル走査で支持率判定（閾値0.8）。床面(y=0)は常に supported。`checkAllSupports` で全配置を一括チェック
- **SaveLoad** (`src/core/SaveLoad.ts`): `SaveData` バリデーション（version/container/cargoDefs/placements の型・値チェック）、JSON シリアライズ、Blob ダウンロード
- **ImportParser** (`src/core/ImportParser.ts`): papaparse による CSV パース、JSON 配列パース。`parseCargoFile` でファイル拡張子ルーティング。color 省略時はランダム色、id は `crypto.randomUUID()`
- **Store 統合**: `recomputeAnalytics()` ヘルパーで weightResult/cogDeviation/supportResults を一括再計算。placeCargo/removePlacement/moveCargo/rotateCargo/undo/redo/setContainer/loadState の末尾で呼出
- **StatsPanel** (`src/ui/StatsPanel.tsx`): 重量プログレスバー（0-79%緑/80-99%黄/100%+赤）、充填率、重心位置(xyz)、配置数、警告リスト（過積載/重心偏り/浮遊荷物）
- **ToolBar Save/Load**: Save→`serializeSaveData`+`downloadJson`、Load→FileReader+`validateSaveData`+`loadState`（VoxelGrid 再構築含む）
- **CargoEditor インポート**: CSV/JSON ファイル読込→`parseCargoFile`→`importCargoDefs`。エラー時トースト通知（Phase 5 で alert から置換）

### Phase 5 で追加された主要機能

- **ViewTransition** (`src/renderer/ViewTransition.ts`): カメラプリセット切替を 300ms ease-out cubic アニメーションで遷移。球面座標の最短経路補間。オービット開始でキャンセル
- **LabelRenderer** (`src/renderer/LabelRenderer.ts`): 荷物上面に名前・寸法・重量を HTML オーバーレイで表示。3D→2D 射影、距離フェード（3000cm-5000cm）。ToolBar の Labels ボタンで表示/非表示切替
- **Ghost 3色化**: ゴースト表示を valid（緑）/ invalid（赤）/ floating（黄）の 3 色に拡張。AABB 底面の支持率（閾値0.8）で浮遊判定
- **レスポンシブレイアウト**: 768px ブレークポイント。モバイルではサイドバー非表示+ハンバーガーメニュー。サイドバーは固定オーバーレイとしてスライドイン、バックドロップ付き
- **ローディングスピナー**: WebGPU 初期化中にスピナーオーバーレイ表示。初期化完了で消去
- **トースト通知** (`src/ui/Toast.tsx`): Save/Load/Import 操作の結果をトースト通知で表示（3 秒自動消去）。`alert()` を全て `addToast()` に置換

### Phase 5 で見送った項目

- **選択アウトライン (post-effect)**: 新 GPU パイプライン＋オフスクリーンテクスチャ＋Sobel フィルタが必要。現在のリムハイライトで十分機能
- **パフォーマンス最適化 (frustum culling/LOD/Web Worker)**: 現規模（〜100 荷物）ではインスタンス描画で十分高速

## Design Documents

Detailed specs are in `docs/` (9 files). Key references:
- `docs/01-data-structures.md` — All type definitions, coordinate system, voxel grid memory layout
- `docs/02-core-engine.md` — VoxelGrid API, Voxelizer, History command pattern
- `docs/03-rendering-engine.md` — WebGPU pipeline configs, shader structures, camera uniform layout (208 bytes), instance data format (80 bytes/instance)
- `docs/04-state-management.md` — Full Zustand store interface, action flows, renderer integration
- `docs/05-ui-components.md` — Component hierarchy, CSS modules, dark theme color scheme
- `docs/08-development-roadmap.md` — 5 Phase ロードマップ、各Phase のステップ詳細
