import type { CargoItemDef, ContainerDef, PlacedCargo, Vec3 } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'

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
const NOFLIP_ORIENTATIONS: Vec3[] = [
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

/**
 * AABB shelf-packing algorithm with rotation support.
 * Cursor advances through rows/layers. At each position, tries all
 * orientation candidates and picks the one with smallest footprint that fits.
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

  let nextId = startInstanceId
  // カーソルを画面奥(X=0)から開始
  let cursorX = 0
  let cursorZ = 0
  let cursorY = 0
  let rowMaxD = 0
  let layerMaxH = 0

  for (const def of sorted) {
    const candidates = getOrientationCandidates(def)
    let placed = false

    // Try at current cursor position, then advance if needed
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      // Find best fitting orientation at current cursor
      let bestCandidate: OrientationCandidate | null = null
      let bestFootprint = Infinity

      for (const c of candidates) {
        if (cursorX + c.effW <= container.widthCm &&
            cursorZ + c.effD <= container.depthCm &&
            cursorY + c.effH <= container.heightCm) {
          const footprint = c.effW * c.effD
          if (footprint < bestFootprint) {
            bestFootprint = footprint
            bestCandidate = c
          }
        }
      }

      if (bestCandidate) {
        const pos = { x: cursorX, y: cursorY, z: cursorZ }
        const rot = bestCandidate.rot

        const result = def.blocks
          ? voxelizeComposite(def.blocks, pos, rot)
          : voxelize(bestCandidate.effW, bestCandidate.effH, bestCandidate.effD, pos, { x: 0, y: 0, z: 0 })

        placements.push({
          instanceId: nextId,
          cargoDefId: def.id,
          positionCm: pos,
          rotationDeg: rot,
        })
        voxelizeResults.push(result)
        nextId++

        cursorX += bestCandidate.effW
        rowMaxD = Math.max(rowMaxD, bestCandidate.effD)
        layerMaxH = Math.max(layerMaxH, bestCandidate.effH)
        placed = true
      } else {
        // Advance cursor
        if (attempt === 0) {
          // Advance to next row
          cursorX = 0
          cursorZ += rowMaxD
          rowMaxD = 0
        } else if (attempt === 1) {
          // Advance to next layer
          cursorZ = 0
          cursorX = 0
          cursorY += layerMaxH
          layerMaxH = 0
          rowMaxD = 0
        }
      }
    }

    if (!placed) {
      failedDefIds.push(def.id)
    }
  }

  return { placements, voxelizeResults, failedDefIds }
}
