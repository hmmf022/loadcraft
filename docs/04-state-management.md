# 04 - 状態管理設計

## 1. 設計方針

本プロジェクトでは、React の状態管理に **Zustand** を採用する。選定理由は以下の通り。

- **軽量・ボイラープレート不要**: Redux のような Provider ラッパーや action type 定数が不要で、シンプルな関数呼び出しで状態を更新できる。
- **React 外からのアクセスが容易**: `store.getState()` や `store.subscribe()` を React コンポーネント外（レンダラー等）から直接利用できる。
- **TypeScript との親和性**: ストア定義がそのまま型定義になり、型安全な開発が可能。

### 状態の配置戦略

ストアに格納するデータと、ストア外で管理するデータを明確に分離する。

| 配置先 | 対象 | 理由 |
|---|---|---|
| **Zustand ストア内** | `PlacedCargo[]`、`CargoItemDef[]`、`ContainerDef`、UI 状態、選択状態など | シリアライズ可能で、React の再レンダリングトリガーとして機能する必要がある |
| **ストア外（シングルトン）** | `VoxelGrid` インスタンス | 大規模な可変オブジェクト（数百万ボクセル）であり、Zustand の不変データモデルに適さない |

### データフローの原則

ストアのアクションがオーケストレーターとして機能し、以下の順序で処理を実行する。

```
ユーザー操作
  → ストアアクション呼び出し
    → PlacedCargo[] 更新（ストア内）
    → VoxelGrid 更新（ストア外シングルトン）
    → renderVersion インクリメント
      → レンダラーが変更を検知し再描画
```

レンダラーは React コンポーネントではないため、Zustand の `subscribe()` API を使って非 React サブスクリプションとしてストアの変更を監視する。


## 2. ストアインターフェース定義

```typescript
interface AppState {
  // --- Container ---
  container: ContainerDef;
  setContainer: (def: ContainerDef) => void;

  // --- Cargo Definitions ---
  cargoDefs: CargoItemDef[];
  addCargoDef: (def: CargoItemDef) => void;
  updateCargoDef: (id: string, updates: Partial<Omit<CargoItemDef, 'id'>>) => void;
  removeCargoDef: (id: string) => void;
  importCargoDefs: (defs: CargoItemDef[]) => void;

  // --- Placements ---
  placements: PlacedCargo[];
  nextInstanceId: number;
  placeCargo: (cargoDefId: string, position: Vec3, rotation?: Vec3) => void;
  moveCargo: (instanceId: number, newPosition: Vec3) => void;
  rotateCargo: (instanceId: number, newRotation: Vec3) => void;
  removePlacement: (instanceId: number) => void;
  dropCargo: (instanceId: number) => void;
  autoPackCargo: (mode: AutoPackMode) => void;

  // --- Staging ---
  stagedItems: StagedItem[];
  stageCargo: (cargoDefId: string, count?: number) => void;
  unstageCargo: (cargoDefId: string, count?: number) => void;
  clearStaged: () => void;

  // --- Selection ---
  selectedInstanceId: number | null;
  setSelectedInstanceId: (id: number | null) => void;

  // --- Drag State ---
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;

  // --- Camera ---
  cameraView: CameraView;
  setCameraView: (view: CameraView) => void;

  // --- UI State ---
  showGrid: boolean;
  toggleGrid: () => void;
  snapToGrid: boolean;
  toggleSnap: () => void;
  gridSizeCm: number;
  setGridSize: (size: number) => void;
  showLabels: boolean;
  toggleLabels: () => void;
  forceMode: boolean;
  toggleForceMode: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // --- Toasts ---
  toasts: { id: number; message: string; type: 'info' | 'success' | 'error' }[];
  addToast: (message: string, type: 'info' | 'success' | 'error') => void;
  removeToast: (id: number) => void;

  // --- History ---
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // --- File I/O ---
  saveState: () => void;
  loadState: (data: SaveData) => void;

  // --- Render version ---
  renderVersion: number;

  // --- Analytics (derived) ---
  weightResult: WeightResult;
  cogDeviation: CogDeviation | null;
  supportResults: Map<number, SupportResult>;
  stackViolations: StackViolation[];
  interferenceResults: InterferencePair[];
  checkInterference: () => void;
}

type CameraView =
  | 'free'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'isometric';

interface DragState {
  cargoDefId: string;
  currentPosition: Vec3 | null;
  currentRotation: Vec3;
  isValid: boolean;
}
```

### 各セクションの解説

**Container**: コンテナの寸法定義。変更時は VoxelGrid の再生成と全配置の再適用が必要。

**Cargo Definitions**: 積荷マスタデータ。CSV インポートにも対応する `importCargoDefs` を含む。

