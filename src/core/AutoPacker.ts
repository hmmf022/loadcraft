import type { CargoItemDef, ContainerDef, PlacedCargo, Vec3 } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'
import { OccupancyMap } from './OccupancyMap'

export interface PackResult {
  placements: PlacedCargo[]
  voxelizeResults: VoxelizeResult[]
  failedDefIds: string[]
}

/** 6 axis-aligned orientations covering all W×H×D permutations */
export const ORIENTATIONS: Vec3[] = [
  { x: 0, y: 0, z: 0 },      // W×H×D (original)
  { x: 0, y: 90, z: 0 },     // D×H×W
  { x: 90, y: 0, z: 0 },     // W×D×H
  { x: 90, y: 90, z: 0 },    // H×D×W
  { x: 0, y: 0, z: 90 },     // H×W×D
  { x: 90, y: 0, z: 90 },    // D×W×H
]

/** Y-axis-only orientations for noFlip items */
export const NOFLIP_ORIENTATIONS: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 90, z: 0 },
]

interface OrientationCandidate {
  rot: Vec3
  effW: number
  effH: number
  effD: number
}

/** Get unique orientation candidates for a cargo def, deduplicating identical AABB sizes */
function getOrientationCandidates(def: CargoItemDef): OrientationCandidate[] {
  const orientations = def.noFlip ? NOFLIP_ORIENTATIONS : ORIENTATIONS
  const seen = new Set<string>()
  const candidates: OrientationCandidate[] = []

  for (const rot of orientations) {
    const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, { x: 0, y: 0, z: 0 }, rot)
    const effW = aabb.max.x - aabb.min.x
    const effH = aabb.max.y - aabb.min.y
    const effD = aabb.max.z - aabb.min.z
    const key = `${effW},${effH},${effD}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ rot, effW, effH, effD })
  }

  return candidates
}

/** Position comparison: prefer smallest X (back wall), then lowest Y */
function isBetter(pos: Vec3, best: Vec3 | null): boolean {
  if (!best) return true
  if (pos.x < best.x) return true
  if (pos.x === best.x && pos.y < best.y) return true
  return false
}

/**
 * OccupancyMap-based packing algorithm with rotation support.
 * Uses height-map for gap-filling placement search.
 */
export function autoPack(
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []

  // 体積降順ソート
  const sorted = [...cargoDefs].sort((a, b) => {
    const volA = a.widthCm * a.heightCm * a.depthCm
    const volB = b.widthCm * b.heightCm * b.depthCm
    return volB - volA
  })

  const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId

  for (const def of sorted) {
    const candidates = getOrientationCandidates(def)

    let bestPos: Vec3 | null = null
    let bestCandidate: OrientationCandidate | null = null

    for (const c of candidates) {
      const pos = occMap.findPosition(c.effW, c.effH, c.effD)
      if (pos && isBetter(pos, bestPos)) {
        bestPos = pos
        bestCandidate = c
      }
    }

    if (bestPos && bestCandidate) {
      let pos = bestPos
      let result = def.blocks
        ? voxelizeComposite(def.blocks, pos, bestCandidate.rot)
        : voxelize(bestCandidate.effW, bestCandidate.effH, bestCandidate.effD, pos, { x: 0, y: 0, z: 0 })

      // 複合形状の回転で AABB がはみ出す場合、位置を補正して再ボクセル化
      const { min, max } = result.aabb
      let dx = 0, dy = 0, dz = 0
      if (min.x < 0) dx = -min.x
      if (min.y < 0) dy = -min.y
      if (min.z < 0) dz = -min.z
      if (max.x > container.widthCm) dx = container.widthCm - max.x
      if (max.y > container.heightCm) dy = container.heightCm - max.y
      if (max.z > container.depthCm) dz = container.depthCm - max.z

      if (dx !== 0 || dy !== 0 || dz !== 0) {
        pos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }
        result = def.blocks
          ? voxelizeComposite(def.blocks, pos, bestCandidate.rot)
          : voxelize(bestCandidate.effW, bestCandidate.effH, bestCandidate.effD, pos, { x: 0, y: 0, z: 0 })

        // 補正後も収まらない場合は配置失敗
        const { min: m2, max: x2 } = result.aabb
        if (m2.x < 0 || m2.y < 0 || m2.z < 0 ||
            x2.x > container.widthCm || x2.y > container.heightCm || x2.z > container.depthCm) {
          failedDefIds.push(def.id)
          continue
        }
      }

      occMap.markAABB(result.aabb)

      placements.push({
        instanceId: nextId,
        cargoDefId: def.id,
        positionCm: pos,
        rotationDeg: bestCandidate.rot,
      })
      voxelizeResults.push(result)
      nextId++
    } else {
      failedDefIds.push(def.id)
    }
  }

  return { placements, voxelizeResults, failedDefIds }
}
