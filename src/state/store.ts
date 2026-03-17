import { create } from 'zustand'
import type { ContainerDef, CargoItemDef, PlacedCargo, Vec3, DragState, CameraView, WeightResult, StagedItem, AutoPackMode } from '../core/types'
import type { PackFailureReason } from '../core/AutoPacker'
import { CONTAINER_PRESETS } from '../core/types'
import { createVoxelGrid, getVoxelGrid } from '../core/voxelGridSingleton'
import { computeWeightWithAABBs, computeCogDeviation } from '../core/WeightCalculator'
import type { CogDeviation } from '../core/WeightCalculator'
import { checkAllSupportsWithAABBs } from '../core/GravityChecker'
import type { SupportResult } from '../core/GravityChecker'
import { checkStackConstraintsWithAABBs } from '../core/StackChecker'
import type { StackViolation } from '../core/StackChecker'
import type { InterferencePair } from '../core/InterferenceChecker'
import { downloadJson } from '../ui/downloadJson'
import { getTranslation, interpolate } from '../i18n'
import type { SaveData } from '../core/SaveLoad'
import { SimulatorSession } from '../core/SimulatorSession'
import { OccupancyMap } from '../core/OccupancyMap'
import { voxelize, voxelizeComposite, computeRotatedAABB } from '../core/Voxelizer'
import { ORIENTATIONS } from '../core/AutoPacker'

const AUTO_PACK_BASE_MS = 15_000
const AUTO_PACK_PER_ITEM_MS = 500

const initialWeightResult: WeightResult = {
  totalWeightKg: 0,
  centerOfGravity: { x: 0, y: 0, z: 0 },
  fillRatePercent: 0,
  overweight: false,
}

const session = new SimulatorSession({
  gridFactory: (def: ContainerDef) => {
    createVoxelGrid(def)
    return getVoxelGrid()
  },
})

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
  autoPackCargo: (mode: AutoPackMode) => void

  // Staging
  stagedItems: StagedItem[]
  autoPackFailures: PackFailureReason[]
  stageCargo: (cargoDefId: string, count?: number) => void
  unstageCargo: (cargoDefId: string, count?: number) => void
  clearStaged: () => void

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

  // Stack violations
  stackViolations: StackViolation[]

  // Interference
  interferenceResults: InterferencePair[]
  checkInterference: () => void

  // Save/Load
  saveState: () => void
  loadState: (data: SaveData) => void

  // History
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void

  // Helpers (used by UI components)
  canMoveTo: (instanceId: number, newPosition: Vec3) => boolean
  findPlacementPosition: (cargoDefId: string) => { position: Vec3; rotation: Vec3 } | null
}

// --- Analytics ---

function recomputeAnalyticsSync(
  placements: PlacedCargo[],
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
): { weightResult: WeightResult; cogDeviation: CogDeviation | null; supportResults: Map<number, SupportResult>; stackViolations: StackViolation[] } {
  const defMap = new Map<string, CargoItemDef>()
  for (const d of cargoDefs) defMap.set(d.id, d)

  // Compute AABBs once for all placements
  const aabbs: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> = []
  for (const p of placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) {
      aabbs.push({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } })
      continue
    }
    aabbs.push(computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg))
  }

  const weightResult = computeWeightWithAABBs(placements, cargoDefs, container, aabbs)
  const cogDeviation = placements.length > 0
    ? computeCogDeviation(weightResult.centerOfGravity, container)
    : null
  const grid = getVoxelGrid()
  const supportResults = checkAllSupportsWithAABBs(grid, placements, aabbs)
  const stackViolations = checkStackConstraintsWithAABBs(placements, cargoDefs, aabbs)
  return { weightResult, cogDeviation, supportResults, stackViolations }
}

let analyticsTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAnalytics(): void {
  if (analyticsTimer !== null) return
  analyticsTimer = setTimeout(() => {
    analyticsTimer = null
    const state = useAppStore.getState()
    const analytics = recomputeAnalyticsSync(state.placements, state.cargoDefs, state.container)
    useAppStore.setState(analytics)
  }, 50)
}

// --- Sync helper ---

function syncFromSession(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): void {
  set({
    container: session.container,
    placements: [...session.placements],
    cargoDefs: [...session.cargoDefs],
    nextInstanceId: session.nextInstanceId,
    stagedItems: [...session.stagedItems],
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
    renderVersion: get().renderVersion + 1,
  })
  scheduleAnalytics()
}

// --- Store ---

const defaultContainer = CONTAINER_PRESETS[0]!

