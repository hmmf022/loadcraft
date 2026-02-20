import { describe, it, expect } from 'vitest'
import { voxelize, isAxisAligned, computeRotatedAABB, rotateVec3 } from '../Voxelizer'

describe('isAxisAligned', () => {
  it('returns true for 0/90/180/270/360/-90', () => {
    expect(isAxisAligned({ x: 0, y: 0, z: 0 })).toBe(true)
    expect(isAxisAligned({ x: 90, y: 0, z: 0 })).toBe(true)
    expect(isAxisAligned({ x: 0, y: 180, z: 0 })).toBe(true)
    expect(isAxisAligned({ x: 0, y: 0, z: 270 })).toBe(true)
    expect(isAxisAligned({ x: 360, y: 0, z: 0 })).toBe(true)
    expect(isAxisAligned({ x: -90, y: 0, z: 0 })).toBe(true)
    expect(isAxisAligned({ x: 90, y: 90, z: 90 })).toBe(true)
  })

  it('returns false for non-90-degree multiples', () => {
    expect(isAxisAligned({ x: 45, y: 0, z: 0 })).toBe(false)
    expect(isAxisAligned({ x: 0, y: 30, z: 0 })).toBe(false)
    expect(isAxisAligned({ x: 0, y: 0, z: 15 })).toBe(false)
  })
})

describe('computeRotatedAABB', () => {
  it('no rotation returns original bounds', () => {
    const aabb = computeRotatedAABB(10, 20, 30, { x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 0 })
    expect(aabb.min).toEqual({ x: 5, y: 5, z: 5 })
    expect(aabb.max).toEqual({ x: 15, y: 25, z: 35 })
  })

  it('Y 90° swaps width and depth', () => {
    const aabb = computeRotatedAABB(10, 20, 30, { x: 0, y: 0, z: 0 }, { x: 0, y: 90, z: 0 })
    // After Y90 rotation, width (10) maps to Z axis, depth (30) maps to X axis
    const sizeX = aabb.max.x - aabb.min.x
    const sizeY = aabb.max.y - aabb.min.y
    const sizeZ = aabb.max.z - aabb.min.z
    expect(sizeY).toBe(20) // height unchanged
    // width and depth should be swapped
    expect(sizeX).toBeCloseTo(30, 0)
    expect(sizeZ).toBeCloseTo(10, 0)
  })

  it('X 90° swaps height and depth', () => {
    const aabb = computeRotatedAABB(10, 20, 30, { x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 })
    const sizeX = aabb.max.x - aabb.min.x
    const sizeY = aabb.max.y - aabb.min.y
    const sizeZ = aabb.max.z - aabb.min.z
    expect(sizeX).toBe(10) // width unchanged
    expect(sizeY).toBeCloseTo(30, 0)
    expect(sizeZ).toBeCloseTo(20, 0)
  })
})

describe('rotateVec3', () => {
  it('identity rotation returns same vector', () => {
    const v = rotateVec3({ x: 10, y: 20, z: 30 }, { x: 0, y: 0, z: 0 })
    expect(v.x).toBeCloseTo(10)
    expect(v.y).toBeCloseTo(20)
    expect(v.z).toBeCloseTo(30)
  })

  it('Y 90° rotates X to -Z and Z to +X', () => {
    const v1 = rotateVec3({ x: 10, y: 0, z: 0 }, { x: 0, y: 90, z: 0 })
    expect(v1.x).toBeCloseTo(0)
    expect(v1.y).toBeCloseTo(0)
    expect(v1.z).toBeCloseTo(-10)

    const v2 = rotateVec3({ x: 0, y: 0, z: 10 }, { x: 0, y: 90, z: 0 })
    expect(v2.x).toBeCloseTo(10)
    expect(v2.y).toBeCloseTo(0)
    expect(v2.z).toBeCloseTo(0)
  })

  it('X 90° rotates Y to +Z', () => {
    const v = rotateVec3({ x: 0, y: 10, z: 0 }, { x: 90, y: 0, z: 0 })
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(0)
    expect(v.z).toBeCloseTo(10)
  })
})

describe('voxelize', () => {
  it('no rotation returns fastPath with correct AABB', () => {
    const result = voxelize(10, 20, 30, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    expect(result.usesFastPath).toBe(true)
    expect(result.voxels).toHaveLength(0)
    expect(result.aabb.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.aabb.max).toEqual({ x: 10, y: 20, z: 30 })
  })

  it('Y 90° returns fastPath with swapped dimensions', () => {
    const result = voxelize(10, 20, 30, { x: 0, y: 0, z: 0 }, { x: 0, y: 90, z: 0 })
    expect(result.usesFastPath).toBe(true)
    expect(result.voxels).toHaveLength(0)
    const sizeX = result.aabb.max.x - result.aabb.min.x
    const sizeZ = result.aabb.max.z - result.aabb.min.z
    expect(sizeX).toBeCloseTo(30, 0)
    expect(sizeZ).toBeCloseTo(10, 0)
  })

  it('X 90° returns fastPath', () => {
    const result = voxelize(10, 20, 30, { x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 })
    expect(result.usesFastPath).toBe(true)
  })

  it('45° rotation returns slowPath with voxels', () => {
    const w = 10, h = 10, d = 10
    const result = voxelize(w, h, d, { x: 20, y: 0, z: 20 }, { x: 0, y: 45, z: 0 })
    expect(result.usesFastPath).toBe(false)
    expect(result.voxels.length).toBeGreaterThan(0)
    // Voxel count should approximate the box volume
    const expectedVolume = w * h * d
    expect(result.voxels.length).toBeGreaterThan(expectedVolume * 0.8)
    expect(result.voxels.length).toBeLessThan(expectedVolume * 1.3)
  })

  it('fastPath AABB min values use the position', () => {
    const result = voxelize(5, 5, 5, { x: 10, y: 20, z: 30 }, { x: 0, y: 0, z: 0 })
    expect(result.aabb.min).toEqual({ x: 10, y: 20, z: 30 })
    expect(result.aabb.max).toEqual({ x: 15, y: 25, z: 35 })
  })
})
