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

1. **Core (`src/core/`)** — Data layer. VoxelGrid (collision detection at 1cm resolution), types, History (undo/redo command pattern). No DOM or GPU dependencies.
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
2. Container walls — two sub-passes: back faces transparent (alpha=0.3), front faces opaque
3. Floor grid — procedural via fract()/fwidth() in WGSL

### Initialization Order

`main.tsx` creates VoxelGrid from store's default container before React mounts. `CanvasPanel` initializes WebGPU asynchronously in useEffect, then subscribes to store.

## TypeScript Constraints

- `erasableSyntaxOnly: true` — No constructor parameter properties (`private x: number` in constructor params). Use class fields instead.
- `noUncheckedIndexedAccess: true` — Array/object index access returns `T | undefined`. Use `!` postfix when you know the index is valid.
- Avoid explicit `Float32Array` return type annotations on functions that create new typed arrays — let TS infer `Float32Array<ArrayBuffer>` to avoid `ArrayBufferLike` incompatibility with WebGPU types.
- WGSL shaders are imported as strings via `?raw` suffix (configured in `vite.config.ts` with `assetsInclude: ['**/*.wgsl']`).

## 実装状況と設計書との差分

Phase 1-2 完了。設計書 (`docs/`) は全Phase分の完全仕様を記述しているため、現時点の実装との差分を以下に記録する。

### 既知の制限事項（次Phase以降で修正必要）

**undo/redo (`src/state/store.ts` undo/redo アクション)**:
- undo は動作する（VoxelGrid の状態は正しく戻る）
- redo で PlaceCommand が再実行された場合、placements 配列にエントリが復元されない。grid 上はボクセルが埋まるが store の placements には反映されないため 3D 描画に出ない
- 修正方針: HistoryManager に PlacedCargo 情報を保持させ、redo 時に placements を復元する。または placements 自体を Command に含める

**auto-placement (`src/ui/CargoList.tsx` findPlacementPosition)**:
- サイドバーの「配置」ボタン経由の自動配置は VoxelGrid の hasCollision ではなく AABB ボックス同士の比較で簡易実装
- 10cm ステップで探索するため、隙間なく詰める精度ではない
- 修正方針: VoxelGrid.hasCollision を使った正確な衝突判定に置き換える
- ※ D&D 経由の配置は `snapPosition` で VoxelGrid を正しく走査済み

**Container 壁メッシュ (`src/renderer/pipelines/ContainerPipeline.ts`)**:
- 設計書では壁厚付き box (inner/outer faces) だが、現在は単純な 5 面ボックス（前面開口、壁厚なし）
- 視覚的には問題ないが、内側から見たときの見え方が設計書と異なる

### Store: 未実装のアクション/プロパティ

設計書 `docs/04-state-management.md` に定義されているが未実装のもの:

| 項目 | 対応Phase | 備考 |
|------|----------|------|
| `rotateCargo` | Phase 3 | 任意回転に必要 |
| `cameraView` / `setCameraView` | Phase 3 | カメラプリセット切替 |
| `showGrid` / `toggleGrid` | Phase 3 | グリッド表示ON/OFF |
| `snapToGrid` / `toggleSnap` | Phase 3 | スナップ機能 |
| `saveState` / `loadState` | Phase 4 | JSON ファイル入出力 |
| `weightResult` | Phase 4 | 重量・重心の計算結果 |
| `updateCargoDef` | Phase 2 | 定義の編集 |
| `importCargoDefs` | Phase 4 | CSV/JSON インポート |

実装済み (Phase 2): ~~`moveCargo`~~, ~~`dragState`/`setDragState`~~, ~~`selectedInstanceId`/`setSelectedInstanceId`~~

### Core: 未実装のモジュール

| モジュール | 設計書 | 対応Phase |
|-----------|--------|----------|
| `Voxelizer` | `docs/02-core-engine.md` | Phase 3 (任意回転対応時に必要) |
| `GravityChecker` | `docs/02-core-engine.md` | Phase 4 |
| `WeightCalculator` | `docs/02-core-engine.md` | Phase 4 |

### Renderer: 未実装のサブシステム

| モジュール | 設計書 | 対応Phase |
|-----------|--------|----------|
| `LabelRenderer` | `docs/03-rendering-engine.md` | Phase 5 |
| `ViewTransition` | `docs/03-rendering-engine.md` | Phase 3 (カメラアニメーション) |

実装済み (Phase 2): ~~`Raycaster`~~ (`src/renderer/Raycaster.ts` — ray-AABB pick, floor intersection, screenToRay)

### UI: 未実装のコンポーネント

| コンポーネント | 設計書 | 対応Phase |
|--------------|--------|----------|
| `PlacementControls` | `docs/05-ui-components.md` | Phase 2 |
| `StatsPanel` | `docs/05-ui-components.md` | Phase 4 |
| `ViewButtons` | `docs/05-ui-components.md` | Phase 3 |
| `ToolBar` | `docs/05-ui-components.md` | Phase 2 |

実装済み (Phase 2): ~~`ErrorBoundary`~~ (`src/ui/ErrorBoundary.tsx`), ~~`WebGPUFallback`~~ (`src/ui/WebGPUFallback.tsx`)

### Phase 2 で追加された主要機能

- **D&D 配置**: サイドバーからキャンバスへのドラッグ&ドロップ。`snapPosition` による重力スタッキング（VoxelGrid 下方走査で最初の空きYを検出）
- **3D 選択**: クリックで荷物を選択（ray-AABB ピッキング）、選択ハイライト表示
- **3D 移動**: 選択した荷物を右ドラッグで移動。ゴースト表示 + 衝突判定。移動中は自身を `excludeInstanceId` で除外
- **選択ハイライト**: cargo シェーダで `selectedInstanceId` に一致するインスタンスを明るく表示

## Design Documents

Detailed specs are in `docs/` (9 files). Key references:
- `docs/01-data-structures.md` — All type definitions, coordinate system, voxel grid memory layout
- `docs/02-core-engine.md` — VoxelGrid API, Voxelizer, History command pattern
- `docs/03-rendering-engine.md` — WebGPU pipeline configs, shader structures, camera uniform layout (208 bytes), instance data format (80 bytes/instance)
- `docs/04-state-management.md` — Full Zustand store interface, action flows, renderer integration
- `docs/05-ui-components.md` — Component hierarchy, CSS modules, dark theme color scheme
- `docs/08-development-roadmap.md` — 5 Phase ロードマップ、各Phase のステップ詳細
