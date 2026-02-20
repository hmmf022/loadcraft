# 11: 自動積み付け（Auto Pack）

定義済み荷物を自動的にコンテナに詰め込む「Auto Pack」機能の設計書。

---

## 1. `BatchCommand`（`src/core/History.ts` に追加）

Auto Pack は複数の荷物を一括配置する。Undo で一括取り消しするために、複数の Command を束ねる `BatchCommand` が必要。

### TypeScript 定義

```typescript
export class BatchCommand implements Command {
  commands: Command[]
  placement: PlacedCargo  // 最初のコマンドの placement を代表として使用

  constructor(commands: Command[]) {
    this.commands = commands
    this.placement = commands[0]!.placement
  }

  execute(grid: VoxelGrid): boolean {
    for (const cmd of this.commands) {
      cmd.execute(grid)
    }
    return true
  }

  undo(grid: VoxelGrid): void {
    // 逆順で undo
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i]!.undo(grid)
    }
  }

  getDescription(): string {
    return `Auto Pack (${this.commands.length} items)`
  }
}
```

### undo の動作

```
[Auto Pack 実行]
  → BatchCommand.execute() → PlaceCommand[0].execute() → PlaceCommand[1].execute() → ...
[Undo]
  → BatchCommand.undo() → PlaceCommand[N-1].undo() → PlaceCommand[N-2].undo() → ...
  → 全荷物が一括で取り消される
```

### store の undo/redo への影響

`undo` / `redo` で `BatchCommand` を `instanceof` チェックする必要がある:

```typescript
// store.ts undo 内に追加
} else if (command instanceof BatchCommand) {
  // BatchCommand 内の PlaceCommand 群を逆適用
  newPlacements = state.placements.filter((p) =>
    !command.commands.some((c) => c.placement.instanceId === p.instanceId)
  )
}

// store.ts redo 内に追加
} else if (command instanceof BatchCommand) {
  const addedPlacements = command.commands.map((c) => c.placement)
  newPlacements = [...state.placements, ...addedPlacements]
}
```

---

## 2. `AutoPacker`（`src/core/AutoPacker.ts` 新規ファイル）

### TypeScript インターフェース

```typescript
import type { Vec3, CargoItemDef, PlacedCargo, ContainerDef, ShapeBlock } from './types'
import type { VoxelGrid } from './VoxelGrid'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'

export interface PackResult {
  placements: PlacedCargo[]        // 配置成功した荷物
  voxelizeResults: VoxelizeResult[] // 対応する VoxelizeResult（PlaceCommand 用）
  failedDefIds: string[]           // 配置できなかった荷物定義 ID
}
```

### アルゴリズム概要: BLB（Bottom-Left-Back）+ Y 軸 4 回転

1. **ソート**: 荷物定義を体積降順でソート（大きい荷物から詰める）
2. **配置数計算**: 各定義のカウント分だけ配置を試みる（現在の実装では各 cargoDef を 1 個ずつ配置。将来拡張で数量指定可能）
3. **回転探索**: 各荷物に対して Y 軸 0°, 90°, 180°, 270° の 4 回転を試す
4. **位置探索**: 各回転に対して BLB 順（Y→Z→X の昇順）で最初の衝突なし位置を採用
5. **スコアリング**: 配置可能な (position, rotation) 候補から最良を選択
   - スコア = `y * 1e8 + z * 1e4 + x`（Y 最小 → Z 最小 → X 最小を優先）

### 擬似コード

