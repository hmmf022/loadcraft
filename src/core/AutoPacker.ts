import type { CargoItemDef, ContainerDef, PlacedCargo, Vec3 } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'
import { OccupancyMap } from './OccupancyMap'
import { buildStackContext, checkStackIncremental, addToStackContext } from './StackChecker'
import type { StackContext } from './StackChecker'

// ─── Public types ───────────────────────────────────────────────

export type PackStrategy = 'default' | 'layer' | 'wall' | 'lff'

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

// ─── Internal types ─────────────────────────────────────────────

interface ScoreWeights {
  floor: number
  backWall: number
  side: number
  support: number
  rotation: number
  cog: number
  grouping: number
  caving: number
}

interface GroupCentroid {
  sumX: number
  sumY: number
  sumZ: number
  count: number
}

interface RunningCog {
  totalWeight: number
  cogX: number
  cogY: number
  cogZ: number
}

interface OrientationCandidate {
  rot: Vec3
  effW: number
  effH: number
  effD: number
  offsetX: number
  offsetY: number
  offsetZ: number
}

interface ScoredCandidate {
  placement: PlacedCargo
  result: VoxelizeResult
  score: number
}

// ─── Score weight presets ───────────────────────────────────────

const DEFAULT_WEIGHTS: ScoreWeights = {
  floor: 1.2, backWall: 1.0, side: 0.9, support: 0.6,
  rotation: 0.2, cog: 0.05, grouping: 0, caving: 0,
}

const GROUPING_FALLBACK_WEIGHTS: ScoreWeights = {
  floor: 1.2, backWall: 1.0, side: 0.9, support: 0.6,
  rotation: 0.2, cog: 0.05, grouping: 1.0, caving: 0,
}

const LFF_WEIGHTS: ScoreWeights = {
  floor: 0.6, backWall: 0.4, side: 0.4, support: 0.8,
  rotation: 0.2, cog: 0.05, grouping: 0.8, caving: 1.5,
}

// ─── Constants ──────────────────────────────────────────────────

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

// ─── Orientation helpers ────────────────────────────────────────

/** Create a memoized orientation resolver keyed by defId */
function createOrientationCache(): (def: CargoItemDef) => OrientationCandidate[] {
  const cache = new Map<string, OrientationCandidate[]>()
  return (def: CargoItemDef) => {
    let cached = cache.get(def.id)
    if (!cached) {
      cached = getOrientationCandidates(def)
      cache.set(def.id, cached)
    }
    return cached
  }
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

// ─── tryPlaceItem — shared placement core ───────────────────────

type TryPlaceSuccess = { placed: true; placement: PlacedCargo; result: VoxelizeResult }
type TryPlaceFailure = { placed: false; failureReason: PackFailureReason }
type TryPlaceResult = TryPlaceSuccess | TryPlaceFailure

/**
 * Try to place a single item. On success, mutates occMap/placedAabbs/stackCtx/runningCog.
 * Returns discriminated result with either the placement or a failure reason.
 */
function tryPlaceItem(
  def: CargoItemDef,
  instanceId: number,
  occMap: OccupancyMap,
  container: ContainerDef,
  placedAabbs: Array<{ min: Vec3; max: Vec3 }>,
  stackCtx: StackContext | null,
  weights: ScoreWeights,
  groupCentroids: Map<string, GroupCentroid> | undefined,
  runningCog: RunningCog,
  deadlineMs?: number,
  yMax?: number,
  allowedOrientations?: OrientationCandidate[],
): TryPlaceResult {
  if (deadlineMs !== undefined && Date.now() > deadlineMs) {
    return { placed: false, failureReason: { cargoDefId: def.id, cargoName: def.name, code: 'NO_FEASIBLE_POSITION', detail: 'Auto-pack timed out.' } }
  }

  const candidates = allowedOrientations ?? getOrientationCandidates(def)

  let hadOrientationFit = false
  let hadCandidatePosition = false
  let hadOutOfBounds = false
  let hadCollision = false
  let hadNoSupport = false
  let hadStackConstraint = false

  const scoredCandidates: ScoredCandidate[] = []

  for (const c of candidates) {
    if (c.effW > container.widthCm || c.effH > container.heightCm || c.effD > container.depthCm) {
      continue
    }
    hadOrientationFit = true
    const posList = occMap.findCandidatePositions(c.effW, c.effH, c.effD, 16, yMax)
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

      if (!isInsideContainer(result.aabb, container)) {
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
        instanceId,
        cargoDefId: def.id,
        positionCm: pos,
        rotationDeg: c.rot,
      }

      const score = scorePlacement(
        placement, def, container,
        runningCog.totalWeight, runningCog.cogX, runningCog.cogY, runningCog.cogZ,
        supportRatio, weights, groupCentroids?.get(def.id),
      )
      scoredCandidates.push({ placement, result, score })
    }
  }

  if (scoredCandidates.length === 0) {
    return { placed: false, failureReason: pickFailureReason(def, hadOrientationFit, hadCandidatePosition, hadStackConstraint, hadNoSupport, hadCollision, hadOutOfBounds) }
  }

  scoredCandidates.sort((a, b) => a.score - b.score)

  for (const cand of scoredCandidates) {
    if (stackCtx) {
      const violations = checkStackIncremental(stackCtx, cand.placement, def)
      if (violations.length > 0) {
        hadStackConstraint = true
        continue
      }
    }

    // Success — mutate shared state
    occMap.markAABB(cand.result.aabb)
    placedAabbs.push(cand.result.aabb)
    if (stackCtx) addToStackContext(stackCtx, cand.placement, def)
    const center = getPlacementCenter(cand.placement, def)
    runningCog.totalWeight += def.weightKg
    runningCog.cogX += center.x * def.weightKg
    runningCog.cogY += center.y * def.weightKg
    runningCog.cogZ += center.z * def.weightKg

    return { placed: true, placement: cand.placement, result: cand.result }
  }

  return { placed: false, failureReason: pickFailureReason(def, hadOrientationFit, hadCandidatePosition, hadStackConstraint, hadNoSupport, hadCollision, hadOutOfBounds) }
}

