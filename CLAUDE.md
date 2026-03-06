# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

複雑な形状のオブジェクトに対応した積込シミュレータ

Container loading simulator with WebGPU 3D visualization. Users define cargo items in a sidebar, place them into shipping containers, and view the result in a real-time 3D scene. All units are in centimeters.

Includes a **Voxel Shape Editor** (`editor.html`) — a Minecraft creative mode-style block editor for building composite (non-rectangular) cargo shapes. Shapes are exported as `.shape.json` files and imported into the simulator as multi-block cargo items.

## Commands

- `npm run dev` — Start dev server (Vite, serves on localhost with COOP/COEP headers for SharedArrayBuffer)
- `npm run build` — TypeScript check + production build (`tsc -b && vite build`)
- `npm run lint` — ESLint
- `npm test` — Run all tests (`vitest run`)
- `npm run test:watch` — Watch mode
- `npx vitest run src/core/__tests__/VoxelGrid.test.ts` — Run a single test file

## Architecture

### Three-Layer Design

1. **Core (`src/core/`)** — Data layer. VoxelGrid (collision detection at 1cm resolution), types, History (undo/redo command pattern), Voxelizer, WeightCalculator, GravityChecker, SaveLoad, ImportParser, ShapeCompressor, ShapeParser, AutoPacker, OccupancyMap, InterferenceChecker. No DOM or GPU dependencies (SaveLoad の `downloadJson` のみ DOM 使用).
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

## i18n (`src/i18n/`)

EN/JA 言語切替。Zustand store (`useI18nStore`) + React hook (`useTranslation()`) + non-React accessor (`getTranslation()`)。`localStorage` key `loadcraft-lang` で永続化、`navigator.language` で自動検出。`interpolate()` でパラメータ付き文字列補間 (`${key}` 形式)。

## 既知の制限事項

- **自動配置の回転未対応** (`src/ui/CargoList.tsx` `findPlacementPosition`): サイドバーの「配置」ボタン経由の自動配置は常に `rotationDeg={0,0,0}` で配置。D&D 経由の配置は回転対応済み。

## Voxel Shape Editor

### 概要

Minecraft クリエイティブモード風のボクセルシェイプエディタ。`editor.html` から起動する別エントリポイント。既存のレンダラー・カメラ・パイプラインを最大限再利用。ダーク/ライトモード切替対応（`localStorage` 永続化）。配置はグリッド範囲内の非負座標のみ制約。

- **URL**: `http://localhost:5173/editor.html`
- **ビルド**: Vite multi-entry (`vite.config.ts` の `rollupOptions.input` に `editor` エントリ追加)

### ディレクトリ構成

```
src/editor/
├── main.tsx                    # React エントリポイント
├── EditorApp.tsx               # ルートコンポーネント (useReducer + history)
├── EditorApp.module.css
├── renderer/
│   ├── EditorRenderer.ts       # WebGPU レンダラー (3パス: blocks/ghost/grid)
│   ├── EditorCameraController.ts # オービット/パン/ズーム + クリック/ホバー検出
│   └── EditorRaycaster.ts      # ブロックピッキング (面検出 + 隣接セル計算)
├── state/
│   ├── types.ts                # EditorState, EditorAction, EditorBlock, EditorTool
│   ├── editorReducer.ts        # 純粋 Reducer (PLACE/REMOVE/PAINT/CLEAR/LOAD...)
│   └── history.ts              # スナップショットベース Undo/Redo (Map before/after, 上限100)
└── ui/
    ├── EditorCanvas.tsx         # WebGPU キャンバス + イベントハンドリング
    ├── EditorToolBar.tsx        # Place/Erase/Paint + Undo/Redo/Clear
    ├── ColorPalette.tsx         # 16プリセット色 + カスタムカラーピッカー
    ├── ShapeInfoPanel.tsx       # 名前/重量/寸法/ブロック数
    └── ExportDialog.tsx         # JSON エクスポート/インポート
```

### ShapeData フォーマット

エディタとシミュレータの間で形状データをやり取りする JSON フォーマット（`.shape.json`）:

```typescript
interface ShapeData {
  version: 1
  name: string
  gridSize: number   // 1 | 5 | 10 cm/セル
  blocks: ShapeBlock[]  // 圧縮済み矩形ブロック
  weightKg: number
}

interface ShapeBlock {  // src/core/types.ts
  x: number; y: number; z: number  // cm (形状原点からのオフセット)
  w: number; h: number; d: number  // cm (ブロック寸法)
  color: string                     // "#RRGGBB"
}
```

### Core モジュール

