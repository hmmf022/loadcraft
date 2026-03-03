import { describe, it, expect } from 'vitest'
import { checkInterference } from '../InterferenceChecker'
import type { CargoItemDef, PlacedCargo } from '../types'

describe('checkInterference', () => {
  const defs: CargoItemDef[] = [
    { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#f00' },
    { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#0f0' },
    { id: 'c', name: 'C', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 1, color: '#00f' },
  ]

  it('干渉なし: 離れた2アイテム', () => {
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 20, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const result = checkInterference(placements, defs)
    expect(result.pairs).toHaveLength(0)
  })

  it('干渉あり: 重なる2アイテム', () => {
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const result = checkInterference(placements, defs)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]!.instanceId1).toBe(1)
    expect(result.pairs[0]!.instanceId2).toBe(2)
    expect(result.pairs[0]!.name1).toBe('A')
    expect(result.pairs[0]!.name2).toBe('B')
  })

  it('3アイテム中2ペア干渉', () => {
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 3, cargoDefId: 'c', positionCm: { x: 8, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const result = checkInterference(placements, defs)
    // A overlaps B (0-10 vs 5-15), B overlaps C (5-15 vs 8-18), A does not overlap C (0-10 vs 8-18 → overlaps!)
    // Actually A(0-10) and C(8-18) do overlap (8 < 10)
    expect(result.pairs).toHaveLength(3)
  })

  it('接触のみ(辺共有)は干渉なし', () => {
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 10, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const result = checkInterference(placements, defs)
    expect(result.pairs).toHaveLength(0)
  })

  it('配置0個: 空リスト', () => {
    const result = checkInterference([], defs)
    expect(result.pairs).toHaveLength(0)
  })
})