// ─── Sorting ────────────────────────────────────────────────────

function sortForStrategy(items: CargoItemDef[], strategy: PackStrategy, container: ContainerDef): CargoItemDef[] {
  const sorted = [...items]
  if (strategy === 'lff') {
    // Less Flexibility First: fewest fitting orientations first, then volume desc, then group by defId
    const flexCache = new Map<string, number>()
    const getFlexibility = (def: CargoItemDef): number => {
      if (flexCache.has(def.id)) return flexCache.get(def.id)!
      const flex = getOrientationCandidates(def).filter(c =>
        c.effW <= container.widthCm && c.effH <= container.heightCm && c.effD <= container.depthCm
      ).length
      flexCache.set(def.id, flex)
      return flex
    }
    sorted.sort((a, b) => {
      const flexA = getFlexibility(a)
      const flexB = getFlexibility(b)
      if (flexA !== flexB) return flexA - flexB
      const volA = a.widthCm * a.heightCm * a.depthCm
      const volB = b.widthCm * b.heightCm * b.depthCm
      if (volA !== volB) return volB - volA
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  } else {
    // default / layer / wall fallback: volume descending
    sorted.sort((a, b) => {
      const volA = a.widthCm * a.heightCm * a.depthCm
      const volB = b.widthCm * b.heightCm * b.depthCm
      return volB - volA
    })
  }
  return sorted
}

// ─── Group centroid tracking ────────────────────────────────────

function updateGroupCentroids(
  centroids: Map<string, GroupCentroid>,
  placement: PlacedCargo,
  def: CargoItemDef,
): void {
  const center = getPlacementCenter(placement, def)
  const gc = centroids.get(def.id) ?? { sumX: 0, sumY: 0, sumZ: 0, count: 0 }
  gc.sumX += center.x
  gc.sumY += center.y
  gc.sumZ += center.z
  gc.count++
  centroids.set(def.id, gc)
}

// ─── Single-pass packing (default, lff, layer/wall fallback) ───

function autoPackSinglePass(
  items: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
  weights: ScoreWeights,
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

  const occMap = baseOccMap
    ? baseOccMap.clone()
    : new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId
  const allDefs = dedupeDefs([...existingDefs, ...items])
  const placedAabbs = buildAabbList(existingPlacements, allDefs)

  const hasAnyStackConstraints = allDefs.some(
    d => d.noStack === true || d.maxStackWeightKg !== undefined
  )
  const stackCtx = hasAnyStackConstraints
    ? buildStackContext(existingPlacements, allDefs)
    : null

  const runningCog: RunningCog = { totalWeight: 0, cogX: 0, cogY: 0, cogZ: 0 }
  for (const p of existingPlacements) {
    const def = allDefs.find((d) => d.id === p.cargoDefId)
    if (!def) continue
    const center = getPlacementCenter(p, def)
    runningCog.totalWeight += def.weightKg
    runningCog.cogX += center.x * def.weightKg
    runningCog.cogY += center.y * def.weightKg
    runningCog.cogZ += center.z * def.weightKg
  }

  // Build group centroids from existing placements (for grouping penalty)
  const groupCentroids: Map<string, GroupCentroid> | undefined =
    weights.grouping > 0 ? new Map() : undefined
  if (groupCentroids) {
    for (const p of existingPlacements) {
      const def = allDefs.find(d => d.id === p.cargoDefId)
      if (def) updateGroupCentroids(groupCentroids, p, def)
    }
  }

  const getCachedOrientations = createOrientationCache()

  for (const def of items) {
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

    const tryResult = tryPlaceItem(
      def, nextId, occMap, container, placedAabbs,
      stackCtx, weights, groupCentroids, runningCog,
      deadlineMs, undefined, getCachedOrientations(def),
    )

    if (tryResult.placed) {
      placements.push(tryResult.placement)
      voxelizeResults.push(tryResult.result)
      if (groupCentroids) updateGroupCentroids(groupCentroids, tryResult.placement, def)
      nextId++
    } else {
      failedDefIds.push(def.id)
      failureReasons.push(tryResult.failureReason)
    }
  }

  return { placements, voxelizeResults, failedDefIds, failureReasons }
}

// ─── Layer-building (repack only) ───────────────────────────────

function autoPackLayered(
  items: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
  deadlineMs?: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []
  const failureReasons: PackFailureReason[] = []

  const getCachedOrientations = createOrientationCache()

  // 1. Group items by cargoDefId
  const groupMap = new Map<string, { def: CargoItemDef; count: number }>()
  for (const item of items) {
    const existing = groupMap.get(item.id)
    if (existing) {
      existing.count++
    } else {
      groupMap.set(item.id, { def: item, count: 1 })
    }
  }

  // 2. For each group, determine best orientation (min effH, then max bottom area)
  interface LayerGroup {
    def: CargoItemDef
    count: number
    bestOrientation: OrientationCandidate
    layerHeight: number
  }

  const groups: LayerGroup[] = []
  for (const [, { def, count }] of groupMap) {
    const candidates = getCachedOrientations(def)
    const fitting = candidates.filter(c =>
      c.effW <= container.widthCm && c.effH <= container.heightCm && c.effD <= container.depthCm
    )
    if (fitting.length === 0) {
      for (let i = 0; i < count; i++) {
        failedDefIds.push(def.id)
        failureReasons.push({
          cargoDefId: def.id,
          cargoName: def.name,
          code: 'OUT_OF_BOUNDS',
          detail: 'Item does not fit container dimensions in any allowed orientation.',
        })
      }
      continue
    }
    // Best: min effH, then max bottom area
    fitting.sort((a, b) => {
      if (a.effH !== b.effH) return a.effH - b.effH
      return (b.effW * b.effD) - (a.effW * a.effD)
    })
    const best = fitting[0]!
    groups.push({ def, count, bestOrientation: best, layerHeight: best.effH })
  }

  // 3. Sort groups by layerHeight descending (tallest groups at the bottom)
  groups.sort((a, b) => b.layerHeight - a.layerHeight)

  // 4. Build layers
  const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId
  const allDefs = dedupeDefs(items)
  const placedAabbs: Array<{ min: Vec3; max: Vec3 }> = []

  const hasAnyStackConstraints = allDefs.some(
    d => d.noStack === true || d.maxStackWeightKg !== undefined
  )
  const stackCtx = hasAnyStackConstraints ? buildStackContext([], allDefs) : null
  const runningCog: RunningCog = { totalWeight: 0, cogX: 0, cogY: 0, cogZ: 0 }

  let layerY = 0

  for (const group of groups) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      for (let i = 0; i < group.count; i++) {
        failedDefIds.push(group.def.id)
        failureReasons.push({
          cargoDefId: group.def.id,
          cargoName: group.def.name,
          code: 'NO_FEASIBLE_POSITION',
          detail: 'Auto-pack timed out.',
        })
      }
      continue
    }

    // a. Check if layer fits
    if (layerY + group.layerHeight > container.heightCm) {
      for (let i = 0; i < group.count; i++) {
        failedDefIds.push(group.def.id)
        failureReasons.push({
          cargoDefId: group.def.id,
          cargoName: group.def.name,
          code: 'NO_FEASIBLE_POSITION',
          detail: 'No vertical space remaining for this layer.',
        })
      }
      continue
    }

    const layerCeiling = layerY + group.layerHeight

    // b. Filter orientations to those with effH <= layerHeight
    const allCandidates = getCachedOrientations(group.def)
    const layerCandidates = allCandidates.filter(c =>
      c.effH <= group.layerHeight &&
      c.effW <= container.widthCm && c.effD <= container.depthCm
    )

    // c. Place each item in the group
    for (let i = 0; i < group.count; i++) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) {
        failedDefIds.push(group.def.id)
        failureReasons.push({
          cargoDefId: group.def.id,
          cargoName: group.def.name,
          code: 'NO_FEASIBLE_POSITION',
          detail: 'Auto-pack timed out.',
        })
        continue
      }

      const tryResult = tryPlaceItem(
        group.def, nextId, occMap, container, placedAabbs,
        stackCtx, DEFAULT_WEIGHTS, undefined, runningCog,
        deadlineMs, layerCeiling, layerCandidates,
      )

      if (tryResult.placed) {
        placements.push(tryResult.placement)
        voxelizeResults.push(tryResult.result)
        nextId++
      } else {
        failedDefIds.push(group.def.id)
        failureReasons.push(tryResult.failureReason)
      }
    }

    // d. Seal the layer
    occMap.sealToHeight(layerCeiling)
    layerY = layerCeiling
  }

  return { placements, voxelizeResults, failedDefIds, failureReasons }
}

