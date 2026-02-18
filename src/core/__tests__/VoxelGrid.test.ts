import { describe, it, expect } from 'vitest'
import { VoxelGrid } from '../VoxelGrid'

describe('VoxelGrid', () => {
  it('initializes with all zeros', () => {
    const grid = new VoxelGrid(10, 10, 10)
    expect(grid.get(0, 0, 0)).toBe(0)
    expect(grid.get(5, 5, 5)).toBe(0)
    expect(grid.get(9, 9, 9)).toBe(0)
  })

  it('get/set works correctly', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.set(3, 4, 5, 42)
    expect(grid.get(3, 4, 5)).toBe(42)
    expect(grid.get(3, 4, 4)).toBe(0)
  })

  it('out-of-bounds get returns 0', () => {
    const grid = new VoxelGrid(10, 10, 10)
    expect(grid.get(-1, 0, 0)).toBe(0)
    expect(grid.get(10, 0, 0)).toBe(0)
    expect(grid.get(0, -1, 0)).toBe(0)
    expect(grid.get(0, 10, 0)).toBe(0)
  })

  it('out-of-bounds set is ignored', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.set(-1, 0, 0, 1) // Should not throw
    grid.set(10, 0, 0, 1) // Should not throw
  })

  it('isInBounds works correctly', () => {
    const grid = new VoxelGrid(10, 10, 10)
    expect(grid.isInBounds(0, 0, 0)).toBe(true)
    expect(grid.isInBounds(9, 9, 9)).toBe(true)
    expect(grid.isInBounds(-1, 0, 0)).toBe(false)
    expect(grid.isInBounds(10, 0, 0)).toBe(false)
  })

  it('fillBox fills a region correctly', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillBox(2, 2, 2, 4, 4, 4, 7)
    // Inside
    expect(grid.get(2, 2, 2)).toBe(7)
    expect(grid.get(3, 3, 3)).toBe(7)
    expect(grid.get(4, 4, 4)).toBe(7)
    // Outside
    expect(grid.get(1, 2, 2)).toBe(0)
    expect(grid.get(5, 2, 2)).toBe(0)
  })

  it('fillBox clamps to grid bounds', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillBox(-5, -5, -5, 15, 15, 15, 1)
    expect(grid.get(0, 0, 0)).toBe(1)
    expect(grid.get(9, 9, 9)).toBe(1)
  })

  it('fillVoxels fills individual voxels', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillVoxels([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ], 99)
    expect(grid.get(1, 2, 3)).toBe(99)
    expect(grid.get(4, 5, 6)).toBe(99)
    expect(grid.get(0, 0, 0)).toBe(0)
  })

  it('clearObject removes only the specified ID', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillBox(0, 0, 0, 4, 4, 4, 1)
    grid.fillBox(5, 5, 5, 9, 9, 9, 2)
    grid.clearObject(1)
    expect(grid.get(0, 0, 0)).toBe(0)
    expect(grid.get(3, 3, 3)).toBe(0)
    expect(grid.get(5, 5, 5)).toBe(2)
  })

  it('hasCollision detects occupied voxels', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.set(5, 5, 5, 1)
    expect(grid.hasCollision([{ x: 5, y: 5, z: 5 }])).toBe(true)
    expect(grid.hasCollision([{ x: 0, y: 0, z: 0 }])).toBe(false)
  })

  it('hasCollision treats out-of-bounds as collision', () => {
    const grid = new VoxelGrid(10, 10, 10)
    expect(grid.hasCollision([{ x: -1, y: 0, z: 0 }])).toBe(true)
    expect(grid.hasCollision([{ x: 10, y: 0, z: 0 }])).toBe(true)
  })

  it('hasCollision excludeId ignores self', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.set(5, 5, 5, 42)
    expect(grid.hasCollision([{ x: 5, y: 5, z: 5 }], 42)).toBe(false)
    expect(grid.hasCollision([{ x: 5, y: 5, z: 5 }], 99)).toBe(true)
  })

  it('computeStats returns correct values', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillBox(0, 0, 0, 4, 4, 4, 1) // 5*5*5 = 125 voxels
    const stats = grid.computeStats()
    expect(stats.totalVoxels).toBe(1000)
    expect(stats.occupiedVoxels).toBe(125)
    expect(stats.fillRate).toBeCloseTo(0.125)
  })

  it('clone creates independent copy', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.set(5, 5, 5, 1)
    const copy = grid.clone()
    expect(copy.get(5, 5, 5)).toBe(1)
    copy.set(5, 5, 5, 2)
    expect(grid.get(5, 5, 5)).toBe(1) // Original unchanged
    expect(copy.get(5, 5, 5)).toBe(2)
  })

  it('clear resets all voxels', () => {
    const grid = new VoxelGrid(10, 10, 10)
    grid.fillBox(0, 0, 0, 9, 9, 9, 1)
    grid.clear()
    expect(grid.get(0, 0, 0)).toBe(0)
    expect(grid.get(5, 5, 5)).toBe(0)
    expect(grid.computeStats().occupiedVoxels).toBe(0)
  })
})
