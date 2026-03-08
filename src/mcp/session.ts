import type { ContainerDef, CargoItemDef, PlacedCargo, Vec3, WeightResult, GridStats, StagedItem, AutoPackMode } from '../core/types.js'
import { CONTAINER_PRESETS } from '../core/types.js'
import { VoxelGrid } from '../core/VoxelGrid.js'
import { HistoryManager, PlaceCommand, RemoveCommand, MoveCommand, RotateCommand, RepackCommand, BatchCommand } from '../core/History.js'
import { autoPack } from '../core/AutoPacker.js'
import { checkInterference } from '../core/InterferenceChecker.js'
import type { InterferencePair } from '../core/InterferenceChecker.js'
import { checkStackConstraints } from '../core/StackChecker.js'
import type { StackViolation } from '../core/StackChecker.js'
import { voxelize, voxelizeComposite } from '../core/Voxelizer.js'
import type { VoxelizeResult } from '../core/Voxelizer.js'
import { computeWeight, computeCogDeviation } from '../core/WeightCalculator.js'
import type { CogDeviation } from '../core/WeightCalculator.js'
import { checkAllSupports } from '../core/GravityChecker.js'
import type { SupportResult } from '../core/GravityChecker.js'
import { serializeSaveData, validateSaveData } from '../core/SaveLoad.js'
import type { SaveData } from '../core/SaveLoad.js'
import { OccupancyMap } from '../core/OccupancyMap.js'
import { parseCargoCSV, parseCargoJSON } from '../core/ImportParser.js'
import { validateShapeData, shapeToCargoItemDef } from '../core/ShapeParser.js'
import { tryKick } from '../core/WallKick.js'

export class SimulatorSession {
  grid: VoxelGrid
  history: HistoryManager
  container: ContainerDef
  cargoDefs: CargoItemDef[]
  placements: PlacedCargo[]
  nextInstanceId: number

  stagedItems: StagedItem[] = []

  constructor() {
    const preset = CONTAINER_PRESETS[0]!
    this.container = {
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      depthCm: preset.depthCm,
      maxPayloadKg: preset.maxPayloadKg,
    }
    this.grid = new VoxelGrid(this.container.widthCm, this.container.heightCm, this.container.depthCm)
    this.history = new HistoryManager(100)
    this.cargoDefs = []
    this.placements = []
    this.nextInstanceId = 1
  }

  // --- Container ---

  setContainer(def: ContainerDef): void {
    this.container = def
    this.grid = new VoxelGrid(def.widthCm, def.heightCm, def.depthCm)
    this.history.clear()
    this.placements = []
    this.nextInstanceId = 1
  }

  // --- Cargo Definitions ---

  addCargoDef(def: CargoItemDef): void {
    this.cargoDefs.push(def)
  }

  removeCargoDef(id: string): { removedPlacements: number } {
    const toRemove = this.placements.filter((p) => p.cargoDefId === id)
    for (const p of toRemove) {
      this.grid.clearObject(p.instanceId)
    }
    this.placements = this.placements.filter((p) => p.cargoDefId !== id)
    this.cargoDefs = this.cargoDefs.filter((d) => d.id !== id)
    this.stagedItems = this.stagedItems.filter((s) => s.cargoDefId !== id)
    return { removedPlacements: toRemove.length }
  }

  updateCargoDef(
    id: string,
    updates: Partial<Pick<CargoItemDef, 'name' | 'widthCm' | 'heightCm' | 'depthCm' | 'weightKg' | 'color' | 'noFlip' | 'noStack' | 'maxStackWeightKg'>>,
  ): { success: boolean; error?: string } {
    const idx = this.cargoDefs.findIndex((d) => d.id === id)
    if (idx < 0) return { success: false, error: 'Cargo definition not found' }

    const def = this.cargoDefs[idx]!
    const hasDimensionChange = updates.widthCm !== undefined || updates.heightCm !== undefined || updates.depthCm !== undefined
    if (hasDimensionChange) {
      const inUse = this.placements.some((p) => p.cargoDefId === id)
      if (inUse) {
        return { success: false, error: 'Cannot change dimensions while cargo is placed. Remove placements first, or update only name/weight/color/constraints.' }
      }
    }

    if (updates.name !== undefined) def.name = updates.name
    if (updates.widthCm !== undefined) def.widthCm = updates.widthCm
    if (updates.heightCm !== undefined) def.heightCm = updates.heightCm
    if (updates.depthCm !== undefined) def.depthCm = updates.depthCm
    if (updates.weightKg !== undefined) def.weightKg = updates.weightKg
    if (updates.color !== undefined) def.color = updates.color
    if (updates.noFlip !== undefined) def.noFlip = updates.noFlip
    if (updates.noStack !== undefined) def.noStack = updates.noStack
    if (updates.maxStackWeightKg !== undefined) def.maxStackWeightKg = updates.maxStackWeightKg

    return { success: true }
  }