**Placements**: 実際にコンテナ内に配置された積荷のリスト。`nextInstanceId` は単調増加のカウンターで、各配置にユニークな ID を付与する。

**Selection**: 現在選択中の積荷インスタンス ID。`null` は未選択を表す。

**Drag State**: ドラッグ＆ドロップ中の一時的な状態。`isValid` は衝突判定の結果を保持し、UI でのビジュアルフィードバック（赤/緑表示）に使用する。

**Camera**: プリセットビューの切替要求。実際のカメラ行列はレンダラーが管理する。

**UI State**: グリッド表示、スナップ、グリッドサイズなどの表示設定。

**History**: Undo/Redo の可否フラグとアクション。内部的には `HistoryManager` に委譲する。

**File I/O**: 配置状態の保存・読込。`PlacementState` はシリアライズ可能な純粋データ。

**Computed**: `placements` と `container` から導出される重量・重心計算結果。配置変更のたびに再計算される。


## 3. VoxelGrid インスタンス管理

### シングルトンパターン

`VoxelGrid` はストア外にモジュールレベルのシングルトンとして保持する。

```typescript
// voxelGridSingleton.ts

import { VoxelGrid } from './engine/VoxelGrid';
import type { ContainerDef } from './types';

let voxelGrid: VoxelGrid | null = null;

export function getVoxelGrid(): VoxelGrid {
  if (!voxelGrid) {
    throw new Error('VoxelGrid is not initialized. Call createVoxelGrid() first.');
  }
  return voxelGrid;
}

export function createVoxelGrid(container: ContainerDef): VoxelGrid {
  voxelGrid = new VoxelGrid(
    container.innerWidthCm,
    container.innerHeightCm,
    container.innerDepthCm,
  );
  return voxelGrid;
}

export function destroyVoxelGrid(): void {
  voxelGrid = null;
}
```

### ライフサイクル

| イベント | 処理 |
|---|---|
| アプリ初期化時 | デフォルトコンテナ（20ft）で `createVoxelGrid()` を呼び出す |
| コンテナ変更時 | 新しい寸法で `createVoxelGrid()` → 既存の `placements[]` を順に再配置（再ボクセル化） |
| アプリ終了時 | 特別な破棄処理は不要（GC に任せる） |

### ストアアクションからのアクセス

ストアアクション内から `getVoxelGrid()` を直接呼び出す。ストアの状態としては保持しない。

```typescript
const useAppStore = create<AppStore>((set, get) => ({
  // ...
  placeCargo: (cargoDefId, position, rotation) => {
    const grid = getVoxelGrid();  // シングルトンを直接取得
    // ... VoxelGrid を操作
  },
}));
```

この設計により、VoxelGrid の大規模な可変データが Zustand の不変更新サイクルに干渉することを防ぐ。


## 4. アクションの詳細フロー

### 4.1 placeCargo フロー

`placeCargo(cargoDefId, position, rotation)` が呼ばれた際の処理フロー。

```
1. cargoDefId から CargoItemDef を取得
2. Voxelizer で CargoItemDef + position + rotation からボクセル座標配列を生成
3. PlacedCargo オブジェクトを生成（instanceId = nextInstanceId）
4. PlaceCommand を生成
5. PlaceCommand.execute() → VoxelGrid にボクセルを書き込み
6. HistoryManager.push(placeCommand)
7. set() で以下を更新:
   - placements: [...placements, newPlacedCargo]
   - nextInstanceId: nextInstanceId + 1
   - canUndo: true
   - canRedo: false（新規操作により redo スタックはクリア）
   - weightResult: 再計算
   - renderVersion: renderVersion + 1
```

```typescript
placeCargo: (cargoDefId, position, rotation) => {
  const { cargoDefs, placements, nextInstanceId } = get();
  const def = cargoDefs.find(d => d.id === cargoDefId);
  if (!def) return;

  const grid = getVoxelGrid();
  const voxels = Voxelizer.generate(def, position, rotation);

  const placed: PlacedCargo = {
    instanceId: nextInstanceId,
    cargoDefId,
    position,
    rotation,
    voxels,
  };

  const command = new PlaceCommand(grid, placed);
  command.execute();
  historyManager.push(command);

  const newPlacements = [...placements, placed];

  set({
    placements: newPlacements,
    nextInstanceId: nextInstanceId + 1,
    canUndo: true,
    canRedo: false,
    weightResult: computeWeight(newPlacements, cargoDefs, get().container),
    renderVersion: get().renderVersion + 1,
  });
},
```

### 4.2 moveCargo フロー

`moveCargo(instanceId, newPosition)` が呼ばれた際の処理フロー。

