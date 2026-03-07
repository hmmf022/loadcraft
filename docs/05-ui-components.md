# 05 - UI コンポーネント設計

## 概要

本ドキュメントでは、コンテナ積載シミュレータの UI コンポーネント構成を定義する。フレームワークとして React（TypeScript）を採用し、ビルドツールに Vite、状態管理に Zustand を使用する。3D レンダリングには WebGPU Canvas を利用し、サイドバーとキャンバスエリアを CSS Grid で配置するレイアウトを基本構成とする。

---

## 1. レイアウト構成

### 全体レイアウト

CSS Grid を用いて、サイドバーとキャンバスエリアの 2 カラムレイアウトを構成する。

```
+------------------+-----------------------------------+
|                  |                                   |
|    Sidebar       |         Canvas Area               |
|    (300px)       |         (flex: 1)                 |
|                  |                                   |
|  - Container     |    +-------------------------+    |
|    Selector      |    |                         |    |
|  - Cargo Editor  |    |    WebGPU Canvas        |    |
|  - Cargo List    |    |                         |    |
|  - Placement     |    |                         |    |
|    Controls      |    +-------------------------+    |
|  - Stats Panel   |    [Front][Side][Top][Iso]         |
|                  |    [Undo][Redo]                    |
+------------------+-----------------------------------+
```

### CSS Grid 設定

```css
.app-layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  grid-template-rows: 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
```

| 領域 | グリッド定義 | 説明 |
|------|-------------|------|
| Sidebar | `300px`（固定幅） | スクロール可能な操作パネル群を格納する |
| Canvas Area | `1fr`（残りの領域を占有） | WebGPU Canvas とビューボタン、ツールバーを配置する |

### レスポンシブ対応

- ブレークポイント: `768px`
- 小画面ではサイドバーを折りたたみ、トグルボタンで表示/非表示を切り替える
- サイドバーは折りたたみ時にオーバーレイとして表示する

```css
@media (max-width: 768px) {
  .app-layout {
    grid-template-columns: 1fr;
  }

  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }

  .sidebar.open {
    transform: translateX(0);
  }
}
```

### サイドバーの内部構成

サイドバーは縦方向にスクロール可能とし、以下のセクションを上から順に配置する。

1. **ContainerSelector** -- コンテナ種別の選択
2. **CargoEditor** -- 貨物定義の作成
3. **CargoList** -- 定義済み貨物の一覧
4. **PlacementControls** -- 選択中の配置貨物の操作
5. **StatsPanel** -- 積載統計の表示

各セクションはヘッダーとディバイダーで区切る。

---

## 2. App コンポーネント

ルートコンポーネントとして、全体のレイアウトを構成し、グローバルなキーボードショートカットとエラーハンドリングを担当する。

### インターフェース

```typescript
interface AppProps {} // Props は受け取らない

// State: なし（Zustand ストアを直接使用する）
// Children: Sidebar, CanvasPanel, ToolBar, ViewButtons
```

### コンポーネント構造

```typescript
const App: React.FC = () => {
  // グローバルキーボードショートカットの登録
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        useStore.getState().undo();
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
      if (e.key === 'Delete') {
        const selected = useStore.getState().selectedInstanceId;
        if (selected) {
          useStore.getState().removePlacement(selected);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ErrorBoundary fallback={<WebGPUFallback />}>
      <div className="app-layout">
        <Sidebar />
        <div className="canvas-area">
          <CanvasPanel />
          <ViewButtons />
          <ToolBar />
        </div>
      </div>
    </ErrorBoundary>
  );
};
```

### 責務

| 項目 | 説明 |
|------|------|
| キーボードショートカット | `Ctrl+Z`（Undo）、`Ctrl+Y`（Redo）、`Delete`（選択中の貨物を削除）をグローバルに処理する |
| エラーバウンダリ | WebGPU の初期化失敗やレンダリングエラーをキャッチし、フォールバック UI を表示する |
| レイアウト管理 | CSS Grid による Sidebar と Canvas Area の配置を定義する |

### WebGPU フォールバック

WebGPU が利用できない環境では、`WebGPUFallback` コンポーネントを表示する。ブラウザの対応状況や、有効化手順を案内するメッセージを含める。

---