export const useAppStore = create<AppState>((set, get) => ({
  // Container
  container: {
    widthCm: defaultContainer.widthCm,
    heightCm: defaultContainer.heightCm,
    depthCm: defaultContainer.depthCm,
    maxPayloadKg: defaultContainer.maxPayloadKg,
  },
  setContainer: (def) => {
    session.setContainer(def)
    set((state) => ({
      container: def,
      placements: [],
      nextInstanceId: 1,
      stagedItems: [],
      selectedInstanceId: null,
      dragState: null,
      canUndo: false,
      canRedo: false,
      renderVersion: state.renderVersion + 1,
      weightResult: initialWeightResult,
      cogDeviation: null,
      supportResults: new Map(),
      stackViolations: [],
      autoPackFailures: [],
    }))
  },

  // Cargo definitions
  cargoDefs: [],
  addCargoDef: (def) => {
    session.addCargoDef(def)
    set({ cargoDefs: [...session.cargoDefs] })
  },
  removeCargoDef: (id) => {
    session.removeCargoDef(id)
    syncFromSession(set, get)
  },
  updateCargoDef: (id, updates) => {
    session.updateCargoDef(id, updates)
    set({
      cargoDefs: [...session.cargoDefs],
      renderVersion: get().renderVersion + 1,
    })
  },
  importCargoDefs: (defs) => {
    for (const def of defs) {
      session.addCargoDef(def)
    }
    set({ cargoDefs: [...session.cargoDefs] })
  },

  // Placements
  placements: [],
  nextInstanceId: 1,
  placeCargo: (cargoDefId, position, rotation) => {
    const result = session.placeCargo(cargoDefId, position, rotation, true)
    if (!result.success) {
      get().addToast(getTranslation().toasts.placementOutOfBounds, 'error')
      return
    }
    syncFromSession(set, get)
  },
  removePlacement: (instanceId) => {
    const result = session.removePlacement(instanceId)
    if (!result.success) return
    const state = get()
    syncFromSession(set, get)
    if (state.selectedInstanceId === instanceId) {
      set({ selectedInstanceId: null })
    }
  },
  moveCargo: (instanceId, newPosition) => {
    const result = session.moveCargo(instanceId, newPosition, true)
    if (!result.success) return
    syncFromSession(set, get)
  },
  rotateCargo: (instanceId, newRotation) => {
    const tt = getTranslation()
    const result = session.rotateCargo(instanceId, newRotation, get().forceMode)
    if (!result.success) {
      if (result.error === 'noFlip cargo cannot be rotated on X/Z axes') {
        get().addToast(tt.toasts.noFlipViolation, 'error')
      } else if (result.error === 'Rotated cargo exceeds container bounds') {
        get().addToast(tt.toasts.rotationExceedsContainer, 'error')
      } else {
        get().addToast(tt.toasts.rotationCollision, 'error')
      }
      return
    }
    if (result.kicked) {
      get().addToast(tt.toasts.kickApplied, 'info')
    }
    syncFromSession(set, get)
  },

  dropCargo: (instanceId) => {
    session.dropCargo(instanceId)
    syncFromSession(set, get)
  },

  autoPackCargo: (mode: AutoPackMode) => {
    const tt = getTranslation()

    // Pre-check for empty cases with toasts
    if (mode === 'repack') {
      if (session.placements.length === 0 && session.stagedItems.length === 0) {
        set({ autoPackFailures: [] })
        get().addToast(tt.toasts.noCargoForPack, 'error')
        return
      }
    } else {
      if (session.stagedItems.length === 0) {
        set({ autoPackFailures: [] })
        get().addToast(tt.toasts.noStagedItems, 'error')
        return
      }
    }

    // Compute item count for deadline
    let itemCount = 0
    if (mode === 'repack') {
      itemCount = session.placements.length
      for (const si of session.stagedItems) itemCount += si.count
    } else {
      for (const si of session.stagedItems) itemCount += si.count
    }
    const deadline = Date.now() + Math.max(AUTO_PACK_BASE_MS, itemCount * AUTO_PACK_PER_ITEM_MS)

    const result = session.autoPackCargo(mode, deadline)
    set({ autoPackFailures: result.failureReasons })

    if (!result.success) {
      if (result.error === 'No items could be placed') {
        get().addToast(tt.toasts.noPlaceablePosition, 'error')
      } else {
        get().addToast(result.error ?? tt.toasts.noPlaceablePosition, 'error')
      }
      syncFromSession(set, get)
      return
    }

    syncFromSession(set, get)

    if (result.failed > 0) {
      const key = mode === 'repack' ? tt.toasts.repackPartial : tt.toasts.autoPackPartial
      get().addToast(interpolate(key, { placed: result.placed, failed: result.failed }), 'info')
    } else {
      const key = mode === 'repack' ? tt.toasts.repackComplete : tt.toasts.autoPackComplete
      get().addToast(interpolate(key, { placed: result.placed }), 'success')
    }
  },

  // Staging
  stagedItems: [],
  autoPackFailures: [],
  stageCargo: (cargoDefId, count = 1) => {
    session.stageCargo(cargoDefId, count)
    set({ stagedItems: [...session.stagedItems] })
    get().addToast(getTranslation().toasts.stagedItem, 'info')
  },
  unstageCargo: (cargoDefId, count = 1) => {
    session.unstageCargo(cargoDefId, count)
    set({ stagedItems: [...session.stagedItems] })
    get().addToast(getTranslation().toasts.unstagedItem, 'info')
  },
  clearStaged: () => {
    session.clearStaged()
    set({ stagedItems: [], autoPackFailures: [] })
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
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
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
    set((state) => {
      const next = [...state.toasts, { id, message, type }]
      return { toasts: next.length > 10 ? next.slice(-10) : next }
    })
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
  stackViolations: [],

  // Interference
  interferenceResults: [],
  checkInterference: () => {
    const result = session.checkInterferenceAll()
    set({ interferenceResults: result.pairs })
    const tt = getTranslation()
    if (result.pairs.length > 0) {
      get().addToast(interpolate(tt.toasts.interferenceFound, { count: result.pairs.length }), 'error')
    } else {
      get().addToast(tt.toasts.noInterference, 'success')
    }
  },

  // Save/Load
  saveState: () => {
    const json = session.serialize()
    downloadJson(json, 'container-layout.json')
  },
  loadState: (data: SaveData) => {
    session.loadFromData(data)
    const analytics = recomputeAnalyticsSync(session.placements, session.cargoDefs, session.container)
    set((state) => ({
      container: session.container,
      cargoDefs: [...session.cargoDefs],
      placements: [...session.placements],
      nextInstanceId: session.nextInstanceId,
      stagedItems: [...session.stagedItems],
      autoPackFailures: [],
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
    const result = session.undo()
    if (!result.success) return
    syncFromSession(set, get)
  },
  redo: () => {
    const result = session.redo()
    if (!result.success) return
    syncFromSession(set, get)
  },

  // --- Helpers for UI ---

  canMoveTo: (instanceId, newPosition) => {
    const grid = getVoxelGrid()
    const placement = session.placements.find((p) => p.instanceId === instanceId)
    if (!placement) return false
    const def = session.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return false

    const pos = { x: Math.round(newPosition.x), y: Math.round(newPosition.y), z: Math.round(newPosition.z) }

    const result = def.blocks
      ? voxelizeComposite(def.blocks, pos, placement.rotationDeg)
      : voxelize(def.widthCm, def.heightCm, def.depthCm, pos, placement.rotationDeg)

    const { min, max } = result.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0) return false
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) return false

    if (result.usesFastPath) {
      for (let z = min.z; z < max.z; z++)
        for (let y = min.y; y < max.y; y++)
          for (let x = min.x; x < max.x; x++) {
            const val = grid.get(x, y, z)
            if (val !== 0 && val !== instanceId) return false
          }
      return true
    }
    return !grid.hasCollision(result.voxels, instanceId)
  },

  findPlacementPosition: (cargoDefId) => {
    const def = session.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return null

    const noFlipOrientations: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 90, z: 0 },
    ]
    const orientations = def.noFlip ? noFlipOrientations : ORIENTATIONS

    const seen = new Set<string>()
    const candidates: { rot: Vec3; effW: number; effH: number; effD: number; offsetX: number; offsetY: number; offsetZ: number }[] = []
    for (const rot of orientations) {
      const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, { x: 0, y: 0, z: 0 }, rot)
      const effW = aabb.max.x - aabb.min.x
      const effH = aabb.max.y - aabb.min.y
      const effD = aabb.max.z - aabb.min.z
      const key = `${effW},${effH},${effD}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ rot, effW, effH, effD, offsetX: -aabb.min.x, offsetY: -aabb.min.y, offsetZ: -aabb.min.z })
    }

    const map = OccupancyMap.fromPlacements(session.placements, session.cargoDefs, session.container)
    for (const c of candidates) {
      const position = map.findPosition(c.effW, c.effH, c.effD)
      if (position) {
        return {
          position: { x: position.x + c.offsetX, y: position.y + c.offsetY, z: position.z + c.offsetZ },
          rotation: c.rot,
        }
      }
    }
    return null
  },
}))
