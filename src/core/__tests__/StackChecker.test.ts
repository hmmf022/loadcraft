import { describe, it, expect } from 'vitest'
import { checkStackConstraints } from '../StackChecker'
import type { PlacedCargo, CargoItemDef } from '../types'

describe('checkStackConstraints', () => {
  it('returns empty for no placements', () => {
    expect(checkStackConstraints([], [])).toEqual([])
  })

  it('returns empty when no constraints are set', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#0f0' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 10, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    expect(checkStackConstraints(placements, defs)).toEqual([])
  })

  it('reports violation for noStack with item on top', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'Fragile', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#f00', noStack: true },
      { id: 'b', name: 'Heavy', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 30, color: '#0f0' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 10, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const violations = checkStackConstraints(placements, defs)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.instanceId).toBe(1)
    expect(violations[0]!.maxStackWeightKg).toBe(0)
    expect(violations[0]!.actualStackWeightKg).toBe(30)
  })

  it('maxStackWeightKg: within limit → no violation', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'Base', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#f00', maxStackWeightKg: 50 },
      { id: 'b', name: 'Light', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 30, color: '#0f0' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 10, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    expect(checkStackConstraints(placements, defs)).toEqual([])
  })

  it('maxStackWeightKg: exceeded → violation', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'Base', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#f00', maxStackWeightKg: 50 },
      { id: 'b', name: 'Heavy', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 70, color: '#0f0' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 10, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    const violations = checkStackConstraints(placements, defs)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.instanceId).toBe(1)
    expect(violations[0]!.maxStackWeightKg).toBe(50)
    expect(violations[0]!.actualStackWeightKg).toBe(70)
  })

  it('chained stack (A→B→C): weight propagation', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 100, color: '#f00', maxStackWeightKg: 80 },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 30, color: '#0f0' },
      { id: 'c', name: 'C', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 60, color: '#00f' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 10, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 3, cargoDefId: 'c', positionCm: { x: 0, y: 20, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    // A has B(30) + C(60) = 90 on top, exceeding maxStackWeightKg=80
    const violations = checkStackConstraints(placements, defs)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.instanceId).toBe(1)
    expect(violations[0]!.actualStackWeightKg).toBe(90)
  })

  it('no violation when items are side by side (no vertical overlap)', () => {
    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#f00', noStack: true },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 10, depthCm: 10, weightKg: 50, color: '#0f0' },
    ]
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 20, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]
    expect(checkStackConstraints(placements, defs)).toEqual([])
  })
})
