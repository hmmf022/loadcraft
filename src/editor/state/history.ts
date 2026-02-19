import type { EditorBlock } from './types'

export interface HistoryEntry {
  /** Blocks state before the action */
  before: Map<string, EditorBlock>
  /** Blocks state after the action */
  after: Map<string, EditorBlock>
}

export class EditorHistory {
  undoStack: HistoryEntry[] = []
  redoStack: HistoryEntry[] = []
  private maxSize = 100

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    this.redoStack = []
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift()
    }
  }

  undo(): Map<string, EditorBlock> | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.redoStack.push(entry)
    return new Map(entry.before)
  }

  redo(): Map<string, EditorBlock> | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    this.undoStack.push(entry)
    return new Map(entry.after)
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
