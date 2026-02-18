import { create } from 'zustand'
import type { ContainerDef, CargoItemDef, PlacedCargo, Vec3 } from '../core/types'
import { CONTAINER_PRESETS } from '../core/types'
import { getVoxelGrid, createVoxelGrid } from '../core/voxelGridSingleton'
import { HistoryManager, PlaceCommand, RemoveCommand } from '../core/History'

const defaultContainer = CONTAINER_PRESETS[0]!
const historyManager = new HistoryManager(100)

export interface AppState {
  // Container
  container: ContainerDef
  setContainer: (def: ContainerDef) => void

  // Cargo definitions
  cargoDefs: CargoItemDef[]
  addCargoDef: (def: CargoItemDef) => void
  removeCargoDef: (id: string) => void

  // Placements
  placements: PlacedCargo[]
  nextInstanceId: number
  placeCargo: (cargoDefId: string, position: Vec3) => void
  removePlacement: (instanceId: number) => void

  // Selection
  selectedInstanceId: number | null
  setSelectedInstanceId: (id: number | null) => void

  // Render version (triggers renderer updates)
  renderVersion: number

  // History
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Container
  container: {
    widthCm: defaultContainer.widthCm,
    heightCm: defaultContainer.heightCm,
    depthCm: defaultContainer.depthCm,
    maxPayloadKg: defaultContainer.maxPayloadKg,
  },
  setContainer: (def) => {
    // Recreate VoxelGrid for new container
    createVoxelGrid(def)
    historyManager.clear()
    set((state) => ({
      container: def,
      placements: [],
      nextInstanceId: 1,
      selectedInstanceId: null,
      canUndo: false,
      canRedo: false,
      renderVersion: state.renderVersion + 1,
    }))
  },

  // Cargo definitions
  cargoDefs: [],
  addCargoDef: (def) => set((state) => ({
    cargoDefs: [...state.cargoDefs, def],
  })),
  removeCargoDef: (id) => {
    const state = get()
    // Remove placements of this def from VoxelGrid
    const toRemove = state.placements.filter((p) => p.cargoDefId === id)
    const grid = getVoxelGrid()
    for (const p of toRemove) {
      grid.clearObject(p.instanceId)
    }
    set({
      cargoDefs: state.cargoDefs.filter((d) => d.id !== id),
      placements: state.placements.filter((p) => p.cargoDefId !== id),
      renderVersion: state.renderVersion + 1,
    })
  },

  // Placements
  placements: [],
  nextInstanceId: 1,
  placeCargo: (cargoDefId, position) => {
    const state = get()
    const def = state.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return
    if (state.nextInstanceId > 65534) return

    const instanceId = state.nextInstanceId
    const x0 = Math.round(position.x)
    const y0 = Math.round(position.y)
    const z0 = Math.round(position.z)
    const x1 = x0 + def.widthCm - 1
    const y1 = y0 + def.heightCm - 1
    const z1 = z0 + def.depthCm - 1

    const grid = getVoxelGrid()

    // Check collision
    if (x1 >= grid.width || y1 >= grid.height || z1 >= grid.depth) return

    // Execute via history
    const cmd = new PlaceCommand(instanceId, x0, y0, z0, x1, y1, z1, def.name)
    historyManager.executeCommand(cmd, grid)

    const newPlacement: PlacedCargo = {
      instanceId,
      cargoDefId,
      positionCm: { x: x0, y: y0, z: z0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    }

    set({
      placements: [...state.placements, newPlacement],
      nextInstanceId: instanceId + 1,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
  },
  removePlacement: (instanceId) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    const grid = getVoxelGrid()

    if (def) {
      const x0 = Math.round(placement.positionCm.x)
      const y0 = Math.round(placement.positionCm.y)
      const z0 = Math.round(placement.positionCm.z)
      const cmd = new RemoveCommand(
        instanceId, x0, y0, z0,
        x0 + def.widthCm - 1, y0 + def.heightCm - 1, z0 + def.depthCm - 1,
        def.name,
      )
      historyManager.executeCommand(cmd, grid)
    } else {
      grid.clearObject(instanceId)
    }

    set({
      placements: state.placements.filter((p) => p.instanceId !== instanceId),
      selectedInstanceId: state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
  },

  // Selection
  selectedInstanceId: null,
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),

  // Render version
  renderVersion: 0,

  // History
  canUndo: false,
  canRedo: false,
  undo: () => {
    const grid = getVoxelGrid()
    const undone = historyManager.undo(grid)
    if (!undone) return

    // Rebuild placements from grid state
    // For undo of PlaceCommand: remove the last placement
    // For undo of RemoveCommand: restore the placement
    // Simplified: rebuild from history would be complex, just re-derive
    const state = get()

    // Re-scan all placement instanceIds in grid to determine which still exist
    const validPlacements = state.placements.filter((p) => {
      const def = state.cargoDefs.find((d) => d.id === p.cargoDefId)
      if (!def) return false
      const x = Math.round(p.positionCm.x)
      const y = Math.round(p.positionCm.y)
      return grid.get(x, y, Math.round(p.positionCm.z)) === p.instanceId
    })

    set({
      placements: validPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
  },
  redo: () => {
    const grid = getVoxelGrid()
    const redone = historyManager.redo(grid)
    if (!redone) return

    const state = get()
    // After redo, we need to check which placements exist
    // For now, rebuild similarly
    const allPlacements = state.placements
    const validPlacements = allPlacements.filter((p) => {
      return grid.get(
        Math.round(p.positionCm.x),
        Math.round(p.positionCm.y),
        Math.round(p.positionCm.z),
      ) === p.instanceId
    })

    // Check if redo re-added a placement (PlaceCommand.execute)
    // We need the full placement list from history - simplified version
    set({
      placements: validPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
  },
}))
