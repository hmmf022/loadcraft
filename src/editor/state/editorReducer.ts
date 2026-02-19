import type { EditorState, EditorAction } from './types'
import { blockKey } from './types'

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'PLACE_BLOCK': {
      const { x, y, z, color } = action
      if (x < 0 || y < 0 || z < 0 || x >= state.maxCells || y >= state.maxCells || z >= state.maxCells) {
        return state
      }
      const key = blockKey(x, y, z)
      if (state.blocks.has(key)) {
        return state // already occupied
      }
      const newBlocks = new Map(state.blocks)
      newBlocks.set(key, { x, y, z, color })
      return { ...state, blocks: newBlocks }
    }

    case 'REMOVE_BLOCK': {
      const key = blockKey(action.x, action.y, action.z)
      if (!state.blocks.has(key)) {
        return state
      }
      const newBlocks = new Map(state.blocks)
      newBlocks.delete(key)
      return { ...state, blocks: newBlocks }
    }

    case 'PAINT_BLOCK': {
      const key = blockKey(action.x, action.y, action.z)
      const existing = state.blocks.get(key)
      if (!existing) {
        return state
      }
      const newBlocks = new Map(state.blocks)
      newBlocks.set(key, { ...existing, color: action.color })
      return { ...state, blocks: newBlocks }
    }

    case 'SET_TOOL':
      return { ...state, currentTool: action.tool }

    case 'SET_COLOR':
      return { ...state, currentColor: action.color }

    case 'SET_NAME':
      return { ...state, shapeName: action.name }

    case 'SET_WEIGHT':
      return { ...state, weightKg: action.weight }

    case 'SET_GHOST':
      return { ...state, ghostPosition: action.position }

    case 'CLEAR_ALL':
      return { ...state, blocks: new Map() }

    case 'LOAD_SHAPE':
      return {
        ...state,
        blocks: action.blocks,
        shapeName: action.name,
        weightKg: action.weightKg,
      }

    case 'RESTORE':
      return { ...state, blocks: action.blocks }

    default:
      return state
  }
}
