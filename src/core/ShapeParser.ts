import type { ShapeBlock, CargoItemDef } from './types'

export interface ShapeData {
  version: 1
  name: string
  gridSize: number   // 1 | 5 | 10 cm/cell
  blocks: ShapeBlock[]
  weightKg: number
  noFlip?: boolean
  noStack?: boolean
  maxStackWeightKg?: number
}

/** Validate a ShapeData JSON object */
export function validateShapeData(data: unknown): data is ShapeData {
  if (typeof data !== 'object' || data === null) return false

  const d = data as Record<string, unknown>
  if (d['version'] !== 1) return false
  if (typeof d['name'] !== 'string' || d['name'].length === 0) return false
  if (d['gridSize'] !== 1 && d['gridSize'] !== 5 && d['gridSize'] !== 10) return false
  if (typeof d['weightKg'] !== 'number' || d['weightKg'] <= 0) return false

  if (!Array.isArray(d['blocks'])) return false
  for (const b of d['blocks'] as unknown[]) {
    if (typeof b !== 'object' || b === null) return false
    const block = b as Record<string, unknown>
    if (typeof block['x'] !== 'number' || block['x'] < 0) return false
    if (typeof block['y'] !== 'number' || block['y'] < 0) return false
    if (typeof block['z'] !== 'number' || block['z'] < 0) return false
    if (typeof block['w'] !== 'number' || block['w'] <= 0) return false
    if (typeof block['h'] !== 'number' || block['h'] <= 0) return false
    if (typeof block['d'] !== 'number' || block['d'] <= 0) return false
    if (typeof block['color'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(block['color'])) return false
  }

  if (d['noFlip'] !== undefined && typeof d['noFlip'] !== 'boolean') return false
  if (d['noStack'] !== undefined && typeof d['noStack'] !== 'boolean') return false
  if (d['maxStackWeightKg'] !== undefined && (typeof d['maxStackWeightKg'] !== 'number' || d['maxStackWeightKg'] < 0)) return false

  return true
}

/** Convert ShapeData to a CargoItemDef for use in the simulator */
export function shapeToCargoItemDef(shape: ShapeData): CargoItemDef {
  const gs = shape.gridSize
  // Scale blocks from cell coordinates to cm
  const scaledBlocks: ShapeBlock[] = gs === 1
    ? shape.blocks
    : shape.blocks.map(b => ({
        x: b.x * gs, y: b.y * gs, z: b.z * gs,
        w: b.w * gs, h: b.h * gs, d: b.d * gs,
        color: b.color,
      }))

  // Compute bounding box from scaled blocks
  let maxX = 0, maxY = 0, maxZ = 0
  for (const b of scaledBlocks) {
    const bx = b.x + b.w
    const by = b.y + b.h
    const bz = b.z + b.d
    if (bx > maxX) maxX = bx
    if (by > maxY) maxY = by
    if (bz > maxZ) maxZ = bz
  }

  return {
    id: crypto.randomUUID(),
    name: shape.name,
    widthCm: maxX,
    heightCm: maxY,
    depthCm: maxZ,
    weightKg: shape.weightKg,
    color: scaledBlocks[0]?.color ?? '#888888',
    blocks: scaledBlocks,
    ...(shape.noFlip !== undefined && { noFlip: shape.noFlip }),
    ...(shape.noStack !== undefined && { noStack: shape.noStack }),
    ...(shape.maxStackWeightKg !== undefined && { maxStackWeightKg: shape.maxStackWeightKg }),
  }
}
