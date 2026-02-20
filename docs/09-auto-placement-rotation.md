# 09: 自動配置の回転対応

## 目的

サイドバーの「配置」ボタン（`CargoList.tsx` の `handlePlace`）経由の自動配置が常に `rotationDeg={0,0,0}` で配置する既知の制限を修正する。

---

## 1. 現状の問題

現在の `findPlacementPosition()` （`src/ui/CargoList.tsx` L101-141）:

```typescript
// 現在のシグネチャ — 回転パラメータなし
function findPlacementPosition(
  w: number, h: number, d: number,
  container: { widthCm: number; heightCm: number; depthCm: number },
): Vec3 | null
```

- 常に `w`, `h`, `d` を直接使って探索（回転を考慮しない）
- `grid.get()` による1cm ステップの直接走査
- 複合形状（`blocks?: ShapeBlock[]`）を受け取らない
- D&D 配置の `snapPosition` は回転対応済みだが、サイドバー配置は未対応

---

## 2. 変更対象ファイル

- `src/ui/CargoList.tsx` のみ
- **注意**: `findPlacementPosition` はコンポーネントファイルから export しない（react-refresh/only-export-components lint エラー回避）。ファイル内 private 関数のまま。

---

## 3. 新しいシグネチャ

```typescript
function findPlacementPosition(
  w: number, h: number, d: number,
  container: { widthCm: number; heightCm: number; depthCm: number },
  rotationDeg: Vec3,        // 追加: 配置時の回転角度
  blocks?: ShapeBlock[],    // 追加: 複合形状のブロック定義
): Vec3 | null
```

---

## 4. 必要な import 追加

```typescript
// 現在の import
import { getVoxelGrid } from '../core/voxelGridSingleton'
import type { Vec3 } from '../core/types'

// 追加する import
import type { ShapeBlock } from '../core/types'
import { computeRotatedAABB, voxelize, voxelizeComposite } from '../core/Voxelizer'
```

---

## 5. アルゴリズム（擬似コード）

`snapPosition`（`src/ui/CanvasPanel.tsx` L164-234）の X,Z 探索版。

```typescript
function findPlacementPosition(
  w: number, h: number, d: number,
  container: { widthCm: number; heightCm: number; depthCm: number },
  rotationDeg: Vec3,
  blocks?: ShapeBlock[],
): Vec3 | null {
  const cw = container.widthCm
  const ch = container.heightCm
  const cd = container.depthCm
  const grid = getVoxelGrid()

  // 1. 回転後 AABB サイズを算出（原点 {0,0,0} に仮配置）
  const testAABB = computeRotatedAABB(w, h, d, { x: 0, y: 0, z: 0 }, rotationDeg)
  const aabbW = testAABB.max.x - testAABB.min.x
  const aabbH = testAABB.max.y - testAABB.min.y
  const aabbD = testAABB.max.z - testAABB.min.z
  const offsetX = testAABB.min.x
  const offsetY = testAABB.min.y
  const offsetZ = testAABB.min.z

  // 2. 有効 Y 範囲: AABB が [0, ch] に収まる
  const minValidY = Math.max(0, Math.ceil(-offsetY))
  const maxValidY = Math.floor(ch - aabbH - offsetY)

  // 3. 有効 X 範囲
  const minValidX = Math.max(0, Math.ceil(-offsetX))
  const maxValidX = Math.floor(cw - aabbW - offsetX)

  // 4. 有効 Z 範囲
  const minValidZ = Math.max(0, Math.ceil(-offsetZ))
  const maxValidZ = Math.floor(cd - aabbD - offsetZ)

  const step = 1

  // 5. Y → Z → X の順で探索（底面から詰める BLB ヒューリスティック）
  for (let y = minValidY; y <= maxValidY; y += step) {
    for (let z = minValidZ; z <= maxValidZ; z += step) {
      for (let x = minValidX; x <= maxValidX; x += step) {
        const testPos = { x, y, z }

        // 6. voxelize してコリジョン判定
        const result = blocks
          ? voxelizeComposite(blocks, testPos, rotationDeg)
          : voxelize(w, h, d, testPos, rotationDeg)

        const { min, max } = result.aabb
        // 境界チェック
        if (min.x < 0 || min.y < 0 || min.z < 0) continue
        if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) continue

        // コリジョン判定
        let collision = false
        if (result.usesFastPath) {
          for (let vz = min.z; vz < max.z && !collision; vz++) {
            for (let vy = min.y; vy < max.y && !collision; vy++) {
              for (let vx = min.x; vx < max.x && !collision; vx++) {
                if (grid.get(vx, vy, vz) !== 0) collision = true
              }
            }
          }
        } else {
          collision = grid.hasCollision(result.voxels)
        }

        if (!collision) return testPos
      }
    }
  }
  return null
}
```

---

## 6. `handlePlace` の変更

```typescript
// 変更前（L11-23）
const handlePlace = (defId: string) => {
  const state = useAppStore.getState()
  const def = state.cargoDefs.find((d) => d.id === defId)
  if (!def) return
  const position = findPlacementPosition(def.widthCm, def.heightCm, def.depthCm, state.container)
  if (position) {
    placeCargo(defId, position)
  } else {
    alert('配置可能な位置が見つかりません')
  }
}

// 変更後
const handlePlace = (defId: string) => {
  const state = useAppStore.getState()
  const def = state.cargoDefs.find((d) => d.id === defId)
  if (!def) return
  const rotationDeg = { x: 0, y: 0, z: 0 }
  const position = findPlacementPosition(
    def.widthCm, def.heightCm, def.depthCm,
    state.container, rotationDeg, def.blocks,
  )
  if (position) {
    placeCargo(defId, position, rotationDeg)
  } else {
    alert('配置可能な位置が見つかりません')
  }
}
```

---

## 7. 参考実装

- `snapPosition`（`src/ui/CanvasPanel.tsx` L164-234）: `computeRotatedAABB` で AABB 算出 → Y スキャンで衝突なし位置を探索
- `isValidPosition`（`src/ui/CanvasPanel.tsx` L72-98）: `voxelize`/`voxelizeComposite` + 境界 + 衝突チェック
- `voxelizeCargo`（`src/state/store.ts` L592-597）: `blocks` の有無で `voxelize`/`voxelizeComposite` を分岐

---

## 8. パフォーマンス考察

- 20ft コンテナ (590×239×235) の場合、最大探索空間は 590×239×235 = 約 3300 万ポイント
- 実際にはコリジョン検出で早期 reject される（4 隅コーナーチェックは削除し、voxelize ベースの完全判定に統一）
- 大量配置時は探索が遅くなりうるが、Phase 6 のスコープでは許容（将来的に BLB 最適化可能）

---

## 9. 検証方法

1. 直方体荷物をサイドバー「配置」ボタンで配置 → Y=0, X=0, Z=0 に配置されること
2. 2個目を配置 → 1個目の横（X方向）に配置されること
3. 横に収まらなくなったら Z 方向にずれること
4. Z も埋まったら Y 方向（上段）に積まれること
5. 複合形状（blocks付き）荷物も同様に配置できること
6. `rotationDeg` を将来的に変更すれば回転付きで配置可能であること
