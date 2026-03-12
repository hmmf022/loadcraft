import type { CargoItemDef, ContainerDef, PlacedCargo, Vec3 } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'
import { OccupancyMap } from './OccupancyMap'
import { buildStackContext, checkStackIncremental, addToStackContext } from './StackChecker'

export interface PackResult {
  placements: PlacedCargo[]
  voxelizeResults: VoxelizeResult[]
  failedDefIds: string[]
  failureReasons: PackFailureReason[]
}

export type PackFailureCode =
  | 'OUT_OF_BOUNDS'
  | 'NO_FEASIBLE_POSITION'
  | 'COLLISION'
  | 'NO_SUPPORT'
  | 'STACK_CONSTRAINT'

export interface PackFailureReason {
  cargoDefId: string
  cargoName: string
  code: PackFailureCode
  detail: string
}

export interface AutoPackContext {
  existingPlacements?: PlacedCargo[]
  existingCargoDefs?: CargoItemDef[]
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
const MIN_SUPPORT_RATIO = 0.5

interface OrientationCandidate {
  rot: Vec3
  effW: number
  effH: number
  effD: number
  offsetX: number
  offsetY: number
  offsetZ: number
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
    candidates.push({ rot, effW, effH, effD, offsetX: -aabb.min.x, offsetY: -aabb.min.y, offsetZ: -aabb.min.z })
  }

  return candidates
}

interface ScoredCandidate {
  placement: PlacedCargo
  result: VoxelizeResult
  score: number
}

/**
 * OccupancyMap-based packing algorithm with rotation support.
 * Uses height-map for gap-filling placement search.
 */
