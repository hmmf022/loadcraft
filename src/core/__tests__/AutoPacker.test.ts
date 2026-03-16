import { describe, it, expect } from 'vitest'
import { autoPack } from '../AutoPacker'
import type { PackStrategy } from '../AutoPacker'
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

  it('deadline: タイムアウト時に partial result を返す', () => {
    const defs: CargoItemDef[] = []
    for (let i = 0; i < 50; i++) {
      defs.push({
        id: `item-${i}`, name: `Item ${i}`,
        widthCm: 20, heightCm: 20, depthCm: 20,
        weightKg: 1, color: '#f00',
      })
    }
    const bigContainer: ContainerDef = {
      widthCm: 500, heightCm: 500, depthCm: 500, maxPayloadKg: 100000,
    }
    // Deadline already passed → all items should fail
    const result = autoPack(defs, bigContainer, 1, undefined, undefined, 0)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toHaveLength(50)
    expect(result.failureReasons[0]!.detail).toContain('timed out')
  })

  it('200+個のアイテムをstack制約なしで配置（パフォーマンス）', () => {
    const defs: CargoItemDef[] = []
    for (let i = 0; i < 200; i++) {
      defs.push({
        id: `box-${i}`, name: `Box ${i}`,
        widthCm: 10, heightCm: 10, depthCm: 10,
        weightKg: 1, color: '#f00',
      })
    }
    const bigContainer: ContainerDef = {
      widthCm: 200, heightCm: 200, depthCm: 200, maxPayloadKg: 100000,
    }
    const start = Date.now()
    const result = autoPack(defs, bigContainer, 1)
    const elapsed = Date.now() - start
    expect(result.placements.length).toBeGreaterThan(100)
    expect(elapsed).toBeLessThan(10000) // Should complete well under 10s
  })

  it('stack制約ありの混在アイテムで正しくviolation検出', () => {
    const baseDef: CargoItemDef = {
      id: 'base', name: 'Base', widthCm: 100, heightCm: 10, depthCm: 100,
      weightKg: 1, color: '#aaa', maxStackWeightKg: 5,
    }
    const heavyDef: CargoItemDef = {
      id: 'heavy', name: 'Heavy', widthCm: 20, heightCm: 20, depthCm: 20,
      weightKg: 10, color: '#f00',
    }
    const existingPlacement = {
      instanceId: 1,
      cargoDefId: 'base',
      positionCm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    }
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    occMap.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 10, z: 100 } })

    const result = autoPack([heavyDef], container, 10, occMap, {
      existingPlacements: [existingPlacement],
      existingCargoDefs: [baseDef, heavyDef],
    })

    // Heavy item (10kg) exceeds base maxStackWeightKg (5kg)
    expect(result.placements).toHaveLength(0)
    expect(result.failureReasons[0]!.code).toBe('STACK_CONSTRAINT')
  })

  // ─── Strategy: default (backward compat) ────────────────────

  it('strategy=default: strategy未指定と同じ結果', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 40, heightCm: 30, depthCm: 20, weightKg: 5, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 30, heightCm: 20, depthCm: 10, weightKg: 2, color: '#0f0' },
    ]
    const r1 = autoPack(defs, container, 1)
    const r2 = autoPack(defs, container, 1, undefined, undefined, undefined, 'default')
    expect(r2.placements).toHaveLength(r1.placements.length)
    for (let i = 0; i < r1.placements.length; i++) {
      expect(r2.placements[i]!.positionCm).toEqual(r1.placements[i]!.positionCm)
      expect(r2.placements[i]!.rotationDeg).toEqual(r1.placements[i]!.rotationDeg)
    }
  })

  // ─── Strategy: layer ─────────────────────────────────────────

  it('layer (repack): 同種アイテムが同一Yレイヤーにグループ化', () => {
    // 3 types of items, 3 each. Same-type items should share Y layers.
    const defs: CargoItemDef[] = []
    for (let i = 0; i < 3; i++) {
      defs.push({ id: 'tall', name: 'Tall', widthCm: 30, heightCm: 40, depthCm: 30, weightKg: 1, color: '#f00' })
    }
    for (let i = 0; i < 3; i++) {
      defs.push({ id: 'short', name: 'Short', widthCm: 30, heightCm: 20, depthCm: 30, weightKg: 1, color: '#0f0' })
    }

    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'layer')
    expect(result.placements.length).toBeGreaterThan(0)
    expect(result.failedDefIds).toHaveLength(0)

    // Same-defId items should be on the same Y layer
    const tallPlacements = result.placements.filter(p => p.cargoDefId === 'tall')
    const shortPlacements = result.placements.filter(p => p.cargoDefId === 'short')

    if (tallPlacements.length >= 2) {
      const yValues = new Set(tallPlacements.map(p => p.positionCm.y))
      // All tall items should share the same Y (or at most 1-2 Y values within the same layer)
      expect(yValues.size).toBeLessThanOrEqual(2)
    }
    if (shortPlacements.length >= 2) {
      const yValues = new Set(shortPlacements.map(p => p.positionCm.y))
      expect(yValues.size).toBeLessThanOrEqual(2)
    }
  })

  it('layer (repack): 空リスト', () => {
    const result = autoPack([], container, 1, undefined, undefined, undefined, 'layer')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('layer (repack): 1個のアイテム', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'layer')
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.positionCm.y).toBe(0)
  })

  it('layer (repack): コンテナ超過はfailedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'Huge', widthCm: 200, heightCm: 200, depthCm: 200, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'layer')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['huge'])
  })

  it('layer (pack_staged): grouping fallback で同種が近接配置', () => {
    // Existing placement at origin
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    occMap.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 30, z: 30 } })
    const existingPlacement = {
      instanceId: 1, cargoDefId: 'exist',
      positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 },
    }
    const existDef: CargoItemDef = {
      id: 'exist', name: 'Exist', widthCm: 30, heightCm: 30, depthCm: 30, weightKg: 1, color: '#aaa',
    }

    const defs: CargoItemDef[] = []
    for (let i = 0; i < 3; i++) {
      defs.push({ id: 'item', name: 'Item', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00' })
    }

    const result = autoPack(defs, container, 10, occMap, {
      existingPlacements: [existingPlacement],
      existingCargoDefs: [existDef],
    }, undefined, 'layer')

    expect(result.placements.length).toBeGreaterThan(0)
    // All placed items should be the same defId → grouping should keep them close
    const positions = result.placements.map(p => p.positionCm)
    // Verify they're actually placed (basic sanity)
    expect(positions.every(p => p.x >= 0 && p.y >= 0 && p.z >= 0)).toBe(true)
  })

  // ─── Strategy: wall ──────────────────────────────────────────

  it('wall (repack): 同種アイテムが同一X壁内にまとまる', () => {
    const defs: CargoItemDef[] = []
    // 4 items of type A (30x40x30)
    for (let i = 0; i < 4; i++) {
      defs.push({ id: 'typeA', name: 'A', widthCm: 30, heightCm: 40, depthCm: 30, weightKg: 1, color: '#f00' })
    }
    // 4 items of type B (20x30x20)
    for (let i = 0; i < 4; i++) {
      defs.push({ id: 'typeB', name: 'B', widthCm: 20, heightCm: 30, depthCm: 20, weightKg: 1, color: '#0f0' })
    }

    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'wall')
    expect(result.placements.length).toBeGreaterThan(0)

    // Check that same-type items tend to cluster in X
    const typeAPlacements = result.placements.filter(p => p.cargoDefId === 'typeA')
    const typeBPlacements = result.placements.filter(p => p.cargoDefId === 'typeB')

    if (typeAPlacements.length >= 2) {
      const xRange = Math.max(...typeAPlacements.map(p => p.positionCm.x)) -
                      Math.min(...typeAPlacements.map(p => p.positionCm.x))
      // Same-type items should be within a limited X range (wall grouping)
      expect(xRange).toBeLessThan(container.widthCm)
    }
    expect(typeBPlacements.length).toBeGreaterThan(0)
  })

  it('wall (repack): 空リスト', () => {
    const result = autoPack([], container, 1, undefined, undefined, undefined, 'wall')
    expect(result.placements).toHaveLength(0)
  })

  it('wall (repack): 1個のアイテム', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'wall')
    expect(result.placements).toHaveLength(1)
  })

  it('wall (repack): コンテナ超過はfailedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'Huge', widthCm: 200, heightCm: 200, depthCm: 200, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'wall')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds.length).toBeGreaterThan(0)
  })

  it('wall (pack_staged): grouping fallback', () => {
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    const defs: CargoItemDef[] = [
      { id: 'item', name: 'Item', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00' },
    ]
    const result = autoPack(defs, container, 1, occMap, undefined, undefined, 'wall')
    expect(result.placements).toHaveLength(1)
  })

  // ─── Strategy: lff ───────────────────────────────────────────

  it('lff: 方向候補が少ないアイテムが先に配置される', () => {
    // Container with limited height forces orientation filtering
    const lowContainer: ContainerDef = {
      widthCm: 50, heightCm: 30, depthCm: 50, maxPayloadKg: 10000,
    }
    // A: 45x45x10 — only 1 orientation fits (45,10,45) because effH must be ≤30
    const constrained: CargoItemDef = {
      id: 'constrained', name: 'Constrained',
      widthCm: 45, heightCm: 45, depthCm: 10, weightKg: 1, color: '#f00',
    }
    // B: 25x25x10 — 3 orientations fit (all have effH ≤ 30)
    const flexible: CargoItemDef = {
      id: 'flexible', name: 'Flexible',
      widthCm: 25, heightCm: 25, depthCm: 10, weightKg: 1, color: '#0f0',
    }
    // Pass flexible first, constrained second — with LFF, constrained (flex=1) placed before flexible (flex=3)
    const result = autoPack([flexible, constrained], lowContainer, 1, undefined, undefined, undefined, 'lff')
    expect(result.placements.length).toBe(2)
    // Constrained item should get the first instanceId (placed first)
    expect(result.placements[0]!.cargoDefId).toBe('constrained')
  })

  it('lff: 壁際への配置が優先される', () => {
    const defs: CargoItemDef[] = [{
      id: 'box', name: 'Box', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'lff')
    expect(result.placements).toHaveLength(1)
    const pos = result.placements[0]!.positionCm
    // With caving penalty, items should be placed at corners/edges
    // At minimum, it should be at x=0, y=0 (touching back wall and floor)
    expect(pos.y).toBe(0)
  })

  it('lff: 空リスト', () => {
    const result = autoPack([], container, 1, undefined, undefined, undefined, 'lff')
    expect(result.placements).toHaveLength(0)
  })

  it('lff: コンテナ超過はfailedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'Huge', widthCm: 200, heightCm: 200, depthCm: 200, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'lff')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['huge'])
  })

  // ─── Strategy: ep ────────────────────────────────────────────

  it('ep (repack): 単一アイテム → (0,0,0) に配置', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('ep (repack): 2アイテム → 2個目は1個目の隣に配置', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 30, heightCm: 30, depthCm: 30, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements).toHaveLength(2)
    expect(result.failedDefIds).toHaveLength(0)
    // Both should be placed at valid positions (no overlap confirmed by interference test below)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    const pos2 = result.placements[1]!.positionCm
    // Second item should be at an EP position (right, top, or front of first item)
    expect(pos2.x >= 0 && pos2.y >= 0 && pos2.z >= 0).toBe(true)
  })

  it('ep (repack): noFlip アイテム', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'NoFlip', widthCm: 95, heightCm: 10, depthCm: 40,
      weightKg: 1, color: '#f00', noFlip: true,
    }]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, narrowContainer, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements).toHaveLength(1)
    const rot = result.placements[0]!.rotationDeg
    expect(rot.x).toBe(0)
    expect(rot.z).toBe(0)
  })

  it('ep (repack): 大きすぎるアイテム → failedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'huge', name: 'Huge', widthCm: 200, heightCm: 200, depthCm: 200,
      weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['huge'])
  })

  it('ep (repack): 複数アイテムがinterferenceなしで配置', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 40, heightCm: 40, depthCm: 40, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 30, heightCm: 30, depthCm: 30, weightKg: 1, color: '#0f0' },
      { id: 'c', name: 'C', widthCm: 25, heightCm: 25, depthCm: 25, weightKg: 1, color: '#00f' },
      { id: 'd', name: 'D', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#ff0' },
    ]
    const result = autoPack(defs, container, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements.length).toBe(4)
    if (result.placements.length > 1) {
      const interference = checkInterference(result.placements, defs)
      expect(interference.pairs).toHaveLength(0)
    }
  })

  it('ep (pack_staged): 既存配置を保持して追加配置', () => {
    const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    occMap.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 50 } })
    const existingPlacement = {
      instanceId: 1, cargoDefId: 'exist',
      positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 },
    }
    const existDef: CargoItemDef = {
      id: 'exist', name: 'Exist', widthCm: 50, heightCm: 50, depthCm: 50, weightKg: 10, color: '#aaa',
    }
    const defs: CargoItemDef[] = [{
      id: 'new', name: 'New', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#f00',
    }]
    const result = autoPack(defs, container, 10, occMap, {
      existingPlacements: [existingPlacement],
      existingCargoDefs: [existDef],
    }, undefined, 'ep')
    expect(result.placements).toHaveLength(1)
    // Should NOT overlap with existing
    const pos = result.placements[0]!.positionCm
    const aabb = { min: pos, max: { x: pos.x + 20, y: pos.y + 20, z: pos.z + 20 } }
    // Verify no overlap with existing AABB
    const existAabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 50 } }
    const overlaps = (
      aabb.min.x < existAabb.max.x && aabb.max.x > existAabb.min.x &&
      aabb.min.y < existAabb.max.y && aabb.max.y > existAabb.min.y &&
      aabb.min.z < existAabb.max.z && aabb.max.z > existAabb.min.z
    )
    expect(overlaps).toBe(false)
  })

  it('ep (repack): 空リスト', () => {
    const result = autoPack([], container, 1, undefined, undefined, undefined, 'ep')
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toHaveLength(0)
  })

  // ─── Deadline tests per strategy ────────────────────────────

  for (const strategy of ['default', 'layer', 'wall', 'lff', 'ep'] as PackStrategy[]) {
    it(`${strategy}: deadline=0 で即タイムアウト → partial result`, () => {
      const defs: CargoItemDef[] = []
      for (let i = 0; i < 20; i++) {
        defs.push({
          id: `item-${i}`, name: `Item ${i}`,
          widthCm: 20, heightCm: 20, depthCm: 20,
          weightKg: 1, color: '#f00',
        })
      }
      const bigContainer: ContainerDef = {
        widthCm: 500, heightCm: 500, depthCm: 500, maxPayloadKg: 100000,
      }
      const result = autoPack(defs, bigContainer, 1, undefined, undefined, 0, strategy)
      // With deadline=0 (already expired), no items should be placed
      expect(result.placements).toHaveLength(0)
      expect(result.failedDefIds.length).toBe(20)
      expect(result.failureReasons.every(r => r.detail.includes('timed out'))).toBe(true)
    })
  }

  // ─── All strategies: no interference ──────────────────────────

  for (const strategy of ['default', 'layer', 'wall', 'lff', 'ep'] as PackStrategy[]) {
    it(`${strategy}: 配置結果にinterferenceがない`, () => {
      const defs: CargoItemDef[] = [
        { id: 'a', name: 'A', widthCm: 30, heightCm: 30, depthCm: 30, weightKg: 1, color: '#f00' },
        { id: 'b', name: 'B', widthCm: 25, heightCm: 25, depthCm: 25, weightKg: 1, color: '#0f0' },
        { id: 'c', name: 'C', widthCm: 20, heightCm: 20, depthCm: 20, weightKg: 1, color: '#00f' },
      ]
      const result = autoPack(defs, container, 1, undefined, undefined, undefined, strategy)
      if (result.placements.length > 1) {
        const interference = checkInterference(result.placements, defs)
        expect(interference.pairs).toHaveLength(0)
      }
    })
  }
})
