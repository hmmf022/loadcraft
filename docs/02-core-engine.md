# コアエンジン設計書

> コンテナ積載シミュレータのコアエンジンに関する詳細設計ドキュメント。
> コアエンジンは React / WebGPU に一切依存せず、純粋な TypeScript ロジックとして実装する。

---

## 1. モジュール概要

### 1.1 コアエンジンの位置づけ

コアエンジンはシミュレータの**計算・状態管理層**であり、以下の原則に基づいて設計される。

- **フレームワーク非依存**: React、WebGPU、DOM など UI/レンダリング技術への依存を一切持たない
- **純粋関数+イミュータブルデータ志向**: 可能な限り副作用を局所化し、テスタビリティを最大化する
- **TypedArray ベース**: 大規模なボクセルデータは `Uint16Array` で管理し、メモリ効率とアクセス速度を確保する

### 1.2 サブモジュール構成

```
core/
├── VoxelGrid.ts          # 3Dボクセルグリッド管理
├── Voxelizer.ts          # 回転箱 → ボクセル集合変換
├── GravityChecker.ts     # 浮遊検出・支持判定
├── WeightCalculator.ts   # 重量・重心計算
├── History.ts            # Undo/Redo (Command パターン)
├── AutoPacker.ts         # 自動積載アルゴリズム
├── OccupancyMap.ts       # 2D ハイトマップ (XZ平面)
├── InterferenceChecker.ts # AABB 干渉チェック
├── StackChecker.ts       # スタック重量制約チェック
├── WallKick.ts           # SRS 風オフセット試行
├── SaveLoad.ts           # 保存・読み込み
├── ImportParser.ts       # CSV/JSON インポートパーサー
├── ShapeCompressor.ts    # ボクセル→矩形ブロック圧縮
├── ShapeParser.ts        # ShapeData バリデーション・変換
├── types.ts              # 共通型定義
└── index.ts              # パブリック API エクスポート
```

### 1.3 座標系

| 軸 | 方向 | 意味 |
|----|------|------|
| X  | 左→右 | コンテナの幅方向 (Width) |
| Y  | 下→上 | コンテナの高さ方向 (Height) |
| Z  | 手前→奥 | コンテナの奥行き方向 (Depth) |

- **原点**: コンテナの左・底面・手前の角
- **分解能**: 1cm = 1 ボクセル
- **単位**: すべてセンチメートル (cm)

### 1.4 コンテナタイプ

| タイプ | 内寸 (W x H x D) cm | ボクセル総数 |
|--------|---------------------|-------------|
| 20ft ドライコンテナ | 590 x 235 x 239 | 約 33,150,650 |
| 40ft ドライコンテナ | 1203 x 235 x 269 | 約 76,033,395 |
| カスタム | ユーザ定義 | W x H x D |

### 1.5 オブジェクト ID 体系

VoxelGrid の各セルは `uint16` 値を保持する。

| ID 値 | 意味 |
|--------|------|
| `0` | 空 (Empty) |
| `1` - `65534` | 貨物オブジェクト ID |
| `65535` (`0xFFFF`) | 予約済み (将来の拡張用) |

---

## 2. VoxelGrid クラス

### 2.1 概要

`VoxelGrid` はコンテナ内部の 3D 空間を 1cm 解像度のボクセルグリッドとして表現するクラスである。内部的に `Uint16Array` のフラットな 1 次元配列を使用し、3D 座標を線形インデックスにマッピングする。

### 2.2 インデックス変換式

3D 座標 `(x, y, z)` からフラット配列のインデックスへの変換:

```
index = x + width * (y + height * z)
```

この方式は **X が最内ループ** (X-major) のレイアウトであり、X 方向に連続するボクセルがメモリ上でも連続するため、水平方向の走査でキャッシュ効率が高い。

### 2.3 TypeScript インターフェース

```typescript
interface VoxelGridOptions {
  width: number;   // X 方向のボクセル数 (cm)
  height: number;  // Y 方向のボクセル数 (cm)
  depth: number;   // Z 方向のボクセル数 (cm)
}

interface GridStats {
  totalVoxels: number;      // グリッド全体のボクセル数 (W * H * D)
  occupiedVoxels: number;   // 占有されているボクセル数 (id !== 0)
  fillRate: number;          // 充填率 (occupiedVoxels / totalVoxels)
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
```

### 2.4 クラス定義

```typescript
class VoxelGrid {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  private data: Uint16Array;

  constructor(width: number, height: number, depth: number);

  // 基本アクセス
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, id: number): void;

  // バッチ操作
  fillBox(x0: number, y0: number, z0: number,
          x1: number, y1: number, z1: number, id: number): void;
  fillVoxels(voxels: Vec3[], id: number): void;
  clearObject(id: number): void;

  // 判定
  hasCollision(voxels: Vec3[], excludeId?: number): boolean;

  // 情報取得
  computeStats(): GridStats;

  // ユーティリティ
  isInBounds(x: number, y: number, z: number): boolean;
  clone(): VoxelGrid;
  clear(): void;
}
```

### 2.5 メソッド仕様

#### `constructor(options: VoxelGridOptions)`

**処理内容**: 指定された寸法のボクセルグリッドを初期化する。

```typescript
constructor(width: number, height: number, depth: number) {
  this.width = width;
  this.height = height;
  this.depth = depth;

  const totalSize = this.width * this.height * this.depth;
  this.data = new Uint16Array(totalSize); // 全要素 0 で初期化される
}
```

**メモリ使用量**:

| コンテナ | ボクセル数 | メモリ (Uint16Array) |
|----------|-----------|---------------------|
| 20ft | ~33.15M | ~63.2 MB |
| 40ft | ~76.03M | ~145.0 MB |

> **注意**: `Uint16Array` は要素あたり 2 バイトを使用する。40ft コンテナでも約 145 MB であり、現代のブラウザでは十分に扱える範囲である。

**計算量**: O(W * H * D) - TypedArray の確保と 0 初期化

---

#### `get(x: number, y: number, z: number): number`

**処理内容**: 指定座標のボクセル値を取得する。

**計算量**: O(1)

```typescript
get(x: number, y: number, z: number): number {
  if (!this.isInBounds(x, y, z)) {
    return 0; // 範囲外は空として扱う
  }
  return this.data[x + this.width * (y + this.height * z)];
}
```

**境界チェック**: 範囲外の座標に対しては `0` (空) を返す。例外はスローしない。これにより、ボクセル走査時に境界条件を呼び出し側で逐一確認する必要がなくなる。

---

#### `set(x: number, y: number, z: number, id: number): void`

**処理内容**: 指定座標のボクセル値を設定する。

**計算量**: O(1)

```typescript
set(x: number, y: number, z: number, id: number): void {
  if (!this.isInBounds(x, y, z)) {
    return; // 範囲外は無視
  }
  this.data[x + this.width * (y + this.height * z)] = id;
}
```