export function autoPack(
  items: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
  baseOccMap?: OccupancyMap,
  context?: AutoPackContext,
  deadlineMs?: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []
  const failureReasons: PackFailureReason[] = []
  const existingPlacements = context?.existingPlacements ?? []
  const existingDefs = context?.existingCargoDefs ?? []

  // 体積降順ソート
  const sorted = [...items].sort((a, b) => {
    const volA = a.widthCm * a.heightCm * a.depthCm
    const volB = b.widthCm * b.heightCm * b.depthCm
    return volB - volA
  })

  const occMap = baseOccMap
    ? baseOccMap.clone()
    : new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId
  const allDefs = dedupeDefs([...existingDefs, ...items])
  const placedAabbs = buildAabbList(existingPlacements, allDefs)

  // Skip stack constraint checking entirely if no defs have constraints
  const hasAnyStackConstraints = allDefs.some(
    d => d.noStack === true || d.maxStackWeightKg !== undefined
  )
  const stackCtx = hasAnyStackConstraints
    ? buildStackContext(existingPlacements, allDefs)
    : null

  let runningTotalWeight = 0
  let runningCogX = 0
  let runningCogY = 0
  let runningCogZ = 0

  for (const p of existingPlacements) {
    const def = allDefs.find((d) => d.id === p.cargoDefId)
    if (!def) continue
    const center = getPlacementCenter(p, def)
    runningTotalWeight += def.weightKg
    runningCogX += center.x * def.weightKg
    runningCogY += center.y * def.weightKg
    runningCogZ += center.z * def.weightKg
  }

  for (const def of sorted) {
    // Deadline check: abort remaining items on timeout
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      failedDefIds.push(def.id)
      failureReasons.push({
        cargoDefId: def.id,
        cargoName: def.name,
        code: 'NO_FEASIBLE_POSITION',
        detail: 'Auto-pack timed out.',
      })
      continue
    }

    const candidates = getOrientationCandidates(def)

    let hadOrientationFit = false
    let hadCandidatePosition = false
    let hadOutOfBounds = false
    let hadCollision = false
    let hadNoSupport = false
    let hadStackConstraint = false

    // Collect all candidates that pass bounds/collision/support, then check stack in score order
    const scoredCandidates: ScoredCandidate[] = []

    for (const c of candidates) {
      if (c.effW > container.widthCm || c.effH > container.heightCm || c.effD > container.depthCm) {
        continue
      }
      hadOrientationFit = true
      const posList = occMap.findCandidatePositions(c.effW, c.effH, c.effD, 16)
      if (posList.length === 0) continue
      hadCandidatePosition = true

      for (const candidatePos of posList) {
        let pos = {
          x: candidatePos.x + c.offsetX,
          y: candidatePos.y + c.offsetY,
          z: candidatePos.z + c.offsetZ,
        }
        let result = def.blocks
          ? voxelizeComposite(def.blocks, pos, c.rot)
          : voxelize(def.widthCm, def.heightCm, def.depthCm, pos, c.rot)

        // Correct slight out-of-bounds shifts caused by rotated AABB offsets.
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
            ? voxelizeComposite(def.blocks, pos, c.rot)
            : voxelize(def.widthCm, def.heightCm, def.depthCm, pos, c.rot)
        }

        const bounded = isInsideContainer(result.aabb, container)
        if (!bounded) {
          hadOutOfBounds = true
          continue
        }

        if (isColliding(result.aabb, placedAabbs)) {
          hadCollision = true
          continue
        }

        const supportRatio = occMap.getSupportRatio(
          result.aabb.min.x,
          result.aabb.min.z,
          result.aabb.max.x - result.aabb.min.x,
          result.aabb.max.z - result.aabb.min.z,
          result.aabb.min.y,
        )
        if (supportRatio < MIN_SUPPORT_RATIO) {
          hadNoSupport = true
          continue
        }

        const placement: PlacedCargo = {
          instanceId: nextId,
          cargoDefId: def.id,
          positionCm: pos,
          rotationDeg: c.rot,
        }

        const score = scorePlacement(
          placement,
          def,
          container,
          runningTotalWeight,
          runningCogX,
          runningCogY,
          runningCogZ,
          supportRatio,
        )
        scoredCandidates.push({ placement, result, score })
      }
    }

    // Sort by score (ascending = better) and check stack constraints in order
    scoredCandidates.sort((a, b) => a.score - b.score)

    let bestPlacement: PlacedCargo | null = null
    let bestResult: VoxelizeResult | null = null

    for (const cand of scoredCandidates) {
      if (stackCtx) {
        const violations = checkStackIncremental(stackCtx, cand.placement, def)
        if (violations.length > 0) {
          hadStackConstraint = true
          continue
        }
      }
      bestPlacement = cand.placement
      bestResult = cand.result
      break
    }

    if (bestPlacement && bestResult) {
      occMap.markAABB(bestResult.aabb)
      placedAabbs.push(bestResult.aabb)
      placements.push(bestPlacement)
      voxelizeResults.push(bestResult)
      if (stackCtx) addToStackContext(stackCtx, bestPlacement, def)
      const center = getPlacementCenter(bestPlacement, def)
      runningTotalWeight += def.weightKg
      runningCogX += center.x * def.weightKg
      runningCogY += center.y * def.weightKg
      runningCogZ += center.z * def.weightKg
      nextId++
    } else {
      failedDefIds.push(def.id)
      const reason = pickFailureReason(
        def,
        hadOrientationFit,
        hadCandidatePosition,
        hadStackConstraint,
        hadNoSupport,
        hadCollision,
        hadOutOfBounds,
      )
      failureReasons.push(reason)
    }
  }

  return { placements, voxelizeResults, failedDefIds, failureReasons }
}

function pickFailureReason(
  def: CargoItemDef,
  hadOrientationFit: boolean,
  hadCandidatePosition: boolean,
  hadStackConstraint: boolean,
  hadNoSupport: boolean,
  hadCollision: boolean,
  hadOutOfBounds: boolean,
): PackFailureReason {
  if (!hadOrientationFit) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'OUT_OF_BOUNDS',
      detail: 'Item does not fit container dimensions in any allowed orientation.',
    }
  }
  if (!hadCandidatePosition) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'NO_FEASIBLE_POSITION',
      detail: 'No free position found in occupancy map search.',
    }
  }
  if (hadStackConstraint) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'STACK_CONSTRAINT',
      detail: 'Placement would violate stack weight constraints.',
    }
  }
  if (hadNoSupport) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'NO_SUPPORT',
      detail: 'Bottom support ratio was below the required threshold.',
    }
  }
  if (hadCollision) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'COLLISION',
      detail: 'Candidate placement intersects existing cargo AABB.',
    }
  }
  if (hadOutOfBounds) {
    return {
      cargoDefId: def.id,
      cargoName: def.name,
      code: 'OUT_OF_BOUNDS',
      detail: 'Candidate placement exceeded container bounds after rotation.',
    }
  }
  return {
    cargoDefId: def.id,
    cargoName: def.name,
    code: 'NO_FEASIBLE_POSITION',
    detail: 'No candidate passed all placement checks.',
  }
}

