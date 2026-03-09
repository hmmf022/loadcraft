import type { ShapeBlock, CargoItemDef } from './types'

export interface ShapeData {
  version: 1
  name: string
  gridSize: 1
  blocks: ShapeBlock[]
  weightKg: number
  noFlip?: boolean
  noStack?: boolean
  maxStackWeightKg?: number
}

type ShapeDataParseResult =
  | { ok: true; data: ShapeData }
  | { ok: false; error: string }

/** Parse and validate a ShapeData JSON object. */
export function parseShapeData(data: unknown): ShapeDataParseResult {
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'ShapeData must be an object' }

  const d = data as Record<string, unknown>
  if (d['version'] !== 1) return { ok: false, error: 'ShapeData version must be 1' }
  if (typeof d['name'] !== 'string' || d['name'].length === 0) return { ok: false, error: 'ShapeData name is required' }
  if (d['gridSize'] !== 1) return { ok: false, error: 'ShapeData gridSize must be 1 for MCP (1cm blocks only)' }
  if (typeof d['weightKg'] !== 'number' || d['weightKg'] <= 0) return { ok: false, error: 'ShapeData weightKg must be > 0' }

  if (!Array.isArray(d['blocks'])) return { ok: false, error: 'ShapeData blocks must be an array' }
  for (const b of d['blocks'] as unknown[]) {
    if (typeof b !== 'object' || b === null) return { ok: false, error: 'ShapeData block must be an object' }
    const block = b as Record<string, unknown>
    if (typeof block['x'] !== 'number' || block['x'] < 0) return { ok: false, error: 'ShapeData block x must be >= 0' }
    if (typeof block['y'] !== 'number' || block['y'] < 0) return { ok: false, error: 'ShapeData block y must be >= 0' }
    if (typeof block['z'] !== 'number' || block['z'] < 0) return { ok: false, error: 'ShapeData block z must be >= 0' }
    if (typeof block['w'] !== 'number' || block['w'] <= 0) return { ok: false, error: 'ShapeData block w must be > 0' }
    if (typeof block['h'] !== 'number' || block['h'] <= 0) return { ok: false, error: 'ShapeData block h must be > 0' }
    if (typeof block['d'] !== 'number' || block['d'] <= 0) return { ok: false, error: 'ShapeData block d must be > 0' }
    if (typeof block['color'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(block['color'])) {
      return { ok: false, error: 'ShapeData block color must be a hex string (#RRGGBB)' }
    }
  }

  if (d['noFlip'] !== undefined && typeof d['noFlip'] !== 'boolean') return { ok: false, error: 'ShapeData noFlip must be boolean' }
  if (d['noStack'] !== undefined && typeof d['noStack'] !== 'boolean') return { ok: false, error: 'ShapeData noStack must be boolean' }
  if (d['maxStackWeightKg'] !== undefined && (typeof d['maxStackWeightKg'] !== 'number' || d['maxStackWeightKg'] < 0)) {
    return { ok: false, error: 'ShapeData maxStackWeightKg must be a number >= 0' }
  }

  return { ok: true, data: d as unknown as ShapeData }
}

/** Validate a ShapeData JSON object */
export function validateShapeData(data: unknown): data is ShapeData {
  return parseShapeData(data).ok
}

/** Convert ShapeData to a CargoItemDef for use in the simulator */
export function shapeToCargoItemDef(shape: ShapeData): CargoItemDef {
  const scaledBlocks: ShapeBlock[] = shape.blocks

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
