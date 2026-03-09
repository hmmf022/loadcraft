import type { EditorState, EditorBlock } from '../editor/state/types.js'
import { initialEditorState, blockKey } from '../editor/state/types.js'
import { editorReducer } from '../editor/state/editorReducer.js'
import { EditorHistory } from '../editor/state/history.js'
import { validateShapeData } from '../core/ShapeParser.js'
import type { ShapeData } from '../core/ShapeParser.js'
import { compressBlocks, expandBlocks } from '../core/ShapeCompressor.js'

export class EditorSession {
  state: EditorState
  history: EditorHistory

  constructor() {
    this.state = { ...initialEditorState, blocks: new Map() }
    this.history = new EditorHistory()
  }

  private dispatch(action: Parameters<typeof editorReducer>[1]): EditorState {
    this.state = editorReducer(this.state, action)
    return this.state
  }
  // --- Blocks ---

  placeBlock(x: number, y: number, z: number, color?: string): { success: boolean; error?: string } {
    const c = color ?? this.state.currentColor
    const before = this.state.blocks
    this.dispatch({ type: 'PLACE_BLOCK', x, y, z, w: 1, h: 1, d: 1, color: c })
    if (this.state.blocks === before) {
      return { success: false, error: 'Block placement failed (overlap or out of bounds)' }
    }
    this.history.push({ before: new Map(before), after: new Map(this.state.blocks) })
    return { success: true }
  }

  removeBlock(x: number, y: number, z: number): { success: boolean; error?: string } {
    const before = this.state.blocks
    this.dispatch({ type: 'REMOVE_BLOCK', x, y, z })
    if (this.state.blocks === before) {
      return { success: false, error: `No block at origin (${x},${y},${z})` }
    }
    this.history.push({ before: new Map(before), after: new Map(this.state.blocks) })
    return { success: true }
  }

  paintBlock(x: number, y: number, z: number, color: string): { success: boolean; error?: string } {
    const before = this.state.blocks
    this.dispatch({ type: 'PAINT_BLOCK', x, y, z, color })
    if (this.state.blocks === before) {
      return { success: false, error: `No block at origin (${x},${y},${z})` }
    }
    this.history.push({ before: new Map(before), after: new Map(this.state.blocks) })
    return { success: true }
  }

  clearAll(): { success: boolean; blockCount: number } {
    const count = this.state.blocks.size
    if (count === 0) return { success: true, blockCount: 0 }
    const before = new Map(this.state.blocks)
    this.dispatch({ type: 'CLEAR_ALL' })
    this.history.push({ before, after: new Map(this.state.blocks) })
    return { success: true, blockCount: count }
  }

  fillRegion(x: number, y: number, z: number, w: number, h: number, d: number, color?: string): { success: boolean; placed: number; skipped: number; error?: string } {
    const totalCells = w * h * d
    if (totalCells > 1_000_000) {
      return { success: false, placed: 0, skipped: 0, error: `Region too large: ${totalCells} cells (max 1,000,000)` }
    }
    if (x < 0 || y < 0 || z < 0) {
      return { success: false, placed: 0, skipped: 0, error: 'Coordinates must be non-negative' }
    }

    const c = color ?? this.state.currentColor
    const before = new Map(this.state.blocks)
    const sizeBefore = this.state.blocks.size
    this.dispatch({ type: 'PLACE_BLOCK', x, y, z, w, h, d, color: c })
    const placed = this.state.blocks.size - sizeBefore
    const skipped = totalCells - placed

    if (placed > 0) {
      this.history.push({ before, after: new Map(this.state.blocks) })
    }

    return { success: true, placed, skipped }
  }

  // --- Metadata ---

  setName(name: string): void {
    this.dispatch({ type: 'SET_NAME', name })
  }

  setWeight(weightKg: number): void {
    this.dispatch({ type: 'SET_WEIGHT', weight: weightKg })
  }

  setBrushSize(w: number, h: number, d: number): void {
    this.dispatch({ type: 'SET_BRUSH_SIZE', w, h, d })
  }

  setColor(color: string): void {
    this.dispatch({ type: 'SET_COLOR', color })
  }

  // --- Query ---

  listBlocks(): EditorBlock[] {
    return [...this.state.blocks.values()]
  }

  getStatus(): {
    shapeName: string
    weightKg: number
    blockCount: number
    currentColor: string
    brushSize: { w: number; h: number; d: number }
    boundingBox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null
    canUndo: boolean
    canRedo: boolean
  } {
    let bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null = null
    if (this.state.blocks.size > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (const b of this.state.blocks.values()) {
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
        if (b.z < minZ) minZ = b.z
        if (b.x + b.w > maxX) maxX = b.x + b.w
        if (b.y + b.h > maxY) maxY = b.y + b.h
        if (b.z + b.d > maxZ) maxZ = b.z + b.d
      }
      bbox = { minX, minY, minZ, maxX, maxY, maxZ }
    }

    return {
      shapeName: this.state.shapeName,
      weightKg: this.state.weightKg,
      blockCount: this.state.blocks.size,
      currentColor: this.state.currentColor,
      brushSize: { w: this.state.brushW, h: this.state.brushH, d: this.state.brushD },
      boundingBox: bbox,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
  }

  findBlockAt(x: number, y: number, z: number) {
    return this.state.blocks.get(blockKey(x, y, z)) ?? null
  }

  // --- History ---

  undo(): { success: boolean } {
    const blocks = this.history.undo()
    if (!blocks) return { success: false }
    this.dispatch({ type: 'RESTORE', blocks })
    return { success: true }
  }

  redo(): { success: boolean } {
    const blocks = this.history.redo()
    if (!blocks) return { success: false }
    this.dispatch({ type: 'RESTORE', blocks })
    return { success: true }
  }

  // --- File ---

  exportShape(): { json: string; shapeData: ShapeData } {
    const blocks = compressBlocks(this.state.blocks, this.state.gridSize)
    const shapeData: ShapeData = {
      version: 1,
      name: this.state.shapeName,
      gridSize: this.state.gridSize,
      blocks,
      weightKg: this.state.weightKg,
    }

    return { json: JSON.stringify(shapeData, null, 2), shapeData }
  }

  importShape(jsonStr: string): { success: boolean; error?: string; blockCount?: number } {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return { success: false, error: 'Invalid JSON' }
    }

    if (!validateShapeData(parsed)) {
      return { success: false, error: 'Invalid ShapeData format' }
    }

    const data = parsed as ShapeData

    const cells = expandBlocks(data.blocks, data.gridSize)

    const before = new Map(this.state.blocks)
    this.dispatch({ type: 'LOAD_SHAPE', blocks: cells, name: data.name, weightKg: data.weightKg })
    this.history.push({ before, after: new Map(this.state.blocks) })

    return { success: true, blockCount: cells.size }
  }
}
