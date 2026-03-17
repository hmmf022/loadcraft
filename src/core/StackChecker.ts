import type { PlacedCargo, CargoItemDef, Vec3 } from './types'
import { computeRotatedAABB } from './Voxelizer'

export interface StackViolation {
  instanceId: number
  cargoDefId: string
  name: string
  maxStackWeightKg: number
  actualStackWeightKg: number
}

interface PlacedAABB {
  instanceId: number
  defId: string
  min: Vec3
  max: Vec3
  weightKg: number
}

const EPSILON = 1.5 // tolerance in cm for "touching"

/**
 * Binary search: find the leftmost index where sorted[index].minY >= target.
 * sorted is an array of { origIdx, minY } sorted by minY ascending.
 */
function lowerBound(sorted: { origIdx: number; minY: number }[], target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]!.minY < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Build the support graph using Y-sort + binary search.
 * For each item a, find items b where b.min.y ≈ a.max.y (b sits on a),
 * then check XZ overlap only for those candidates.
 */
function buildSupportGraph(
  aabbs: PlacedAABB[],
): { onTopOf: number[][]; supportedBy: number[][] } {
  const n = aabbs.length
  const onTopOf: number[][] = Array.from({ length: n }, () => [])
  const supportedBy: number[][] = Array.from({ length: n }, () => [])

  // Sort indices by min.y for binary search
  const sorted = aabbs.map((a, i) => ({ origIdx: i, minY: a.min.y }))
  sorted.sort((a, b) => a.minY - b.minY)

  // For each item a, find candidates b where b.min.y ∈ [a.max.y - EPSILON, a.max.y + EPSILON)
  for (let i = 0; i < n; i++) {
    const a = aabbs[i]!
    const lo = lowerBound(sorted, a.max.y - EPSILON)

    for (let k = lo; k < sorted.length; k++) {
      const entry = sorted[k]!
      if (entry.minY >= a.max.y + EPSILON) break
      const j = entry.origIdx
      if (j === i) continue

      const b = aabbs[j]!
      // Check XZ overlap
      const overlapX = a.min.x < b.max.x && a.max.x > b.min.x
      const overlapZ = a.min.z < b.max.z && a.max.z > b.min.z
      if (!overlapX || !overlapZ) continue

      // b sits on a (b.min.y ≈ a.max.y)
      onTopOf[i]!.push(j)
      supportedBy[j]!.push(i)
    }
  }

  return { onTopOf, supportedBy }
}

/**
 * Check stack constraints for all placements.
 * Returns violations where weight on top exceeds maxStackWeightKg or noStack is violated.
 */
export function checkStackConstraints(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
): StackViolation[] {
  if (placements.length === 0) return []

  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) {
    defMap.set(d.id, d)
  }

  // Compute AABBs for all placements
  const aabbs: PlacedAABB[] = []
  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue

    const aabb = computeRotatedAABB(
      def.widthCm, def.heightCm, def.depthCm,
      p.positionCm, p.rotationDeg,
    )
    aabbs.push({
      instanceId: p.instanceId,
      defId: def.id,
      min: aabb.min,
      max: aabb.max,
      weightKg: def.weightKg,
    })
  }

  // Build support graph using Y-sort + binary search (O(n log n) instead of O(n²))
  const { onTopOf } = buildSupportGraph(aabbs)

  // For each constrained item, compute total weight above it recursively (with memoization)
  const weightAboveCache = new Map<number, number>()

  function getWeightAbove(idx: number): number {
    const cached = weightAboveCache.get(idx)
    if (cached !== undefined) return cached

    let total = 0
    for (const aboveIdx of onTopOf[idx]!) {
      const aboveItem = aabbs[aboveIdx]!
      total += aboveItem.weightKg + getWeightAbove(aboveIdx)
    }

    weightAboveCache.set(idx, total)
    return total
  }

  const violations: StackViolation[] = []

  for (let i = 0; i < aabbs.length; i++) {
    const item = aabbs[i]!
    const def = defMap.get(item.defId)
    if (!def) continue

    const maxStack = def.noStack ? 0 : def.maxStackWeightKg
    if (maxStack === undefined) continue

    const actualWeight = getWeightAbove(i)
    if (actualWeight > maxStack) {
      violations.push({
        instanceId: item.instanceId,
        cargoDefId: def.id,
        name: def.name,
        maxStackWeightKg: maxStack,
        actualStackWeightKg: actualWeight,
      })
    }
  }

  return violations
}

