import { describe, it, expect } from 'vitest'
import { VoxelGrid } from '../VoxelGrid'
import { checkSupport, checkAllSupports } from '../GravityChecker'
import type { CargoItemDef, PlacedCargo } from '../types'

describe('checkSupport', () => {
  it('floor-level object is always supported', () => {
    const grid = new VoxelGrid(20, 20, 20)
    grid.fillBox(0, 0, 0, 9, 9, 9, 1)

    const result = checkSupport(grid, 1, {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(true)
    expect(result.supportRatio).toBe(1.0)
    expect(result.totalBottomVoxels).toBe(100) // 10x10
  })

  it('airborne object with no support below is unsupported', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // Place object at y=5, nothing below
    grid.fillBox(0, 5, 0, 9, 9, 9, 1)

    const result = checkSupport(grid, 1, {
      min: { x: 0, y: 5, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(false)
    expect(result.supportRatio).toBe(0)
    expect(result.totalBottomVoxels).toBe(100)
    expect(result.supportedBottomVoxels).toBe(0)
  })

  it('stacked object with full support below is supported', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // Bottom object
    grid.fillBox(0, 0, 0, 9, 4, 9, 1)
    // Top object
    grid.fillBox(0, 5, 0, 9, 9, 9, 2)

    const result = checkSupport(grid, 2, {
      min: { x: 0, y: 5, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(true)
    expect(result.supportRatio).toBe(1.0)
  })

  it('partial support with ratio < 0.8 is unsupported', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // Small support: only 5x10 of the 10x10 bottom face
    grid.fillBox(0, 0, 0, 4, 4, 9, 1)
    // Top object: 10x10 base at y=5
    grid.fillBox(0, 5, 0, 9, 9, 9, 2)

    const result = checkSupport(grid, 2, {
      min: { x: 0, y: 5, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(false)
    expect(result.supportRatio).toBeCloseTo(0.5)
    expect(result.totalBottomVoxels).toBe(100)
    expect(result.supportedBottomVoxels).toBe(50)
  })

  it('partial support with ratio >= 0.8 is supported', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // Support: 8x10 of 10x10 base
    grid.fillBox(0, 0, 0, 7, 4, 9, 1)
    // Top object
    grid.fillBox(0, 5, 0, 9, 9, 9, 2)

    const result = checkSupport(grid, 2, {
      min: { x: 0, y: 5, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(true)
    expect(result.supportRatio).toBeCloseTo(0.8)
  })

  it('returns zero totals when no voxels match the objectId at bottom', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // AABB says object is at y=5 but no voxels with id 3 exist there
    const result = checkSupport(grid, 3, {
      min: { x: 0, y: 5, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    })

    expect(result.supported).toBe(false)
    expect(result.totalBottomVoxels).toBe(0)
  })
})

describe('checkAllSupports', () => {
  it('checks all placements', () => {
    const grid = new VoxelGrid(20, 20, 20)
    // Object 1: on floor
    grid.fillBox(0, 0, 0, 9, 4, 9, 1)
    // Object 2: stacked on top of 1
    grid.fillBox(0, 5, 0, 9, 9, 9, 2)

    const defs: CargoItemDef[] = [
      { id: 'a', name: 'A', widthCm: 10, heightCm: 5, depthCm: 10, weightKg: 10, color: '#f00' },
      { id: 'b', name: 'B', widthCm: 10, heightCm: 5, depthCm: 10, weightKg: 10, color: '#0f0' },
    ]

    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'a', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
      { instanceId: 2, cargoDefId: 'b', positionCm: { x: 0, y: 5, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]

    const results = checkAllSupports(grid, placements, defs)

    expect(results.size).toBe(2)
    expect(results.get(1)!.supported).toBe(true)
    expect(results.get(2)!.supported).toBe(true)
  })

  it('skips placements with missing def', () => {
    const grid = new VoxelGrid(20, 20, 20)
    const defs: CargoItemDef[] = []
    const placements: PlacedCargo[] = [
      { instanceId: 1, cargoDefId: 'missing', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    ]

    const results = checkAllSupports(grid, placements, defs)
    expect(results.size).toBe(0)
  })
})