## 3. CanvasPanel コンポーネント

WebGPU Canvas の管理を行うコンポーネント。キャンバスの初期化、リサイズ処理、マウスイベントの転送、ドラッグ&ドロップの受け取りを担当する。

### インターフェース

```typescript
interface CanvasPanelProps {}
```

### 実装方針

```typescript
const CanvasPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // WebGPU Renderer の初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initRenderer = async () => {
      const renderer = new Renderer(canvas);
      await renderer.initialize();
      rendererRef.current = renderer;
    };
    initRenderer();

    return () => {
      // アンマウント時にレンダラーをクリーンアップする
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ResizeObserver によるキャンバスリサイズ処理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = width * devicePixelRatio;
        canvas.height = height * devicePixelRatio;
        rendererRef.current?.resize(canvas.width, canvas.height);
      }
    });
    observer.observe(canvas);

    return () => observer.disconnect();
  }, []);

  // マウスイベントのハンドリング
  const handleMouseDown = (e: React.MouseEvent) => { /* CameraController へ転送 */ };
  const handleMouseMove = (e: React.MouseEvent) => { /* CameraController へ転送 */ };
  const handleMouseUp = (e: React.MouseEvent) => { /* CameraController へ転送 */ };

  // ドラッグ&ドロップのハンドリング
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const cargoDefId = e.dataTransfer.getData('application/x-cargo-def-id');
    if (cargoDefId) {
      // ドロップ位置をキャンバス座標に変換し、配置処理を呼び出す
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // レンダラーを通じてワールド座標を取得し、ストアに配置を追加する
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="webgpu-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    />
  );
};
```

### 責務一覧

| 項目 | 説明 |
|------|------|
| Canvas 参照管理 | `useRef` で canvas 要素を保持する |
| Renderer 初期化 | `useEffect` でマウント時に WebGPU Renderer を初期化する |
| リサイズ対応 | `ResizeObserver` でキャンバスサイズの変化を検知し、レンダラーに通知する |
| クリーンアップ | アンマウント時にレンダラーの `dispose` を呼び出してリソースを解放する |
| マウスイベント転送 | マウスイベントを `CameraController` およびドラッグハンドラーに転送する |
| ドロップターゲット | 貨物一覧からのドラッグ&ドロップを受け付け、キャンバス上に貨物を配置する |

---

## 4. Sidebar コンポーネント

サイドバーのサブコンポーネントを格納するコンテナコンポーネント。

### 構造

```typescript
const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Container Simulator</h1>
      </div>
      <div className="sidebar-content">
        <SidebarSection title="コンテナ設定">
          <ContainerSelector />
        </SidebarSection>
        <SidebarSection title="貨物定義">
          <CargoEditor />
        </SidebarSection>
        <SidebarSection title="貨物一覧">
          <CargoList />
        </SidebarSection>
        <SidebarSection title="配置操作">
          <PlacementControls />
        </SidebarSection>
        <SidebarSection title="積載統計">
          <StatsPanel />
        </SidebarSection>
      </div>
    </aside>
  );
};
```

### スタイル

```css
.sidebar {
  background-color: #1e1e2e;
  color: #cdd6f4;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #313244;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
```

### 設計方針

- 縦方向にスクロール可能なレイアウトとする
- 各セクションはヘッダー（タイトル）とディバイダー（区切り線）で分離する
- `SidebarSection` は折りたたみ可能な共通ラッパーコンポーネントとする

---

## 5. ContainerSelector コンポーネント

コンテナ種別を選択するコンポーネント。プリセットからの選択とカスタムサイズの入力に対応する。

### インターフェース

```typescript
interface ContainerSelectorProps {}
// 使用するストア: container, setContainer
```

### プリセット定義

| プリセット名 | 内寸 幅 (mm) | 内寸 高さ (mm) | 内寸 奥行 (mm) | 最大積載量 (kg) |
|-------------|-------------|---------------|---------------|----------------|
| 20ft Standard | 2,352 | 2,393 | 5,898 | 21,727 |
| 40ft Standard | 2,352 | 2,393 | 12,032 | 26,680 |
| 40ft High Cube | 2,352 | 2,698 | 12,032 | 26,460 |
| Custom | ユーザー入力 | ユーザー入力 | ユーザー入力 | ユーザー入力 |