**ID 値の制約**: `id` は `0` ~ `65535` の範囲でなければならない。`Uint16Array` に格納されるため、範囲外の値は自動的にマスクされる (下位 16 ビットのみ保持)。

---

#### `fillBox(x0, y0, z0, x1, y1, z1, id): void`

**処理内容**: 軸に整列した直方体領域を指定 ID で充填する。回転のない (軸平行な) 箱の配置に使用する高速パスである。

**計算量**: O((x1-x0) * (y1-y0) * (z1-z0)) - 充填する体積に比例

```typescript
fillBox(x0: number, y0: number, z0: number,
        x1: number, y1: number, z1: number, id: number): void {
  // クランプ: グリッド範囲内に収める
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(this.width - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(this.height - 1, Math.max(y0, y1));
  const minZ = Math.max(0, Math.min(z0, z1));
  const maxZ = Math.min(this.depth - 1, Math.max(z0, z1));

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      // X 方向は連続メモリ → TypedArray.fill() で高速に一括設定
      const startIdx = minX + this.width * (y + this.height * z);
      const endIdx = maxX + this.width * (y + this.height * z);
      this.data.fill(id, startIdx, endIdx + 1);
    }
  }
}
```

**最適化ポイント**: X 方向が連続メモリレイアウトであるため、最内ループを `Uint16Array.fill()` に置き換えている。`fill()` はネイティブ実装であり、要素ごとの代入に比べて大幅に高速である。

---

#### `fillVoxels(voxels: Vec3[], id: number): void`

**処理内容**: 任意のボクセル座標集合を指定 ID で充填する。回転されたオブジェクトの配置に使用する。

**計算量**: O(N) - N はボクセルの個数

```typescript
fillVoxels(voxels: Vec3[], id: number): void {
  for (let i = 0; i < voxels.length; i++) {
    const { x, y, z } = voxels[i];
    if (this.isInBounds(x, y, z)) {
      this.data[x + this.width * (y + this.height * z)] = id;
    }
  }
}
```

---

#### `clearObject(id: number): void`

**処理内容**: 指定 ID のボクセルをすべて `0` (空) にクリアする。グリッド全体をフルスキャンする。

**計算量**: O(W * H * D) - グリッド全体を走査

```typescript
clearObject(id: number): void {
  const len = this.data.length;
  for (let i = 0; i < len; i++) {
    if (this.data[i] === id) {
      this.data[i] = 0;
    }
  }
}
```

> **パフォーマンスノート**: フルスキャンは 40ft コンテナで約 7600 万要素の走査になるが、TypedArray の単純な線形走査は CPU キャッシュフレンドリーであり、実測では数十ミリ秒程度で完了する。もし頻繁にクリアが必要な場合は、オブジェクトごとにボクセル座標リストを別途保持しておき、そのリストを用いて O(N) でクリアする戦略も有効である (History モジュールがこのリストを保持する)。

---

#### `hasCollision(voxels: Vec3[], excludeId?: number): boolean`

**処理内容**: 指定されたボクセル座標集合がグリッド上で既に占有されているセルと衝突するかを判定する。

**計算量**: O(N) - 最悪ケース。衝突を検出した時点で早期リターンする。

```typescript
hasCollision(voxels: Vec3[], excludeId?: number): boolean {
  for (let i = 0; i < voxels.length; i++) {
    const { x, y, z } = voxels[i];
    if (!this.isInBounds(x, y, z)) {
      return true; // 範囲外 = 衝突扱い
    }
    const current = this.data[x + this.width * (y + this.height * z)];
    if (current !== 0 && current !== excludeId) {
      return true;
    }
  }
  return false;
}
```

**`excludeId` パラメータ**: オブジェクトの移動時に、自分自身のボクセルとの衝突を無視するために使用する。例えば、ID=5 の貨物を移動する場合、移動先のボクセルが ID=5 で占有されていても衝突とはみなさない。

**設計方針 (衝突の扱い)**: このメソッドは衝突の**検出**のみを行い、衝突を**禁止**しない。衝突状態での配置を許可するかどうかはアプリケーション層の判断に委ねる。衝突が検出された場合、UI 層は警告を表示するが、ユーザの意思で配置を確定することができる。

---

> **注意**: 支持チェックは `GravityChecker.checkSupport()` を使用する。VoxelGrid には支持判定メソッドは含まれない。

---

#### `computeStats(): GridStats`

**処理内容**: グリッドの統計情報を計算する。

**計算量**: O(W * H * D) - グリッド全体を走査

```typescript
computeStats(): GridStats {
  const totalVoxels = this.data.length;
  let occupiedVoxels = 0;

  for (let i = 0; i < totalVoxels; i++) {
    if (this.data[i] !== 0) {
      occupiedVoxels++;
    }
  }

  return {
    totalVoxels,
    occupiedVoxels,
    fillRate: totalVoxels > 0 ? occupiedVoxels / totalVoxels : 0,
  };
}
```

---

#### `isInBounds(x: number, y: number, z: number): boolean`

**処理内容**: 座標がグリッド範囲内かを判定する。

**計算量**: O(1)

```typescript
isInBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < this.width &&
         y >= 0 && y < this.height &&
         z >= 0 && z < this.depth;
}
```

---

#### `clone(): VoxelGrid`

**処理内容**: グリッドの深いコピーを作成する。

**計算量**: O(W * H * D)

```typescript
clone(): VoxelGrid {
  const cloned = new VoxelGrid({
    width: this.width,
    height: this.height,
    depth: this.depth,
  });
  cloned.data.set(this.data); // TypedArray.set() でバルクコピー
  return cloned;
}
```

---

#### `clear(): void`

**処理内容**: グリッド全体を `0` で初期化する。

**計算量**: O(W * H * D)

```typescript
clear(): void {
  this.data.fill(0);
}
```

---

## 3. Voxelizer モジュール

### 3.1 概要

Voxelizer は、位置・回転を持つ直方体 (貨物) を、VoxelGrid 上のボクセル座標集合に変換するモジュールである。回転のない場合は `fillBox` による高速パスを使用し、任意回転の場合は OBB (Oriented Bounding Box) の内外判定によるボクセライゼーションを行う。

### 3.2 入力型定義

```typescript
interface CargoItemDef {
  width: number;   // X 方向のサイズ (cm)
  depth: number;   // Z 方向のサイズ (cm)
  height: number;  // Y 方向のサイズ (cm)
}

interface Placement {
  position: Vec3;         // 配置位置 (ローカル原点 = 貨物の左・底・手前角)
  rotation: EulerAngles;  // 回転角度 (度)
}

interface EulerAngles {
  rx: number;  // X 軸周りの回転角度 (度)
  ry: number;  // Y 軸周りの回転角度 (度)
  rz: number;  // Z 軸周りの回転角度 (度)
}

interface VoxelizeResult {
  voxels: Vec3[];                    // ボクセル座標のリスト
  usesFastPath: boolean;             // fillBox による高速パスが使えるか
  aabb?: { min: Vec3; max: Vec3 };   // 軸平行バウンディングボックス (高速パス時)
}
```

