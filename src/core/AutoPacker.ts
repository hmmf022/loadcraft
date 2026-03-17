import type { CargoItemDef, ContainerDef, PlacedCargo, Vec3 } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite, computeRotatedAABB } from './Voxelizer'
import { OccupancyMap } from './OccupancyMap'
import { buildStackContext, checkStackIncremental, addToStackContext } from './StackChecker'
import type { StackContext } from './StackChecker'

// ─── Public types ───────────────────────────────────────────────

export type PackStrategy = 'default' | 'layer' | 'wall' | 'lff' | 'ep'

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

const EP_WEIGHTS: ScoreWeights = {
  floor: 1.2, backWall: 1.0, side: 0.9, support: 0.6,
  rotation: 0.2, cog: 0.05, grouping: 0, caving: 1.0,
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
  placedAabbs: SpatialHash,
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
      // Offset existing results instead of re-voxelizing (corrections are always integers).
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
        result = {
          voxels: result.voxels.map(v => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz })),
          usesFastPath: result.usesFastPath,
          aabb: {
            min: { x: min.x + dx, y: min.y + dy, z: min.z + dz },
            max: { x: max.x + dx, y: max.y + dy, z: max.z + dz },
          },
        }
      }

      if (!isInsideContainer(result.aabb, container)) {
        hadOutOfBounds = true
        continue
      }
      if (placedAabbs.isColliding(result.aabb)) {
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

      const candCenter = centerFromAABB(result.aabb)
      const score = scorePlacement(
        placement, def, container,
        runningCog.totalWeight, runningCog.cogX, runningCog.cogY, runningCog.cogZ,
        supportRatio, weights, groupCentroids?.get(def.id),
        result.aabb, candCenter,
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
    placedAabbs.add(cand.result.aabb)
    if (stackCtx) addToStackContext(stackCtx, cand.placement, def)
    const center = centerFromAABB(cand.result.aabb)
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
      const nsA = a.noStack ? 1 : 0
      const nsB = b.noStack ? 1 : 0
      if (nsA !== nsB) return nsA - nsB
      const flexA = getFlexibility(a)
      const flexB = getFlexibility(b)
      if (flexA !== flexB) return flexA - flexB
      const volA = a.widthCm * a.heightCm * a.depthCm
      const volB = b.widthCm * b.heightCm * b.depthCm
      if (volA !== volB) return volB - volA
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  } else {
    // default / layer / wall fallback: volume descending, noStack items last
    sorted.sort((a, b) => {
      const nsA = a.noStack ? 1 : 0
      const nsB = b.noStack ? 1 : 0
      if (nsA !== nsB) return nsA - nsB
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
  defId: string,
  center: Vec3,
): void {
  const gc = centroids.get(defId) ?? { sumX: 0, sumY: 0, sumZ: 0, count: 0 }
  gc.sumX += center.x
  gc.sumY += center.y
  gc.sumZ += center.z
  gc.count++
  centroids.set(defId, gc)
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
  const placedAabbs = buildAabbHash(existingPlacements, allDefs)

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
      if (def) updateGroupCentroids(groupCentroids, def.id, getPlacementCenter(p, def))
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
      if (groupCentroids) updateGroupCentroids(groupCentroids, def.id, centerFromAABB(tryResult.result.aabb))
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

  // 3. Sort groups by layerHeight descending (tallest groups at the bottom), noStack last
  groups.sort((a, b) => {
    const nsA = a.def.noStack ? 1 : 0
    const nsB = b.def.noStack ? 1 : 0
    if (nsA !== nsB) return nsA - nsB
    return b.layerHeight - a.layerHeight
  })

  // 4. Build layers
  const occMap = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId
  const allDefs = dedupeDefs(items)
  const placedAabbs = new SpatialHash()

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
  const globalPlacedAabbs = new SpatialHash()

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
    const wallPlacedAabbs = new SpatialHash()
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
      globalPlacedAabbs.add(globalResult.aabb)
      if (globalStackCtx) addToStackContext(globalStackCtx, globalPlacement, def)

      const center = centerFromAABB(globalResult.aabb)
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

// ─── Extreme Point helpers ───────────────────────────────────────

/** Compute AABB for a cargo def (simple or composite) at position with rotation. */
function computeCargoAABB(
  def: CargoItemDef,
  position: Vec3,
  rotationDeg: Vec3,
): { min: Vec3; max: Vec3 } {
  if (def.blocks) {
    return voxelizeComposite(def.blocks, position, rotationDeg).aabb
  }
  return computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, position, rotationDeg)
}

interface ExtremePoint {
  x: number
  z: number
  fixedY: number | null  // EP_top: fixed Y, others: null (dynamic via getStackHeight)
}

class ExtremePointSet {
  points: ExtremePoint[]
  containerW: number
  containerH: number
  containerD: number

  constructor(container: ContainerDef) {
    this.containerW = container.widthCm
    this.containerH = container.heightCm
    this.containerD = container.depthCm
    this.points = [{ x: 0, z: 0, fixedY: null }]
  }

  generateFromPlacement(aabb: { min: Vec3; max: Vec3 }): void {
    // EP_right: right side
    if (aabb.max.x < this.containerW && aabb.min.z < this.containerD) {
      this.points.push({ x: aabb.max.x, z: aabb.min.z, fixedY: null })
    }
    // EP_top: on top
    if (aabb.min.x < this.containerW && aabb.min.z < this.containerD && aabb.max.y < this.containerH) {
      this.points.push({ x: aabb.min.x, z: aabb.min.z, fixedY: aabb.max.y })
    }
    // EP_front: in front
    if (aabb.min.x < this.containerW && aabb.max.z < this.containerD) {
      this.points.push({ x: aabb.min.x, z: aabb.max.z, fixedY: null })
    }
  }

  removeInsideAnyAABB(aabbs: Array<{ min: Vec3; max: Vec3 }>): void {
    this.points = this.points.filter(ep => {
      for (const a of aabbs) {
        if (ep.x >= a.min.x && ep.x < a.max.x &&
            ep.z >= a.min.z && ep.z < a.max.z) {
          if (ep.fixedY === null) return false
          if (ep.fixedY >= a.min.y && ep.fixedY < a.max.y) return false
        }
      }
      return true
    })
  }

  removeDominated(): void {
    const n = this.points.length
    const dominated = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (dominated.has(i)) continue
      const a = this.points[i]!
      for (let j = i + 1; j < n; j++) {
        if (dominated.has(j)) continue
        const b = this.points[j]!
        // a dominates b?
        if (a.x <= b.x && a.z <= b.z) {
          if (a.fixedY === null && b.fixedY === null) {
            dominated.add(j)
          } else if (a.fixedY !== null && b.fixedY !== null && a.fixedY <= b.fixedY) {
            dominated.add(j)
          }
        }
        // b dominates a?
        if (b.x <= a.x && b.z <= a.z) {
          if (a.fixedY === null && b.fixedY === null) {
            dominated.add(i)
            break
          } else if (a.fixedY !== null && b.fixedY !== null && b.fixedY <= a.fixedY) {
            dominated.add(i)
            break
          }
        }
      }
    }
    this.points = this.points.filter((_, i) => !dominated.has(i))
  }

  getCandidates(): ExtremePoint[] {
    if (this.points.length <= 500) return this.points
    const sorted = [...this.points].sort((a, b) => (a.x + a.z) - (b.x + b.z))
    return sorted.slice(0, 500)
  }
}

// ─── Extreme Point packing ──────────────────────────────────────

function autoPackExtremePoint(
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

  const occMap = baseOccMap
    ? baseOccMap.clone()
    : new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
  let nextId = startInstanceId
  const allDefs = dedupeDefs([...existingDefs, ...items])
  const placedAabbs = buildAabbHash(existingPlacements, allDefs)

  const hasAnyStackConstraints = allDefs.some(
    d => d.noStack === true || d.maxStackWeightKg !== undefined
  )
  const stackCtx = hasAnyStackConstraints
    ? buildStackContext(existingPlacements, allDefs)
    : null

  const runningCog: RunningCog = { totalWeight: 0, cogX: 0, cogY: 0, cogZ: 0 }
  for (const p of existingPlacements) {
    const def = allDefs.find(d => d.id === p.cargoDefId)
    if (!def) continue
    const center = getPlacementCenter(p, def)
    runningCog.totalWeight += def.weightKg
    runningCog.cogX += center.x * def.weightKg
    runningCog.cogY += center.y * def.weightKg
    runningCog.cogZ += center.z * def.weightKg
  }

  const getCachedOrientations = createOrientationCache()

  // ── EP set initialization ──
  const epSet = new ExtremePointSet(container)

  // Generate initial EPs from existing placements
  for (const p of existingPlacements) {
    const def = allDefs.find(d => d.id === p.cargoDefId)
    if (!def) continue
    const aabb = computeCargoAABB(def, p.positionCm, p.rotationDeg)
    epSet.generateFromPlacement(aabb)
  }
  epSet.removeInsideAnyAABB(placedAabbs.getAll())
  epSet.removeDominated()

  // ── Main loop ──
  for (const def of items) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      failedDefIds.push(def.id)
      failureReasons.push({
        cargoDefId: def.id, cargoName: def.name,
        code: 'NO_FEASIBLE_POSITION', detail: 'Auto-pack timed out.',
      })
      continue
    }

    const candidates = getCachedOrientations(def)
    const scoredList: Array<{ placement: PlacedCargo; aabb: { min: Vec3; max: Vec3 }; score: number }> = []
    let hadOrientationFit = false
    let hadCandidatePosition = false
    let hadOutOfBounds = false
    let hadCollision = false
    let hadNoSupport = false
    let hadStackConstraint = false

    // Early termination threshold: floor placement at back wall with good support
    const GOOD_ENOUGH_SCORE = 0.3
    // Limit total candidates to evaluate (more placed items → fewer candidates needed)
    const maxCandidates = Math.max(32, 200 - placedAabbs.getAll().length)
    let bestScore = Infinity

    for (const c of candidates) {
      if (c.effW > container.widthCm || c.effH > container.heightCm || c.effD > container.depthCm) continue
      hadOrientationFit = true

      for (const ep of epSet.getCandidates()) {
        if (scoredList.length >= maxCandidates && bestScore <= GOOD_ENOUGH_SCORE) break

        // Determine Y coordinate
        const baseY = ep.fixedY !== null
          ? ep.fixedY
          : occMap.getStackHeight(ep.x, ep.z, c.effW, c.effD)

        if (baseY + c.effH > container.heightCm) continue
        hadCandidatePosition = true

        let pos: Vec3 = {
          x: ep.x + c.offsetX,
          y: baseY + c.offsetY,
          z: ep.z + c.offsetZ,
        }

        let aabb = computeCargoAABB(def, pos, c.rot)

        // Bounds correction — offset AABB instead of recomputing
        let dx = 0, dy = 0, dz = 0
        if (aabb.min.x < 0) dx = -aabb.min.x
        if (aabb.min.y < 0) dy = -aabb.min.y
        if (aabb.min.z < 0) dz = -aabb.min.z
        if (aabb.max.x > container.widthCm) dx = container.widthCm - aabb.max.x
        if (aabb.max.y > container.heightCm) dy = container.heightCm - aabb.max.y
        if (aabb.max.z > container.depthCm) dz = container.depthCm - aabb.max.z
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          pos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }
          aabb = {
            min: { x: aabb.min.x + dx, y: aabb.min.y + dy, z: aabb.min.z + dz },
            max: { x: aabb.max.x + dx, y: aabb.max.y + dy, z: aabb.max.z + dz },
          }
        }

        if (!isInsideContainer(aabb, container)) { hadOutOfBounds = true; continue }
        if (placedAabbs.isColliding(aabb)) { hadCollision = true; continue }

        const supportRatio = occMap.getSupportRatio(
          aabb.min.x, aabb.min.z,
          aabb.max.x - aabb.min.x, aabb.max.z - aabb.min.z,
          aabb.min.y,
        )
        if (supportRatio < MIN_SUPPORT_RATIO) { hadNoSupport = true; continue }

        const placement: PlacedCargo = {
          instanceId: nextId, cargoDefId: def.id,
          positionCm: pos, rotationDeg: c.rot,
        }
        const epCenter = centerFromAABB(aabb)
        const score = scorePlacement(
          placement, def, container,
          runningCog.totalWeight, runningCog.cogX, runningCog.cogY, runningCog.cogZ,
          supportRatio, EP_WEIGHTS, undefined,
          aabb, epCenter,
        )
        scoredList.push({ placement, aabb, score })
        if (score < bestScore) bestScore = score
      }
      if (scoredList.length >= maxCandidates && bestScore <= GOOD_ENOUGH_SCORE) break
    }

    // Fallback: if EP candidates found no valid position, try OccupancyMap search
    if (scoredList.length === 0) {
      for (const c of candidates) {
        if (c.effW > container.widthCm || c.effH > container.heightCm || c.effD > container.depthCm) continue
        const posList = occMap.findCandidatePositions(c.effW, c.effH, c.effD, 16)
        for (const candidatePos of posList) {
          hadCandidatePosition = true
          let pos: Vec3 = {
            x: candidatePos.x + c.offsetX,
            y: candidatePos.y + c.offsetY,
            z: candidatePos.z + c.offsetZ,
          }
          let aabb = computeCargoAABB(def, pos, c.rot)
          let dx = 0, dy = 0, dz = 0
          if (aabb.min.x < 0) dx = -aabb.min.x
          if (aabb.min.y < 0) dy = -aabb.min.y
          if (aabb.min.z < 0) dz = -aabb.min.z
          if (aabb.max.x > container.widthCm) dx = container.widthCm - aabb.max.x
          if (aabb.max.y > container.heightCm) dy = container.heightCm - aabb.max.y
          if (aabb.max.z > container.depthCm) dz = container.depthCm - aabb.max.z
          if (dx !== 0 || dy !== 0 || dz !== 0) {
            pos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }
            aabb = {
              min: { x: aabb.min.x + dx, y: aabb.min.y + dy, z: aabb.min.z + dz },
              max: { x: aabb.max.x + dx, y: aabb.max.y + dy, z: aabb.max.z + dz },
            }
          }
          if (!isInsideContainer(aabb, container)) { hadOutOfBounds = true; continue }
          if (placedAabbs.isColliding(aabb)) { hadCollision = true; continue }
          const supportRatio = occMap.getSupportRatio(
            aabb.min.x, aabb.min.z,
            aabb.max.x - aabb.min.x, aabb.max.z - aabb.min.z,
            aabb.min.y,
          )
          if (supportRatio < MIN_SUPPORT_RATIO) { hadNoSupport = true; continue }
          const placement: PlacedCargo = {
            instanceId: nextId, cargoDefId: def.id,
            positionCm: pos, rotationDeg: c.rot,
          }
          const fbCenter = centerFromAABB(aabb)
          const score = scorePlacement(
            placement, def, container,
            runningCog.totalWeight, runningCog.cogX, runningCog.cogY, runningCog.cogZ,
            supportRatio, EP_WEIGHTS, undefined,
            aabb, fbCenter,
          )
          scoredList.push({ placement, aabb, score })
        }
      }
    }

    if (scoredList.length === 0) {
      failedDefIds.push(def.id)
      failureReasons.push(pickFailureReason(def, hadOrientationFit, hadCandidatePosition, hadStackConstraint, hadNoSupport, hadCollision, hadOutOfBounds))
      continue
    }

    scoredList.sort((a, b) => a.score - b.score)

    let placed = false
    for (const cand of scoredList) {
      if (stackCtx) {
        const violations = checkStackIncremental(stackCtx, cand.placement, def)
        if (violations.length > 0) { hadStackConstraint = true; continue }
      }

      // Success — update state
      occMap.markAABB(cand.aabb)
      placedAabbs.add(cand.aabb)
      if (stackCtx) addToStackContext(stackCtx, cand.placement, def)
      const center = centerFromAABB(cand.aabb)
      runningCog.totalWeight += def.weightKg
      runningCog.cogX += center.x * def.weightKg
      runningCog.cogY += center.y * def.weightKg
      runningCog.cogZ += center.z * def.weightKg

      // EP update
      epSet.generateFromPlacement(cand.aabb)
      epSet.removeInsideAnyAABB(placedAabbs.getAll())
      epSet.removeDominated()

      // Generate VoxelizeResult
      const result = def.blocks
        ? voxelizeComposite(def.blocks, cand.placement.positionCm, cand.placement.rotationDeg)
        : voxelize(def.widthCm, def.heightCm, def.depthCm, cand.placement.positionCm, cand.placement.rotationDeg)

      placements.push(cand.placement)
      voxelizeResults.push(result)
      nextId++
      placed = true
      break
    }

    if (!placed) {
      failedDefIds.push(def.id)
      failureReasons.push(pickFailureReason(def, hadOrientationFit, hadCandidatePosition, hadStackConstraint, hadNoSupport, hadCollision, hadOutOfBounds))
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

  if (strategy === 'ep') {
    const sorted = sortForStrategy(items, 'default', container)
    return autoPackExtremePoint(sorted, container, startInstanceId, baseOccMap, context, deadlineMs)
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
  groupCentroid: GroupCentroid | undefined,
  aabb: { min: Vec3; max: Vec3 },
  center: Vec3,
): number {
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

function buildAabbHash(placements: PlacedCargo[], defs: CargoItemDef[]): SpatialHash {
  const defMap = new Map<string, CargoItemDef>()
  for (const def of defs) {
    defMap.set(def.id, def)
  }
  const hash = new SpatialHash()
  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue
    const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg)
    hash.add(aabb)
  }
  return hash
}

