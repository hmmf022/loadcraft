import { describe, it, expect } from 'vitest'
import { buildStackContext, checkStackIncremental, addToStackContext } from '../StackChecker'
import type { PlacedCargo, CargoItemDef } from '../types'

describe('incremental stack checking', () => {
  const makeDef = (id: string, weight: number, opts?: { noStack?: boolean; maxStackWeightKg?: number }): CargoItemDef => ({
    id, name: id, widthCm: 10, heightCm: 10, depthCm: 10,
    weightKg: weight, color: '#f00', ...opts,
  })

  const makePlace = (id: number, defId: string, y: number): PlacedCargo => ({
    instanceId: id, cargoDefId: defId,
    positionCm: { x: 0, y, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
  })

  it('buildStackContext creates correct graph', () => {
    const defs = [makeDef('a', 10), makeDef('b', 20)]
    const placements = [makePlace(1, 'a', 0), makePlace(2, 'b', 10)]
    const ctx = buildStackContext(placements, defs)

    expect(ctx.aabbs).toHaveLength(2)
    expect(ctx.onTopOf[0]).toEqual([1]) // b is on top of a
    expect(ctx.supportedBy[1]).toEqual([0]) // b is supported by a
  })

  it('no violation when placing next to constrained item', () => {
    const defs = [makeDef('a', 10, { noStack: true }), makeDef('b', 20)]
    const placements = [makePlace(1, 'a', 0)]
    const ctx = buildStackContext(placements, defs)

    // Place b next to a (not on top)
    const newPlacement: PlacedCargo = {
      instanceId: 2, cargoDefId: 'b',
      positionCm: { x: 20, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    }
    const violations = checkStackIncremental(ctx, newPlacement, defs[1]!)
    expect(violations).toHaveLength(0)
  })

  it('detects violation when placing on noStack item', () => {
    const defs = [makeDef('a', 10, { noStack: true }), makeDef('b', 5)]
    const placements = [makePlace(1, 'a', 0)]
    const ctx = buildStackContext(placements, defs)

    // Place b on top of a
    const newPlacement = makePlace(2, 'b', 10)
    const violations = checkStackIncremental(ctx, newPlacement, defs[1]!)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.instanceId).toBe(1)
    expect(violations[0]!.maxStackWeightKg).toBe(0)
  })

  it('detects violation for maxStackWeightKg exceeded', () => {
    const defs = [makeDef('a', 10, { maxStackWeightKg: 3 }), makeDef('b', 5)]
    const placements = [makePlace(1, 'a', 0)]
    const ctx = buildStackContext(placements, defs)

    const newPlacement = makePlace(2, 'b', 10)
    const violations = checkStackIncremental(ctx, newPlacement, defs[1]!)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.actualStackWeightKg).toBe(5)
    expect(violations[0]!.maxStackWeightKg).toBe(3)
  })

  it('within maxStackWeightKg → no violation', () => {
    const defs = [makeDef('a', 10, { maxStackWeightKg: 50 }), makeDef('b', 5)]
    const placements = [makePlace(1, 'a', 0)]
    const ctx = buildStackContext(placements, defs)

    const newPlacement = makePlace(2, 'b', 10)
    const violations = checkStackIncremental(ctx, newPlacement, defs[1]!)
    expect(violations).toHaveLength(0)
  })

  it('chained stack: A→B→C, adding C violates A', () => {
    const defs = [
      makeDef('a', 10, { maxStackWeightKg: 20 }),
      makeDef('b', 15),
      makeDef('c', 10),
    ]
    const placements = [makePlace(1, 'a', 0), makePlace(2, 'b', 10)]
    const ctx = buildStackContext(placements, defs)

    // A already has B(15) on top. Adding C(10) on B → A has 15+10=25 > maxStack=20
    const newPlacement = makePlace(3, 'c', 20)
    const violations = checkStackIncremental(ctx, newPlacement, defs[2]!)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.instanceId).toBe(1) // A is violated
    expect(violations[0]!.actualStackWeightKg).toBe(25) // 15 (existing) + 10 (new)
  })

  it('addToStackContext updates graph correctly', () => {
    const defs = [makeDef('a', 10), makeDef('b', 20)]
    const placements = [makePlace(1, 'a', 0)]
    const ctx = buildStackContext(placements, defs)

    const newPlacement = makePlace(2, 'b', 10)
    addToStackContext(ctx, newPlacement, defs[1]!)

    expect(ctx.aabbs).toHaveLength(2)
    expect(ctx.onTopOf[0]).toEqual([1]) // b on top of a
    expect(ctx.supportedBy[1]).toEqual([0])
  })

  it('addToStackContext invalidates weight cache', () => {
    const defs = [
      makeDef('a', 10, { maxStackWeightKg: 100 }),
      makeDef('b', 20),
      makeDef('c', 30),
    ]
    const placements = [makePlace(1, 'a', 0), makePlace(2, 'b', 10)]
    const ctx = buildStackContext(placements, defs)

    // Prime the cache by checking (no violation)
    const check1 = checkStackIncremental(ctx, makePlace(99, 'c', 20), defs[2]!)
    expect(check1).toHaveLength(0) // 20 + 30 = 50 < 100

    // Now add b to context
    // (b is already there from initial build, so add c instead)
    addToStackContext(ctx, makePlace(3, 'c', 20), defs[2]!)

    // Cache should be invalidated for a (supporter of b, which supports c)
    expect(ctx.weightAboveCache.has(0)).toBe(false)
  })
})