```
1. instanceId から既存の PlacedCargo を検索
2. 古いボクセル座標で VoxelGrid からクリア
3. 新しい position でボクセル座標を再計算
4. 新しいボクセル座標で VoxelGrid に書き込み
5. MoveCommand を生成し HistoryManager に push
6. set() で placements 配列内の該当要素を更新
7. weightResult を再計算
8. renderVersion をインクリメント
```

```typescript
moveCargo: (instanceId, newPosition) => {
  const { placements, cargoDefs } = get();
  const index = placements.findIndex(p => p.instanceId === instanceId);
  if (index === -1) return;

  const old = placements[index];
  const def = cargoDefs.find(d => d.id === old.cargoDefId)!;
  const grid = getVoxelGrid();

  // 古いボクセルをクリア
  grid.clearVoxels(old.voxels);

  // 新しいボクセルを計算
  const newVoxels = Voxelizer.generate(def, newPosition, old.rotation);

  // 新しいボクセルを書き込み
  grid.fillVoxels(newVoxels, old.instanceId);

  const command = new MoveCommand(grid, old, newPosition, old.voxels, newVoxels);
  historyManager.push(command);

  const updated: PlacedCargo = {
    ...old,
    position: newPosition,
    voxels: newVoxels,
  };

  const newPlacements = [...placements];
  newPlacements[index] = updated;

  set({
    placements: newPlacements,
    canUndo: true,
    canRedo: false,
    weightResult: computeWeight(newPlacements, cargoDefs, get().container),
    renderVersion: get().renderVersion + 1,
  });
},
```

### 4.3 undo/redo フロー

Undo/Redo は Command パターンにより VoxelGrid の操作を逆転・再実行する。

```
undo:
  1. HistoryManager.undo() を呼び出し
  2. 戻り値の Command.undo() が VoxelGrid を元の状態に復元
  3. Command から復元すべき PlacedCargo の状態を取得
  4. placements 配列を同期（追加→削除、移動→元の位置に戻す等）
  5. canUndo / canRedo フラグを更新
  6. weightResult を再計算
  7. renderVersion をインクリメント

redo:
  1. HistoryManager.redo() を呼び出し
  2. 戻り値の Command.execute() が VoxelGrid を再度変更
  3. placements 配列を同期
  4. canUndo / canRedo フラグを更新
  5. weightResult を再計算
  6. renderVersion をインクリメント
```

```typescript
undo: () => {
  const command = historyManager.undo();
  if (!command) return;

  command.undo();  // VoxelGrid を復元

  const restoredPlacements = rebuildPlacementsFromHistory(historyManager);

  set({
    placements: restoredPlacements,
    canUndo: historyManager.canUndo(),
    canRedo: historyManager.canRedo(),
    weightResult: computeWeight(restoredPlacements, get().cargoDefs, get().container),
    renderVersion: get().renderVersion + 1,
  });
},

redo: () => {
  const command = historyManager.redo();
  if (!command) return;

  command.execute();  // VoxelGrid を再変更

  const restoredPlacements = rebuildPlacementsFromHistory(historyManager);

  set({
    placements: restoredPlacements,
    canUndo: historyManager.canUndo(),
    canRedo: historyManager.canRedo(),
    weightResult: computeWeight(restoredPlacements, get().cargoDefs, get().container),
    renderVersion: get().renderVersion + 1,
  });
},
```


## 5. レンダラーとの連携

### サブスクリプション方式

レンダラーは React コンポーネントではないため、Zustand の `subscribe()` API を使用してストアの変更を監視する。

```typescript
// renderer.ts

import { useAppStore } from './store';

class Renderer {
  private lastRenderVersion = -1;
  private unsubscribe: (() => void) | null = null;

  init(): void {
    // ストアへのサブスクリプション（非 React）
    this.unsubscribe = useAppStore.subscribe((state) => {
      if (state.renderVersion !== this.lastRenderVersion) {
        this.lastRenderVersion = state.renderVersion;
        this.requestRebuild();
      }
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private requestRebuild(): void {
    // 次の requestAnimationFrame で GPU バッファを再構築
    this.needsRebuild = true;
  }

  private renderLoop = (): void => {
    if (this.needsRebuild) {
      this.rebuildInstanceBuffer();
      this.needsRebuild = false;
    }
    this.render();
    requestAnimationFrame(this.renderLoop);
  };

  private rebuildInstanceBuffer(): void {
    const { placements } = useAppStore.getState();
    // placements[] からインスタンスバッファデータを構築
    // → GPU にアップロード
  }
}
```

### renderVersion カウンター

`renderVersion` はストア内の数値カウンターで、視覚的な変更が発生するたびにインクリメントされる。

```typescript
interface AppStore {
  // ... 前述のインターフェースに加えて（内部用）
  renderVersion: number;
}
```