### 3.3 回転行列の構築

回転は **Y-X-Z** オイラー角の順序で適用する。これはコンテナ積載の文脈で自然な回転順序であり、「まず水平に回転 (Y)、次に前後に傾斜 (X)、最後に横転 (Z)」に対応する。

```typescript
function buildRotationMatrix(rx: number, ry: number, rz: number): Mat3 {
  // 度 → ラジアン変換
  const toRad = Math.PI / 180;
  const ax = rx * toRad;
  const ay = ry * toRad;
  const az = rz * toRad;

  const sinX = Math.sin(ax), cosX = Math.cos(ax);
  const sinY = Math.sin(ay), cosY = Math.cos(ay);
  const sinZ = Math.sin(az), cosZ = Math.cos(az);

  // R = Rz * Rx * Ry (適用順序: Y → X → Z)
  // 行列要素 (行優先)
  return {
    m00: cosZ * cosY + sinZ * sinX * sinY,
    m01: sinZ * cosX,
    m02: -cosZ * sinY + sinZ * sinX * cosY,

    m10: -sinZ * cosY + cosZ * sinX * sinY,
    m11: cosZ * cosX,
    m12: sinZ * sinY + cosZ * sinX * cosY,

    m20: cosX * sinY,
    m21: -sinX,
    m22: cosX * cosY,
  };
}
```

### 3.4 90 度倍数判定と高速パス

回転角度がすべて 90 度の倍数である場合、回転後の直方体は軸に整列した直方体のままであるため、ボクセライゼーションをスキップして `fillBox` による高速充填を使用できる。

```typescript
function isAxisAligned(rotation: EulerAngles): boolean {
  const isMultipleOf90 = (angle: number): boolean => {
    const normalized = ((angle % 360) + 360) % 360;
    return Math.abs(normalized % 90) < 0.001;
  };
  return isMultipleOf90(rotation.rx) &&
         isMultipleOf90(rotation.ry) &&
         isMultipleOf90(rotation.rz);
}
```

高速パスでは、8 頂点を回転して新しい AABB を求めるだけでよい:

```typescript
function voxelizeFastPath(
  item: CargoItemDef,
  placement: Placement
): VoxelizeResult {
  const R = buildRotationMatrix(
    placement.rotation.rx,
    placement.rotation.ry,
    placement.rotation.rz
  );

  // 箱のローカル座標系での 8 頂点 (原点 = 左・底・手前角)
  const localVertices: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: item.width, y: 0, z: 0 },
    { x: 0, y: item.height, z: 0 },
    { x: item.width, y: item.height, z: 0 },
    { x: 0, y: 0, z: item.depth },
    { x: item.width, y: 0, z: item.depth },
    { x: 0, y: item.height, z: item.depth },
    { x: item.width, y: item.height, z: item.depth },
  ];

  // 回転適用 + ワールド座標変換
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const v of localVertices) {
    const wx = R.m00 * v.x + R.m01 * v.y + R.m02 * v.z + placement.position.x;
    const wy = R.m10 * v.x + R.m11 * v.y + R.m12 * v.z + placement.position.y;
    const wz = R.m20 * v.x + R.m21 * v.y + R.m22 * v.z + placement.position.z;

    minX = Math.min(minX, wx);  maxX = Math.max(maxX, wx);
    minY = Math.min(minY, wy);  maxY = Math.max(maxY, wy);
    minZ = Math.min(minZ, wz);  maxZ = Math.max(maxZ, wz);
  }

  // 整数座標にスナップ
  const x0 = Math.round(minX);
  const y0 = Math.round(minY);
  const z0 = Math.round(minZ);
  const x1 = Math.round(maxX) - 1;
  const y1 = Math.round(maxY) - 1;
  const z1 = Math.round(maxZ) - 1;

  return {
    voxels: [],  // 高速パスでは voxels リストは不要 (fillBox を直接使う)
    usesFastPath: true,
    aabb: {
      min: { x: x0, y: y0, z: z0 },
      max: { x: x1, y: y1, z: z1 },
    },
  };
}
```

### 3.5 任意回転のボクセライゼーション アルゴリズム

回転角度が 90 度の倍数でない場合、以下のアルゴリズムでボクセライゼーションを行う。

#### アルゴリズム概要

1. 回転行列 R を構築する
2. 箱の 8 頂点にRを適用し、ワールド座標に変換する
3. 回転後の頂点群から AABB を計算する
4. AABB 内のすべてのボクセル候補に対して、逆回転を適用して OBB の内外判定を行う
5. OBB 内部のボクセルのみを結果に含める

#### 擬似コード

```typescript
function voxelize(
  item: CargoItemDef,
  placement: Placement
): VoxelizeResult {
  // --- ステップ 0: 高速パス判定 ---
  if (isAxisAligned(placement.rotation)) {
    return voxelizeFastPath(item, placement);
  }

  // --- ステップ 1: 回転行列と逆行列の構築 ---
  const R = buildRotationMatrix(
    placement.rotation.rx,
    placement.rotation.ry,
    placement.rotation.rz
  );
  // 回転行列は直交行列なので、逆行列 = 転置行列
  const Rinv: Mat3 = {
    m00: R.m00, m01: R.m10, m02: R.m20,
    m10: R.m01, m11: R.m11, m12: R.m21,
    m20: R.m02, m21: R.m12, m22: R.m22,
  };

  // --- ステップ 2: 8 頂点の回転 + AABB 計算 ---
  const localVertices: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: item.width, y: 0, z: 0 },
    { x: 0, y: item.height, z: 0 },
    { x: item.width, y: item.height, z: 0 },
    { x: 0, y: 0, z: item.depth },
    { x: item.width, y: 0, z: item.depth },
    { x: 0, y: item.height, z: item.depth },
    { x: item.width, y: item.height, z: item.depth },
  ];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const v of localVertices) {
    const wx = R.m00 * v.x + R.m01 * v.y + R.m02 * v.z + placement.position.x;
    const wy = R.m10 * v.x + R.m11 * v.y + R.m12 * v.z + placement.position.y;
    const wz = R.m20 * v.x + R.m21 * v.y + R.m22 * v.z + placement.position.z;

    minX = Math.min(minX, wx);  maxX = Math.max(maxX, wx);
    minY = Math.min(minY, wy);  maxY = Math.max(maxY, wy);
    minZ = Math.min(minZ, wz);  maxZ = Math.max(maxZ, wz);
  }

  // AABB を整数ボクセル座標にスナップ (切り捨て / 切り上げで余裕を持たせる)
  const aabbMinX = Math.floor(minX);
  const aabbMinY = Math.floor(minY);
  const aabbMinZ = Math.floor(minZ);
  const aabbMaxX = Math.ceil(maxX);
  const aabbMaxY = Math.ceil(maxY);
  const aabbMaxZ = Math.ceil(maxZ);

  // --- ステップ 3: AABB 内の全ボクセルに対する OBB 内外判定 ---
  const voxels: Vec3[] = [];
  const px = placement.position.x;
  const py = placement.position.y;
  const pz = placement.position.z;

  for (let z = aabbMinZ; z < aabbMaxZ; z++) {
    for (let y = aabbMinY; y < aabbMaxY; y++) {
      for (let x = aabbMinX; x < aabbMaxX; x++) {
        // ボクセルの中心座標 (0.5 オフセット)
        const cx = x + 0.5;
        const cy = y + 0.5;
        const cz = z + 0.5;

        // ワールド座標 → ローカル座標 (逆回転)
        const dx = cx - px;
        const dy = cy - py;
        const dz = cz - pz;

        const lx = Rinv.m00 * dx + Rinv.m01 * dy + Rinv.m02 * dz;
        const ly = Rinv.m10 * dx + Rinv.m11 * dy + Rinv.m12 * dz;
        const lz = Rinv.m20 * dx + Rinv.m21 * dy + Rinv.m22 * dz;

        // ローカル座標系で箱の内部にあるかを判定
        // 箱のローカル範囲: [0, width] x [0, height] x [0, depth]
        if (lx >= 0 && lx <= item.width &&
            ly >= 0 && ly <= item.height &&
            lz >= 0 && lz <= item.depth) {
          voxels.push({ x, y, z });
        }
      }
    }
  }

  return {
    voxels,
    usesFastPath: false,
  };
}
```

