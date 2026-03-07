# データ構造設計書

コンテナ積載シミュレータにおける座標系、型定義、VoxelGrid メモリレイアウト、およびオブジェクト管理の設計を定義する。

ボクセルグリッド解像度は **1cm** とし、1 ボクセル = 1cm³ に対応する。

---

## 1. 座標系定義

本シミュレータでは右手座標系を採用する。原点はコンテナ内部の **左・下・手前** の角に置く。

| 軸 | 方向 | 意味 |
|----|------|------|
| **X** | 左 → 右 | 幅 (width) |
| **Y** | 下 → 上 | 高さ (height) |
| **Z** | 手前 → 奥 | 奥行き (depth) |

- 単位: センチメートル (cm)
- 1 ボクセル = 1cm x 1cm x 1cm = 1cm³

```
        Y (高さ)
        ^
        |
        |
        |
        +-----------> X (幅)
       /
      /
     v
    Z (奥行き)

    原点 = コンテナ内部の左・下・手前の角

    コンテナ内部を手前から見た図:

         +--------------------+
        /|                   /|
       / |                  / |
      /  |                 /  |
     +--------------------+   |
     |   |                |   |
     |   |   コンテナ内部  |   |
     |   |                |   |
     |   +----------------|---+
     |  /                 |  /
     | /                  | /
     |/                   |/
     +--------------------+
   原点(0,0,0)           (W,0,0)
   左・下・手前
```

---

## 2. 基本型定義

シミュレータで使用する全ての TypeScript 型・インターフェース定義を以下に示す。

### 2.1 数学型

```typescript
// --- Math types ---

/** 3次元ベクトル */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 4x4 行列 (列優先) */
interface Mat4 {
  data: Float32Array;    // 16 要素、列優先 (column-major)
}
```

### 2.2 コンテナ定義

```typescript
// --- Container ---

/** コンテナプリセット (テンプレート) */
interface ContainerPreset {
  name: string;          // 例: "20ft Standard"
  widthCm: number;       // 内寸幅 (cm)
  heightCm: number;      // 内寸高さ (cm)
  depthCm: number;       // 内寸奥行き (cm)
  maxPayloadKg: number;  // 最大積載重量 (kg)
}

/** コンテナ定義 (シーン内で使用) */
interface ContainerDef {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  maxPayloadKg: number;
}
```

### 2.3 貨物定義

```typescript
// --- Cargo Definition (template) ---

/** 貨物アイテム定義 (テンプレート) */
interface CargoItemDef {
  id: string;            // UUID
  name: string;          // 貨物名
  widthCm: number;       // 回転前の幅 (cm) — 複合形状の場合は AABB 自動計算
  heightCm: number;      // 回転前の高さ (cm)
  depthCm: number;       // 回転前の奥行き (cm)
  weightKg: number;      // 重量 (kg)
  color: string;         // 16進カラー 例: "#FF6B35"
  blocks?: ShapeBlock[]; // undefined = 従来の直方体 (後方互換)
  noFlip?: boolean;      // Y軸回転のみ許可（天地固定）
  noStack?: boolean;     // スタック禁止 (maxStackWeightKg=0 の糖衣)
  maxStackWeightKg?: number; // 上面最大積載重量 (kg). undefined=無制限
}
```

### 2.4 配置済み貨物

```typescript
// --- Placed Cargo (instance in container) ---

/** 配置済み貨物 (コンテナ内のインスタンス) */
interface PlacedCargo {
  instanceId: number;    // VoxelGrid 内の一意ID (1-65534)
  cargoDefId: string;    // CargoItemDef.id への参照
  positionCm: Vec3;      // 配置位置 (AABB の左・下・手前の角)
  rotationDeg: Vec3;     // オイラー角 (度単位: rx, ry, rz)
}
```

### 2.5 ステージング・自動配置

```typescript
// --- Staging ---

/** ステージングエリアのアイテム */
interface StagedItem {
  cargoDefId: string;    // 対応する CargoItemDef.id
  count: number;         // 配置予定数
}

/** 自動配置モード */
type AutoPackMode = 'repack' | 'packStaged';
```

### 2.6 シェイプブロック

```typescript
// --- Shape Block (composite cargo) ---

/** 複合形状を構成する矩形ブロック */
interface ShapeBlock {
  x: number; y: number; z: number;  // cm (形状原点からのオフセット)
  w: number; h: number; d: number;  // cm (ブロック寸法)
  color: string;                     // "#RRGGBB"
}
```

### 2.7 配置状態 (シーン全体)

```typescript
// --- Placement State (complete scene) ---

/** 配置状態 (シーン全体を表す) */
interface PlacementState {
  container: ContainerDef;
  cargoDefs: CargoItemDef[];
  placements: PlacedCargo[];
  nextInstanceId: number;
}
```

### 2.6 重量・バランス

```typescript
// --- Weight/Balance ---

/** 重量計算結果 */
interface WeightResult {
  totalWeightKg: number;   // 総重量 (kg)
  centerOfGravity: Vec3;   // 重心位置 (原点からの cm)
  fillRatePercent: number; // 体積充填率 (%)
  overweight: boolean;     // 過積載フラグ
}
```

### 2.7 支持判定

```typescript
// --- Gravity Check ---

/** 支持判定結果 */
interface SupportResult {
  supported: boolean;      // 支持されているか
  supportRatio: number;    // 支持率 (0.0-1.0)
}
```

---

## 3. VoxelGrid メモリレイアウト

VoxelGrid はコンテナ内部空間を 1cm 解像度で離散化した 3 次元グリッドであり、フラットな `Uint16Array` として実装する。

### 3.1 配列の生成

```typescript
const grid = new Uint16Array(widthCm * heightCm * depthCm);
```

### 3.2 インデックス計算式

