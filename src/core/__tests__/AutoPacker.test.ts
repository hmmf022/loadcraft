import { describe, it, expect } from 'vitest'
import { autoPack } from '../AutoPacker'
import { OccupancyMap } from '../OccupancyMap'
import { computeRotatedAABB } from '../Voxelizer'
import { checkInterference } from '../InterferenceChecker'
import type { CargoItemDef, ContainerDef } from '../types'

describe('autoPack', () => {
  const container: ContainerDef = {
    widthCm: 100, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
  }

  it('配置0個: 空の定義リスト', () => {
    const result = autoPack([], container, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('1個の直方体を奥壁に配置', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#ff0000',
    }]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(1)
    // 奥壁: x = 0
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('2個の直方体: 配置成功', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    expect(result.failedDefIds).toHaveLength(0)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    // 2nd item placed at floor level
    expect(result.placements[1]!.positionCm.y).toBe(0)
  })

  it('体積降順ソート: 大きい荷物が先に配置される', () => {
    const defs: CargoItemDef[] = [
      { id: 'small', name: 'S', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'large', name: 'L', widthCm: 50, heightCm: 50, depthCm: 50, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    // large が先に配置（instanceId が小さい）
    expect(result.placements[0]!.cargoDefId).toBe('large')
  })

  it('コンテナに入らない荷物 → failedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'H', widthCm: 200, heightCm: 200, depthCm: 200,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['huge'])
  })

  it('回転で収まるケース: 幅が広すぎても回転で配置可能', () => {
    const defs: CargoItemDef[] = [{
      id: 'long', name: 'L', widthCm: 95, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#f00',
    }]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, narrowContainer, 1)
    // Should succeed with rotation (e.g., 90° Y puts W→D: 10×10×95)
    expect(result.placements).toHaveLength(1)
    expect(result.failedDefIds).toHaveLength(0)
    // The rotation should not be {0,0,0} since 95 > 50 (container width)
    const rot = result.placements[0]!.rotationDeg
    expect(rot).not.toEqual({ x: 0, y: 0, z: 0 })
  })

  it('棚積み: 2つのアイテムが隣接配置される', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 60, heightCm: 60, depthCm: 60, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 40, heightCm: 40, depthCm: 40, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    // 1st (larger volume): x=0, z=0
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    // 2nd: should be at floor level (y=0)
    expect(result.placements[1]!.positionCm.y).toBe(0)
  })

  it('棚積み: 3つのアイテムが全て配置される', () => {
    // 3 cubes of 40cm in 100cm container
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 40, heightCm: 40, depthCm: 40, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 40, heightCm: 40, depthCm: 40, weightKg: 1, color: '#0f0' },
      { id: 'c', name: 'C', widthCm: 40, heightCm: 40, depthCm: 40, weightKg: 1, color: '#00f' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(3)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    // First two items at floor level, third may stack (OccupancyMap prefers X=0)
    expect(result.placements[0]!.positionCm.y).toBe(0)
    expect(result.placements[1]!.positionCm.y).toBe(0)
  })

  it('棚積み: レイヤー折り返し', () => {
    // Use cubes that fill entire XZ plane so next item must go to next layer
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 100, heightCm: 30, depthCm: 100, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 100, heightCm: 30, depthCm: 100, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    // Both should be placed
    expect(result.failedDefIds).toHaveLength(0)
    // 1st at origin
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    // 2nd goes up (either y or z depends on rotation), but must be at a different position
    const pos2 = result.placements[1]!.positionCm
    expect(pos2.x + pos2.y + pos2.z).toBeGreaterThan(0)
  })

  it('instanceId が startInstanceId から連番', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 42)
    expect(result.placements[0]!.instanceId).toBe(42)
    expect(result.placements[1]!.instanceId).toBe(43)
  })

  it('noFlip: Y軸回転のみ使用', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'NoFlip', widthCm: 95, heightCm: 10, depthCm: 40,
      weightKg: 1, color: '#f00', noFlip: true,
    }]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, narrowContainer, 1)
    // 95×10×40 with noFlip can rotate Y90 → 40×10×95 which fits (40 < 50 width)
    expect(result.placements).toHaveLength(1)
    const rot = result.placements[0]!.rotationDeg
    // Must be Y-axis only rotation
    expect(rot.x).toBe(0)
    expect(rot.z).toBe(0)
  })

  it('noFlip: item that cannot fit even with Y rotation → failedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'NoFlip', widthCm: 95, heightCm: 10, depthCm: 80,
      weightKg: 1, color: '#f00', noFlip: true,
    }]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 20, depthCm: 50, maxPayloadKg: 10000,
    }
    // 95×10×80 with noFlip: original=95×10×80, Y90=80×10×95, neither fits in 50×20×50
    const result = autoPack(defs, narrowContainer, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['a'])
    expect(result.failureReasons).toHaveLength(1)
    expect(result.failureReasons[0]!.code).toBe('OUT_OF_BOUNDS')
  })

  it('cube item has only 1 orientation candidate (deduplication)', () => {
    const defs: CargoItemDef[] = [{
      id: 'cube', name: 'Cube', widthCm: 30, heightCm: 30, depthCm: 30,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(1)
    // Should place with identity rotation since all orientations yield same AABB
    expect(result.placements[0]!.rotationDeg).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('同一defの複数個配置', () => {
    const def: CargoItemDef = {
      id: 'a', name: 'A', widthCm: 30, heightCm: 30, depthCm: 30,
      weightKg: 1, color: '#f00',
    }
    // Pass same def 3 times to simulate 3 items
    const result = autoPack([def, def, def], container, 1)
    expect(result.placements).toHaveLength(3)
    expect(result.failedDefIds).toHaveLength(0)
    // All should have different positions
    const positions = result.placements.map((p) => `${p.positionCm.x},${p.positionCm.y},${p.positionCm.z}`)
    expect(new Set(positions).size).toBe(3)
  })

  it('baseOccMap: pack-staged モード（既存配置を保持）', () => {
    // Simulate existing placement occupying the origin corner
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    occMap.markAABB({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 50 },
    })

    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 30, heightCm: 30, depthCm: 30,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 10, occMap)
    expect(result.placements).toHaveLength(1)
    // Should NOT be at origin (occupied by existing)
    const pos = result.placements[0]!.positionCm
    expect(pos.x >= 50 || pos.y >= 50 || pos.z >= 50).toBe(true)
  })

  it('baseOccMap なし: 空マップから開始', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('回転配置の AABB が computeRotatedAABB と一致', () => {
    // 高さ 95cm のアイテム → 高さ 50cm のコンテナでは回転が必要
    const defs: CargoItemDef[] = [{
      id: 'tall', name: 'Tall', widthCm: 30, heightCm: 95, depthCm: 20,
      weightKg: 1, color: '#f00',
    }]
    const smallContainer: ContainerDef = {
      widthCm: 100, heightCm: 50, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, smallContainer, 1)
    expect(result.placements).toHaveLength(1)

    const p = result.placements[0]!
    // 非恒等回転であること
    expect(p.rotationDeg).not.toEqual({ x: 0, y: 0, z: 0 })

    // InterferenceChecker と同じ方法で AABB を再計算
    const def = defs[0]!
    const recomputedAABB = computeRotatedAABB(
      def.widthCm, def.heightCm, def.depthCm,
      p.positionCm, p.rotationDeg,
    )
    // autoPack が返す voxelizeResult.aabb と一致すること
    const packAABB = result.voxelizeResults[0]!.aabb
    expect(recomputedAABB.min).toEqual(packAABB.min)
    expect(recomputedAABB.max).toEqual(packAABB.max)
  })

  it('回転配置後に checkInterference が干渉なしを返す', () => {
    // 回転が必要な2つのアイテムを配置
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 80, heightCm: 30, depthCm: 40, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 80, heightCm: 30, depthCm: 40, weightKg: 1, color: '#0f0' },
    ]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, narrowContainer, 1)
    expect(result.placements.length).toBeGreaterThan(0)

    // checkInterference で干渉なし
    const interference = checkInterference(result.placements, defs)
    expect(interference.pairs).toHaveLength(0)
  })

  it('stack制約違反時に failureReasons を返す', () => {
    const existingDef: CargoItemDef = {
      id: 'base', name: 'Base', widthCm: 100, heightCm: 10, depthCm: 100,
      weightKg: 1, color: '#aaa', maxStackWeightKg: 0,
    }
    const existingPlacement = {
      instanceId: 1,
      cargoDefId: 'base',
      positionCm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    }
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    occMap.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 10, z: 100 } })
    const stagedDef: CargoItemDef = {
      id: 'top', name: 'Top', widthCm: 20, heightCm: 20, depthCm: 20,
      weightKg: 10, color: '#f00',
    }

    const result = autoPack([stagedDef], container, 10, occMap, {
      existingPlacements: [existingPlacement],
      existingCargoDefs: [existingDef, stagedDef],
    })

    expect(result.placements).toHaveLength(0)
    expect(result.failureReasons).toHaveLength(1)
    expect(result.failureReasons[0]!.code).toBe('STACK_CONSTRAINT')
  })
})