### 3.6 逆変換テスト式 (OBB 内外判定)

ワールド座標のボクセル中心 `P_world = (cx, cy, cz)` が OBB の内部にあるかの判定は以下の手順で行う:

1. **平行移動の除去**: `D = P_world - P_origin` (配置原点からの差分ベクトル)
2. **逆回転の適用**: `P_local = R^T * D` (回転行列の転置 = 逆回転)
3. **範囲判定**: `0 <= P_local.x <= width` かつ `0 <= P_local.y <= height` かつ `0 <= P_local.z <= depth`

数式表現:

```
P_local = R^(-1) * (P_world - P_origin)

P_local が [0, W] x [0, H] x [0, D] の内部 ⟺ P_world は OBB の内部
```

### 3.7 パフォーマンス考察

| シナリオ | 計算量 | 備考 |
|----------|--------|------|
| 軸平行 (高速パス) | O(1) | AABB の計算のみ。fillBox に委譲 |
| 任意回転 | O(V_aabb) | AABB 内の全ボクセルを走査。V_aabb は AABB の体積 |

任意回転の場合、AABB の体積は元の箱の体積よりも大きくなる (最悪で約 √3 倍)。しかし、内外判定は単純な浮動小数点比較 6 回のみであり、十分高速である。

---

## 4. GravityChecker モジュール

### 4.1 概要

GravityChecker は、配置されたオブジェクトが重力的に支持されているかを判定するモジュールである。コンテナ積載シミュレータでは「空中に浮いた貨物」は物理的に不正な配置であるため、これを検出して警告する。

### 4.2 支持判定のアルゴリズム

オブジェクトのボクセル集合に対して、以下の条件で支持状態を判定する:

1. **床面接触**: ボクセルの Y 座標が 0 であれば、そのボクセルは床面に接触しており支持されている
2. **下方支持**: ボクセルの直下 `(x, y-1, z)` が別のオブジェクト (ID !== 0) で占有されていれば、そのボクセルは支持されている
3. **底面ボクセル**: オブジェクトの中で「自身の直下に自身のボクセルが存在しない」ボクセルを「底面ボクセル」と定義する。支持判定は底面ボクセルに対してのみ行う

### 4.3 TypeScript インターフェース

```typescript
interface SupportResult {
  supported: boolean;     // 支持判定の結果 (閾値以上か)
  supportRatio: number;   // 支持率 (0.0 ~ 1.0)
  totalBottomVoxels: number;   // 底面ボクセルの総数
  supportedBottomVoxels: number; // 支持されている底面ボクセルの数
  unsupportedPositions: Vec3[];  // 支持されていないボクセルの座標 (可視化用)
}

interface GravityCheckerOptions {
  supportThreshold: number;   // 支持率の閾値 (デフォルト: 0.8 = 80%)
  warningThreshold: number;   // 警告閾値 (デフォルト: 0.95 = 95%)
}
```

### 4.4 判定アルゴリズム

```typescript
function checkSupport(
  grid: VoxelGrid,
  objectId: number,
  voxels: Vec3[],
  options: GravityCheckerOptions = {
    supportThreshold: 0.80,
    warningThreshold: 0.95,
  }
): SupportResult {
  // ステップ 1: 底面ボクセルの特定
  // オブジェクト自身のボクセルを高速検索できるようにセットを構築
  const voxelSet = new Set<string>();
  for (const v of voxels) {
    voxelSet.add(`${v.x},${v.y},${v.z}`);
  }

  // 底面ボクセル = 直下に自身のボクセルが存在しないボクセル
  const bottomVoxels: Vec3[] = [];
  for (const v of voxels) {
    const belowKey = `${v.x},${v.y - 1},${v.z}`;
    if (!voxelSet.has(belowKey)) {
      bottomVoxels.push(v);
    }
  }

  // ステップ 2: 底面ボクセルの支持判定
  let supportedCount = 0;
  const unsupportedPositions: Vec3[] = [];

  for (const v of bottomVoxels) {
    if (v.y === 0) {
      // 床面に接触 → 支持されている
      supportedCount++;
    } else {
      const belowId = grid.get(v.x, v.y - 1, v.z);
      if (belowId !== 0 && belowId !== objectId) {
        // 他のオブジェクトに支持されている
        supportedCount++;
      } else {
        // 支持されていない
        unsupportedPositions.push(v);
      }
    }
  }

  // ステップ 3: 支持率の計算
  const totalBottomVoxels = bottomVoxels.length;
  const supportRatio = totalBottomVoxels > 0
    ? supportedCount / totalBottomVoxels
    : 1.0;  // 底面ボクセルが 0 個 = 完全に内包されている → 支持されている

  return {
    supported: supportRatio >= options.supportThreshold,
    supportRatio,
    totalBottomVoxels,
    supportedBottomVoxels: supportedCount,
    unsupportedPositions,
  };
}
```

### 4.5 閾値の設計

| 支持率 | 状態 | UI での表示 |
|--------|------|------------|
| 95% ~ 100% | 正常 | 緑色表示 (問題なし) |
| 80% ~ 95% | 警告 | 黄色表示 (不安定だが許容) |
| 0% ~ 80% | エラー | 赤色表示 (浮遊状態) |

- **warningThreshold (95%)**: これを下回ると「不安定」警告を表示する。積載はできるが、ユーザに注意を促す。
- **supportThreshold (80%)**: これを下回ると「浮遊」エラーを表示する。配置は許可されるが、エラーとしてマークされる。