### 実装方針

```typescript
const CONTAINER_PRESETS = [
  { label: '20ft Standard', width: 2352, height: 2393, depth: 5898, maxPayload: 21727 },
  { label: '40ft Standard', width: 2352, height: 2393, depth: 12032, maxPayload: 26680 },
  { label: '40ft High Cube', width: 2352, height: 2698, depth: 12032, maxPayload: 26460 },
] as const;

const ContainerSelector: React.FC = () => {
  const { container, setContainer } = useStore();
  const [preset, setPreset] = useState<string>('20ft Standard');
  const [isCustom, setIsCustom] = useState(false);

  const handlePresetChange = (value: string) => {
    if (value === 'custom') {
      setIsCustom(true);
      return;
    }
    setIsCustom(false);
    const selected = CONTAINER_PRESETS.find((p) => p.label === value);
    if (selected) {
      confirmAndSetContainer(selected);
    }
  };

  const confirmAndSetContainer = (containerDef: ContainerDef) => {
    // 配置済み貨物が存在する場合は確認ダイアログを表示する
    const placements = useStore.getState().placements;
    if (placements.length > 0) {
      if (!confirm('コンテナを変更すると、すべての配置がクリアされます。続行しますか？')) {
        return;
      }
    }
    setContainer(containerDef);
  };

  return (
    <div className="container-selector">
      <select value={isCustom ? 'custom' : preset} onChange={(e) => handlePresetChange(e.target.value)}>
        {CONTAINER_PRESETS.map((p) => (
          <option key={p.label} value={p.label}>{p.label}</option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {isCustom && <CustomContainerForm onSubmit={confirmAndSetContainer} />}
    </div>
  );
};
```

### カスタム入力フォーム

「Custom」が選択された場合に表示される入力フォーム。

| フィールド | 型 | 単位 | バリデーション |
|-----------|-----|------|--------------|
| width | number | mm | 最小: 1, 最大: 99999 |
| height | number | mm | 最小: 1, 最大: 99999 |
| depth | number | mm | 最小: 1, 最大: 99999 |
| maxPayload | number | kg | 最小: 1, 最大: 99999 |

### 注意事項

- コンテナ変更時に既存の配置がすべてクリアされることをユーザーに警告する
- 確認ダイアログで「キャンセル」を選択した場合は変更を取り消す

---

## 6. CargoEditor コンポーネント

貨物定義を作成するためのフォームコンポーネント。新規作成モードと編集モードの両方に対応する。

### インターフェース

```typescript
interface CargoEditorProps {}
// 使用するストア: addCargoDef
```

### フォームフィールド

| フィールド | 型 | 単位 | バリデーション | 説明 |
|-----------|-----|------|--------------|------|
| name | text | - | 必須、1文字以上 | 貨物の名前 |
| width | number | cm | 必須、> 0、コンテナ内寸以下 | 幅 |
| height | number | cm | 必須、> 0、コンテナ内寸以下 | 高さ |
| depth | number | cm | 必須、> 0、コンテナ内寸以下 | 奥行 |
| weight | number | kg | 必須、> 0 | 重量 |
| color | color | - | 有効なカラーコード | 3D 表示時の色 |

### 実装方針

```typescript
const CargoEditor: React.FC = () => {
  const addCargoDef = useStore((s) => s.addCargoDef);
  const container = useStore((s) => s.container);

  const [form, setForm] = useState({
    name: '',
    width: 0,
    height: 0,
    depth: 0,
    weight: 0,
    color: '#4a90d9',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = '名前を入力してください';
    if (form.width <= 0) newErrors.width = '幅は 0 より大きい値を入力してください';
    if (form.height <= 0) newErrors.height = '高さは 0 より大きい値を入力してください';
    if (form.depth <= 0) newErrors.depth = '奥行は 0 より大きい値を入力してください';
    if (form.weight <= 0) newErrors.weight = '重量は 0 より大きい値を入力してください';
    // コンテナ内寸との比較（cm → mm 変換）
    if (form.width * 10 > container.width) newErrors.width = 'コンテナの幅を超えています';
    if (form.height * 10 > container.height) newErrors.height = 'コンテナの高さを超えています';
    if (form.depth * 10 > container.depth) newErrors.depth = 'コンテナの奥行を超えています';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    addCargoDef({ ...form, id: crypto.randomUUID() });
    // フォームをリセットする
    setForm({ name: '', width: 0, height: 0, depth: 0, weight: 0, color: '#4a90d9' });
  };

  return (
    <div className="cargo-editor">
      {/* 各入力フィールドを配置する */}
      <button onClick={handleSubmit}>追加</button>
      <ImportButton />
    </div>
  );
};
```

