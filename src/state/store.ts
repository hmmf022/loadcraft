import { create } from 'zustand'
import type { ContainerDef, CargoItemDef, PlacedCargo, Vec3, DragState } from '../core/types'
import { CONTAINER_PRESETS } from '../core/types'
import { getVoxelGrid, createVoxelGrid } from '../core/voxelGridSingleton'
import { HistoryManager, PlaceCommand, RemoveCommand, MoveCommand } from '../core/History'

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
  updateCargoDef: (id: string, updates: Partial<Omit<CargoItemDef, 'id'>>) => void

  // Placements
  placements: PlacedCargo[]
  nextInstanceId: number
  placeCargo: (cargoDefId: string, position: Vec3) => void
  removePlacement: (instanceId: number) => void
  moveCargo: (instanceId: number, newPosition: Vec3) => void

  // Selection
  selectedInstanceId: number | null
  setSelectedInstanceId: (id: number | null) => void

  // Drag state
  dragState: DragState | null
  setDragState: (state: DragState | null) => void

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
      dragState: null,
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
  updateCargoDef: (id, updates) => {
    set((state) => ({
      cargoDefs: state.cargoDefs.map((d) =>
        d.id === id ? { ...d, ...updates } : d,
      ),
      renderVersion: state.renderVersion + 1,
    }))
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

    // Check bounds
    if (x1 >= grid.width || y1 >= grid.height || z1 >= grid.depth) return

    const newPlacement: PlacedCargo = {
      instanceId,
      cargoDefId,
      positionCm: { x: x0, y: y0, z: z0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    }

    // Execute via history
    const cmd = new PlaceCommand(instanceId, x0, y0, z0, x1, y1, z1, def.name, newPlacement)
    historyManager.executeCommand(cmd, grid)

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
        placement,
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
  moveCargo: (instanceId, newPosition) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    const grid = getVoxelGrid()
    const oldX0 = Math.round(placement.positionCm.x)
    const oldY0 = Math.round(placement.positionCm.y)
    const oldZ0 = Math.round(placement.positionCm.z)
    const newX0 = Math.round(newPosition.x)
    const newY0 = Math.round(newPosition.y)
    const newZ0 = Math.round(newPosition.z)
    const w = def.widthCm - 1
    const h = def.heightCm - 1
    const d = def.depthCm - 1

    // Check bounds
    if (newX0 + w >= grid.width || newY0 + h >= grid.height || newZ0 + d >= grid.depth) return
    if (newX0 < 0 || newY0 < 0 || newZ0 < 0) return

    const updatedPlacement: PlacedCargo = {
      ...placement,
      positionCm: { x: newX0, y: newY0, z: newZ0 },
    }

    const cmd = new MoveCommand(
      instanceId,
      oldX0, oldY0, oldZ0, oldX0 + w, oldY0 + h, oldZ0 + d,
      newX0, newY0, newZ0, newX0 + w, newY0 + h, newZ0 + d,
      def.name,
      updatedPlacement,
    )
    historyManager.executeCommand(cmd, grid)

    set({
      placements: state.placements.map((p) =>
        p.instanceId === instanceId ? updatedPlacement : p,
      ),
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
  },

  // Selection
  selectedInstanceId: null,
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),

  // Drag state
  dragState: null,
  setDragState: (dragState) => set({ dragState }),

  // Render version
  renderVersion: 0,

  // History
  canUndo: false,
  canRedo: false,
  undo: () => {
    const grid = getVoxelGrid()
    const command = historyManager.undo(grid)
    if (!command) return

    const state = get()

    if (command instanceof PlaceCommand) {
      // Undo place → remove the placement
      set({
        placements: state.placements.filter((p) => p.instanceId !== command.instanceId),
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    } else if (command instanceof RemoveCommand) {
      // Undo remove → restore the placement
      set({
        placements: [...state.placements, command.placement],
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    } else if (command instanceof MoveCommand) {
      // Undo move → restore old position
      const oldPlacement: PlacedCargo = {
        ...command.placement,
        positionCm: { x: command.oldX0, y: command.oldY0, z: command.oldZ0 },
      }
      set({
        placements: state.placements.map((p) =>
          p.instanceId === command.instanceId ? oldPlacement : p,
        ),
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    }
  },
  redo: () => {
    const grid = getVoxelGrid()
    const command = historyManager.redo(grid)
    if (!command) return

    const state = get()

    if (command instanceof PlaceCommand) {
      // Redo place → add the placement back
      set({
        placements: [...state.placements, command.placement],
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    } else if (command instanceof RemoveCommand) {
      // Redo remove → remove the placement
      set({
        placements: state.placements.filter((p) => p.instanceId !== command.instanceId),
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    } else if (command instanceof MoveCommand) {
      // Redo move → apply new position
      set({
        placements: state.placements.map((p) =>
          p.instanceId === command.instanceId ? command.placement : p,
        ),
        canUndo: historyManager.canUndo,
        canRedo: historyManager.canRedo,
        renderVersion: state.renderVersion + 1,
      })
    }
  },
}))