/**
 * Check stack constraints using pre-computed AABBs.
 * Same logic as checkStackConstraints but avoids recomputing AABBs.
 */
export function checkStackConstraintsWithAABBs(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
  aabbs: Array<{ min: Vec3; max: Vec3 }>,
): StackViolation[] {
  if (placements.length === 0) return []

  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) {
    defMap.set(d.id, d)
  }

  // Build PlacedAABB array from pre-computed AABBs
  const placedAABBs: PlacedAABB[] = []
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!
    const def = defMap.get(p.cargoDefId)
    if (!def) continue

    const aabb = aabbs[i]!
    placedAABBs.push({
      instanceId: p.instanceId,
      defId: def.id,
      min: aabb.min,
      max: aabb.max,
      weightKg: def.weightKg,
    })
  }

  // Build support graph using Y-sort + binary search
  const { onTopOf } = buildSupportGraph(placedAABBs)

  // For each constrained item, compute total weight above it recursively (with memoization)
  const weightAboveCache = new Map<number, number>()

  function getWeightAbove(idx: number): number {
    const cached = weightAboveCache.get(idx)
    if (cached !== undefined) return cached

    let total = 0
    for (const aboveIdx of onTopOf[idx]!) {
      const aboveItem = placedAABBs[aboveIdx]!
      total += aboveItem.weightKg + getWeightAbove(aboveIdx)
    }

    weightAboveCache.set(idx, total)
    return total
  }

  const violations: StackViolation[] = []

  for (let i = 0; i < placedAABBs.length; i++) {
    const item = placedAABBs[i]!
    const def = defMap.get(item.defId)
    if (!def) continue

    const maxStack = def.noStack ? 0 : def.maxStackWeightKg
    if (maxStack === undefined) continue

    const actualWeight = getWeightAbove(i)
    if (actualWeight > maxStack) {
      violations.push({
        instanceId: item.instanceId,
        cargoDefId: def.id,
        name: def.name,
        maxStackWeightKg: maxStack,
        actualStackWeightKg: actualWeight,
      })
    }
  }

  return violations
}

// --- Incremental stack checking for AutoPacker ---

export interface StackContext {
  aabbs: PlacedAABB[]
  onTopOf: number[][]
  supportedBy: number[][]
  weightAboveCache: Map<number, number>
  defMap: Map<string, CargoItemDef>
}

/** Build an incremental stack context from existing placements. */
export function buildStackContext(
  placements: PlacedCargo[],
  defs: CargoItemDef[],
): StackContext {
  const defMap = new Map<string, CargoItemDef>()
  for (const d of defs) defMap.set(d.id, d)

  const aabbs: PlacedAABB[] = []
  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue
    const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg)
    aabbs.push({ instanceId: p.instanceId, defId: def.id, min: aabb.min, max: aabb.max, weightKg: def.weightKg })
  }

  // Build support graph using Y-sort + binary search (O(n log n) instead of O(n²))
  const { onTopOf, supportedBy } = buildSupportGraph(aabbs)

  return { aabbs, onTopOf, supportedBy, weightAboveCache: new Map(), defMap }
}

/**
 * Check if adding newPlacement would violate any stack constraints.
 * Only checks items affected by the new placement (O(N) instead of O(N²)).
 */
