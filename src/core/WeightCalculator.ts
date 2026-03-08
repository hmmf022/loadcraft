import type { Vec3, ContainerDef, CargoItemDef, PlacedCargo, WeightResult } from './types'
import { computeRotatedAABB, rotateVec3 } from './Voxelizer'

export interface CogDeviation {
  deviationX: number
  deviationY: number
  deviationZ: number
  isBalanced: boolean
}

export function computeWeight(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
): WeightResult {
  if (placements.length === 0) {
    return {
      totalWeightKg: 0,
      centerOfGravity: { x: 0, y: 0, z: 0 },
      fillRatePercent: 0,
      overweight: false,
    }
  }

  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) {
    defMap.set(d.id, d)
  }

  let totalWeight = 0
  let cogX = 0
  let cogY = 0
  let cogZ = 0
  let totalVolume = 0

  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue

    totalWeight += def.weightKg

    if (def.blocks) {
      // Composite shape: use block-level volume and center of gravity
      let blockVol = 0
      let bCogX = 0, bCogY = 0, bCogZ = 0
      for (const b of def.blocks) {
        const vol = b.w * b.h * b.d
        blockVol += vol
        bCogX += (b.x + b.w / 2) * vol
        bCogY += (b.y + b.h / 2) * vol
        bCogZ += (b.z + b.d / 2) * vol
      }
      totalVolume += blockVol
      const localCog = blockVol > 0
        ? { x: bCogX / blockVol, y: bCogY / blockVol, z: bCogZ / blockVol }
        : { x: 0, y: 0, z: 0 }
      const rotated = rotateVec3(localCog, p.rotationDeg)
      cogX += (p.positionCm.x + rotated.x) * def.weightKg
      cogY += (p.positionCm.y + rotated.y) * def.weightKg
      cogZ += (p.positionCm.z + rotated.z) * def.weightKg
    } else {
      // Simple box: use AABB
      const aabb = computeRotatedAABB(
        def.widthCm, def.heightCm, def.depthCm,
        p.positionCm, p.rotationDeg,
      )
      cogX += ((aabb.min.x + aabb.max.x) / 2) * def.weightKg
      cogY += ((aabb.min.y + aabb.max.y) / 2) * def.weightKg
      cogZ += ((aabb.min.z + aabb.max.z) / 2) * def.weightKg
      totalVolume += def.widthCm * def.heightCm * def.depthCm
    }
  }

  const cog: Vec3 = totalWeight > 0
    ? { x: cogX / totalWeight, y: cogY / totalWeight, z: cogZ / totalWeight }
    : { x: 0, y: 0, z: 0 }

  const containerVolume = container.widthCm * container.heightCm * container.depthCm
  const fillRatePercent = containerVolume > 0
    ? (totalVolume / containerVolume) * 100
    : 0

  return {
    totalWeightKg: totalWeight,
    centerOfGravity: cog,
    fillRatePercent,
    overweight: totalWeight > container.maxPayloadKg,
  }
}

export function computeCogDeviation(cog: Vec3, container: ContainerDef): CogDeviation {
  const containerCenterX = container.widthCm / 2
  const containerCenterY = container.heightCm / 2
  const containerCenterZ = container.depthCm / 2

  const deviationX = cog.x - containerCenterX
  const deviationY = cog.y - containerCenterY
  const deviationZ = cog.z - containerCenterZ

  const thresholdX = container.widthCm * 0.1
  const thresholdY = container.heightCm * 0.1
  const thresholdZ = container.depthCm * 0.1

  return {
    deviationX,
    deviationY,
    deviationZ,
    isBalanced:
      Math.abs(deviationX) <= thresholdX &&
      Math.abs(deviationY) <= thresholdY &&
      Math.abs(deviationZ) <= thresholdZ,
  }
}
