import { create } from 'zustand'
import type { ContainerDef, CargoItemDef, PlacedCargo, Vec3, DragState, CameraView, WeightResult } from '../core/types'
import { CONTAINER_PRESETS } from '../core/types'
import { getVoxelGrid, createVoxelGrid } from '../core/voxelGridSingleton'
import { HistoryManager, PlaceCommand, RemoveCommand, MoveCommand, RotateCommand } from '../core/History'
import { voxelize, voxelizeComposite } from '../core/Voxelizer'
import { computeWeight, computeCogDeviation } from '../core/WeightCalculator'
import type { CogDeviation } from '../core/WeightCalculator'
import { checkAllSupports } from '../core/GravityChecker'
import type { SupportResult } from '../core/GravityChecker'
import { serializeSaveData, downloadJson } from '../core/SaveLoad'
import type { SaveData } from '../core/SaveLoad'
import type { VoxelizeResult } from '../core/Voxelizer'
import type { VoxelGrid } from '../core/VoxelGrid'

const defaultContainer = CONTAINER_PRESETS[0]!
const historyManager = new HistoryManager(100)

const initialWeightResult: WeightResult = {
  totalWeightKg: 0,
  centerOfGravity: { x: 0, y: 0, z: 0 },
  fillRatePercent: 0,
  overweight: false,
}

export interface AppState {
  // Container
  container: ContainerDef
  setContainer: (def: ContainerDef) => void

  // Cargo definitions
  cargoDefs: CargoItemDef[]
  addCargoDef: (def: CargoItemDef) => void
  removeCargoDef: (id: string) => void
  updateCargoDef: (id: string, updates: Partial<Omit<CargoItemDef, 'id'>>) => void
  importCargoDefs: (defs: CargoItemDef[]) => void

  // Placements
  placements: PlacedCargo[]
  nextInstanceId: number
  placeCargo: (cargoDefId: string, position: Vec3, rotation?: Vec3) => void
  removePlacement: (instanceId: number) => void
  moveCargo: (instanceId: number, newPosition: Vec3) => void
  rotateCargo: (instanceId: number, newRotation: Vec3) => void
  dropCargo: (instanceId: number) => void

  // Selection
  selectedInstanceId: number | null
  setSelectedInstanceId: (id: number | null) => void

  // Drag state
  dragState: DragState | null
  setDragState: (state: DragState | null) => void

  // Camera view
  cameraView: CameraView
  setCameraView: (view: CameraView) => void

  // Grid / Snap
  showGrid: boolean
  toggleGrid: () => void
  snapToGrid: boolean
  toggleSnap: () => void
  gridSizeCm: number
  setGridSize: (size: number) => void

  // Labels
  showLabels: boolean
  toggleLabels: () => void

  // Force mode
  forceMode: boolean
  toggleForceMode: () => void

  // Sidebar (responsive)
  sidebarOpen: boolean
  toggleSidebar: () => void

  // Toasts
  toasts: { id: number; message: string; type: 'info' | 'success' | 'error' }[]
  addToast: (message: string, type: 'info' | 'success' | 'error') => void
  removeToast: (id: number) => void

  // Render version (triggers renderer updates)
  renderVersion: number

  // Analytics
  weightResult: WeightResult
  cogDeviation: CogDeviation | null
  supportResults: Map<number, SupportResult>

  // Save/Load
  saveState: () => void
  loadState: (data: SaveData) => void