function isInsideContainer(aabb: { min: Vec3; max: Vec3 }, container: ContainerDef): boolean {
  return !(
    aabb.min.x < 0 || aabb.min.y < 0 || aabb.min.z < 0 ||
    aabb.max.x > container.widthCm || aabb.max.y > container.heightCm || aabb.max.z > container.depthCm
  )
}

// ─── Spatial hash for fast AABB collision queries ────────────────

const CELL_SIZE = 50

class SpatialHash {
  private cells: Map<number, Array<{ min: Vec3; max: Vec3 }>>
  private allAABBs: Array<{ min: Vec3; max: Vec3 }>

  constructor() {
    this.cells = new Map()
    this.allAABBs = []
  }

  private hashKey(cx: number, cy: number, cz: number): number {
    // Use a large-prime spatial hash to minimize collisions
    return (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)
  }

  add(aabb: { min: Vec3; max: Vec3 }): void {
    this.allAABBs.push(aabb)
    const minCX = Math.floor(aabb.min.x / CELL_SIZE)
    const minCY = Math.floor(aabb.min.y / CELL_SIZE)
    const minCZ = Math.floor(aabb.min.z / CELL_SIZE)
    const maxCX = Math.floor(aabb.max.x / CELL_SIZE)
    const maxCY = Math.floor(aabb.max.y / CELL_SIZE)
    const maxCZ = Math.floor(aabb.max.z / CELL_SIZE)
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
          const key = this.hashKey(cx, cy, cz)
          let cell = this.cells.get(key)
          if (!cell) {
            cell = []
            this.cells.set(key, cell)
          }
          cell.push(aabb)
        }
      }
    }
  }

  isColliding(aabb: { min: Vec3; max: Vec3 }): boolean {
    const minCX = Math.floor(aabb.min.x / CELL_SIZE)
    const minCY = Math.floor(aabb.min.y / CELL_SIZE)
    const minCZ = Math.floor(aabb.min.z / CELL_SIZE)
    const maxCX = Math.floor(aabb.max.x / CELL_SIZE)
    const maxCY = Math.floor(aabb.max.y / CELL_SIZE)
    const maxCZ = Math.floor(aabb.max.z / CELL_SIZE)

    const checked = new Set<{ min: Vec3; max: Vec3 }>()
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
          const cell = this.cells.get(this.hashKey(cx, cy, cz))
          if (!cell) continue
          for (const e of cell) {
            if (checked.has(e)) continue
            checked.add(e)
            if (aabb.min.x < e.max.x && aabb.max.x > e.min.x &&
                aabb.min.y < e.max.y && aabb.max.y > e.min.y &&
                aabb.min.z < e.max.z && aabb.max.z > e.min.z) {
              return true
            }
          }
        }
      }
    }
    return false
  }

  /** Get all AABBs (for EP removeInsideAnyAABB) */
  getAll(): Array<{ min: Vec3; max: Vec3 }> {
    return this.allAABBs
  }
}


function centerFromAABB(aabb: { min: Vec3; max: Vec3 }): Vec3 {
  return {
    x: (aabb.min.x + aabb.max.x) / 2,
    y: (aabb.min.y + aabb.max.y) / 2,
    z: (aabb.min.z + aabb.max.z) / 2,
  }
}

function getPlacementCenter(p: PlacedCargo, def: CargoItemDef, precomputedAABB?: { min: Vec3; max: Vec3 }): Vec3 {
  const aabb = precomputedAABB ?? computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg)
  return centerFromAABB(aabb)
}
