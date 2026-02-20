# 10: パフォーマンス改善

4つのパフォーマンス改善を個別セクションとして記載する。

---

## 1. `buildPickItems()` メモ化

### 対象ファイル

`src/ui/CanvasPanel.tsx` L21-57

### 現状の問題

`buildPickItems()` はクリック/移動のたびに全 `placements` をループして `PickItem[]` を再構築する。`renderVersion` が変わっていなければ結果は同じなのに毎回再計算。

### 変更内容

モジュールスコープにキャッシュ変数を追加:

```typescript
// CanvasPanel.tsx のトップレベル（コンポーネント外）
let pickItemsCache: PickItem[] = []
let pickItemsCacheVersion = -1

function buildPickItems(): PickItem[] {
  const state = useAppStore.getState()
  if (state.renderVersion === pickItemsCacheVersion) {
    return pickItemsCache
  }
  // ... 既存のビルドロジック（変更なし）...
  pickItemsCache = items
  pickItemsCacheVersion = state.renderVersion
  return items
}
```

### 効果

- `handleClick` 呼出し時のコスト: O(N placements × M blocks) → O(1)（キャッシュヒット時）
- 移動/回転操作中のピッキングが高速化

---

## 2. `snapPosition` ボクセル化キャッシュ

### 対象ファイル

`src/ui/CanvasPanel.tsx` L164-234

### 現状の問題

`snapPosition` の Y スキャンループ（L201-231）で、毎回 `voxelize()` / `voxelizeComposite()` を呼ぶ:

```typescript
for (let y = minValidY; y <= maxValidY; y++) {
  const testPos = { x, y, z }
  const result = blocks
    ? voxelizeComposite(blocks, testPos, rotationDeg)   // ← 毎Y呼出し
    : voxelize(widthCm, heightCm, depthCm, testPos, rotationDeg)  // ← 毎Y呼出し
  // ...
}
```

Y が変わっても回転が同じならボクセルの**相対パターン**は同じ。位置オフセットだけ異なる。

### 変更内容

Y=0 で1回だけ voxelize し、Y オフセットで再利用:

```typescript
function snapPosition(hitPoint: Vec3, widthCm: number, heightCm: number, depthCm: number, rotationDeg: Vec3, excludeInstanceId?: number, blocks?: ShapeBlock[]): Vec3 {
  // ... 既存の X, Z 計算 ...

  // Y=minValidY で1回だけ voxelize
  const basePos = { x, y: minValidY, z }
  const baseResult = blocks
    ? voxelizeComposite(blocks, basePos, rotationDeg)
    : voxelize(widthCm, heightCm, depthCm, basePos, rotationDeg)

  for (let y = minValidY; y <= maxValidY; y++) {
    const dy = y - minValidY

    // AABB をオフセット
    const min = { x: baseResult.aabb.min.x, y: baseResult.aabb.min.y + dy, z: baseResult.aabb.min.z }
    const max = { x: baseResult.aabb.max.x, y: baseResult.aabb.max.y + dy, z: baseResult.aabb.max.z }

    // 境界チェック
    if (min.x < 0 || min.y < 0 || min.z < 0) continue
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) continue

    // コリジョン判定
    let collision = false
    if (baseResult.usesFastPath) {
      // AABB のまま Y をオフセットしてチェック
      for (let vz = min.z; vz < max.z && !collision; vz++) {
        for (let vy = min.y; vy < max.y && !collision; vy++) {
          for (let vx = min.x; vx < max.x && !collision; vx++) {
            const val = grid.get(vx, vy, vz)
            if (val !== 0 && val !== excludeInstanceId) collision = true
          }
        }
      }
    } else {
      // ボクセルリストの Y をオフセットしてチェック
      for (const v of baseResult.voxels) {
        const vy = v.y + dy
        if (!grid.isInBounds(v.x, vy, v.z)) { collision = true; break }
        const val = grid.get(v.x, vy, v.z)
        if (val !== 0 && val !== excludeInstanceId) { collision = true; break }
      }
    }

    if (!collision) {
      bestY = y
      break
    }
  }

  return { x, y: bestY, z }
}
```

### 効果

- voxelize 呼出し回数: Y スキャン回数（最大 ch = 239 回）→ 1 回
- ドラッグ中の snapPosition は毎 mousemove で呼ばれるため効果大
- 特に `voxelizeComposite`（slow path）はブロック数 × AABB ボクセル数なので効果顕著

---

## 3. `recomputeAnalytics()` デバウンス

### 対象ファイル

`src/state/store.ts` L103-115

### 現状の問題

`recomputeAnalytics()` は `computeWeight()` + `computeCogDeviation()` + `checkAllSupports()` を同期実行。
以下のアクション末尾で毎回呼ばれる:

