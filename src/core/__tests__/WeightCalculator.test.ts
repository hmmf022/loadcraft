import { describe, it, expect } from 'vitest'
import { computeWeight, computeCogDeviation } from '../WeightCalculator'
import type { PlacedCargo, CargoItemDef, ContainerDef } from '../types'

const container: ContainerDef = {
  widthCm: 100,
  heightCm: 100,
  depthCm: 100,
  maxPayloadKg: 1000,
}

const makeDef = (id: string, w: number, h: number, d: number, wt: number): CargoItemDef => ({
  id,
  name: `cargo-${id}`,
  widthCm: w,
  heightCm: h,
  depthCm: d,
  weightKg: wt,
  color: '#ff0000',
})

const makePlacement = (instanceId: number, defId: string, x: number, y: number, z: number): PlacedCargo => ({
  instanceId,
  cargoDefId: defId,
  positionCm: { x, y, z },
  rotationDeg: { x: 0, y: 0, z: 0 },
})

describe('computeWeight', () => {
  it('returns initial values for empty placements', () => {
    const result = computeWeight([], [], container)
    expect(result.totalWeightKg).toBe(0)
    expect(result.centerOfGravity).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.fillRatePercent).toBe(0)
    expect(result.overweight).toBe(false)
  })

  it('computes weight and CoG for a single cargo', () => {
    const defs = [makeDef('a', 10, 10, 10, 50)]
    const placements = [makePlacement(1, 'a', 0, 0, 0)]
    const result = computeWeight(placements, defs, container)

    expect(result.totalWeightKg).toBe(50)
    // Center of a 10x10x10 box at (0,0,0) -> (5, 5, 5)
    expect(result.centerOfGravity.x).toBeCloseTo(5)
    expect(result.centerOfGravity.y).toBeCloseTo(5)
    expect(result.centerOfGravity.z).toBeCloseTo(5)
    // 1000 / 1000000 * 100 = 0.1%
    expect(result.fillRatePercent).toBeCloseTo(0.1)
    expect(result.overweight).toBe(false)
  })

  it('computes weighted CoG for multiple cargo', () => {
    const defs = [
      makeDef('a', 10, 10, 10, 100),
      makeDef('b', 10, 10, 10, 200),
    ]
    const placements = [
      makePlacement(1, 'a', 0, 0, 0),   // center (5, 5, 5), weight 100
      makePlacement(2, 'b', 90, 0, 0),   // center (95, 5, 5), weight 200
    ]
    const result = computeWeight(placements, defs, container)

    expect(result.totalWeightKg).toBe(300)
    // CoG_x = (5*100 + 95*200) / 300 = 19500/300 = 65
    expect(result.centerOfGravity.x).toBeCloseTo(65)
    expect(result.centerOfGravity.y).toBeCloseTo(5)
    expect(result.centerOfGravity.z).toBeCloseTo(5)
  })

  it('computes fill rate correctly', () => {
    const defs = [makeDef('a', 50, 50, 50, 10)]
    const placements = [makePlacement(1, 'a', 0, 0, 0)]
    const result = computeWeight(placements, defs, container)

    // 125000 / 1000000 * 100 = 12.5%
    expect(result.fillRatePercent).toBeCloseTo(12.5)
  })

  it('detects overweight', () => {
    const defs = [makeDef('a', 10, 10, 10, 1500)]
    const placements = [makePlacement(1, 'a', 0, 0, 0)]
    const result = computeWeight(placements, defs, container)

    expect(result.totalWeightKg).toBe(1500)
    expect(result.overweight).toBe(true)
  })

  it('skips placements with missing def', () => {
    const defs = [makeDef('a', 10, 10, 10, 50)]
    const placements = [
      makePlacement(1, 'a', 0, 0, 0),
      makePlacement(2, 'missing', 10, 0, 0),
    ]
    const result = computeWeight(placements, defs, container)
    expect(result.totalWeightKg).toBe(50)
  })

  it('uses block-level volume for composite shapes', () => {
    // L-shape: two blocks, AABB is 20x20x10 = 4000, but actual block volume = 2000+1000 = 3000
    const defs: CargoItemDef[] = [{
      id: 'l',
      name: 'L-shape',
      widthCm: 20,
      heightCm: 20,
      depthCm: 10,
      weightKg: 30,
      color: '#ff0000',
      blocks: [
        { x: 0, y: 0, z: 0, w: 20, h: 10, d: 10, color: '#ff0000' },
        { x: 0, y: 10, z: 0, w: 10, h: 10, d: 10, color: '#ff0000' },
      ],
    }]
    const placements = [makePlacement(1, 'l', 0, 0, 0)]
    const result = computeWeight(placements, defs, container)

    // Volume should be 3000, not AABB 4000
    expect(result.fillRatePercent).toBeCloseTo(3000 / (100 * 100 * 100) * 100)
  })

  it('uses block-level CoG for composite shapes', () => {
    // L-shape: block1 (0,0,0 20x10x10 vol=2000 center=(10,5,5))
    //          block2 (0,10,0 10x10x10 vol=1000 center=(5,15,5))
    // Weighted local CoG: x=(10*2000+5*1000)/3000=25000/3000≈8.333
    //                     y=(5*2000+15*1000)/3000=25000/3000≈8.333
    //                     z=(5*2000+5*1000)/3000=15000/3000=5
    const defs: CargoItemDef[] = [{
      id: 'l',
      name: 'L-shape',
      widthCm: 20,
      heightCm: 20,
      depthCm: 10,
      weightKg: 30,
      color: '#ff0000',
      blocks: [
        { x: 0, y: 0, z: 0, w: 20, h: 10, d: 10, color: '#ff0000' },
        { x: 0, y: 10, z: 0, w: 10, h: 10, d: 10, color: '#ff0000' },
      ],
    }]
    const placements = [makePlacement(1, 'l', 0, 0, 0)]
    const result = computeWeight(placements, defs, container)

    // AABB center would be (10, 10, 5) — block CoG should differ
    expect(result.centerOfGravity.x).toBeCloseTo(25000 / 3000)
    expect(result.centerOfGravity.y).toBeCloseTo(25000 / 3000)
    expect(result.centerOfGravity.z).toBeCloseTo(5)
  })
})

describe('computeCogDeviation', () => {
  it('returns zero deviation when CoG is at center', () => {
    const cog = { x: 50, y: 50, z: 50 }
    const dev = computeCogDeviation(cog, container)
    expect(dev.deviationX).toBe(0)
    expect(dev.deviationY).toBe(0)
    expect(dev.deviationZ).toBe(0)
    expect(dev.isBalanced).toBe(true)
  })

  it('isBalanced=true when within 10% threshold', () => {
    // container is 100x100x100, threshold is 10cm each axis
    const cog = { x: 59, y: 50, z: 50 }
    const dev = computeCogDeviation(cog, container)
    expect(dev.deviationX).toBe(9)
    expect(dev.isBalanced).toBe(true)
  })

  it('isBalanced=false when exceeding 10% threshold', () => {
    const cog = { x: 61, y: 50, z: 50 }
    const dev = computeCogDeviation(cog, container)
    expect(dev.deviationX).toBe(11)
    expect(dev.isBalanced).toBe(false)
  })

  it('reports deviation in all axes', () => {
    const cog = { x: 60, y: 70, z: 30 }
    const dev = computeCogDeviation(cog, container)
    expect(dev.deviationX).toBe(10)
    expect(dev.deviationY).toBe(20)
    expect(dev.deviationZ).toBe(-20)
    expect(dev.isBalanced).toBe(false)
  })
})
