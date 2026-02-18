import type { VoxelGrid } from './VoxelGrid'
import type { PlacedCargo } from './types'

export interface Command {
  execute(grid: VoxelGrid): boolean
  undo(grid: VoxelGrid): void
  getDescription(): string
  readonly placement: PlacedCargo
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
  placement: PlacedCargo

  constructor(instanceId: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string, placement: PlacedCargo) {
    this.instanceId = instanceId
    this.x0 = x0
    this.y0 = y0
    this.z0 = z0
    this.x1 = x1
    this.y1 = y1
    this.z1 = z1
    this.name = name
    this.placement = placement
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
  placement: PlacedCargo

  constructor(instanceId: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string, placement: PlacedCargo) {
    this.instanceId = instanceId
    this.x0 = x0
    this.y0 = y0
    this.z0 = z0
    this.x1 = x1
    this.y1 = y1
    this.z1 = z1
    this.name = name
    this.placement = placement
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

export class MoveCommand implements Command {
  instanceId: number
  oldX0: number
  oldY0: number
  oldZ0: number
  oldX1: number
  oldY1: number
  oldZ1: number
  newX0: number
  newY0: number
  newZ0: number
  newX1: number
  newY1: number
  newZ1: number
  name: string
  placement: PlacedCargo

  constructor(
    instanceId: number,
    oldX0: number, oldY0: number, oldZ0: number, oldX1: number, oldY1: number, oldZ1: number,
    newX0: number, newY0: number, newZ0: number, newX1: number, newY1: number, newZ1: number,
    name: string,
    placement: PlacedCargo,
  ) {
    this.instanceId = instanceId
    this.oldX0 = oldX0
    this.oldY0 = oldY0
    this.oldZ0 = oldZ0
    this.oldX1 = oldX1
    this.oldY1 = oldY1
    this.oldZ1 = oldZ1
    this.newX0 = newX0
    this.newY0 = newY0
    this.newZ0 = newZ0
    this.newX1 = newX1
    this.newY1 = newY1
    this.newZ1 = newZ1
    this.name = name
    this.placement = placement
  }

  execute(grid: VoxelGrid): boolean {
    grid.fillBox(this.oldX0, this.oldY0, this.oldZ0, this.oldX1, this.oldY1, this.oldZ1, 0)
    grid.fillBox(this.newX0, this.newY0, this.newZ0, this.newX1, this.newY1, this.newZ1, this.instanceId)
    return true
  }

  undo(grid: VoxelGrid): void {
    grid.fillBox(this.newX0, this.newY0, this.newZ0, this.newX1, this.newY1, this.newZ1, 0)
    grid.fillBox(this.oldX0, this.oldY0, this.oldZ0, this.oldX1, this.oldY1, this.oldZ1, this.instanceId)
  }

  getDescription(): string {
    return `Move ${this.name}`
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

  undo(grid: VoxelGrid): Command | null {
    const command = this.undoStack.pop()
    if (!command) return null
    command.undo(grid)
    this.redoStack.push(command)
    return command
  }

  redo(grid: VoxelGrid): Command | null {
    const command = this.redoStack.pop()
    if (!command) return null
    command.execute(grid)
    this.undoStack.push(command)
    return command
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