> **設計方針**: 閾値はデフォルト値として設定するが、ユーザがカスタマイズ可能とする。実際の積載ではパレットやダンネージによる支持もあるため、厳密な 100% 支持は要求しない。

### 4.6 連鎖浮遊の検出

オブジェクト A がオブジェクト B を支持し、B がオブジェクト C を支持している場合、A を取り除くと B と C が連鎖的に浮遊する。この連鎖浮遊の検出は、単一オブジェクトの支持判定を配置されている全オブジェクトに対して再実行することで行う:

```typescript
function checkAllSupports(
  grid: VoxelGrid,
  placements: Map<number, Vec3[]>,
  options?: GravityCheckerOptions
): Map<number, SupportResult> {
  const results = new Map<number, SupportResult>();
  for (const [objectId, voxels] of placements) {
    results.set(objectId, checkSupport(grid, objectId, voxels, options));
  }
  return results;
}
```

---

## 5. WeightCalculator モジュール

### 5.1 概要

WeightCalculator は、コンテナ内に配置された全貨物の総重量、重心位置、および充填率を計算するモジュールである。

### 5.2 TypeScript インターフェース

```typescript
interface CargoPlacement {
  id: number;                // オブジェクト ID
  item: CargoItemDef;        // 貨物定義 (寸法)
  weight: number;            // 重量 (kg)
  position: Vec3;            // 配置位置
  rotation: EulerAngles;     // 回転
  voxels: Vec3[];            // ボクセル座標リスト
}

interface WeightResult {
  totalWeight: number;                  // 総重量 (kg)
  centerOfGravity: Vec3;               // 重心位置 (cm)
  fillRateByVolume: number;            // 体積充填率 (0.0 ~ 1.0)
  fillRateByWeight: number;            // 重量充填率 (0.0 ~ 1.0, 最大積載量が設定されている場合)
  perCargoWeights: Map<number, number>; // 個別貨物の重量
}

interface ContainerSpec {
  width: number;    // 内寸幅 (cm)
  height: number;   // 内寸高さ (cm)
  depth: number;    // 内寸奥行き (cm)
  maxPayload: number; // 最大積載量 (kg)
}
```

### 5.3 重心計算アルゴリズム

重心は、各貨物の幾何学的中心と重量を用いた加重平均で計算する。

#### 数式

各貨物 i に対して:

- `center_i`: 貨物 i のボクセル集合から計算した幾何学的中心
- `weight_i`: 貨物 i の重量 (kg)

```
           Σ (center_i.x * weight_i)
CoG_x  =  ─────────────────────────
                Σ weight_i

           Σ (center_i.y * weight_i)
CoG_y  =  ─────────────────────────
                Σ weight_i

           Σ (center_i.z * weight_i)
CoG_z  =  ─────────────────────────
                Σ weight_i
```

#### 実装

```typescript
function computeWeight(
  placements: CargoPlacement[],
  containerSpec: ContainerSpec
): WeightResult {
  if (placements.length === 0) {
    return {
      totalWeight: 0,
      centerOfGravity: { x: 0, y: 0, z: 0 },
      fillRateByVolume: 0,
      fillRateByWeight: 0,
      perCargoWeights: new Map(),
    };
  }

  let totalWeight = 0;
  let cogX = 0;
  let cogY = 0;
  let cogZ = 0;
  let totalOccupiedVoxels = 0;
  const perCargoWeights = new Map<number, number>();

  for (const placement of placements) {
    const w = placement.weight;
    totalWeight += w;
    perCargoWeights.set(placement.id, w);

    // ボクセル集合の幾何学的中心を計算
    const voxels = placement.voxels;
    const voxelCount = voxels.length;
    totalOccupiedVoxels += voxelCount;

    if (voxelCount > 0) {
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const v of voxels) {
        sumX += v.x + 0.5; // ボクセルの中心
        sumY += v.y + 0.5;
        sumZ += v.z + 0.5;
      }
      const centerX = sumX / voxelCount;
      const centerY = sumY / voxelCount;
      const centerZ = sumZ / voxelCount;

      // 加重累積
      cogX += centerX * w;
      cogY += centerY * w;
      cogZ += centerZ * w;
    }
  }

  // 重心位置
  const centerOfGravity: Vec3 = totalWeight > 0
    ? {
        x: cogX / totalWeight,
        y: cogY / totalWeight,
        z: cogZ / totalWeight,
      }
    : { x: 0, y: 0, z: 0 };

  // 充填率 (体積)
  const containerVolume = containerSpec.width * containerSpec.height * containerSpec.depth;
  const fillRateByVolume = containerVolume > 0
    ? totalOccupiedVoxels / containerVolume
    : 0;

  // 充填率 (重量)
  const fillRateByWeight = containerSpec.maxPayload > 0
    ? totalWeight / containerSpec.maxPayload
    : 0;

  return {
    totalWeight,
    centerOfGravity,
    fillRateByVolume,
    fillRateByWeight,
    perCargoWeights,
  };
}
```

### 5.4 重心の可視化用情報

重心位置はコンテナの中心からの偏りとしても表現する。偏りが大きい場合は警告を出す。

```typescript
interface CogDeviation {
  deviationX: number;  // X 方向の偏り (コンテナ中心からの距離, cm)
  deviationY: number;  // Y 方向の偏り
  deviationZ: number;  // Z 方向の偏り
  isBalanced: boolean; // 偏りが許容範囲内か
}

function computeCogDeviation(
  cog: Vec3,
  containerSpec: ContainerSpec
): CogDeviation {
  const centerX = containerSpec.width / 2;
  const centerY = containerSpec.height / 2;
  const centerZ = containerSpec.depth / 2;

  const deviationX = cog.x - centerX;
  const deviationY = cog.y - centerY;
  const deviationZ = cog.z - centerZ;

  // 偏りの許容範囲: 各方向の寸法の 10% 以内
  const toleranceX = containerSpec.width * 0.10;
  const toleranceZ = containerSpec.depth * 0.10;

  const isBalanced =
    Math.abs(deviationX) <= toleranceX &&
    Math.abs(deviationZ) <= toleranceZ;

  return { deviationX, deviationY, deviationZ, isBalanced };
}
```

---

## 6. History (Undo/Redo) モジュール

### 6.1 概要

History モジュールは、Command パターンを用いて全操作の Undo/Redo を実現する。各操作はコマンドオブジェクトとしてカプセル化され、実行時の状態差分を保持する。

### 6.2 Command インターフェース

```typescript
interface Command {
  /**
   * コマンドを実行する。
   * グリッドの状態を変更し、成功したら true を返す。
   */
  execute(grid: VoxelGrid): boolean;

  /**
   * コマンドを取り消し、実行前の状態に戻す。
   */
  undo(grid: VoxelGrid): void;

  /**
   * コマンドの人間可読な説明を返す。
   * UI の履歴一覧に表示される。
   */
  getDescription(): string;
}
```