3 次元座標 `(x, y, z)` からフラット配列のインデックスを以下の式で求める。

```
index = x + widthCm * (y + heightCm * z)
```

ループ展開の観点では、Z が最外ループ、Y が中間ループ、X が最内ループとなる。

```typescript
for (let z = 0; z < depthCm; z++) {
  for (let y = 0; y < heightCm; y++) {
    for (let x = 0; x < widthCm; x++) {
      const index = x + widthCm * (y + heightCm * z);
      // grid[index] にアクセス
    }
  }
}
```

X 軸が最も速く変化するため、X 方向のスキャンにおいてメモリアクセスが連続的になり、CPU キャッシュに優しいレイアウトとなる。

### 3.3 値のセマンティクス

| 値 | 意味 |
|----|------|
| `0` | 空 (未占有) |
| `1` - `65534` | 貨物インスタンス ID |
| `65535` (`0xFFFF`) | 予約済み (将来の用途、例: コンテナ壁面) |

---

## 4. オブジェクトID管理

VoxelGrid に書き込まれるインスタンス ID は `uint16` 型の値で、1 から 65534 の範囲を使用する。

### 4.1 ID 割り当てルール

- `nextInstanceId` カウンタを `1` から開始し、貨物を配置するたびにインクリメントする。
- 貨物を削除しても ID は **再利用しない** (実装の単純化のため)。
- 最大 65,533 回の配置が可能であり、実運用上は十分な回数である。

### 4.2 オーバーフロー処理

```typescript
if (nextInstanceId > 65534) {
  throw new Error('インスタンスIDの上限に達しました (最大65534)');
}
```

カウンタが 65534 を超えた場合はエラーとする。実際の運用では到達することは極めて考えにくい。

---

## 5. コンテナプリセット

標準的なコンテナサイズをプリセットとして定義する。寸法はコンテナの内寸である。

```typescript
const CONTAINER_PRESETS: ContainerPreset[] = [
  {
    name: '20ft Standard',
    widthCm: 590,
    heightCm: 239,
    depthCm: 235,
    maxPayloadKg: 28200,
  },
  {
    name: '40ft Standard',
    widthCm: 1203,
    heightCm: 239,
    depthCm: 235,
    maxPayloadKg: 26680,
  },
  {
    name: '40ft High Cube',
    widthCm: 1203,
    heightCm: 269,
    depthCm: 235,
    maxPayloadKg: 26460,
  },
];
```

| プリセット | 幅 (cm) | 高さ (cm) | 奥行き (cm) | 最大積載量 (kg) |
|-----------|---------|-----------|-------------|----------------|
| 20ft Standard | 590 | 239 | 235 | 28,200 |
| 40ft Standard | 1,203 | 239 | 235 | 26,680 |
| 40ft High Cube | 1,203 | 269 | 235 | 26,460 |

---

## 6. メモリ使用量見積もり

VoxelGrid (`Uint16Array`) のメモリ使用量を各コンテナタイプごとに見積もる。

| コンテナ | ボクセル数 (W x H x D) | ボクセル数 (合計) | バイト数 (x2) | メモリ使用量 |
|---------|----------------------|-----------------|--------------|-------------|
| 20ft Standard | 590 x 239 x 235 | 33,130,150 | 66,260,300 | 約 63.2 MB |
| 40ft Standard | 1,203 x 239 x 235 | 67,526,055 | 135,052,110 | 約 128.8 MB |
| 40ft High Cube | 1,203 x 269 x 235 | 76,031,595 | 152,063,190 | 約 145.0 MB |

### 補足事項

- 上記は `Uint16Array` 本体のみのメモリ使用量である。各配置データ (`PlacedCargo`) の追加メモリは無視できる程度に小さい。
- 現代のブラウザタブのメモリ上限は一般的に 2-4 GB であり、最大の 40ft High Cube でも約 145 MB に収まるため十分に範囲内である。
- 回転処理にはハイブリッド方式を採用する。データ処理はボクセル単位で行い、レンダリングはメッシュベースで行う。

---

## 7. 型の関連図

各型の関連を以下の ASCII 図で示す。

```
  ContainerDef <─── PlacementState ───> CargoItemDef[]
                          │
                          │ placements
                          ▼
                    PlacedCargo[]
                          │
                          │ cargoDefId
                          ▼
                     CargoItemDef

                    PlacedCargo[]
                          │
                          │ position + rotation → voxelize (runtime)
                          ▼
                     VoxelGrid
                  (実行時のみ、シリアライズ対象外)
```

### 関連の説明

| 関連 | 説明 |
|------|------|
| `PlacementState.container` → `ContainerDef` | シーンが使用するコンテナの定義 |
| `PlacementState.cargoDefs` → `CargoItemDef[]` | シーン内で使用可能な貨物テンプレート一覧 |
| `PlacementState.placements` → `PlacedCargo[]` | コンテナ内に配置された貨物インスタンス一覧 |
| `PlacedCargo.cargoDefId` → `CargoItemDef.id` | 配置された貨物がどのテンプレートに基づくかの参照 |
| `PlacedCargo` → `VoxelGrid` | 配置位置と回転から VoxelGrid にボクセルが書き込まれるが、VoxelGrid 自体は `PlacementState` に含まれない (実行時に再構築可能) |

### データフロー

```
CargoItemDef (テンプレート)
       │
       │ ユーザーが貨物を配置
       ▼
PlacedCargo (インスタンス生成)
       │
       │ position + rotation からボクセル座標を算出
       ▼
VoxelGrid に instanceId を書き込み
       │
       ├──> 衝突判定 (ボクセル値が 0 でなければ衝突)
       ├──> 支持判定 (SupportResult)
       └──> 重量・重心計算 (WeightResult)
```