// ─── Wall-building (repack only) ────────────────────────────────

function autoPackWalled(
  items: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
  deadlineMs?: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []
  const failureReasons: PackFailureReason[] = []

  const getCachedOrientations = createOrientationCache()

  // Track unplaced items as { def, originalIndex }
  interface UnplacedItem {
    def: CargoItemDef
    idx: number
  }
  let unplaced: UnplacedItem[] = items.map((def, idx) => ({ def, idx }))

  const allDefs = dedupeDefs(items)
  const hasAnyStackConstraints = allDefs.some(
    d => d.noStack === true || d.maxStackWeightKg !== undefined
  )
  const globalStackCtx = hasAnyStackConstraints ? buildStackContext([], allDefs) : null
  const globalRunningCog: RunningCog = { totalWeight: 0, cogX: 0, cogY: 0, cogZ: 0 }
  const globalPlacedAabbs: Array<{ min: Vec3; max: Vec3 }> = []

  let wallX = 0
  let nextId = startInstanceId

  while (unplaced.length > 0 && wallX < container.widthCm) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      for (const u of unplaced) {
        failedDefIds.push(u.def.id)
        failureReasons.push({
          cargoDefId: u.def.id,
          cargoName: u.def.name,
          code: 'NO_FEASIBLE_POSITION',
          detail: 'Auto-pack timed out.',
        })
      }
      break
    }

    // b. Select LDB (Largest Dimension Box) using George-Robinson criteria
    const defCounts = new Map<string, number>()
    for (const u of unplaced) {
      defCounts.set(u.def.id, (defCounts.get(u.def.id) ?? 0) + 1)
    }

    // For each distinct defId, evaluate the GR criteria
    const seenDefs = new Map<string, UnplacedItem>()
    for (const u of unplaced) {
      if (!seenDefs.has(u.def.id)) seenDefs.set(u.def.id, u)
    }

    let ldbItem: UnplacedItem | null = null
    let ldbMinDim = -1
    let ldbCount = -1
    let ldbVolume = -1

    for (const [defId, representative] of seenDefs) {
      const d = representative.def
      const minDim = Math.min(d.widthCm, d.heightCm, d.depthCm)
      const volume = d.widthCm * d.heightCm * d.depthCm
      const count = defCounts.get(defId) ?? 0

      if (
        minDim > ldbMinDim ||
        (minDim === ldbMinDim && count > ldbCount) ||
        (minDim === ldbMinDim && count === ldbCount && volume > ldbVolume)
      ) {
        ldbMinDim = minDim
        ldbCount = count
        ldbVolume = volume
        ldbItem = representative
      }
    }

    if (!ldbItem) break

    // c. Determine wallDepth from LDB's best X-thin orientation
    const ldbCandidates = getCachedOrientations(ldbItem.def)
    const remainingW = container.widthCm - wallX
    const fittingLdb = ldbCandidates.filter(c =>
      c.effW <= remainingW && c.effH <= container.heightCm && c.effD <= container.depthCm
    )

    if (fittingLdb.length === 0) {
      // LDB doesn't fit in remaining space — remove all of this defId
      const ldbDefId = ldbItem.def.id
      for (const u of unplaced.filter(u => u.def.id === ldbDefId)) {
        failedDefIds.push(u.def.id)
        failureReasons.push({
          cargoDefId: u.def.id,
          cargoName: u.def.name,
          code: 'NO_FEASIBLE_POSITION',
          detail: 'LDB does not fit in remaining container width.',
        })
      }
      unplaced = unplaced.filter(u => u.def.id !== ldbDefId)
      continue
    }

    // Pick orientation with smallest effW (thinnest wall)
    fittingLdb.sort((a, b) => a.effW - b.effW)
    let wallDepth = fittingLdb[0]!.effW
    if (wallX + wallDepth > container.widthCm) {
      wallDepth = container.widthCm - wallX
    }

    // d. Create wall-local OccupancyMap
    const wallContainer: ContainerDef = {
      widthCm: wallDepth,
      heightCm: container.heightCm,
      depthCm: container.depthCm,
      maxPayloadKg: container.maxPayloadKg,
    }
    const wallOccMap = new OccupancyMap(wallDepth, container.heightCm, container.depthCm)
    const wallPlacedAabbs: Array<{ min: Vec3; max: Vec3 }> = []
    const wallStackCtx = hasAnyStackConstraints ? buildStackContext([], allDefs) : null
    const wallRunningCog: RunningCog = { totalWeight: 0, cogX: 0, cogY: 0, cogZ: 0 }

    const wallPlacements: Array<{ placement: PlacedCargo; result: VoxelizeResult; itemIdx: number }> = []

    // e. Place LDB defId items first
    const ldbDefId = ldbItem.def.id
    const ldbItems = unplaced.filter(u => u.def.id === ldbDefId)
    const nonLdbItems = unplaced.filter(u => u.def.id !== ldbDefId)

    for (const u of ldbItems) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) break

      // Filter orientations to effW <= wallDepth
      const orientations = getCachedOrientations(u.def).filter(c =>
        c.effW <= wallDepth && c.effH <= container.heightCm && c.effD <= container.depthCm
      )
      if (orientations.length === 0) continue

      const tryResult = tryPlaceItem(
        u.def, nextId, wallOccMap, wallContainer, wallPlacedAabbs,
        wallStackCtx, DEFAULT_WEIGHTS, undefined, wallRunningCog,
        deadlineMs, undefined, orientations,
      )

      if (tryResult.placed) {
        wallPlacements.push({ placement: tryResult.placement, result: tryResult.result, itemIdx: u.idx })
        nextId++
      }
    }

    // f. Try remaining items — pre-filter items whose min dimension exceeds wallDepth
    const fittableNonLdb = nonLdbItems.filter(u => {
      const minDim = Math.min(u.def.widthCm, u.def.heightCm, u.def.depthCm)
      return minDim <= wallDepth
    })

    for (const u of fittableNonLdb) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) break

      const orientations = getCachedOrientations(u.def).filter(c =>
        c.effW <= wallDepth && c.effH <= container.heightCm && c.effD <= container.depthCm
      )
      if (orientations.length === 0) continue

      const tryResult = tryPlaceItem(
        u.def, nextId, wallOccMap, wallContainer, wallPlacedAabbs,
        wallStackCtx, DEFAULT_WEIGHTS, undefined, wallRunningCog,
        deadlineMs, undefined, orientations,
      )

      if (tryResult.placed) {
        wallPlacements.push({ placement: tryResult.placement, result: tryResult.result, itemIdx: u.idx })
        nextId++
      }
    }

    // g. Convert wall-local placements to global coordinates
    const placedIdxSet = new Set<number>()
    for (const wp of wallPlacements) {
      placedIdxSet.add(wp.itemIdx)

      // Offset position
      const globalPos: Vec3 = {
        x: wp.placement.positionCm.x + wallX,
        y: wp.placement.positionCm.y,
        z: wp.placement.positionCm.z,
      }

      const globalPlacement: PlacedCargo = {
        ...wp.placement,
        positionCm: globalPos,
      }

      // Re-voxelize at global position
      const def = items[wp.itemIdx]!
      const globalResult = def.blocks
        ? voxelizeComposite(def.blocks, globalPos, wp.placement.rotationDeg)
        : voxelize(def.widthCm, def.heightCm, def.depthCm, globalPos, wp.placement.rotationDeg)

      placements.push(globalPlacement)
      voxelizeResults.push(globalResult)
      globalPlacedAabbs.push(globalResult.aabb)
      if (globalStackCtx) addToStackContext(globalStackCtx, globalPlacement, def)

      const center = getPlacementCenter(globalPlacement, def)
      globalRunningCog.totalWeight += def.weightKg
      globalRunningCog.cogX += center.x * def.weightKg
      globalRunningCog.cogY += center.y * def.weightKg
      globalRunningCog.cogZ += center.z * def.weightKg
    }

    // Remove placed items from unplaced list
    unplaced = unplaced.filter(u => !placedIdxSet.has(u.idx))

    // h. Advance wall position
    wallX += wallDepth
  }

  // 3. Remaining unplaced items
  for (const u of unplaced) {
    if (!failedDefIds.includes(u.def.id) || failedDefIds.filter(id => id === u.def.id).length < unplaced.filter(uu => uu.def.id === u.def.id).length) {
      failedDefIds.push(u.def.id)
      failureReasons.push({
        cargoDefId: u.def.id,
        cargoName: u.def.name,
        code: 'NO_FEASIBLE_POSITION',
        detail: 'Could not fit in any wall.',
      })
    }
  }

  return { placements, voxelizeResults, failedDefIds, failureReasons }
}