### 6.3 PlaceCommand (配置コマンド)

新しい貨物をコンテナ内に配置するコマンド。

```typescript
class PlaceCommand implements Command {
  private cargoId: number;
  private placement: CargoPlacement;
  private voxels: Vec3[];
  private usesFastPath: boolean;
  private aabb?: { min: Vec3; max: Vec3 };

  constructor(
    cargoId: number,
    placement: CargoPlacement,
    voxelizeResult: VoxelizeResult
  ) {
    this.cargoId = cargoId;
    this.placement = placement;
    this.voxels = voxelizeResult.voxels;
    this.usesFastPath = voxelizeResult.usesFastPath;
    this.aabb = voxelizeResult.aabb;
  }

  execute(grid: VoxelGrid): boolean {
    if (this.usesFastPath && this.aabb) {
      grid.fillBox(
        this.aabb.min.x, this.aabb.min.y, this.aabb.min.z,
        this.aabb.max.x, this.aabb.max.y, this.aabb.max.z,
        this.cargoId
      );
    } else {
      grid.fillVoxels(this.voxels, this.cargoId);
    }
    return true;
  }

  undo(grid: VoxelGrid): void {
    if (this.usesFastPath && this.aabb) {
      grid.fillBox(
        this.aabb.min.x, this.aabb.min.y, this.aabb.min.z,
        this.aabb.max.x, this.aabb.max.y, this.aabb.max.z,
        0 // クリア
      );
    } else {
      grid.fillVoxels(this.voxels, 0); // クリア
    }
  }

  getDescription(): string {
    const p = this.placement.position;
    return `配置: 貨物 #${this.cargoId} @ (${p.x}, ${p.y}, ${p.z})`;
  }
}
```

### 6.4 MoveCommand (移動コマンド)

貨物を別の位置に移動するコマンド。

```typescript
class MoveCommand implements Command {
  private cargoId: number;
  private oldVoxels: Vec3[];
  private newVoxels: Vec3[];
  private oldPlacement: Placement;
  private newPlacement: Placement;
  private oldFastPath: boolean;
  private newFastPath: boolean;
  private oldAabb?: { min: Vec3; max: Vec3 };
  private newAabb?: { min: Vec3; max: Vec3 };

  constructor(
    cargoId: number,
    oldPlacement: Placement,
    newPlacement: Placement,
    oldVoxelizeResult: VoxelizeResult,
    newVoxelizeResult: VoxelizeResult
  ) {
    this.cargoId = cargoId;
    this.oldPlacement = oldPlacement;
    this.newPlacement = newPlacement;
    this.oldVoxels = oldVoxelizeResult.voxels;
    this.newVoxels = newVoxelizeResult.voxels;
    this.oldFastPath = oldVoxelizeResult.usesFastPath;
    this.newFastPath = newVoxelizeResult.usesFastPath;
    this.oldAabb = oldVoxelizeResult.aabb;
    this.newAabb = newVoxelizeResult.aabb;
  }

  execute(grid: VoxelGrid): boolean {
    // 旧位置をクリア
    this._fillWith(grid, this.oldVoxels, this.oldFastPath, this.oldAabb, 0);
    // 新位置に配置
    this._fillWith(grid, this.newVoxels, this.newFastPath, this.newAabb, this.cargoId);
    return true;
  }

  undo(grid: VoxelGrid): void {
    // 新位置をクリア
    this._fillWith(grid, this.newVoxels, this.newFastPath, this.newAabb, 0);
    // 旧位置に配置
    this._fillWith(grid, this.oldVoxels, this.oldFastPath, this.oldAabb, this.cargoId);
  }

  getDescription(): string {
    const o = this.oldPlacement.position;
    const n = this.newPlacement.position;
    return `移動: 貨物 #${this.cargoId} (${o.x},${o.y},${o.z}) → (${n.x},${n.y},${n.z})`;
  }

  private _fillWith(
    grid: VoxelGrid,
    voxels: Vec3[],
    useFastPath: boolean,
    aabb: { min: Vec3; max: Vec3 } | undefined,
    id: number
  ): void {
    if (useFastPath && aabb) {
      grid.fillBox(
        aabb.min.x, aabb.min.y, aabb.min.z,
        aabb.max.x, aabb.max.y, aabb.max.z,
        id
      );
    } else {
      grid.fillVoxels(voxels, id);
    }
  }
}
```

### 6.5 RotateCommand (回転コマンド)

貨物の回転を変更するコマンド。MoveCommand と類似の構造であるが、回転の変更に特化した説明文を生成する。

```typescript
class RotateCommand implements Command {
  private cargoId: number;
  private oldVoxels: Vec3[];
  private newVoxels: Vec3[];
  private oldPlacement: Placement;
  private newPlacement: Placement;
  private oldFastPath: boolean;
  private newFastPath: boolean;
  private oldAabb?: { min: Vec3; max: Vec3 };
  private newAabb?: { min: Vec3; max: Vec3 };

  constructor(
    cargoId: number,
    oldPlacement: Placement,
    newPlacement: Placement,
    oldVoxelizeResult: VoxelizeResult,
    newVoxelizeResult: VoxelizeResult
  ) {
    this.cargoId = cargoId;
    this.oldPlacement = oldPlacement;
    this.newPlacement = newPlacement;
    this.oldVoxels = oldVoxelizeResult.voxels;
    this.newVoxels = newVoxelizeResult.voxels;
    this.oldFastPath = oldVoxelizeResult.usesFastPath;
    this.newFastPath = newVoxelizeResult.usesFastPath;
    this.oldAabb = oldVoxelizeResult.aabb;
    this.newAabb = newVoxelizeResult.aabb;
  }

  execute(grid: VoxelGrid): boolean {
    // 旧ボクセルをクリア
    if (this.oldFastPath && this.oldAabb) {
      grid.fillBox(
        this.oldAabb.min.x, this.oldAabb.min.y, this.oldAabb.min.z,
        this.oldAabb.max.x, this.oldAabb.max.y, this.oldAabb.max.z,
        0
      );
    } else {
      grid.fillVoxels(this.oldVoxels, 0);
    }

    // 新ボクセルを配置
    if (this.newFastPath && this.newAabb) {
      grid.fillBox(
        this.newAabb.min.x, this.newAabb.min.y, this.newAabb.min.z,
        this.newAabb.max.x, this.newAabb.max.y, this.newAabb.max.z,
        this.cargoId
      );
    } else {
      grid.fillVoxels(this.newVoxels, this.cargoId);
    }

    return true;
  }