### インポート機能

「インポート」ボタンにより、CSV または JSON ファイルから貨物定義を一括読み込みできる。

#### CSV フォーマット

```csv
name,width,height,depth,weight,color
段ボール箱A,60,40,40,15,#4a90d9
パレット,120,15,100,25,#8b5e3c
```

#### JSON フォーマット

```json
[
  {
    "name": "段ボール箱A",
    "width": 60,
    "height": 40,
    "depth": 40,
    "weight": 15,
    "color": "#4a90d9"
  }
]
```

#### インポート処理フロー

1. ファイルピッカーダイアログを表示する（accept: `.csv, .json`）
2. ファイルの拡張子に基づいてパーサーを選択する
3. 各行/エントリをバリデーションする
4. 有効なエントリをストアに追加する
5. エラーがある場合はスキップした行数を通知する

---

## 7. CargoList コンポーネント

定義済みの貨物種別を一覧表示するコンポーネント。各項目はドラッグソースとして機能し、キャンバスへのドラッグ&ドロップによる配置を可能にする。

### インターフェース

```typescript
interface CargoListProps {}
// 使用するストア: cargoDefs, removeCargoDef
```

### 一覧項目の構成

各項目は以下の情報を表示する。

```
+--------------------------------------------------+
| [■] 段ボール箱A          60×40×40 cm   15 kg     |
|                                    [Edit] [Delete]|
+--------------------------------------------------+
```

| 要素 | 説明 |
|------|------|
| カラースウォッチ | 貨物定義に設定された色を小さな四角形で表示する |
| 名前 | 貨物の名前 |
| 寸法 | `W×H×D cm` 形式で幅、高さ、奥行を表示する |
| 重量 | `kg` 単位で表示する |
| 編集ボタン | クリックで CargoEditor を編集モードに切り替える |
| 削除ボタン | 確認後に貨物定義を削除する |

### ドラッグ&ドロップ（ドラッグソース）

HTML5 Drag API を使用して、貨物一覧の各項目をドラッグソースとする。

```typescript
const handleDragStart = (e: React.DragEvent, cargoDefId: string) => {
  e.dataTransfer.setData('application/x-cargo-def-id', cargoDefId);
  e.dataTransfer.effectAllowed = 'copy';
  // オプション: ドラッグイメージを設定する
};
```

### 空状態

貨物定義が存在しない場合は、以下のメッセージを表示する。

```
貨物が定義されていません。
上のフォームから貨物を追加するか、CSV/JSON ファイルをインポートしてください。
```

### 削除時の確認

削除ボタンがクリックされた場合、以下の条件を確認する。

- 当該貨物定義が配置済みの場合は、配置も同時に削除されることを警告する
- 確認ダイアログで「キャンセル」が選択された場合は削除を取り消す

---

## 8. PlacementControls コンポーネント

3D ビューで選択された配置済み貨物の操作を行うコンポーネント。貨物が選択されていない場合は非表示となる。

### インターフェース

```typescript
interface PlacementControlsProps {}
// 使用するストア: selectedInstanceId, placements, rotateCargo, removePlacement
```

### 表示条件

`selectedInstanceId` が `null` でない場合にのみ表示する。選択なしの場合は「貨物を選択してください」というメッセージを表示する。

### 表示内容と操作

```
+--------------------------------------------------+
| 選択中: 段ボール箱A                               |
+--------------------------------------------------+
| 位置                                              |
|   X: [  120 ] mm                                  |
|   Y: [    0 ] mm                                  |
|   Z: [  300 ] mm                                  |
+--------------------------------------------------+
| 回転                                              |
|   RX: [   0 ] °                                   |
|   RY: [  90 ] °                                   |
|   RZ: [   0 ] °                                   |
+--------------------------------------------------+
|              [削除]  [選択解除]                     |
+--------------------------------------------------+
```

