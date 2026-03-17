import type { CargoItemDef, PlacedCargo, Vec3 } from './types'
import type { VoxelGrid } from './VoxelGrid'
import { computeRotatedAABB } from './Voxelizer'

export interface SupportResult {
  supported: boolean
  supportRatio: number
  totalBottomVoxels: number
  supportedBottomVoxels: number
}

export function checkSupport(
  grid: VoxelGrid,
  objectId: number,
  aabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): SupportResult {
  const bottomY = aabb.min.y

  // Floor-level objects are always supported
  if (bottomY === 0) {
    const totalBottomVoxels = countBottomVoxels(grid, objectId, aabb, bottomY)
    return {
      supported: true,
      supportRatio: 1.0,
      totalBottomVoxels,
      supportedBottomVoxels: totalBottomVoxels,
    }
  }

  let totalBottomVoxels = 0
  let supportedBottomVoxels = 0

  for (let z = aabb.min.z; z < aabb.max.z; z++) {
    for (let x = aabb.min.x; x < aabb.max.x; x++) {
      const val = grid.get(x, bottomY, z)
      if (val === objectId) {
        totalBottomVoxels++
        // Check directly below
        const below = grid.get(x, bottomY - 1, z)
        if (below !== 0 && below !== objectId) {
          supportedBottomVoxels++
        }
      }
    }
  }

  if (totalBottomVoxels === 0) {
    return { supported: false, supportRatio: 0, totalBottomVoxels: 0, supportedBottomVoxels: 0 }
  }

  const supportRatio = supportedBottomVoxels / totalBottomVoxels
  return {
    supported: supportRatio >= 0.8,
    supportRatio,
    totalBottomVoxels,
    supportedBottomVoxels,
  }
}

function countBottomVoxels(
  grid: VoxelGrid,
  objectId: number,
  aabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  bottomY: number,
): number {
  let count = 0
  for (let z = aabb.min.z; z < aabb.max.z; z++) {
    for (let x = aabb.min.x; x < aabb.max.x; x++) {
      if (grid.get(x, bottomY, z) === objectId) {
        count++
      }
    }
  }
  return count
}

export function checkAllSupports(
  grid: VoxelGrid,
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
): Map<number, SupportResult> {
  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) {
    defMap.set(d.id, d)
  }

  const results = new Map<number, SupportResult>()

  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue

    const aabb = computeRotatedAABB(
      def.widthCm, def.heightCm, def.depthCm,
      p.positionCm, p.rotationDeg,
    )
    results.set(p.instanceId, checkSupport(grid, p.instanceId, aabb))
  }

  return results
}

export function checkAllSupportsWithAABBs(
  grid: VoxelGrid,
  placements: PlacedCargo[],
  aabbs: Array<{ min: Vec3; max: Vec3 }>,
): Map<number, SupportResult> {
  const results = new Map<number, SupportResult>()
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!
    const aabb = aabbs[i]!
    results.set(p.instanceId, checkSupport(grid, p.instanceId, aabb))
  }
  return results
}