- **ShapeCompressor** (`src/core/ShapeCompressor.ts`): ボクセル→矩形ブロック圧縮。色ごとにグループ化し、X→Y→Z の貪欲拡張アルゴリズムで圧縮。`compressBlocks()` / `expandBlocks()` で可逆変換
- **ShapeParser** (`src/core/ShapeParser.ts`): `validateShapeData()` でJSONバリデーション、`shapeToCargoItemDef()` でAABB自動計算→CargoItemDef変換

### CargoItemDef 拡張 (複合形状対応)

`CargoItemDef` に `blocks?: ShapeBlock[]` フィールドを追加（後方互換: undefined = 従来の直方体）。
- **レンダリング**: 1配置 = N GPUインスタンス（ブロックごとに個別のmodel matrix + color）
- **ボクセル化**: `voxelizeComposite()` で各ブロックを個別にボクセル化し union
- **ピッキング**: 各ブロックの変換済みAABBを個別PickItemとして追加（同一instanceId）
- **ゴースト**: D&D中に複合形状全体のゴーストプレビュー表示
- **SaveLoad**: `blocks` フィールドをoptionalとしてバリデーション・保存・復元
- **インポート**: `parseCargoJSON()` でShapeDataを自動検出し `shapeToCargoItemDef()` で変換

## MCP Server (`src/mcp/`)

LLM (Claude等) が LoadCraft のコア配置ロジックをツールとして直接操作するための MCP (Model Context Protocol) Server。

### Commands

- `npm run build:mcp` — tsup で `dist-mcp/main.js` にバンドルビルド
- `npm run mcp` — ビルド済みサーバーを実行
- `npm run mcp:dev` — tsx で開発時直接実行

### Architecture

```
LLM ↔ stdio (JSON-RPC) ↔ MCP Server (Node.js)
  ├─ SimulatorSession (VoxelGrid + placements + history)
  └─ src/core/* を直接 import して再利用
```

- **ステートフル**: プロセス内に VoxelGrid + 配置状態 + 履歴を保持
- **session.ts**: `src/state/store.ts` の配置ビジネスロジックを React/Zustand 非依存で抽出
- **ビルド**: `tsup` (ESM, Node.js target), `tsconfig.mcp.json` (DOM/WebGPU型を除外)

### Tools (20)

| Category | Tool | Description |
|----------|------|-------------|
| Container | `list_container_presets` | プリセット一覧 |
| Container | `set_container` | コンテナサイズ設定 |
| Cargo | `add_cargo_def` | 貨物定義追加 |
| Cargo | `list_cargo_defs` | 貨物定義一覧 |
| Cargo | `remove_cargo_def` | 貨物定義削除 |
| Cargo | `import_cargo` | CSV/JSONインポート |
| Placement | `place_cargo` | 配置 |
| Placement | `remove_cargo` | 配置削除 |
| Placement | `move_cargo` | 移動 |
| Placement | `rotate_cargo` | 回転 |
| Placement | `drop_cargo` | 重力落下 |
| Placement | `auto_pack` | 自動配置 |
| Placement | `find_position` | 配置位置探索 |
| Analysis | `get_status` | 状態・充填率・重量・重心 |
| Analysis | `check_interference` | AABB干渉チェック |
| Analysis | `check_support` | 支持力チェック |
| History | `undo` / `redo` | 操作履歴 |
| Save | `save_state` / `load_state` | 状態保存・復元 |

### File Structure

```
src/mcp/
├── main.ts            # エントリポイント (McpServer + stdio transport)
├── session.ts         # SimulatorSession (VoxelGrid + placements + history)
└── tools/
    ├── container.ts   # set_container, list_container_presets
    ├── cargo.ts       # add_cargo_def, list_cargo_defs, remove_cargo_def, import_cargo
    ├── placement.ts   # place_cargo, remove_cargo, move_cargo, rotate_cargo, drop_cargo, auto_pack, find_position
    ├── analysis.ts    # get_status, check_interference, check_support
    ├── history.ts     # undo, redo
    └── save.ts        # save_state, load_state
```

## Design Documents

Detailed specs are in `docs/` (8 files). Key references:
- `docs/00-architecture-overview.md` — アーキテクチャ概要
- `docs/01-data-structures.md` — All type definitions, coordinate system, voxel grid memory layout
- `docs/02-core-engine.md` — VoxelGrid API, Voxelizer, History command pattern
- `docs/03-rendering-engine.md` — WebGPU pipeline configs, shader structures, camera uniform layout (208 bytes), instance data format (80 bytes/instance)
- `docs/04-state-management.md` — Full Zustand store interface, action flows, renderer integration
- `docs/05-ui-components.md` — Component hierarchy, CSS modules, dark theme color scheme
- `docs/06-interaction-design.md` — インタラクション仕様
- `docs/07-file-formats.md` — ファイルフォーマット仕様