// ─── Main dispatcher ────────────────────────────────────────────

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
  strategy: PackStrategy = 'default',
): PackResult {
  const isRepack = !baseOccMap

  if (strategy === 'layer') {
    if (isRepack) {
      return autoPackLayered(items, container, startInstanceId, deadlineMs)
    }
    // pack_staged fallback: default pass with grouping weights
    const sorted = sortForStrategy(items, 'default', container)
    return autoPackSinglePass(sorted, container, startInstanceId, GROUPING_FALLBACK_WEIGHTS, baseOccMap, context, deadlineMs)
  }

  if (strategy === 'wall') {
    if (isRepack) {
      return autoPackWalled(items, container, startInstanceId, deadlineMs)
    }
    // pack_staged fallback: default pass with grouping weights
    const sorted = sortForStrategy(items, 'default', container)
    return autoPackSinglePass(sorted, container, startInstanceId, GROUPING_FALLBACK_WEIGHTS, baseOccMap, context, deadlineMs)
  }

  if (strategy === 'lff') {
    const sorted = sortForStrategy(items, 'lff', container)
    return autoPackSinglePass(sorted, container, startInstanceId, LFF_WEIGHTS, baseOccMap, context, deadlineMs)
  }

  // default
  const sorted = sortForStrategy(items, 'default', container)
  return autoPackSinglePass(sorted, container, startInstanceId, DEFAULT_WEIGHTS, baseOccMap, context, deadlineMs)
}