  undo(grid: VoxelGrid): void {
    // 新ボクセルをクリア
    if (this.newFastPath && this.newAabb) {
      grid.fillBox(
        this.newAabb.min.x, this.newAabb.min.y, this.newAabb.min.z,
        this.newAabb.max.x, this.newAabb.max.y, this.newAabb.max.z,
        0
      );
    } else {
      grid.fillVoxels(this.newVoxels, 0);
    }

    // 旧ボクセルを復元
    if (this.oldFastPath && this.oldAabb) {
      grid.fillBox(
        this.oldAabb.min.x, this.oldAabb.min.y, this.oldAabb.min.z,
        this.oldAabb.max.x, this.oldAabb.max.y, this.oldAabb.max.z,
        this.cargoId
      );
    } else {
      grid.fillVoxels(this.oldVoxels, this.cargoId);
    }
  }

  getDescription(): string {
    const r = this.newPlacement.rotation;
    return `回転: 貨物 #${this.cargoId} → (rx=${r.rx}°, ry=${r.ry}°, rz=${r.rz}°)`;
  }
}
```

### 6.6 RemoveCommand (削除コマンド)

貨物をコンテナから削除するコマンド。PlaceCommand の逆操作である。

```typescript
class RemoveCommand implements Command {
  private cargoId: number;
  private placement: CargoPlacement;
  private voxels: Vec3[];
  private usesFastPath: boolean;
  private aabb?: { min: Vec3; max: Vec3 };

  constructor(
    cargoId: number,
    placement: CargoPlacement,
    voxelizeResult: VoxelizeResult
  ) {
    this.cargoId = cargoId;
    this.placement = placement;
    this.voxels = voxelizeResult.voxels;
    this.usesFastPath = voxelizeResult.usesFastPath;
    this.aabb = voxelizeResult.aabb;
  }

  execute(grid: VoxelGrid): boolean {
    // ボクセルをクリア (削除)
    if (this.usesFastPath && this.aabb) {
      grid.fillBox(
        this.aabb.min.x, this.aabb.min.y, this.aabb.min.z,
        this.aabb.max.x, this.aabb.max.y, this.aabb.max.z,
        0
      );
    } else {
      grid.fillVoxels(this.voxels, 0);
    }
    return true;
  }

  undo(grid: VoxelGrid): void {
    // ボクセルを復元 (再配置)
    if (this.usesFastPath && this.aabb) {
      grid.fillBox(
        this.aabb.min.x, this.aabb.min.y, this.aabb.min.z,
        this.aabb.max.x, this.aabb.max.y, this.aabb.max.z,
        this.cargoId
      );
    } else {
      grid.fillVoxels(this.voxels, this.cargoId);
    }
  }

  getDescription(): string {
    return `削除: 貨物 #${this.cargoId}`;
  }
}
```

### 6.7 HistoryManager

全コマンドのスタック管理を行う。

```typescript
interface HistoryState {
  undoCount: number;     // Undo 可能な回数
  redoCount: number;     // Redo 可能な回数
  descriptions: string[]; // コマンド履歴の説明一覧
}

class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * コマンドを実行し、履歴に追加する。
   * 新しいコマンドを実行すると Redo スタックはクリアされる。
   */
  executeCommand(command: Command, grid: VoxelGrid): boolean {
    const success = command.execute(grid);
    if (success) {
      this.undoStack.push(command);

      // Redo スタックをクリア (新しい操作が行われたため)
      this.redoStack = [];

      // 履歴サイズの上限チェック
      if (this.undoStack.length > this.maxHistorySize) {
        this.undoStack.shift(); // 最も古い履歴を破棄
      }
    }
    return success;
  }

  /**
   * 直近のコマンドを取り消す。
   * @returns 取り消しが実行されたら true
   */
  undo(grid: VoxelGrid): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;

    command.undo(grid);
    this.redoStack.push(command);
    return true;
  }

  /**
   * 直近の Undo を再実行する。
   * @returns 再実行されたら true
   */
  redo(grid: VoxelGrid): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;

    command.execute(grid);
    this.undoStack.push(command);
    return true;
  }

  /**
   * 現在の履歴状態を取得する。
   */
  getState(): HistoryState {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      descriptions: this.undoStack.map(cmd => cmd.getDescription()),
    };
  }

  /**
   * 全履歴をクリアする。
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Undo が可能かどうか。
   */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Redo が可能かどうか。
   */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
```

### 6.8 操作フロー

```
[ユーザ操作] → [Command 生成] → [HistoryManager.executeCommand()]
                                        │
                                        ├── command.execute(grid)
                                        ├── undoStack.push(command)
                                        └── redoStack = []  ← Redo スタックをクリア

[Undo] → [HistoryManager.undo()]
              │
              ├── command = undoStack.pop()
              ├── command.undo(grid)
              └── redoStack.push(command)

[Redo] → [HistoryManager.redo()]
              │
              ├── command = redoStack.pop()
              ├── command.execute(grid)
              └── undoStack.push(command)