  importCargo(content: string, format: 'csv' | 'json'): { defs: CargoItemDef[]; errors: string[] } {
    const result = format === 'csv' ? parseCargoCSV(content) : parseCargoJSON(content)
    for (const def of result.defs) {
      this.cargoDefs.push(def)
    }
    return result
  }

  importShape(
    jsonStr: string,
    overrides?: { noFlip?: boolean; noStack?: boolean; maxStackWeightKg?: number },
  ): { success: boolean; id?: string; name?: string; error?: string } {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return { success: false, error: 'Invalid JSON' }
    }

    if (!validateShapeData(parsed)) {
      return { success: false, error: 'Invalid ShapeData format (requires version=1, name, gridSize, blocks, weightKg)' }
    }

    if (parsed.blocks.length === 0) {
      return { success: false, error: 'ShapeData has no blocks' }
    }

    const def = shapeToCargoItemDef(parsed)
    if (overrides?.noFlip !== undefined) def.noFlip = overrides.noFlip
    if (overrides?.noStack !== undefined) def.noStack = overrides.noStack
    if (overrides?.maxStackWeightKg !== undefined) def.maxStackWeightKg = overrides.maxStackWeightKg

    this.cargoDefs.push(def)
    return { success: true, id: def.id, name: def.name }
  }

  // --- Staging ---

  stageCargo(cargoDefId: string, count: number = 1): { success: boolean; error?: string } {
    const def = this.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return { success: false, error: 'Cargo definition not found' }
    const existing = this.stagedItems.find((s) => s.cargoDefId === cargoDefId)
    if (existing) {
      existing.count += count
    } else {
      this.stagedItems.push({ cargoDefId, count })
    }
    return { success: true }
  }

  unstageCargo(cargoDefId: string, count: number = 1): { success: boolean; error?: string } {
    const idx = this.stagedItems.findIndex((s) => s.cargoDefId === cargoDefId)
    if (idx < 0) return { success: false, error: 'Item not found in staging' }
    this.stagedItems[idx]!.count -= count
    if (this.stagedItems[idx]!.count <= 0) {
      this.stagedItems.splice(idx, 1)
    }
    return { success: true }
  }

  listStaged(): StagedItem[] {
    return this.stagedItems
  }

  // --- Placement ---

  placeCargo(
    cargoDefId: string,
    position: Vec3,
    rotation?: Vec3,
  ): { success: boolean; instanceId?: number; error?: string } {
    const def = this.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return { success: false, error: 'Cargo definition not found' }
    if (this.nextInstanceId > 65534) return { success: false, error: 'Max instance limit reached (65534)' }

    const instanceId = this.nextInstanceId
    const pos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) }
    const rot = rotation ?? { x: 0, y: 0, z: 0 }

    const result = voxelizeCargo(def, pos, rot)

    const { min, max } = result.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0 ||
        max.x > this.grid.width || max.y > this.grid.height || max.z > this.grid.depth) {
      return { success: false, error: 'Placement out of container bounds' }
    }

    if (checkCollision(this.grid, result, instanceId)) {
      return { success: false, error: 'Collision with existing cargo' }
    }

    const newPlacement: PlacedCargo = { instanceId, cargoDefId, positionCm: pos, rotationDeg: rot }
    const cmd = new PlaceCommand(instanceId, result, def.name, newPlacement)
    this.history.executeCommand(cmd, this.grid)
    this.placements.push(newPlacement)
    this.nextInstanceId = instanceId + 1

    return { success: true, instanceId }
  }

  removePlacement(instanceId: number): { success: boolean; error?: string } {
    const placement = this.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return { success: false, error: 'Placement not found' }

    const def = this.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (def) {
      const result = voxelizeCargo(def, placement.positionCm, placement.rotationDeg)
      const cmd = new RemoveCommand(instanceId, result, def.name, placement)
      this.history.executeCommand(cmd, this.grid)
    } else {
      this.grid.clearObject(instanceId)
    }

    this.placements = this.placements.filter((p) => p.instanceId !== instanceId)
    return { success: true }
  }

  moveCargo(instanceId: number, newPosition: Vec3): { success: boolean; error?: string } {
    const placement = this.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return { success: false, error: 'Placement not found' }

    const def = this.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return { success: false, error: 'Cargo definition not found' }

    const oldPos = placement.positionCm
    const rot = placement.rotationDeg
    const newPos = { x: Math.round(newPosition.x), y: Math.round(newPosition.y), z: Math.round(newPosition.z) }

    const oldResult = voxelizeCargo(def, oldPos, rot)
    const newResult = voxelizeCargo(def, newPos, rot)

    const { min, max } = newResult.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0 ||
        max.x > this.grid.width || max.y > this.grid.height || max.z > this.grid.depth) {
      return { success: false, error: 'New position out of container bounds' }
    }

    // Check collision at new position (temporarily clear old)
    fillFromResult(this.grid, oldResult, 0)
    const hasCollision = checkCollision(this.grid, newResult, instanceId)
    fillFromResult(this.grid, oldResult, instanceId)

    if (hasCollision) {
      return { success: false, error: 'Collision at new position' }
    }

    const updatedPlacement: PlacedCargo = { ...placement, positionCm: newPos }
    const cmd = new MoveCommand(instanceId, oldResult, newResult, def.name, updatedPlacement, placement)
    this.history.executeCommand(cmd, this.grid)
    this.placements = this.placements.map((p) => p.instanceId === instanceId ? updatedPlacement : p)

    return { success: true }
  }

  rotateCargo(instanceId: number, newRotation: Vec3): { success: boolean; error?: string } {
    const placement = this.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return { success: false, error: 'Placement not found' }

    const def = this.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return { success: false, error: 'Cargo definition not found' }

    // noFlip check: reject X/Z axis rotation
    if (def.noFlip) {
      const oldRot = placement.rotationDeg
      const xChanged = ((newRotation.x % 360) + 360) % 360 !== ((oldRot.x % 360) + 360) % 360
      const zChanged = ((newRotation.z % 360) + 360) % 360 !== ((oldRot.z % 360) + 360) % 360
      if (xChanged || zChanged) {
        return { success: false, error: 'noFlip cargo cannot be rotated on X/Z axes' }
      }
    }

    const pos = placement.positionCm
    const oldRot = placement.rotationDeg

    const oldResult = voxelizeCargo(def, pos, oldRot)
    let newPos = pos
    let newResult = voxelizeCargo(def, newPos, newRotation)

    // Auto-correct position to keep within bounds
    const { min, max } = newResult.aabb
    let dx = 0, dy = 0, dz = 0
    if (min.x < 0) dx = -min.x
    else if (max.x > this.grid.width) dx = this.grid.width - max.x
    if (min.y < 0) dy = -min.y
    else if (max.y > this.grid.height) dy = this.grid.height - max.y
    if (min.z < 0) dz = -min.z
    else if (max.z > this.grid.depth) dz = this.grid.depth - max.z

    if (dx !== 0 || dy !== 0 || dz !== 0) {
      newPos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }
      newResult = voxelizeCargo(def, newPos, newRotation)
      const { min: m2, max: x2 } = newResult.aabb
      if (m2.x < 0 || m2.y < 0 || m2.z < 0 ||
          x2.x > this.grid.width || x2.y > this.grid.height || x2.z > this.grid.depth) {
        return { success: false, error: 'Rotated cargo exceeds container bounds' }
      }
    }

    // Collision check
    fillFromResult(this.grid, oldResult, 0)
    const hasCollision = checkCollision(this.grid, newResult, instanceId)
    if (hasCollision) {
      // Try wall-kick
      const kick = tryKick(
        this.grid, def, newPos, newRotation, instanceId,
        voxelizeCargo, checkCollision,
      )
      if (kick) {
        newPos = kick.position
        newResult = kick.result
      } else {
        fillFromResult(this.grid, oldResult, instanceId)
        return { success: false, error: 'Collision after rotation' }
      }
    }
    fillFromResult(this.grid, oldResult, instanceId)

    const updatedPlacement: PlacedCargo = { ...placement, positionCm: newPos, rotationDeg: newRotation }
    const cmd = new RotateCommand(instanceId, oldResult, newResult, def.name, updatedPlacement, placement)
    this.history.executeCommand(cmd, this.grid)
    this.placements = this.placements.map((p) => p.instanceId === instanceId ? updatedPlacement : p)

    return { success: true }
  }

  dropCargo(instanceId: number): { success: boolean; newY?: number; error?: string } {
    const placement = this.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return { success: false, error: 'Placement not found' }

    const def = this.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return { success: false, error: 'Cargo definition not found' }

    const pos = placement.positionCm
    const rot = placement.rotationDeg

    const oldResult = voxelizeCargo(def, pos, rot)
    fillFromResult(this.grid, oldResult, 0)

    let bestY = -1
    for (let y = 0; y <= pos.y; y++) {
      const testResult = voxelizeCargo(def, { x: pos.x, y, z: pos.z }, rot)
      const { min, max } = testResult.aabb
      if (min.x < 0 || min.y < 0 || min.z < 0) continue
      if (max.x > this.grid.width || max.y > this.grid.height || max.z > this.grid.depth) continue
      if (checkCollision(this.grid, testResult, instanceId)) continue
      bestY = y
      break
    }

    fillFromResult(this.grid, oldResult, instanceId)

    if (bestY < 0 || bestY === pos.y) {
      return { success: true, newY: pos.y }
    }

    const moveResult = this.moveCargo(instanceId, { x: pos.x, y: bestY, z: pos.z })
    if (!moveResult.success) return moveResult
    return { success: true, newY: bestY }
  }

  autoPackCargo(mode: AutoPackMode = 'packStaged'): { success: boolean; placed: number; failed: number; error?: string } {
    if (mode === 'repack') {
      const allItems: CargoItemDef[] = []
      for (const p of this.placements) {
        const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
        if (def) allItems.push(def)
      }
      for (const si of this.stagedItems) {
        const def = this.cargoDefs.find((d) => d.id === si.cargoDefId)
        if (def) {
          for (let i = 0; i < si.count; i++) allItems.push(def)
        }
      }

      if (allItems.length === 0) {
        return { success: false, placed: 0, failed: 0, error: 'No items to repack' }
      }

      const removedEntries: { placement: PlacedCargo; result: VoxelizeResult }[] = []
      for (const p of this.placements) {
        const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
        if (!def) continue
        removedEntries.push({ placement: p, result: voxelizeCargo(def, p.positionCm, p.rotationDeg) })
      }

      const result = autoPack(allItems, this.container, this.nextInstanceId)

      if (result.placements.length === 0) {
        return { success: false, placed: 0, failed: allItems.length, error: 'No items could be placed' }
      }

      const addedEntries: { placement: PlacedCargo; result: VoxelizeResult }[] = []
      for (let i = 0; i < result.placements.length; i++) {
        addedEntries.push({ placement: result.placements[i]!, result: result.voxelizeResults[i]! })
      }

      const repackCmd = new RepackCommand(removedEntries, addedEntries)
      this.history.executeCommand(repackCmd, this.grid)

      this.placements = result.placements
      const maxInstanceId = result.placements.reduce(
        (mx, p) => Math.max(mx, p.instanceId), this.nextInstanceId,
      )
      this.nextInstanceId = maxInstanceId + 1
      this.stagedItems = []

      return { success: true, placed: result.placements.length, failed: result.failedDefIds.length }
    } else {
      // packStaged
      if (this.stagedItems.length === 0) {
        return { success: false, placed: 0, failed: 0, error: 'No staged items' }
      }

      const items: CargoItemDef[] = []
      for (const si of this.stagedItems) {
        const def = this.cargoDefs.find((d) => d.id === si.cargoDefId)
        if (def) {
          for (let i = 0; i < si.count; i++) items.push(def)
        }
      }

      if (items.length === 0) {
        return { success: false, placed: 0, failed: 0, error: 'No staged items' }
      }

      const occMap = OccupancyMap.fromPlacements(this.placements, this.cargoDefs, this.container)
      const result = autoPack(items, this.container, this.nextInstanceId, occMap)

      if (result.placements.length === 0) {
        return { success: false, placed: 0, failed: items.length, error: 'No items could be placed' }
      }

      const commands: PlaceCommand[] = []
      for (let i = 0; i < result.placements.length; i++) {
        const p = result.placements[i]!
        const r = result.voxelizeResults[i]!
        const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
        if (!def) continue
        commands.push(new PlaceCommand(p.instanceId, r, def.name, p))
      }

      const batch = new BatchCommand(commands)
      this.history.executeCommand(batch, this.grid)

      this.placements = [...this.placements, ...result.placements]
      const maxInstanceId = result.placements.reduce(
        (mx, p) => Math.max(mx, p.instanceId), this.nextInstanceId,
      )
      this.nextInstanceId = maxInstanceId + 1

      // Decrement staged counts
      const placedCountByDef = new Map<string, number>()
      for (const p of result.placements) {
        placedCountByDef.set(p.cargoDefId, (placedCountByDef.get(p.cargoDefId) ?? 0) + 1)
      }
      this.stagedItems = this.stagedItems
        .map((si) => ({ ...si, count: si.count - (placedCountByDef.get(si.cargoDefId) ?? 0) }))
        .filter((si) => si.count > 0)

      return { success: true, placed: result.placements.length, failed: result.failedDefIds.length }
    }
  }

  findPosition(cargoDefId: string): { position: Vec3 | null } {
    const def = this.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return { position: null }

    const occMap = OccupancyMap.fromPlacements(this.placements, this.cargoDefs, this.container)
    const pos = occMap.findPosition(def.widthCm, def.heightCm, def.depthCm)
    return { position: pos }
  }

  // --- Analysis ---

  getStatus(): {
    container: ContainerDef
    placementCount: number
    cargoDefCount: number
    weight: WeightResult
    cogDeviation: CogDeviation | null
    gridStats: GridStats
  } {
    const weight = computeWeight(this.placements, this.cargoDefs, this.container)
    const cogDeviation = this.placements.length > 0
      ? computeCogDeviation(weight.centerOfGravity, this.container)
      : null
    const gridStats = this.grid.computeStats()

    return {
      container: this.container,
      placementCount: this.placements.length,
      cargoDefCount: this.cargoDefs.length,
      weight,
      cogDeviation,
      gridStats,
    }
  }

  checkInterferenceAll(): { pairs: InterferencePair[] } {
    return checkInterference(this.placements, this.cargoDefs)
  }

  checkStackConstraintsAll(): { violations: StackViolation[] } {
    const violations = checkStackConstraints(this.placements, this.cargoDefs)
    return { violations }
  }

  checkSupportAll(): { results: Record<number, SupportResult> } {
    const map = checkAllSupports(this.grid, this.placements, this.cargoDefs)
    const results: Record<number, SupportResult> = {}
    for (const [id, sr] of map) {
      results[id] = sr
    }
    return { results }
  }

  // --- History ---

  undo(): { success: boolean; description?: string } {
    const command = this.history.undo(this.grid)
    if (!command) return { success: false }

    if (command instanceof PlaceCommand) {
      this.placements = this.placements.filter((p) => p.instanceId !== command.instanceId)
    } else if (command instanceof RemoveCommand) {
      this.placements = [...this.placements, command.placement]
    } else if (command instanceof MoveCommand) {
      this.placements = this.placements.map((p) =>
        p.instanceId === command.instanceId ? command.oldPlacement : p,
      )
    } else if (command instanceof RotateCommand) {
      this.placements = this.placements.map((p) =>
        p.instanceId === command.instanceId ? command.oldPlacement : p,
      )
    } else if (command instanceof RepackCommand) {
      this.placements = this.placements
        .filter((p) => !command.added.some((a) => a.placement.instanceId === p.instanceId))
      this.placements = [...this.placements, ...command.removed.map((r) => r.placement)]
    } else if (command instanceof BatchCommand) {
      this.placements = this.placements.filter((p) =>
        !command.commands.some((c) => c.placement.instanceId === p.instanceId)
      )
    }

    return { success: true, description: command.getDescription() }
  }

  redo(): { success: boolean; description?: string } {
    const command = this.history.redo(this.grid)
    if (!command) return { success: false }

    if (command instanceof PlaceCommand) {
      this.placements = [...this.placements, command.placement]
    } else if (command instanceof RemoveCommand) {
      this.placements = this.placements.filter((p) => p.instanceId !== command.instanceId)
    } else if (command instanceof MoveCommand) {
      this.placements = this.placements.map((p) =>
        p.instanceId === command.instanceId ? command.placement : p,
      )
    } else if (command instanceof RotateCommand) {
      this.placements = this.placements.map((p) =>
        p.instanceId === command.instanceId ? command.placement : p,
      )
    } else if (command instanceof RepackCommand) {
      this.placements = this.placements
        .filter((p) => !command.removed.some((r) => r.placement.instanceId === p.instanceId))
      this.placements = [...this.placements, ...command.added.map((a) => a.placement)]
    } else if (command instanceof BatchCommand) {
      const addedPlacements = command.commands.map((c) => c.placement)
      this.placements = [...this.placements, ...addedPlacements]
    }

    return { success: true, description: command.getDescription() }
  }

  // --- Save/Load ---

  serialize(): string {
    return serializeSaveData({
      container: this.container,
      cargoDefs: this.cargoDefs,
      placements: this.placements,
      nextInstanceId: this.nextInstanceId,
      stagedItems: this.stagedItems,
    })
  }

  loadFromSaveData(jsonString: string): { success: boolean; error?: string } {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      return { success: false, error: 'Invalid JSON' }
    }

    if (!validateSaveData(parsed)) {
      return { success: false, error: 'Invalid save data format' }
    }

    const data = parsed as SaveData

    this.container = data.container
    this.grid = new VoxelGrid(data.container.widthCm, data.container.heightCm, data.container.depthCm)
    this.cargoDefs = data.cargoDefs
    this.placements = data.placements
    this.nextInstanceId = data.nextInstanceId
    this.stagedItems = data.stagedItems ?? []
    this.history.clear()

    // Restore voxel grid
    const defMap = new Map<string, CargoItemDef>()
    for (const d of data.cargoDefs) {
      defMap.set(d.id, d)
    }
    for (const p of data.placements) {
      const def = defMap.get(p.cargoDefId)
      if (!def) continue
      const result = voxelizeCargo(def, p.positionCm, p.rotationDeg)
      fillFromResult(this.grid, result, p.instanceId)
    }

    return { success: true }
  }
}

function voxelizeCargo(def: CargoItemDef, pos: Vec3, rot: Vec3): VoxelizeResult {
  if (def.blocks) {
    return voxelizeComposite(def.blocks, pos, rot)
  }
  return voxelize(def.widthCm, def.heightCm, def.depthCm, pos, rot)
}

function fillFromResult(grid: VoxelGrid, result: VoxelizeResult, id: number): void {
  if (result.usesFastPath) {
    const { min, max } = result.aabb
    grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, id)
  } else {
    grid.fillVoxels(result.voxels, id)
  }
}

function checkCollision(grid: VoxelGrid, result: VoxelizeResult, excludeId: number): boolean {
  if (result.usesFastPath) {
    const { min, max } = result.aabb
    for (let z = min.z; z < max.z; z++) {
      for (let y = min.y; y < max.y; y++) {
        for (let x = min.x; x < max.x; x++) {
          if (!grid.isInBounds(x, y, z)) return true
          const val = grid.get(x, y, z)
          if (val !== 0 && val !== excludeId) return true
        }
      }
    }
    return false
  } else {
    return grid.hasCollision(result.voxels, excludeId)
  }
}
