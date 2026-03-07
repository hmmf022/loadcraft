import { describe, it, expect } from 'vitest'
import { tryKick } from '../WallKick'
import { VoxelGrid } from '../VoxelGrid'
import type { CargoItemDef, Vec3 } from '../types'
import type { VoxelizeResult } from '../Voxelizer'

function makeGrid(w: number, h: number, d: number): VoxelGrid {
  return new VoxelGrid(w, h, d)
}

function simpleVoxelize(def: CargoItemDef, pos: Vec3, _rot: Vec3): VoxelizeResult {
  void _rot
  return {
    voxels: [],
    usesFastPath: true,
    aabb: {
      min: { x: pos.x, y: pos.y, z: pos.z },
      max: { x: pos.x + def.widthCm, y: pos.y + def.heightCm, z: pos.z + def.depthCm },
    },
  }
}

function noCollision(_grid: VoxelGrid, _result: VoxelizeResult, _excludeId: number): boolean {
  void _grid; void _result; void _excludeId
  return false
}

function alwaysCollision(_grid: VoxelGrid, _result: VoxelizeResult, _excludeId: number): boolean {
  void _grid; void _result; void _excludeId
  return true
}

const baseDef: CargoItemDef = {
  id: 'test', name: 'Test', widthCm: 20, heightCm: 20, depthCm: 20,
  weightKg: 1, color: '#ff0000',
}

describe('tryKick', () => {
  it('衝突なし: 最初のオフセットで成功', () => {
    const grid = makeGrid(100, 100, 100)
    const result = tryKick(
      grid, baseDef, { x: 30, y: 0, z: 30 }, { x: 0, y: 90, z: 0 }, 1,
      simpleVoxelize, noCollision,
    )
    expect(result).not.toBeNull()
    expect(result!.position).toEqual({ x: 40, y: 0, z: 30 })
  })

  it('全オフセット衝突: null を返す', () => {
    const grid = makeGrid(100, 100, 100)
    const result = tryKick(
      grid, baseDef, { x: 30, y: 0, z: 30 }, { x: 0, y: 90, z: 0 }, 1,
      simpleVoxelize, alwaysCollision,
    )
    expect(result).toBeNull()
  })

  it('bounds 外: コンテナに収まらないオフセットはスキップ', () => {
    // Small container where offsets push out of bounds
    const grid = makeGrid(30, 30, 30)
    const result = tryKick(
      grid, baseDef, { x: 5, y: 5, z: 5 }, { x: 0, y: 90, z: 0 }, 1,
      simpleVoxelize, noCollision,
    )
    // All +10/-10 offsets would push 20cm item out of 30cm container at pos 5
    // x=15,y=5,z=5 -> max.x=35 > 30 → skip
    // x=-5 → min.x=-5 < 0 → skip
    // etc. Only { x: 5, y: 15, z: 5 } -> max.y=35 > 30 → skip
    // Actually x=15, max=35>30 skip; x=-5 min=-5<0 skip
    // z: z=15, max=35>30 skip; z=-5 min=-5<0 skip
    // y=15, max=35>30 skip
    // diagonal offsets also fail
    // 20+20=40>30 for most
    // So all should fail
    expect(result).toBeNull()
  })

  it('一部オフセットのみ成功: 正しい位置を返す', () => {
    const grid = makeGrid(100, 100, 100)
    let callCount = 0
    const collisionExceptThird = (_grid: VoxelGrid, _result: VoxelizeResult, _excludeId: number): boolean => {
      void _grid; void _result; void _excludeId
      callCount++
      // First two offsets collide, third succeeds
      return callCount <= 2
    }
    const result = tryKick(
      grid, baseDef, { x: 30, y: 0, z: 30 }, { x: 0, y: 90, z: 0 }, 1,
      simpleVoxelize, collisionExceptThird,
    )
    expect(result).not.toBeNull()
    // Third offset is { x: 0, y: 0, z: 10 }
    expect(result!.position).toEqual({ x: 30, y: 0, z: 40 })
  })
})