  // History
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

function recomputeAnalyticsSync(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
): { weightResult: WeightResult; cogDeviation: CogDeviation | null; supportResults: Map<number, SupportResult> } {
  const weightResult = computeWeight(placements, cargoDefs, container)
  const cogDeviation = placements.length > 0
    ? computeCogDeviation(weightResult.centerOfGravity, container)
    : null
  const grid = getVoxelGrid()
  const supportResults = checkAllSupports(grid, placements, cargoDefs)
  return { weightResult, cogDeviation, supportResults }
}

let analyticsTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAnalytics(): void {
  if (analyticsTimer !== null) return
  analyticsTimer = setTimeout(() => {
    analyticsTimer = null
    const state = useAppStore.getState()
    const analytics = recomputeAnalyticsSync(state.placements, state.cargoDefs, state.container)
    useAppStore.setState(analytics)
  }, 0)
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
      weightResult: initialWeightResult,
      cogDeviation: null,
      supportResults: new Map(),
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
    const newPlacements = state.placements.filter((p) => p.cargoDefId !== id)
    const newDefs = state.cargoDefs.filter((d) => d.id !== id)
    set({
      cargoDefs: newDefs,
      placements: newPlacements,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
  updateCargoDef: (id, updates) => {
    set((state) => ({
      cargoDefs: state.cargoDefs.map((d) =>
        d.id === id ? { ...d, ...updates } : d,
      ),
      renderVersion: state.renderVersion + 1,
    }))
  },
  importCargoDefs: (defs) => {
    set((state) => ({
      cargoDefs: [...state.cargoDefs, ...defs],
    }))
  },

  // Placements
  placements: [],
  nextInstanceId: 1,
  placeCargo: (cargoDefId, position, rotation) => {
    const state = get()
    const def = state.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return
    if (state.nextInstanceId > 65534) return

    const instanceId = state.nextInstanceId
    const pos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) }
    const rot = rotation ?? { x: 0, y: 0, z: 0 }

    const result = voxelizeCargo(def, pos, rot)
    const grid = getVoxelGrid()

    // Bounds check via AABB
    const { min, max } = result.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0) return
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) return

    const newPlacement: PlacedCargo = {
      instanceId,
      cargoDefId,
      positionCm: pos,
      rotationDeg: rot,
    }

    const cmd = new PlaceCommand(instanceId, result, def.name, newPlacement)
    historyManager.executeCommand(cmd, grid)

    const newPlacements = [...state.placements, newPlacement]

