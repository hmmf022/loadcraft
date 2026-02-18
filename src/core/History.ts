import type { VoxelGrid } from './VoxelGrid'
import type { PlacedCargo } from './types'
import type { VoxelizeResult } from './Voxelizer'

export interface Command {
  execute(grid: VoxelGrid): boolean
  undo(grid: VoxelGrid): void
  getDescription(): string
  readonly placement: PlacedCargo
}

/** Fill or clear voxels based on VoxelizeResult */
function fillFromResult(grid: VoxelGrid, result: VoxelizeResult, id: number): void {
  if (result.usesFastPath) {
    const { min, max } = result.aabb
    grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, id)
  } else {
    grid.fillVoxels(result.voxels, id)
  }
}

export class PlaceCommand implements Command {
  instanceId: number
  result: VoxelizeResult
  name: string
  placement: PlacedCargo

  constructor(instanceId: number, result: VoxelizeResult, name: string, placement: PlacedCargo) {
    this.instanceId = instanceId
    this.result = result
    this.name = name
    this.placement = placement
  }

  execute(grid: VoxelGrid): boolean {
    fillFromResult(grid, this.result, this.instanceId)
    return true
  }

  undo(grid: VoxelGrid): void {
    fillFromResult(grid, this.result, 0)
  }

  getDescription(): string {
    return `Place ${this.name}`
  }
}

export class RemoveCommand implements Command {
  instanceId: number
  result: VoxelizeResult
  name: string
  placement: PlacedCargo

  constructor(instanceId: number, result: VoxelizeResult, name: string, placement: PlacedCargo) {
    this.instanceId = instanceId
    this.result = result
    this.name = name
    this.placement = placement
  }

  execute(grid: VoxelGrid): boolean {
    fillFromResult(grid, this.result, 0)
    return true
  }

  undo(grid: VoxelGrid): void {
    fillFromResult(grid, this.result, this.instanceId)
  }

  getDescription(): string {
    return `Remove ${this.name}`
  }
}

export class MoveCommand implements Command {
  instanceId: number
  oldResult: VoxelizeResult
  newResult: VoxelizeResult
  name: string
  placement: PlacedCargo
  oldPlacement: PlacedCargo

  constructor(
    instanceId: number,
    oldResult: VoxelizeResult, newResult: VoxelizeResult,
    name: string,
    placement: PlacedCargo, oldPlacement: PlacedCargo,
  ) {
    this.instanceId = instanceId
    this.oldResult = oldResult
    this.newResult = newResult
    this.name = name
    this.placement = placement
    this.oldPlacement = oldPlacement
  }

  execute(grid: VoxelGrid): boolean {
    fillFromResult(grid, this.oldResult, 0)
    fillFromResult(grid, this.newResult, this.instanceId)
    return true
  }

  undo(grid: VoxelGrid): void {
    fillFromResult(grid, this.newResult, 0)
    fillFromResult(grid, this.oldResult, this.instanceId)
  }

  getDescription(): string {
    return `Move ${this.name}`
  }
}

export class RotateCommand implements Command {
  instanceId: number
  oldResult: VoxelizeResult
  newResult: VoxelizeResult
  name: string
  placement: PlacedCargo
  oldPlacement: PlacedCargo

  constructor(
    instanceId: number,
    oldResult: VoxelizeResult, newResult: VoxelizeResult,
    name: string,
    placement: PlacedCargo, oldPlacement: PlacedCargo,
  ) {
    this.instanceId = instanceId
    this.oldResult = oldResult
    this.newResult = newResult
    this.name = name
    this.placement = placement
    this.oldPlacement = oldPlacement
  }

  execute(grid: VoxelGrid): boolean {
    fillFromResult(grid, this.oldResult, 0)
    fillFromResult(grid, this.newResult, this.instanceId)
    return true
  }

  undo(grid: VoxelGrid): void {
    fillFromResult(grid, this.newResult, 0)
    fillFromResult(grid, this.oldResult, this.instanceId)
  }

  getDescription(): string {
    return `Rotate ${this.name}`
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