export function checkStackIncremental(
  ctx: StackContext,
  newPlacement: PlacedCargo,
  newDef: CargoItemDef,
): StackViolation[] {
  const aabb = computeRotatedAABB(
    newDef.widthCm, newDef.heightCm, newDef.depthCm,
    newPlacement.positionCm, newPlacement.rotationDeg,
  )
  const newAABB: PlacedAABB = {
    instanceId: newPlacement.instanceId,
    defId: newDef.id,
    min: aabb.min,
    max: aabb.max,
    weightKg: newDef.weightKg,
  }

  // Find which existing items the new placement sits on top of
  const directSupporters: number[] = []
  for (let i = 0; i < ctx.aabbs.length; i++) {
    const existing = ctx.aabbs[i]!
    const overlapX = existing.min.x < newAABB.max.x && existing.max.x > newAABB.min.x
    const overlapZ = existing.min.z < newAABB.max.z && existing.max.z > newAABB.min.z
    if (!overlapX || !overlapZ) continue
    if (Math.abs(newAABB.min.y - existing.max.y) < EPSILON) {
      directSupporters.push(i)
    }
  }

  if (directSupporters.length === 0) return []

  // The new placement has nothing above it, so its weight contribution
  // to supporters is just newDef.weightKg.
  // Check all transitive supporters downward.
  const violations: StackViolation[] = []
  const visited = new Set<number>()
  const queue = [...directSupporters]

  // Temporarily add newDef.weightKg to the weight-above chain
  const addedWeight = newDef.weightKg

  while (queue.length > 0) {
    const idx = queue.pop()!
    if (visited.has(idx)) continue
    visited.add(idx)

    const item = ctx.aabbs[idx]!
    const def = ctx.defMap.get(item.defId)
    if (def) {
      const maxStack = def.noStack ? 0 : def.maxStackWeightKg
      if (maxStack !== undefined) {
        const currentWeightAbove = getWeightAboveFromCtx(ctx, idx)
        if (currentWeightAbove + addedWeight > maxStack) {
          violations.push({
            instanceId: item.instanceId,
            cargoDefId: def.id,
            name: def.name,
            maxStackWeightKg: maxStack,
            actualStackWeightKg: currentWeightAbove + addedWeight,
          })
        }
      }
    }

    // Propagate downward through supporters
    for (const belowIdx of ctx.supportedBy[idx]!) {
      if (!visited.has(belowIdx)) queue.push(belowIdx)
    }
  }

  return violations
}

/** Add a confirmed placement to the stack context. */
export function addToStackContext(
  ctx: StackContext,
  placement: PlacedCargo,
  def: CargoItemDef,
): void {
  const aabb = computeRotatedAABB(
    def.widthCm, def.heightCm, def.depthCm,
    placement.positionCm, placement.rotationDeg,
  )
  const newIdx = ctx.aabbs.length
  ctx.aabbs.push({
    instanceId: placement.instanceId,
    defId: def.id,
    min: aabb.min,
    max: aabb.max,
    weightKg: def.weightKg,
  })
  ctx.onTopOf.push([])
  ctx.supportedBy.push([])

  // Build edges for the new item
  for (let i = 0; i < newIdx; i++) {
    const existing = ctx.aabbs[i]!
    const overlapX = existing.min.x < aabb.max.x && existing.max.x > aabb.min.x
    const overlapZ = existing.min.z < aabb.max.z && existing.max.z > aabb.min.z
    if (!overlapX || !overlapZ) continue

    // New item sits on existing
    if (Math.abs(aabb.min.y - existing.max.y) < EPSILON) {
      ctx.onTopOf[i]!.push(newIdx)
      ctx.supportedBy[newIdx]!.push(i)
    }
    // Existing sits on new item
    if (Math.abs(existing.min.y - aabb.max.y) < EPSILON) {
      ctx.onTopOf[newIdx]!.push(i)
      ctx.supportedBy[i]!.push(newIdx)
    }
  }

  // Invalidate weight-above cache for affected items (transitive supporters)
  const toInvalidate = new Set<number>()
  const queue = [...ctx.supportedBy[newIdx]!]
  while (queue.length > 0) {
    const idx = queue.pop()!
    if (toInvalidate.has(idx)) continue
    toInvalidate.add(idx)
    for (const belowIdx of ctx.supportedBy[idx]!) {
      if (!toInvalidate.has(belowIdx)) queue.push(belowIdx)
    }
  }
  for (const idx of toInvalidate) {
    ctx.weightAboveCache.delete(idx)
  }
}

function getWeightAboveFromCtx(ctx: StackContext, idx: number): number {
  const cached = ctx.weightAboveCache.get(idx)
  if (cached !== undefined) return cached

  let total = 0
  for (const aboveIdx of ctx.onTopOf[idx]!) {
    const aboveItem = ctx.aabbs[aboveIdx]!
    total += aboveItem.weightKg + getWeightAboveFromCtx(ctx, aboveIdx)
  }

  ctx.weightAboveCache.set(idx, total)
  return total
}