- `placeCargo` (L213)
- `removePlacement` (L243)
- `moveCargo` (L289)
- `rotateCargo` (L366)
- `undo` (L545)
- `redo` (L579)
- `removeCargoDef` (L159)

移動ドラッグ中（`moveCargo` が高頻度呼出し）は無駄に analytics を再計算する。

### 変更内容

デバウンスで非同期化。`setTimeout(0)` で次のマイクロタスクに遅延:

```typescript
// store.ts のモジュールスコープ
let analyticsTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAnalytics(): void {
  if (analyticsTimer !== null) return  // 既にスケジュール済み
  analyticsTimer = setTimeout(() => {
    analyticsTimer = null
    const state = useAppStore.getState()
    const analytics = recomputeAnalyticsSync(state.placements, state.cargoDefs, state.container)
    useAppStore.setState(analytics)
  }, 0)
}

// 既存の recomputeAnalytics を recomputeAnalyticsSync にリネーム
function recomputeAnalyticsSync(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
): { weightResult: WeightResult; cogDeviation: CogDeviation | null; supportResults: Map<number, SupportResult> } {
  // ... 既存実装そのまま ...
}
```

各アクションの変更:

```typescript
// 変更前（例: placeCargo）
const analytics = recomputeAnalytics(newPlacements, state.cargoDefs, state.container)
set({
  placements: newPlacements,
  ...analytics,
  renderVersion: state.renderVersion + 1,
})

// 変更後
set({
  placements: newPlacements,
  renderVersion: state.renderVersion + 1,
  // analytics は含めない
})
scheduleAnalytics()
```

**例外**: `loadState` と `setContainer` は同期のまま（初期状態を正しく表示するため）:

```typescript
// loadState 内
const analytics = recomputeAnalyticsSync(data.placements, data.cargoDefs, data.container)
set((state) => ({
  ...data,
  renderVersion: state.renderVersion + 1,
  ...analytics,
}))
```

### 効果

- ドラッグ中の moveCargo: analytics 計算がフレーム間で合体（60fps → 1回/移動完了時）
- `checkAllSupports` が全配置の底面ボクセルを走査するため、配置数が多い場合に顕著

### 注意点

- `StatsPanel` は store の `weightResult`/`cogDeviation`/`supportResults` をサブスクライブしている。デバウンス後に更新されるため、一瞬古い値が表示される（ユーザーには知覚不能: setTimeout(0) = 次の microtask）

---

## 4. `LabelRenderer` DOM 最適化

### 対象ファイル

`src/renderer/LabelRenderer.ts` L54-99（`project()` メソッド）

### 現状の問題

```typescript
// L97-98: 毎フレーム style.left と style.top を書き換え
el.style.left = `${sx}px`
el.style.top = `${sy}px`
```

`style.left` / `style.top` の変更はブラウザの layout reflow を引き起こす（読み取りとの交互でバッチ化されない場合）。

### 変更内容

`transform: translate()` に一本化:

```typescript
// 変更前（L43-46 の初期スタイル）
el.style.cssText =
  'position:absolute;background:rgba(0,0,0,0.75);color:#fff;font-size:11px;' +
  'padding:2px 6px;border-radius:3px;pointer-events:none;white-space:nowrap;' +
  'will-change:transform;transform:translate(-50%,-100%);'

// 変更後
el.style.cssText =
  'position:absolute;left:0;top:0;background:rgba(0,0,0,0.75);color:#fff;font-size:11px;' +
  'padding:2px 6px;border-radius:3px;pointer-events:none;white-space:nowrap;' +
  'will-change:transform;'
```

```typescript
// 変更前（project() L95-98）
el.style.display = ''
el.style.opacity = String(opacity)
el.style.left = `${sx}px`
el.style.top = `${sy}px`

// 変更後
el.style.display = ''
el.style.opacity = String(opacity)
el.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 100%))`
```

### 効果

- `transform` のみの変更は composite layer update のみで完了（layout/paint をスキップ）
- `will-change: transform` により GPU 合成レイヤーに昇格
- ラベル数 N に対して N 回の layout reflow → 0 回
- 初期 `cssText` で `left:0;top:0` を固定し、transform で位置制御

---

## 検証方法（共通）

1. `npm run build` が成功すること
2. `npm run lint` がエラーなしであること
3. `npm test` が全テスト通過すること
4. 20ft コンテナに 10 個程度の荷物を配置し、Chrome DevTools Performance タブで:
   - ドラッグ中のフレームレートが改善されていること（特に 2, 3）
   - `buildPickItems` の実行時間が 0.01ms 以下であること（キャッシュヒット時）（1）
   - Layout イベントがラベル更新時に発生しないこと（4）
