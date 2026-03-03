import type { CargoItemDef, PlacedCargo } from './types'
import { computeRotatedAABB } from './Voxelizer'

export interface InterferencePair {
  instanceId1: number
  instanceId2: number
  name1: string
  name2: string
}

export interface InterferenceResult {
  pairs: InterferencePair[]
}

/**
 * Check all placement pairs for AABB overlap.
 * O(n²) but n < 100 so this is fine.
 */
export function checkInterference(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
): InterferenceResult {
  const pairs: InterferencePair[] = []
  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) {
    defMap.set(d.id, d)
  }

  // Pre-compute AABBs for all placements
  const aabbs: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }[] = []
  const names: string[] = []

  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) {
      aabbs.push({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } })
      names.push('unknown')
      continue
    }
    const aabb = computeRotatedAABB(
      def.widthCm, def.heightCm, def.depthCm,
      p.positionCm, p.rotationDeg,
    )
    aabbs.push(aabb)
    names.push(def.name)
  }

  // Pairwise AABB overlap check
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = aabbs[i]!
      const b = aabbs[j]!

      // Separating axis test on all 3 axes
      if (
        a.min.x < b.max.x && a.max.x > b.min.x &&
        a.min.y < b.max.y && a.max.y > b.min.y &&
        a.min.z < b.max.z && a.max.z > b.min.z
      ) {
        pairs.push({
          instanceId1: placements[i]!.instanceId,
          instanceId2: placements[j]!.instanceId,
          name1: names[i]!,
          name2: names[j]!,
        })
      }
    }
  }

  return { pairs }
}