    set({
      placements: newPlacements,
      nextInstanceId: instanceId + 1,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
  removePlacement: (instanceId) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    const grid = getVoxelGrid()

    if (def) {
      const pos = placement.positionCm
      const rot = placement.rotationDeg
      const result = voxelizeCargo(def, pos, rot)
      const cmd = new RemoveCommand(instanceId, result, def.name, placement)
      historyManager.executeCommand(cmd, grid)
    } else {
      grid.clearObject(instanceId)
    }

    const newPlacements = state.placements.filter((p) => p.instanceId !== instanceId)

    set({
      placements: newPlacements,
      selectedInstanceId: state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
  moveCargo: (instanceId, newPosition) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    const grid = getVoxelGrid()
    const oldPos = placement.positionCm
    const rot = placement.rotationDeg
    const newPos = { x: Math.round(newPosition.x), y: Math.round(newPosition.y), z: Math.round(newPosition.z) }

    const oldResult = voxelizeCargo(def, oldPos, rot)
    const newResult = voxelizeCargo(def, newPos, rot)

    // Bounds check
    const { min, max } = newResult.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0) return
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) return

    const updatedPlacement: PlacedCargo = {
      ...placement,
      positionCm: newPos,
    }

    const cmd = new MoveCommand(
      instanceId, oldResult, newResult,
      def.name, updatedPlacement, placement,
    )
    historyManager.executeCommand(cmd, grid)

    const newPlacements = state.placements.map((p) =>
      p.instanceId === instanceId ? updatedPlacement : p,
    )

    set({
      placements: newPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
  rotateCargo: (instanceId, newRotation) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    const grid = getVoxelGrid()
    const pos = placement.positionCm
    const oldRot = placement.rotationDeg

    const oldResult = voxelizeCargo(def, pos, oldRot)
    let newPos = pos
    let newResult = voxelizeCargo(def, newPos, newRotation)

    // Auto-correct: shift position to keep AABB within container
    const { min, max } = newResult.aabb
    let dx = 0, dy = 0, dz = 0
    if (min.x < 0) dx = -min.x
    else if (max.x > grid.width) dx = grid.width - max.x
    if (min.y < 0) dy = -min.y
    else if (max.y > grid.height) dy = grid.height - max.y
    if (min.z < 0) dz = -min.z
    else if (max.z > grid.depth) dz = grid.depth - max.z

    if (dx !== 0 || dy !== 0 || dz !== 0) {
      newPos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }
      newResult = voxelizeCargo(def, newPos, newRotation)
      // Re-check after correction (object may be larger than container)
      const { min: m2, max: x2 } = newResult.aabb
      if (m2.x < 0 || m2.y < 0 || m2.z < 0 ||
          x2.x > grid.width || x2.y > grid.height || x2.z > grid.depth) {
        get().addToast('回転後のサイズがコンテナに収まりません', 'error')
        return
      }
    }

    // Collision check: clear old, test new (skip collision check in force mode)
    fillFromResult(grid, oldResult, 0)
    if (!get().forceMode) {
      const hasCollision = checkCollision(grid, newResult, instanceId)
      if (hasCollision) {
        // Restore old
        fillFromResult(grid, oldResult, instanceId)
        get().addToast('他の荷物と衝突するため回転できません', 'error')
        return
      }
    }
    // Restore old (RotateCommand.execute will handle the actual change)
    fillFromResult(grid, oldResult, instanceId)

    const updatedPlacement: PlacedCargo = {
      ...placement,
      positionCm: newPos,
      rotationDeg: newRotation,
    }

    const cmd = new RotateCommand(
      instanceId, oldResult, newResult,
      def.name, updatedPlacement, placement,
    )
    historyManager.executeCommand(cmd, grid)

    const newPlacements = state.placements.map((p) =>
      p.instanceId === instanceId ? updatedPlacement : p,
    )

    set({
      placements: newPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },

  dropCargo: (instanceId) => {
    const state = get()
    const placement = state.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return

    const def = state.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    const grid = getVoxelGrid()
    const pos = placement.positionCm
    const rot = placement.rotationDeg

    // Voxelize at current position and temporarily clear from grid
    const oldResult = voxelizeCargo(def, pos, rot)
    fillFromResult(grid, oldResult, 0)

    // Scan from Y=0 upward to find the lowest valid position
    let bestY = -1
    for (let y = 0; y <= pos.y; y++) {
      const testResult = voxelizeCargo(def, { x: pos.x, y, z: pos.z }, rot)
      const { min, max } = testResult.aabb
      if (min.x < 0 || min.y < 0 || min.z < 0) continue
      if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) continue
      if (checkCollision(grid, testResult, instanceId)) continue
      bestY = y
      break
    }

    // Restore grid
    fillFromResult(grid, oldResult, instanceId)

    // No valid position found, or already at lowest
    if (bestY < 0 || bestY === pos.y) return

    // Use moveCargo for undo/redo support
    state.moveCargo(instanceId, { x: pos.x, y: bestY, z: pos.z })
  },

  // Selection
  selectedInstanceId: null,
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),

  // Drag state
  dragState: null,
  setDragState: (dragState) => set({ dragState }),

  // Camera view
  cameraView: 'free' as CameraView,
  setCameraView: (view) => set({ cameraView: view }),

  // Grid / Snap
  showGrid: true,
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid, renderVersion: state.renderVersion + 1 })),
  snapToGrid: false,
  toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  gridSizeCm: 1,
  setGridSize: (size) => set({ gridSizeCm: size }),

  // Labels
  showLabels: true,
  toggleLabels: () => set((state) => ({ showLabels: !state.showLabels })),

  // Force mode
  forceMode: false,
  toggleForceMode: () => set((state) => ({ forceMode: !state.forceMode })),

  // Sidebar (responsive)
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // Toasts
  toasts: [],
  addToast: (message, type) => {
    const id = Date.now()
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }))
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, 3000)
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),

  // Render version
  renderVersion: 0,

  // Analytics
  weightResult: initialWeightResult,
  cogDeviation: null,
  supportResults: new Map(),

  // Save/Load
  saveState: () => {
    const state = get()
    const json = serializeSaveData({
      container: state.container,
      cargoDefs: state.cargoDefs,
      placements: state.placements,
      nextInstanceId: state.nextInstanceId,
    })
    downloadJson(json, 'container-layout.json')
  },
  loadState: (data: SaveData) => {
    // Recreate VoxelGrid
    createVoxelGrid(data.container)
    const grid = getVoxelGrid()

    // Restore all placements into VoxelGrid
    const defMap = new Map<string, CargoItemDef>()
    for (const d of data.cargoDefs) {
      defMap.set(d.id, d)
    }
    for (const p of data.placements) {
      const def = defMap.get(p.cargoDefId)
      if (!def) continue
      const result = voxelizeCargo(def, p.positionCm, p.rotationDeg)
      fillFromResult(grid, result, p.instanceId)
    }

    historyManager.clear()

    const analytics = recomputeAnalyticsSync(data.placements, data.cargoDefs, data.container)

    set((state) => ({
      container: data.container,
      cargoDefs: data.cargoDefs,
      placements: data.placements,
      nextInstanceId: data.nextInstanceId,
      selectedInstanceId: null,
      dragState: null,
      canUndo: false,
      canRedo: false,
      renderVersion: state.renderVersion + 1,
      ...analytics,
    }))
  },

  // History
  canUndo: false,
  canRedo: false,
  undo: () => {
    const grid = getVoxelGrid()
    const command = historyManager.undo(grid)
    if (!command) return

    const state = get()
    let newPlacements: PlacedCargo[]

    if (command instanceof PlaceCommand) {
      newPlacements = state.placements.filter((p) => p.instanceId !== command.instanceId)
    } else if (command instanceof RemoveCommand) {
      newPlacements = [...state.placements, command.placement]
    } else if (command instanceof MoveCommand) {
      newPlacements = state.placements.map((p) =>
        p.instanceId === command.instanceId ? command.oldPlacement : p,
      )
    } else if (command instanceof RotateCommand) {
      newPlacements = state.placements.map((p) =>
        p.instanceId === command.instanceId ? command.oldPlacement : p,
      )
    } else {
      return
    }

    set({
      placements: newPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
  redo: () => {
    const grid = getVoxelGrid()
    const command = historyManager.redo(grid)
    if (!command) return

    const state = get()
    let newPlacements: PlacedCargo[]

    if (command instanceof PlaceCommand) {
      newPlacements = [...state.placements, command.placement]
    } else if (command instanceof RemoveCommand) {
      newPlacements = state.placements.filter((p) => p.instanceId !== command.instanceId)
    } else if (command instanceof MoveCommand) {
      newPlacements = state.placements.map((p) =>
        p.instanceId === command.instanceId ? command.placement : p,
      )
    } else if (command instanceof RotateCommand) {
      newPlacements = state.placements.map((p) =>
        p.instanceId === command.instanceId ? command.placement : p,
      )
    } else {
      return
    }

    set({
      placements: newPlacements,
      canUndo: historyManager.canUndo,
      canRedo: historyManager.canRedo,
      renderVersion: state.renderVersion + 1,
    })
    scheduleAnalytics()
  },
}))

/** Voxelize a cargo item, using composite path for shapes with blocks */
function voxelizeCargo(def: CargoItemDef, pos: Vec3, rot: Vec3): VoxelizeResult {
  if (def.blocks) {
    return voxelizeComposite(def.blocks, pos, rot)
  }
  return voxelize(def.widthCm, def.heightCm, def.depthCm, pos, rot)
}

// Helper: fill/clear voxels from VoxelizeResult
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
    // Generate voxels for collision check
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
