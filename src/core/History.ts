import type { VoxelGrid } from './VoxelGrid'

export interface Command {
  execute(grid: VoxelGrid): boolean
  undo(grid: VoxelGrid): void
  getDescription(): string
}

export class PlaceCommand implements Command {
  instanceId: number
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  name: string

  constructor(instanceId: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string) {
    this.instanceId = instanceId
    this.x0 = x0
    this.y0 = y0
    this.z0 = z0
    this.x1 = x1
    this.y1 = y1
    this.z1 = z1
    this.name = name
  }

  execute(grid: VoxelGrid): boolean {
    grid.fillBox(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1, this.instanceId)
    return true
  }

  undo(grid: VoxelGrid): void {
    grid.fillBox(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1, 0)
  }

  getDescription(): string {
    return `Place ${this.name}`
  }
}

export class RemoveCommand implements Command {
  instanceId: number
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  name: string

  constructor(instanceId: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string) {
    this.instanceId = instanceId
    this.x0 = x0
    this.y0 = y0
    this.z0 = z0
    this.x1 = x1
    this.y1 = y1
    this.z1 = z1
    this.name = name
  }

  execute(grid: VoxelGrid): boolean {
    grid.fillBox(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1, 0)
    return true
  }

  undo(grid: VoxelGrid): void {
    grid.fillBox(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1, this.instanceId)
  }

  getDescription(): string {
    return `Remove ${this.name}`
  }
}

export class HistoryManager {
  undoStack: Command[] = []
  redoStack: Command[] = []
  maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  executeCommand(command: Command, grid: VoxelGrid): boolean {
    const result = command.execute(grid)
    if (result) {
      this.undoStack.push(command)
      this.redoStack = []
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift()
      }
    }
    return result
  }

  undo(grid: VoxelGrid): boolean {
    const command = this.undoStack.pop()
    if (!command) return false
    command.undo(grid)
    this.redoStack.push(command)
    return true
  }

  redo(grid: VoxelGrid): boolean {
    const command = this.redoStack.pop()
    if (!command) return false
    command.execute(grid)
    this.undoStack.push(command)
    return true
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