| フィールド | 型 | 編集可否 | 説明 |
|-----------|-----|---------|------|
| 貨物名 | text | 読み取り専用 | 配置された貨物の定義名を表示する |
| 位置 X | number (mm) | 読み取り専用または編集可 | X 座標 |
| 位置 Y | number (mm) | 読み取り専用または編集可 | Y 座標 |
| 位置 Z | number (mm) | 読み取り専用または編集可 | Z 座標 |
| 回転 RX | number (度) | 編集可 | X 軸回りの回転角度 |
| 回転 RY | number (度) | 編集可 | Y 軸回りの回転角度 |
| 回転 RZ | number (度) | 編集可 | Z 軸回りの回転角度 |

### 操作ボタン

| ボタン | 動作 |
|--------|------|
| 削除 | 選択中の配置を削除し、選択状態を解除する |
| 選択解除 | 選択状態のみを解除する（配置はそのまま残る） |

### 回転入力の処理

```typescript
const handleRotationChange = (axis: 'rx' | 'ry' | 'rz', degrees: number) => {
  // 0-360 の範囲にクランプする
  const clamped = ((degrees % 360) + 360) % 360;
  rotateCargo(selectedInstanceId, { [axis]: clamped });
};
```

---

## 9. StatsPanel コンポーネント

積載に関する統計情報を表示するコンポーネント。重量、重心位置、容積充填率などをリアルタイムで表示する。

### インターフェース

```typescript
interface StatsPanelProps {}
// 使用するストア: weightResult, container
```

### 表示項目

#### 重量情報

```
総重量: 12,450 kg / 21,727 kg
[████████████░░░░░░░░] 57.3%
```

- プログレスバーで現在重量と最大積載量の比率を視覚的に表示する
- 80% 以上で黄色、100% 超過で赤色に変化する

#### 過積載警告

最大積載量を超過した場合、赤色の警告インジケータを表示する。

```
⚠ 過積載警告: 最大積載量を 1,230 kg 超過しています
```

#### 重心位置

```
重心位置:
  X: 2,340 mm
  Y:   580 mm
  Z: 1,120 mm
```

#### 容積充填率

```
容積充填率: 68.5%
[█████████████░░░░░░░] 68.5%
```

- コンテナ内寸の総容積に対する、配置済み貨物の総容積の割合を表示する

#### 配置数

```
配置済みアイテム: 24 個
```

### 実装方針

```typescript
const StatsPanel: React.FC = () => {
  const weightResult = useStore((s) => s.weightResult);
  const container = useStore((s) => s.container);
  const placements = useStore((s) => s.placements);

  const totalWeight = weightResult.totalWeight;
  const maxPayload = container.maxPayload;
  const weightRatio = totalWeight / maxPayload;
  const isOverweight = weightRatio > 1.0;

  const containerVolume = container.width * container.height * container.depth;
  const cargoVolume = placements.reduce((sum, p) => {
    return sum + p.width * p.height * p.depth;
  }, 0);
  const volumeRatio = cargoVolume / containerVolume;

  return (
    <div className="stats-panel">
      <StatBar label="総重量" value={totalWeight} max={maxPayload} unit="kg" warn={isOverweight} />
      {isOverweight && <OverweightWarning excess={totalWeight - maxPayload} />}
      <GravityCenter position={weightResult.centerOfGravity} />
      <StatBar label="容積充填率" value={volumeRatio * 100} max={100} unit="%" />
      <div className="stat-item">配置済みアイテム: {placements.length} 個</div>
    </div>
  );
};
```

### StatBar サブコンポーネント

```typescript
interface StatBarProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  warn?: boolean;
}
```

プログレスバーの色は以下のルールで決定する。

| 充填率 | 色 |
|--------|-----|
| 0 - 79% | 緑 (`#a6e3a1`) |
| 80 - 99% | 黄 (`#f9e2af`) |
| 100% 以上 | 赤 (`#f38ba8`) |

---

## 10. ViewButtons コンポーネント

カメラのビュープリセットを切り替えるボタン群。キャンバスエリアの下部に配置する。

### インターフェース