```

### 6.9 メモリに関する考慮

各コマンドはボクセル座標のリスト (`Vec3[]`) を保持する。大きな貨物のボクセル数は数百万に達する可能性があるため、メモリ使用量に注意が必要である。

| 貨物サイズ | ボクセル数 | Vec3 配列メモリ (概算) |
|-----------|-----------|----------------------|
| 100x100x100 cm | 1,000,000 | ~24 MB (3 x number x 8 bytes) |
| 50x50x50 cm | 125,000 | ~3 MB |
| 30x30x30 cm | 27,000 | ~0.6 MB |

> **最適化方針**: 軸平行な配置 (高速パス) の場合、ボクセルリストではなく AABB のみを保持するため、メモリ使用量は一定 (O(1)) となる。任意回転の貨物のみがボクセルリストを保持する。`maxHistorySize` パラメータにより、過度なメモリ消費を防止する。

---

## 7. API まとめ

### 7.1 VoxelGrid クラス

| メソッド | パラメータ | 戻り値 | 計算量 | 概要 |
|---------|-----------|--------|--------|------|
| `constructor` | `width, height, depth: number` | `VoxelGrid` | O(W*H*D) | グリッド初期化 |
| `get` | `x, y, z: number` | `number` | O(1) | ボクセル値取得 |
| `set` | `x, y, z: number, id: number` | `void` | O(1) | ボクセル値設定 |
| `fillBox` | `x0,y0,z0, x1,y1,z1: number, id: number` | `void` | O(V) | 直方体領域充填 |
| `fillVoxels` | `voxels: Vec3[], id: number` | `void` | O(N) | 任意ボクセル充填 |
| `clearObject` | `id: number` | `void` | O(W*H*D) | 指定IDをクリア |
| `hasCollision` | `voxels: Vec3[], excludeId?: number` | `boolean` | O(N) | 衝突検出 |
| `computeStats` | なし | `GridStats` | O(W*H*D) | 統計情報計算 |
| `isInBounds` | `x, y, z: number` | `boolean` | O(1) | 範囲チェック |
| `clone` | なし | `VoxelGrid` | O(W*H*D) | 深いコピー |
| `clear` | なし | `void` | O(W*H*D) | 全クリア |

> V = 充填する直方体の体積、N = ボクセルリストの要素数、W*H*D = グリッド全体のボクセル数

### 7.2 Voxelizer モジュール

| 関数 | パラメータ | 戻り値 | 計算量 | 概要 |
|------|-----------|--------|--------|------|
| `voxelize` | `item: CargoItemDef, placement: Placement` | `VoxelizeResult` | O(1) or O(V_aabb) | 直方体→ボクセル変換 |
| `isAxisAligned` | `rotation: EulerAngles` | `boolean` | O(1) | 軸平行判定 |
| `buildRotationMatrix` | `rx, ry, rz: number` | `Mat3` | O(1) | 回転行列構築 |

### 7.3 GravityChecker モジュール

| 関数 | パラメータ | 戻り値 | 計算量 | 概要 |
|------|-----------|--------|--------|------|
| `checkSupport` | `grid: VoxelGrid, objectId: number, voxels: Vec3[], options?: GravityCheckerOptions` | `SupportResult` | O(N) | 支持判定 (部分支持対応) |
| `checkAllSupports` | `grid: VoxelGrid, placements: Map<number, Vec3[]>, options?: GravityCheckerOptions` | `Map<number, SupportResult>` | O(M*N) | 全オブジェクト支持判定 |

> N = 対象オブジェクトのボクセル数、M = オブジェクト数

### 7.4 WeightCalculator モジュール

| 関数 | パラメータ | 戻り値 | 計算量 | 概要 |
|------|-----------|--------|--------|------|
| `computeWeight` | `placements: CargoPlacement[], containerSpec: ContainerSpec` | `WeightResult` | O(Σ N_i) | 重量・重心計算 |
| `computeCogDeviation` | `cog: Vec3, containerSpec: ContainerSpec` | `CogDeviation` | O(1) | 重心偏差計算 |

> N_i = 貨物 i のボクセル数

### 7.5 History モジュール

| クラス/メソッド | パラメータ | 戻り値 | 概要 |
|---------------|-----------|--------|------|
| `HistoryManager.constructor` | `maxHistorySize?: number` | `HistoryManager` | 履歴マネージャ初期化 |
| `HistoryManager.executeCommand` | `command: Command, grid: VoxelGrid` | `boolean` | コマンド実行+履歴追加 |
| `HistoryManager.undo` | `grid: VoxelGrid` | `boolean` | 直近の操作を取り消し |
| `HistoryManager.redo` | `grid: VoxelGrid` | `boolean` | 直近の Undo を再実行 |
| `HistoryManager.getState` | なし | `HistoryState` | 履歴状態取得 |
| `HistoryManager.clear` | なし | `void` | 履歴全クリア |
| `HistoryManager.canUndo` | (プロパティ) | `boolean` | Undo 可能か |
| `HistoryManager.canRedo` | (プロパティ) | `boolean` | Redo 可能か |

| Command 実装クラス | 概要 | execute | undo |
|-------------------|------|---------|------|
| `PlaceCommand` | 貨物を配置 | ボクセル充填 | ボクセルクリア |
| `MoveCommand` | 貨物を移動 | 旧クリア+新充填 | 新クリア+旧充填 |
| `RotateCommand` | 貨物を回転 | 旧クリア+新充填 | 新クリア+旧充填 |
| `RemoveCommand` | 貨物を削除 | ボクセルクリア | ボクセル充填 |
| `RepackCommand` | auto-pack/repack 用バッチ | 全 remove→全 add | 逆順で復元 |
| `BatchCommand` | 複数 Command をまとめて 1 undo/redo 単位 | 順次 execute | 逆順 undo |

---

## 8. AutoPacker モジュール

### 8.1 概要

自動積載アルゴリズム。OccupancyMap ベースのハイトマップを用いて、ボリューム降順・6方向回転候補で配置位置を探索する。

### 8.2 インターフェース

```typescript
interface PackResult {
  placements: PlacedCargo[]
  voxelizeResults: VoxelizeResult[]
  failedDefIds: string[]
}

function autoPack(
  items: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
  baseOccMap?: OccupancyMap,
): PackResult
```

### 8.3 アルゴリズム概要

1. アイテムをボリューム降順にソート
2. 各アイテムに対して方向候補を生成（`noFlip` の場合は Y 軸回転のみ2方向、通常は6方向）
3. 重複する AABB サイズの方向を除外
4. 各方向で `OccupancyMap.findPosition()` を呼び出し、最適位置を選択
5. 配置成功したら OccupancyMap を更新、失敗したら `failedDefIds` に追加

---

## 9. OccupancyMap モジュール

### 9.1 概要

コンテナの XZ 平面上の 2D ハイトマップ。各セル (デフォルト10cm単位) が最大占有 Y 高さを保持する。VoxelGrid の全スキャンに比べ、配置位置探索を大幅に高速化する。

### 9.2 インターフェース

```typescript
class OccupancyMap {
  constructor(widthCm: number, heightCm: number, depthCm: number, cellSize?: number)
  markAABB(aabb: { min: Vec3; max: Vec3 }): void
  getStackHeight(x: number, z: number, w: number, d: number): number
  findPosition(w: number, h: number, d: number): Vec3 | null
  clone(): OccupancyMap
  static fromPlacements(placements: PlacedCargo[], cargoDefs: CargoItemDef[], container: ContainerDef): OccupancyMap
}
```

---

## 10. InterferenceChecker モジュール

### 10.1 概要

全配置ペアの AABB 重なりを検出する。O(n²) だが n < 100 のため実用上問題なし。

### 10.2 インターフェース

```typescript
interface InterferencePair {
  instanceId1: number
  instanceId2: number
  name1: string
  name2: string
}

interface InterferenceResult {
  pairs: InterferencePair[]
}

function checkInterference(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
): InterferenceResult
```

---

## 11. StackChecker モジュール

### 11.1 概要

各配置の上面に積載された重量を再帰的に計算し、`maxStackWeightKg` / `noStack` 制約に違反するペアを検出する。メモ化により効率化。

### 11.2 インターフェース

```typescript
interface StackViolation {
  instanceId: number
  cargoDefId: string
  name: string
  maxStackWeightKg: number
  actualStackWeightKg: number
}

function checkStackConstraints(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
): StackViolation[]
```

---

## 12. WallKick モジュール

### 12.1 概要

SRS (Super Rotation System) 風のオフセット試行。回転後に衝突が発生した場合、14方向のオフセット (±10cm, ±20cm) を順に試して衝突しない位置を探索する。

### 12.2 インターフェース

```typescript
interface KickResult {
  position: Vec3
  rotation: Vec3
  result: VoxelizeResult
}

function tryKick(
  grid: VoxelGrid,
  def: CargoItemDef,
  basePos: Vec3,
  newRot: Vec3,
  excludeId: number,
  voxelizeFn: (def: CargoItemDef, pos: Vec3, rot: Vec3) => VoxelizeResult,
  checkCollisionFn: (grid: VoxelGrid, result: VoxelizeResult, excludeId: number) => boolean,
): KickResult | null
```