renderVersion がインクリメントされる操作:
- `placeCargo` / `moveCargo` / `rotateCargo` / `removePlacement`
- `undo` / `redo`
- `loadState`
- `setContainer`（コンテナ変更）

renderVersion がインクリメント**されない**操作:
- `setSelectedInstanceId`（選択ハイライトはレンダラー側で別途処理）
- `setCameraView`（カメラは別経路で更新）
- `toggleGrid` / `toggleSnap`（UI のみの変更）

> **注意**: `selectedInstanceId` の変更はレンダラーが個別にサブスクライブし、ハイライト用の uniform を更新する。インスタンスバッファの再構築は不要。

### カメラ制御の分離

カメラの状態（ビュー行列・プロジェクション行列）はレンダラーが直接管理する。ストアの `cameraView` はプリセットビューへの切替要求として機能する。

```
ユーザーが "Top View" ボタンをクリック
  → setCameraView('top')
  → レンダラーがサブスクライブで検知
  → カメラを top view 位置にアニメーション遷移
```

フリーカメラのマウス操作（回転・ズーム・パン）はレンダラー内で完結し、ストアには通知しない。


## 6. 状態変更時のGPUバッファ更新タイミング

### 更新トリガーと処理のマッピング

| トリガー | 更新対象 | タイミング |
|---|---|---|
| `renderVersion` 変更 | インスタンスバッファ再構築 | 次の `requestAnimationFrame` |
| カメラ操作（マウス） | ビュー行列 uniform バッファ | 次の `requestAnimationFrame` |
| `cameraView` 変更 | ビュー行列 uniform バッファ（アニメーション） | 毎フレーム（アニメーション完了まで） |
| `selectedInstanceId` 変更 | 選択ハイライト uniform | 次の `requestAnimationFrame` |
| `showGrid` 変更 | グリッド表示フラグ uniform | 次の `requestAnimationFrame` |

### フレーム処理の流れ

```
requestAnimationFrame コールバック:
  1. needsRebuild フラグを確認
     → true なら placements[] からインスタンスバッファを再構築
  2. カメラアニメーション更新（進行中なら）
  3. Uniform バッファ更新（ビュー行列、プロジェクション行列）
  4. レンダーパス実行
     - コンテナ描画
     - 積荷インスタンス描画
     - グリッド描画（showGrid が true の場合）
     - 選択ハイライト描画
```

### デバウンスについて

`requestAnimationFrame` が自然なフレームレートスロットルとして機能するため、明示的なデバウンス処理は不要。

- 1 フレーム内で複数のストア更新が発生しても、`renderVersion` の比較により再構築は 1 回のみ。
- ドラッグ中の `moveCargo` が高頻度で呼ばれても、GPU バッファ更新は最大でも 60fps（ディスプレイリフレッシュレートに依存）。


## 7. 初期化シーケンス

アプリケーション起動時の初期化は以下の順序で行う。

```
1. Zustand ストアを生成（デフォルト 20ft コンテナ）
   └─ container: { innerWidthCm: 590, innerHeightCm: 239, innerDepthCm: 235 }
   └─ placements: []
   └─ cargoDefs: []
   └─ renderVersion: 0

2. VoxelGrid シングルトンを生成
   └─ createVoxelGrid(store.getState().container)
   └─ → new VoxelGrid(590, 239, 235)

3. WebGPU レンダラーを初期化
   └─ GPU デバイス取得
   └─ パイプライン構築
   └─ 初期バッファ作成（空のインスタンスバッファ含む）

4. レンダラーがストアをサブスクライブ
   └─ store.subscribe() で renderVersion 監視
   └─ store.subscribe() で selectedInstanceId 監視
   └─ store.subscribe() で cameraView 監視

5. レンダーループ開始
   └─ requestAnimationFrame(renderLoop)
```

### コード例

```typescript
// main.ts

import { useAppStore } from './store';
import { createVoxelGrid } from './voxelGridSingleton';
import { Renderer } from './renderer/Renderer';

async function main(): Promise<void> {
  // 1. ストアは import 時に自動生成される（Zustand の create()）
  const store = useAppStore;
  const { container } = store.getState();

  // 2. VoxelGrid 生成
  createVoxelGrid(container);

  // 3. レンダラー初期化（非同期: WebGPU デバイス取得を含む）
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  await renderer.init();

  // 4. サブスクリプション設定（renderer.init() 内で実行）

  // 5. レンダーループ開始
  renderer.startRenderLoop();
}

main().catch(console.error);
```

### エラーハンドリング

WebGPU が利用できない環境では、初期化ステップ 3 で早期にエラーをスローし、フォールバック UI（非対応ブラウザ向けメッセージ）を表示する。

```typescript
if (!navigator.gpu) {
  showFallbackMessage('このアプリケーションには WebGPU 対応ブラウザが必要です。');
  return;
}
```