function dedupeDefs(defs: CargoItemDef[]): CargoItemDef[] {
  const map = new Map<string, CargoItemDef>()
  for (const def of defs) {
    map.set(def.id, def)
  }
  return [...map.values()]
}

function buildAabbList(placements: PlacedCargo[], defs: CargoItemDef[]): Array<{ min: Vec3; max: Vec3 }> {
  const defMap = new Map<string, CargoItemDef>()
  for (const def of defs) {
    defMap.set(def.id, def)
  }
  const list: Array<{ min: Vec3; max: Vec3 }> = []
  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue
    const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg)
    list.push(aabb)
  }
  return list
}

function isInsideContainer(aabb: { min: Vec3; max: Vec3 }, container: ContainerDef): boolean {
  return !(
    aabb.min.x < 0 || aabb.min.y < 0 || aabb.min.z < 0 ||
    aabb.max.x > container.widthCm || aabb.max.y > container.heightCm || aabb.max.z > container.depthCm
  )
}

function isColliding(aabb: { min: Vec3; max: Vec3 }, existing: Array<{ min: Vec3; max: Vec3 }>): boolean {
  for (const e of existing) {
    if (
      aabb.min.x < e.max.x && aabb.max.x > e.min.x &&
      aabb.min.y < e.max.y && aabb.max.y > e.min.y &&
      aabb.min.z < e.max.z && aabb.max.z > e.min.z
    ) {
      return true
    }
  }
  return false
}

function getPlacementCenter(p: PlacedCargo, def: CargoItemDef): Vec3 {
  const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg)
  return {
    x: (aabb.min.x + aabb.max.x) / 2,
    y: (aabb.min.y + aabb.max.y) / 2,
    z: (aabb.min.z + aabb.max.z) / 2,
  }
}

function scorePlacement(
  placement: PlacedCargo,
  def: CargoItemDef,
  container: ContainerDef,
  runningTotalWeight: number,
  runningCogX: number,
  runningCogY: number,
  runningCogZ: number,
  supportRatio: number,
): number {
  const center = getPlacementCenter(placement, def)
  const totalWeight = runningTotalWeight + def.weightKg
  const cogX = (runningCogX + center.x * def.weightKg) / totalWeight
  const cogY = (runningCogY + center.y * def.weightKg) / totalWeight
  const cogZ = (runningCogZ + center.z * def.weightKg) / totalWeight
  const targetX = container.widthCm / 2
  const targetY = container.heightCm / 2
  const targetZ = container.depthCm / 2
  const devX = Math.abs(cogX - targetX) / Math.max(1, container.widthCm)
  const devY = Math.abs(cogY - targetY) / Math.max(1, container.heightCm)
  const devZ = Math.abs(cogZ - targetZ) / Math.max(1, container.depthCm)
  const cogPenalty = devX + devY * 0.25 + devZ

  const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, placement.positionCm, placement.rotationDeg)
  const floorPenalty = aabb.min.y / Math.max(1, container.heightCm)
  const backWallPenalty = placement.positionCm.x / Math.max(1, container.widthCm)
  const sidePenalty = placement.positionCm.z / Math.max(1, container.depthCm)
  const supportPenalty = 1 - supportRatio
  const rotationPenalty =
    (Math.abs(placement.rotationDeg.x) + Math.abs(placement.rotationDeg.y) + Math.abs(placement.rotationDeg.z)) / 270

  return floorPenalty * 1.2 + backWallPenalty * 1.0 + sidePenalty * 0.9 + cogPenalty * 0.05 + supportPenalty * 0.6 + rotationPenalty * 0.2
}
