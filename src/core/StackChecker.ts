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

  // Build support graph: for each item, find which items sit directly on top of it
  // B is on top of A if: B.min.y ≈ A.max.y and XZ projections overlap
  const EPSILON = 1.5 // tolerance in cm for "touching"

  // supporters[i] = indices of items that support item i (items below it)
  const supportedBy: number[][] = aabbs.map(() => [])
  // onTopOf[i] = indices of items sitting on top of item i
  const onTopOf: number[][] = aabbs.map(() => [])

  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i]!
      const b = aabbs[j]!

      // Check XZ overlap
      const overlapX = a.min.x < b.max.x && a.max.x > b.min.x
      const overlapZ = a.min.z < b.max.z && a.max.z > b.min.z
      if (!overlapX || !overlapZ) continue

      // Check if B sits on A (B.min.y ≈ A.max.y)
      if (Math.abs(b.min.y - a.max.y) < EPSILON) {
        onTopOf[i]!.push(j)
        supportedBy[j]!.push(i)
      }
      // Check if A sits on B (A.min.y ≈ B.max.y)
      if (Math.abs(a.min.y - b.max.y) < EPSILON) {
        onTopOf[j]!.push(i)
        supportedBy[i]!.push(j)
      }
    }
  }

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