// ─── Scoring ────────────────────────────────────────────────────

function scorePlacement(
  placement: PlacedCargo,
  def: CargoItemDef,
  container: ContainerDef,
  runningTotalWeight: number,
  runningCogX: number,
  runningCogY: number,
  runningCogZ: number,
  supportRatio: number,
  weights: ScoreWeights,
  groupCentroid?: GroupCentroid,
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

  let score =
    floorPenalty * weights.floor +
    backWallPenalty * weights.backWall +
    sidePenalty * weights.side +
    cogPenalty * weights.cog +
    supportPenalty * weights.support +
    rotationPenalty * weights.rotation

  // Grouping penalty
  if (weights.grouping > 0 && groupCentroid && groupCentroid.count > 0) {
    const avgX = groupCentroid.sumX / groupCentroid.count
    const avgY = groupCentroid.sumY / groupCentroid.count
    const avgZ = groupCentroid.sumZ / groupCentroid.count
    const groupingPenalty =
      Math.abs(center.x - avgX) / Math.max(1, container.widthCm) +
      Math.abs(center.y - avgY) / Math.max(1, container.heightCm) +
      Math.abs(center.z - avgZ) / Math.max(1, container.depthCm)
    score += groupingPenalty * weights.grouping
  }

  // Caving penalty (wall contact)
  if (weights.caving > 0) {
    let wallContact = 0
    if (aabb.min.x < 1) wallContact++
    if (aabb.min.y < 1) wallContact++
    if (aabb.min.z < 1) wallContact++
    if (aabb.max.x > container.widthCm - 1) wallContact++
    if (aabb.max.z > container.depthCm - 1) wallContact++
    const cavingPenalty = 1 - wallContact / 5
    score += cavingPenalty * weights.caving
  }

  return score
}

// ─── Utility functions ──────────────────────────────────────────

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