```typescript
export function autoPack(
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
  grid: VoxelGrid,
  startInstanceId: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []

  // 体積降順ソート
  const sorted = [...cargoDefs].sort((a, b) => {
    const volA = a.widthCm * a.heightCm * a.depthCm
    const volB = b.widthCm * b.heightCm * b.depthCm
    return volB - volA
  })

  let nextId = startInstanceId

  for (const def of sorted) {
    const rotations: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 90, z: 0 },
      { x: 0, y: 180, z: 0 },
      { x: 0, y: 270, z: 0 },
    ]

    let bestPos: Vec3 | null = null
    let bestRot: Vec3 = rotations[0]!
    let bestResult: VoxelizeResult | null = null
    let bestScore = Infinity

    for (const rot of rotations) {
      // 回転後 AABB で探索範囲を算出
      const testAABB = computeRotatedAABB(
        def.widthCm, def.heightCm, def.depthCm,
        { x: 0, y: 0, z: 0 }, rot,
      )
      const aabbW = testAABB.max.x - testAABB.min.x
      const aabbH = testAABB.max.y - testAABB.min.y
      const aabbD = testAABB.max.z - testAABB.min.z
      const offX = testAABB.min.x
      const offY = testAABB.min.y
      const offZ = testAABB.min.z

      // 探索範囲
      const minX = Math.max(0, Math.ceil(-offX))
      const maxX = Math.floor(container.widthCm - aabbW - offX)
      const minY = Math.max(0, Math.ceil(-offY))
      const maxY = Math.floor(container.heightCm - aabbH - offY)
      const minZ = Math.max(0, Math.ceil(-offZ))
      const maxZ = Math.floor(container.depthCm - aabbD - offZ)

      if (maxX < minX || maxY < minY || maxZ < minZ) continue

      // BLB: Y → Z → X 昇順
      let found = false
      for (let y = minY; y <= maxY && !found; y++) {
        for (let z = minZ; z <= maxZ && !found; z++) {
          for (let x = minX; x <= maxX && !found; x++) {
            const testPos = { x, y, z }
            const result = def.blocks
              ? voxelizeComposite(def.blocks, testPos, rot)
              : voxelize(def.widthCm, def.heightCm, def.depthCm, testPos, rot)

            const { min, max } = result.aabb
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

            if (!collision) {
              const score = y * 1e8 + z * 1e4 + x
              if (score < bestScore) {
                bestScore = score
                bestPos = testPos
                bestRot = rot
                bestResult = result
              }
              found = true // BLB: この回転での最初の有効位置を採用
            }
          }
        }
      }
    }

    if (bestPos && bestResult) {
      // VoxelGrid に即座に書き込み（後続荷物の衝突判定に反映）
      if (bestResult.usesFastPath) {
        const { min, max } = bestResult.aabb
        grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, nextId)
      } else {
        grid.fillVoxels(bestResult.voxels, nextId)
      }

      placements.push({
        instanceId: nextId,
        cargoDefId: def.id,
        positionCm: bestPos,
        rotationDeg: bestRot,
      })
      voxelizeResults.push(bestResult)
      nextId++
    } else {
      failedDefIds.push(def.id)
    }
  }

  // 方式B: grid から書き込みをクリアして返す
  // （呼び出し元が BatchCommand.execute() で再度書き込む）
  for (let i = 0; i < placements.length; i++) {
    const r = voxelizeResults[i]!
    if (r.usesFastPath) {
      const { min, max } = r.aabb
      grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, 0)
    } else {
      grid.fillVoxels(r.voxels, 0)
    }
  }

  return { placements, voxelizeResults, failedDefIds }
}
```

### パフォーマンス考察

| コンテナ | 荷物 10 個 | 荷物 50 個 |
|---------|-----------|-----------|
| 20ft | 数秒 | 数十秒（UI ブロック注意） |
| 40ft | 数秒〜10秒 | 分単位の可能性 |

- 将来的に Web Worker 化を検討（Phase 6 スコープ外）
- ステップ幅を 5cm にすれば大幅に高速化可能だが精度低下（トレードオフ）

---

## 3. Store の `autoPackCargo` アクション

### `AppState` インターフェースへの追加

```typescript
// src/state/store.ts の AppState に追加
autoPackCargo: () => void
```

### アクション実装

```typescript
autoPackCargo: () => {
  const state = get()
  if (state.cargoDefs.length === 0) {
    state.addToast('荷物が定義されていません', 'error')
    return
  }

  const grid = getVoxelGrid()

  // autoPack を呼出し（既存配置の上に追加）
  const result = autoPack(
    state.cargoDefs,
    state.container,
    grid,
    state.nextInstanceId,
  )

  if (result.placements.length === 0) {
    state.addToast('配置可能な位置が見つかりません', 'error')
    return
  }

  // BatchCommand を構築
  const commands: PlaceCommand[] = []
  for (let i = 0; i < result.placements.length; i++) {
    const p = result.placements[i]!
    const r = result.voxelizeResults[i]!
    const def = state.cargoDefs.find((d) => d.id === p.cargoDefId)
    if (!def) continue
    commands.push(new PlaceCommand(p.instanceId, r, def.name, p))
  }

  // 方式B: autoPack で grid への書き込みはクリア済み
  // BatchCommand.execute() で再度 grid に書き込む
  const batch = new BatchCommand(commands)
  historyManager.executeCommand(batch, grid)

  const newPlacements = [...state.placements, ...result.placements]
  const maxInstanceId = result.placements.reduce(
    (max, p) => Math.max(max, p.instanceId), state.nextInstanceId
  )

  const analytics = recomputeAnalytics(newPlacements, state.cargoDefs, state.container)

  set({
    placements: newPlacements,
    nextInstanceId: maxInstanceId + 1,
    canUndo: historyManager.canUndo,
    canRedo: historyManager.canRedo,
    renderVersion: state.renderVersion + 1,
    ...analytics,
  })

  const failCount = result.failedDefIds.length
  if (failCount > 0) {
    state.addToast(`${result.placements.length} 個配置、${failCount} 個配置不可`, 'info')
  } else {
    state.addToast(`${result.placements.length} 個すべて配置完了`, 'success')
  }
},
```