```typescript
interface ViewButtonsProps {}
// 使用するストア: setCameraView
```

### ビュープリセット

| ボタン | 識別子 | 説明 |
|--------|--------|------|
| Front | `front` | 正面ビュー（Z 軸正方向から見る） |
| Back | `back` | 背面ビュー（Z 軸負方向から見る） |
| Left | `left` | 左側面ビュー（X 軸負方向から見る） |
| Right | `right` | 右側面ビュー（X 軸正方向から見る） |
| Top | `top` | 上面ビュー（Y 軸正方向から見下ろす） |
| Isometric | `isometric` | アイソメトリックビュー（斜め上方から見る） |

### 実装方針

```typescript
type CameraViewType = 'front' | 'back' | 'left' | 'right' | 'top' | 'isometric';

const VIEW_OPTIONS: { label: string; value: CameraViewType }[] = [
  { label: 'Front', value: 'front' },
  { label: 'Back', value: 'back' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
  { label: 'Top', value: 'top' },
  { label: 'Iso', value: 'isometric' },
];

const ViewButtons: React.FC = () => {
  const setCameraView = useStore((s) => s.setCameraView);
  const currentView = useStore((s) => s.cameraView);

  return (
    <div className="view-buttons">
      {VIEW_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`view-btn ${currentView === opt.value ? 'active' : ''}`}
          onClick={() => setCameraView(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};
```

### スタイル

- ボタン群は水平方向に並べて配置する
- 現在アクティブなビューのボタンはハイライト表示する（背景色を変更する）
- キャンバスエリアの直下に配置する

```css
.view-buttons {
  display: flex;
  gap: 4px;
  padding: 8px;
  justify-content: center;
}

.view-btn {
  padding: 6px 12px;
  border: 1px solid #45475a;
  background: #313244;
  color: #cdd6f4;
  border-radius: 4px;
  cursor: pointer;
}

.view-btn.active {
  background: #585b70;
  border-color: #89b4fa;
  color: #89b4fa;
}
```

---

## 11. ToolBar コンポーネント

Undo/Redo、保存/読み込み、グリッドおよびスナップのトグルといった共通操作を提供するツールバー。

### インターフェース

```typescript
interface ToolBarProps {}
// 使用するストア: undo, redo, canUndo, canRedo, saveState, loadState
```

### ボタン一覧

| ボタン | アクション | 無効化条件 | 説明 |
|--------|-----------|-----------|------|
| Undo | `undo()` | `canUndo === false` | 直前の操作を取り消す |
| Redo | `redo()` | `canRedo === false` | 取り消した操作をやり直す |
| Save | `saveState()` | なし | 現在の状態を JSON ファイルとしてダウンロードする |
| Load | `loadState()` | なし | JSON ファイルを読み込んで状態を復元する |
| Grid | `toggleGrid()` | なし | グリッド表示の ON/OFF を切り替える |
| Snap | `toggleSnap()` | なし | スナップ機能の ON/OFF を切り替える |

### 実装方針

