import type { Vec3, CargoItemDef } from './types'
import type { VoxelGrid } from './VoxelGrid'
import type { VoxelizeResult } from './Voxelizer'

const KICK_OFFSETS: Vec3[] = [
  { x: 10, y: 0, z: 0 },  { x: -10, y: 0, z: 0 },
  { x: 0, y: 0, z: 10 },  { x: 0, y: 0, z: -10 },
  { x: 0, y: 10, z: 0 },
  { x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: -10 },
  { x: -10, y: 0, z: 10 },{ x: -10, y: 0, z: -10 },
  { x: 20, y: 0, z: 0 },  { x: -20, y: 0, z: 0 },
  { x: 0, y: 0, z: 20 },  { x: 0, y: 0, z: -20 },
  { x: 0, y: 20, z: 0 },
]

export interface KickResult {
  position: Vec3
  rotation: Vec3
  result: VoxelizeResult
}

export function tryKick(
  grid: VoxelGrid,
  def: CargoItemDef,
  basePos: Vec3,
  newRot: Vec3,
  excludeId: number,
  voxelizeFn: (def: CargoItemDef, pos: Vec3, rot: Vec3) => VoxelizeResult,
  checkCollisionFn: (grid: VoxelGrid, result: VoxelizeResult, excludeId: number) => boolean,
): KickResult | null {
  for (const offset of KICK_OFFSETS) {
    const pos: Vec3 = {
      x: basePos.x + offset.x,
      y: basePos.y + offset.y,
      z: basePos.z + offset.z,
    }

    const result = voxelizeFn(def, pos, newRot)

    // Bounds check
    const { min, max } = result.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0) continue
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) continue

    // Collision check
    if (checkCollisionFn(grid, result, excludeId)) continue

    return { position: pos, rotation: newRot, result }
  }

  return null
}
