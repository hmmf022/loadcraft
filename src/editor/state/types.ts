export const DISPLAY_SCALE = 10

export type EditorTool = 'place' | 'erase' | 'paint'

export interface EditorBlock {
  x: number
  y: number
  z: number
  color: string
}

export interface EditorState {
  blocks: Map<string, EditorBlock>
  gridSize: 1            // always 1cm/cell
  maxCells: number       // max cells per axis (100)
  currentTool: EditorTool
  currentColor: string
  shapeName: string
  weightKg: number
  ghostPosition: { x: number; y: number; z: number } | null
}

export type EditorAction =
  | { type: 'PLACE_BLOCK'; x: number; y: number; z: number; color: string }
  | { type: 'REMOVE_BLOCK'; x: number; y: number; z: number }
  | { type: 'PAINT_BLOCK'; x: number; y: number; z: number; color: string }
  | { type: 'SET_TOOL'; tool: EditorTool }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_WEIGHT'; weight: number }
  | { type: 'SET_GHOST'; position: { x: number; y: number; z: number } | null }
  | { type: 'CLEAR_ALL' }
  | { type: 'LOAD_SHAPE'; blocks: Map<string, EditorBlock>; name: string; weightKg: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESTORE'; blocks: Map<string, EditorBlock> }

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

export const initialEditorState: EditorState = {
  blocks: new Map(),
  gridSize: 1,
  maxCells: 100,
  currentTool: 'place',
  currentColor: '#4a90d9',
  shapeName: 'New Shape',
  weightKg: 10,
  ghostPosition: null,
}