```typescript
const ToolBar: React.FC = () => {
  const { undo, redo, canUndo, canRedo } = useStore();
  const gridEnabled = useStore((s) => s.gridEnabled);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleSnap = useStore((s) => s.toggleSnap);

  const handleSave = () => {
    const state = useStore.getState().serializeState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `container-simulation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const state = JSON.parse(text);
        useStore.getState().loadState(state);
      } catch {
        alert('無効なファイル形式です。');
      }
    };
    input.click();
  };

  return (
    <div className="toolbar">
      <button onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
        Undo
      </button>
      <button onClick={redo} disabled={!canRedo} title="やり直す (Ctrl+Y)">
        Redo
      </button>
      <div className="toolbar-separator" />
      <button onClick={handleSave} title="保存">Save</button>
      <button onClick={handleLoad} title="読み込み">Load</button>
      <div className="toolbar-separator" />
      <button
        onClick={toggleGrid}
        className={gridEnabled ? 'active' : ''}
        title="グリッド表示"
      >
        Grid
      </button>
      <button
        onClick={toggleSnap}
        className={snapEnabled ? 'active' : ''}
        title="スナップ"
      >
        Snap
      </button>
    </div>
  );
};
```

### Save / Load の仕様

#### 保存（Save）

- `serializeState()` でストアの状態をシリアライズする
- JSON ファイルとしてブラウザからダウンロードする
- ファイル名: `container-simulation-{timestamp}.json`

#### 読み込み（Load）

- ファイルピッカーで `.json` ファイルを選択する
- ファイル内容をパースし、`loadState()` で状態を復元する
- 不正なファイル形式の場合はエラーメッセージを表示する

---

## 12. スタイリング方針

### 技術選択

- **CSS Modules** を基本とし、コンポーネント単位でスコープを分離する
- 必要に応じてインラインスタイルを使用する（動的な値の適用時）
- 外部 CSS フレームワークへの依存は最小限に抑える

### カラースキーム

ダークテーマを基調とし、サイドバーは暗色、キャンバス背景は明色とする。

| 用途 | カラーコード | 説明 |
|------|-------------|------|
| サイドバー背景 | `#1e1e2e` | ダークネイビー |
| サイドバーテキスト | `#cdd6f4` | ライトグレー |
| サイドバーボーダー | `#313244` | ダークグレー |
| キャンバス背景 | `#f5f5f5` | ライトグレー |
| アクセントカラー | `#89b4fa` | ブルー（アクティブ状態、リンク） |
| 警告色 | `#f38ba8` | レッド（エラー、過積載警告） |
| 注意色 | `#f9e2af` | イエロー（警告レベル） |
| 成功色 | `#a6e3a1` | グリーン（正常範囲） |
| ボタン背景 | `#313244` | ダークグレー |
| ボタンホバー | `#45475a` | ミディアムグレー |
| ボタンアクティブ | `#585b70` | ライトダークグレー |

### タイポグラフィ

| 要素 | フォントサイズ | フォントウェイト |
|------|-------------|----------------|
| セクションヘッダー | `14px` | `600` (semibold) |
| 本文テキスト | `13px` | `400` (normal) |
| ラベル | `12px` | `500` (medium) |
| 統計値 | `16px` | `700` (bold) |
| 入力フィールド | `13px` | `400` (normal) |

### スペーシング

| 用途 | 値 |
|------|-----|
| セクション間マージン | `16px` |
| セクション内パディング | `12px` |
| フォーム要素間ギャップ | `8px` |
| ボタン内パディング | `6px 12px` |
| ボタン間ギャップ | `4px` |

### レスポンシブ対応

| ブレークポイント | 挙動 |
|----------------|------|
| `> 768px` | サイドバー固定表示、2 カラムレイアウト |
| `<= 768px` | サイドバー折りたたみ、トグルボタンで表示切替、キャンバスが全幅 |

### CSS Modules の命名規則

- ファイル名: `ComponentName.module.css`
- クラス名: キャメルケース（例: `sidebarHeader`, `statBar`, `viewBtn`）

```
src/
  components/
    App.tsx
    App.module.css
    CanvasPanel.tsx
    CanvasPanel.module.css
    Sidebar.tsx
    Sidebar.module.css
    ContainerSelector.tsx
    ContainerSelector.module.css
    CargoEditor.tsx
    CargoEditor.module.css
    CargoList.tsx
    CargoList.module.css
    PlacementControls.tsx
    PlacementControls.module.css
    StatsPanel.tsx
    StatsPanel.module.css
    ViewButtons.tsx
    ViewButtons.module.css
    ToolBar.tsx
    ToolBar.module.css
```

---

## コンポーネント依存関係図

```
App
├── Sidebar
│   ├── ContainerSelector
│   ├── CargoEditor
│   │   └── ImportButton
│   ├── CargoList
│   │   └── CargoListItem (× N)
│   ├── StagingPanel          # ステージングエリア（配置予定アイテム管理）
│   ├── PlacementControls
│   └── StatsPanel
│       └── StatBar (× N)
├── CanvasPanel
├── ViewButtons
├── ToolBar
├── Toast                     # 通知トースト（操作結果フィードバック）
└── HelpOverlay               # ヘルプオーバーレイ（キーバインド一覧等）
```

すべてのコンポーネントは Zustand ストアを介して状態を共有し、props のバケツリレーを最小限に抑える。各コンポーネントは必要なストアスライスのみを `useStore` のセレクタで購読し、不要な再レンダリングを防止する。
