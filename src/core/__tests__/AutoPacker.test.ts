import { describe, it, expect } from 'vitest'
import { autoPack } from '../AutoPacker'
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

  it('1個の直方体を (0,0,0) に配置', () => {
    const defs: CargoItemDef[] = [{
      id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#ff0000',
    }]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.failedDefIds).toHaveLength(0)
  })

  it('2個の直方体: 横並び配置', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 50, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    // Both placed at Y=0
    for (const p of result.placements) {
      expect(p.positionCm.y).toBe(0)
    }
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

  it('回転なし: 幅が収まらない荷物は failedDefIds', () => {
    const defs: CargoItemDef[] = [{
      id: 'long', name: 'L', widthCm: 95, heightCm: 10, depthCm: 10,
      weightKg: 1, color: '#f00',
    }]
    const narrowContainer: ContainerDef = {
      widthCm: 50, heightCm: 100, depthCm: 100, maxPayloadKg: 10000,
    }
    const result = autoPack(defs, narrowContainer, 1)
    expect(result.placements).toHaveLength(0)
    expect(result.failedDefIds).toEqual(['long'])
  })

  it('棚積み: 行折り返し', () => {
    // 3個の60cm幅アイテム → 1個目x=0, 2個目はx=60で入らない→次行x=0
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 60, heightCm: 10, depthCm: 20, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 60, heightCm: 10, depthCm: 20, weightKg: 1, color: '#0f0' },
      { id: 'c', name: 'C', widthCm: 60, heightCm: 10, depthCm: 20, weightKg: 1, color: '#00f' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(3)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.placements[1]!.positionCm).toEqual({ x: 0, y: 0, z: 20 })
    expect(result.placements[2]!.positionCm).toEqual({ x: 0, y: 0, z: 40 })
  })

  it('棚積み: レイヤー折り返し', () => {
    // Fill depth with items, then next layer
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 100, heightCm: 30, depthCm: 100, weightKg: 1, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 100, heightCm: 30, depthCm: 100, weightKg: 1, color: '#0f0' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements).toHaveLength(2)
    expect(result.placements[0]!.positionCm).toEqual({ x: 0, y: 0, z: 0 })
    // Second item goes to next layer (y=30)
    expect(result.placements[1]!.positionCm).toEqual({ x: 0, y: 30, z: 0 })
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

  it('常に rotationDeg={0,0,0} で配置', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 20, depthCm: 30, weightKg: 1, color: '#f00' },
    ]
    const result = autoPack(defs, container, 1)
    expect(result.placements[0]!.rotationDeg).toEqual({ x: 0, y: 0, z: 0 })
  })
})