### autoPack の修正点（方式B）

`autoPack` 内で grid に書き込む箇所は、後続荷物の衝突判定に必要なため一時的に書き込む。
関数終了時に全書き込みをクリアして呼び出し元に返す。
呼び出し元が `BatchCommand.execute()` で再度 grid に書き込むことで HistoryManager の一貫性を保つ。

---

## 4. ToolBar UI

### 対象ファイル

- `src/ui/ToolBar.tsx`
- `src/ui/ToolBar.module.css`

### ToolBar.tsx の変更

```typescript
// import 追加
const autoPackCargo = useAppStore((s) => s.autoPackCargo)

// JSX: Force ボタンの後、separator の前に追加
<button
  className={styles.button}
  onClick={autoPackCargo}
>
  Auto Pack
</button>
```

### ToolBar.module.css の変更

なし。既存の `.button` スタイルをそのまま使用。

---

## 5. テスト（`src/core/__tests__/AutoPacker.test.ts` 新規）

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { VoxelGrid } from '../VoxelGrid'
import { autoPack } from '../AutoPacker'
import type { CargoItemDef, ContainerDef } from '../types'

describe('autoPack', () => {
  let grid: VoxelGrid
  const container: ContainerDef = {
    widthCm: 100, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
  }

  beforeEach(() => {
    grid = new VoxelGrid(100, 100, 100)
  })

  it('配置0個: 空の定義リスト', () => {
    const result = autoPack([], container, grid, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('1個の直方体を (0,0,0) に配置', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#ff0000',
    }]
    const result = autoPack(defs, container, grid, 1)
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('2個の直方体: 横並び配置', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, grid, 1)
    expect(result.placements).toHaveLength(2)
    // 体積同じなのでソート順は不定だが、Y=0 に2個入るはず
    for (const p of result.placements) {
      expect(p.positionCm.y).toBe(0)
    }
  })

  it('体積降順ソート: 大きい荷物が先に配置される', () => {
    const defs: CargoItemDef[] = [
      { id: 'small', name: 'S', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'large', name: 'L', widthCm: 50, heightCm: 50, depthCm: 50, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, grid, 1)
    expect(result.placements).toHaveLength(2)
    // large が先に配置（instanceId が小さい）
    expect(result.placements[0]!.cargoDefId).toBe('large')
  })

  it('コンテナに入らない荷物 → failedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'H', widthCm: 200, heightCm: 200, depthCm: 200,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, grid, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['huge'])
  })

  it('回転で入る荷物: 90° 回転して配置', () => {
    const defs: CargoItemDef[] = [{
      id: 'long', name: 'L', widthCm: 95, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#f00',
    }]
    // コンテナを幅50にして、回転なしでは入らないがY軸90°回転でdepth方向(100)に収まる
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const narrowGrid = new VoxelGrid(50, 100, 100)
    const result = autoPack(defs, narrowContainer, narrowGrid, 1)
    expect(result.placements).toHaveLength(1)
    // Y軸90°回転で配置されるはず
    expect(result.placements[0]!.rotationDeg.y).toBe(90)
  })

  it('既存配置がある状態でも衝突回避', () => {
    // (0,0,0) に 50x50x50 を事前配置
    grid.fillBox(0, 0, 0, 49, 49, 49, 999)
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, grid, 1)
    expect(result.placements).toHaveLength(1)
    // 既存配置の外に配置される
    const pos = result.placements[0]!.positionCm
    expect(pos.x >= 50 || pos.y >= 50 || pos.z >= 50).toBe(true)
  })

  it('instanceId が startInstanceId から連番', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, grid, 42)
    expect(result.placements[0]!.instanceId).toBe(42)
    expect(result.placements[1]!.instanceId).toBe(43)
  })
})
```

---

## 6. 検証方法

1. `npm run build` 成功
2. `npm run lint` エラーなし
3. `npm test` 全テスト通過（AutoPacker テスト含む）
4. ブラウザ操作:
   - 荷物を3種類定義
   - 「Auto Pack」ボタン押下 → 全荷物が自動配置される
   - Undo 1回 → 全荷物が一括で消える
   - Redo 1回 → 全荷物が一括で復元される
   - 既に手動配置した荷物がある状態で Auto Pack → 衝突せず追加配置される
   - コンテナに入りきらない荷物がある場合 → トースト通知で失敗数が表示される
