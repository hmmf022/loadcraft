import { useRef, useEffect, useCallback, useState } from 'react'
import { Renderer } from '../renderer/Renderer'
import { useAppStore } from '../state/store'
import { pick, screenToRay, intersectRayPlane } from '../renderer/Raycaster'
import type { PickItem } from '../renderer/Raycaster'
import type { Vec3, CargoItemDef, ShapeBlock } from '../core/types'
import { getVoxelGrid } from '../core/voxelGridSingleton'
import { computeRotatedAABB, voxelize, voxelizeComposite, rotateVec3 } from '../core/Voxelizer'
import styles from './CanvasPanel.module.css'

const CAMERA_PRESETS: Record<string, { theta: number; phi: number }> = {
  front:     { theta: 0,            phi: Math.PI / 2 },
  back:      { theta: Math.PI,      phi: Math.PI / 2 },
  left:      { theta: -Math.PI / 2, phi: Math.PI / 2 },
  right:     { theta: Math.PI / 2,  phi: Math.PI / 2 },
  top:       { theta: 0,            phi: 0.01 },
  isometric: { theta: Math.PI / 4,  phi: Math.PI / 4 },
}

/** Build AABB pick items from current placements (rotation-aware, composite-aware) */
function buildPickItems(): PickItem[] {
  const state = useAppStore.getState()
  const defMap = new Map<string, CargoItemDef>()
  for (const d of state.cargoDefs) {
    defMap.set(d.id, d)
  }
  const items: PickItem[] = []
  for (const p of state.placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue

    if (def.blocks) {
      // Composite shape: add each block as a separate pick item (same instanceId)
      for (const block of def.blocks) {
        const rotatedOffset = rotateVec3(
          { x: block.x, y: block.y, z: block.z },
          p.rotationDeg,
        )
        const blockAabb = computeRotatedAABB(
          block.w, block.h, block.d,
          {
            x: p.positionCm.x + rotatedOffset.x,
            y: p.positionCm.y + rotatedOffset.y,
            z: p.positionCm.z + rotatedOffset.z,
          },
          p.rotationDeg,
          true,
        )
        items.push({ instanceId: p.instanceId, aabb: blockAabb })
      }
    } else {
      const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg, true)
      items.push({ instanceId: p.instanceId, aabb })
    }
  }
  return items
}

/** Check if a position is within container bounds (no collision check) */
function isInBounds(pos: Vec3, widthCm: number, heightCm: number, depthCm: number, rotationDeg: Vec3, blocks?: ShapeBlock[]): boolean {
  const grid = getVoxelGrid()
  const roundedPos = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
  const { min, max } = (blocks
    ? voxelizeComposite(blocks, roundedPos, rotationDeg)
    : voxelize(widthCm, heightCm, depthCm, roundedPos, rotationDeg)
  ).aabb
  return min.x >= 0 && min.y >= 0 && min.z >= 0 &&
         max.x <= grid.width && max.y <= grid.height && max.z <= grid.depth
}

/** Check if a position is valid for placing cargo (rotation-aware, composite-aware) */
function isValidPosition(pos: Vec3, widthCm: number, heightCm: number, depthCm: number, rotationDeg: Vec3, excludeInstanceId?: number, blocks?: ShapeBlock[]): boolean {
  const grid = getVoxelGrid()
  const roundedPos = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
  const result = blocks
    ? voxelizeComposite(blocks, roundedPos, rotationDeg)
    : voxelize(widthCm, heightCm, depthCm, roundedPos, rotationDeg)

  // Bounds check
  const { min, max } = result.aabb
  if (min.x < 0 || min.y < 0 || min.z < 0) return false
  if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) return false

  // Collision check
  if (result.usesFastPath) {
    for (let z = min.z; z < max.z; z++) {
      for (let y = min.y; y < max.y; y++) {
        for (let x = min.x; x < max.x; x++) {
          const val = grid.get(x, y, z)
          if (val !== 0 && val !== excludeInstanceId) return false
        }
      }
    }
    return true
  } else {
    return !grid.hasCollision(result.voxels, excludeInstanceId)
  }
}

/** Determine ghost validity: 'invalid' if collision, 'floating' if unsupported, 'valid' otherwise, 'force' if force mode allows */
function getGhostValidity(pos: Vec3, widthCm: number, heightCm: number, depthCm: number, rotationDeg: Vec3, excludeInstanceId?: number, blocks?: ShapeBlock[]): 'valid' | 'invalid' | 'floating' | 'force' {
  if (!isValidPosition(pos, widthCm, heightCm, depthCm, rotationDeg, excludeInstanceId, blocks)) {
    if (useAppStore.getState().forceMode && isInBounds(pos, widthCm, heightCm, depthCm, rotationDeg, blocks)) return 'force'
    return 'invalid'
  }

  if (blocks) {
    // Composite shape: use actual voxels for support check
    const roundedPos = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
    const result = voxelizeComposite(blocks, roundedPos, rotationDeg)
    if (result.aabb.min.y === 0) return 'valid' // on floor

    // Group voxels by (x,z) and find the minimum y for each column
    const grid = getVoxelGrid()
    const columnMinY = new Map<string, number>()
    for (const v of result.voxels) {
      const key = `${v.x},${v.z}`
      const prev = columnMinY.get(key)
      if (prev === undefined || v.y < prev) {
        columnMinY.set(key, v.y)
      }
    }

    let totalBottom = 0
    let supportedBottom = 0
    for (const [key, minY] of columnMinY) {
      const [xStr, zStr] = key.split(',')
      const x = Number(xStr)
      const z = Number(zStr)
      totalBottom++
      const below = grid.get(x, minY - 1, z)
      if (below !== 0 && below !== excludeInstanceId) {
        supportedBottom++
      }
    }
    if (totalBottom === 0) return 'floating'
    return (supportedBottom / totalBottom) >= 0.8 ? 'valid' : 'floating'
  }

  // Simple box: use AABB-based check
  const aabb = computeRotatedAABB(widthCm, heightCm, depthCm, pos, rotationDeg)
  if (aabb.min.y === 0) return 'valid' // on floor

  const grid = getVoxelGrid()
  let totalBottom = 0
  let supportedBottom = 0
  for (let z = aabb.min.z; z < aabb.max.z; z++) {
    for (let x = aabb.min.x; x < aabb.max.x; x++) {
      const below = grid.get(x, aabb.min.y - 1, z)
      if (below !== 0 && below !== excludeInstanceId) {
        supportedBottom++
      }
      totalBottom++
    }
  }
  if (totalBottom === 0) return 'floating'
  return (supportedBottom / totalBottom) >= 0.8 ? 'valid' : 'floating'
}

/**
 * Snap position: determine X,Z from hit point, then find the lowest valid Y
 * (gravity stacking — cargo drops down and lands on top of existing items)
 */
function snapPosition(hitPoint: Vec3, widthCm: number, heightCm: number, depthCm: number, rotationDeg: Vec3, excludeInstanceId?: number, blocks?: ShapeBlock[]): Vec3 {
  const state = useAppStore.getState()
  const cw = state.container.widthCm
  const ch = state.container.heightCm
  const cd = state.container.depthCm

  // Compute AABB size for the rotated box at origin
  const testAABB = computeRotatedAABB(widthCm, heightCm, depthCm, { x: 0, y: 0, z: 0 }, rotationDeg)
  const aabbW = testAABB.max.x - testAABB.min.x
  const aabbD = testAABB.max.z - testAABB.min.z
  // Offset from position origin to AABB min
  const offsetX = testAABB.min.x
  const offsetZ = testAABB.min.z

  let x = Math.round(hitPoint.x - aabbW / 2 - offsetX)
  let z = Math.round(hitPoint.z - aabbD / 2 - offsetZ)

  // Apply grid snap
  const { snapToGrid, gridSizeCm } = useAppStore.getState()
  if (snapToGrid && gridSizeCm > 1) {
    x = Math.round(x / gridSizeCm) * gridSizeCm
    z = Math.round(z / gridSizeCm) * gridSizeCm
  }

  // Clamp so that the AABB fits within container
  x = Math.max(-offsetX, Math.min(x, cw - aabbW - offsetX))
  z = Math.max(-offsetZ, Math.min(z, cd - aabbD - offsetZ))

  // Find the lowest valid Y by scanning from bottom up
  const grid = getVoxelGrid()

  // Valid Y range: AABB must fit within [0, ch]
  // AABB at position y occupies [y + testAABB.min.y, y + testAABB.max.y]
  const minValidY = Math.max(0, Math.ceil(-testAABB.min.y))
  const maxValidY = Math.floor(ch - testAABB.max.y)
  let bestY = minValidY

  for (let y = minValidY; y <= maxValidY; y++) {
    const testPos = { x, y, z }
    const result = blocks
      ? voxelizeComposite(blocks, testPos, rotationDeg)
      : voxelize(widthCm, heightCm, depthCm, testPos, rotationDeg)
    const { min, max } = result.aabb
    if (min.x < 0 || min.y < 0 || min.z < 0) continue
    if (max.x > grid.width || max.y > grid.height || max.z > grid.depth) continue

    // Collision check
    let collision = false
    if (result.usesFastPath) {
      for (let vz = min.z; vz < max.z && !collision; vz++) {
        for (let vy = min.y; vy < max.y && !collision; vy++) {
          for (let vx = min.x; vx < max.x && !collision; vx++) {
            const val = grid.get(vx, vy, vz)
            if (val !== 0 && val !== excludeInstanceId) {
              collision = true
            }
          }
        }
      }
    } else {
      collision = grid.hasCollision(result.voxels, excludeInstanceId)
    }

    if (!collision) {
      bestY = y
      break
    }
  }

  return { x, y: bestY, z }
}

export function CanvasPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const [loading, setLoading] = useState(true)

  // Track which instanceId is being moved (for clearing from grid)
  const movingInstanceRef = useRef<number | null>(null)
  const moveOrigPosRef = useRef<Vec3 | null>(null)

  // Track rotation drag state
  const rotatingInstanceRef = useRef<number | null>(null)
  const rotateOrigRotRef = useRef<Vec3 | null>(null)
  const rotateOrigPosRef = useRef<Vec3 | null>(null)
  const rotateCurrRotRef = useRef<Vec3>({ x: 0, y: 0, z: 0 })

  const ROTATION_SENSITIVITY = 0.5 // degrees per pixel

  const handleClick = useCallback((screenX: number, screenY: number) => {
    const renderer = rendererRef.current
    if (!renderer) return

    const canvas = canvasRef.current
    if (!canvas) return

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const items = buildPickItems()
    const hit = pick(screenX, screenY, canvas.width, canvas.height, invVP, items)

    const store = useAppStore.getState()
    if (hit) {
      store.setSelectedInstanceId(hit.instanceId)
      renderer.selectedInstanceId = hit.instanceId
    } else {
      store.setSelectedInstanceId(null)
      renderer.selectedInstanceId = null
    }
    // Refresh instances to update highlight
    renderer.updateInstances(store.placements, store.cargoDefs)
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMoveStart = useCallback((_screenX: number, _screenY: number) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const store = useAppStore.getState()
    const selectedId = store.selectedInstanceId
    if (selectedId === null) return

    const placement = store.placements.find((p) => p.instanceId === selectedId)
    if (!placement) return
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    // Save original position and remove from grid temporarily
    movingInstanceRef.current = selectedId
    moveOrigPosRef.current = { ...placement.positionCm }
    const grid = getVoxelGrid()
    grid.clearObject(selectedId)

    // Show ghost at current position
    const pos = placement.positionCm
    const rot = placement.rotationDeg
    const validity = getGhostValidity(pos, def.widthCm, def.heightCm, def.depthCm, rot, selectedId, def.blocks)
    renderer.updateGhost(pos, def.widthCm, def.heightCm, def.depthCm, validity, rot, def.blocks)
  }, [])

  const handleMove = useCallback((screenX: number, screenY: number) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const canvas = canvasRef.current
    if (!canvas) return

    const movingId = movingInstanceRef.current
    if (movingId === null) return

    const store = useAppStore.getState()
    const placement = store.placements.find((p) => p.instanceId === movingId)
    if (!placement) return
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    const rot = placement.rotationDeg
    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)
    if (!floorHit) return

    const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, rot, movingId, def.blocks)
    const validity = getGhostValidity(snapped, def.widthCm, def.heightCm, def.depthCm, rot, movingId, def.blocks)
    renderer.updateGhost(snapped, def.widthCm, def.heightCm, def.depthCm, validity, rot, def.blocks)
  }, [])

  const handleMoveEnd = useCallback((screenX: number, screenY: number) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const canvas = canvasRef.current
    if (!canvas) return

    const movingId = movingInstanceRef.current
    const origPos = moveOrigPosRef.current
    if (movingId === null || !origPos) return

    const store = useAppStore.getState()
    const placement = store.placements.find((p) => p.instanceId === movingId)
    if (!placement) {
      movingInstanceRef.current = null
      moveOrigPosRef.current = null
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
      return
    }
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) {
      // Restore grid
      const grid = getVoxelGrid()
      const x0 = Math.round(origPos.x)
      const y0 = Math.round(origPos.y)
      const z0 = Math.round(origPos.z)
      grid.fillBox(x0, y0, z0, x0 + 1, y0 + 1, z0 + 1, movingId)
      movingInstanceRef.current = null
      moveOrigPosRef.current = null
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
      return
    }

    const rot = placement.rotationDeg
    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)

    let newPos = origPos
    if (floorHit) {
      const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, rot, movingId, def.blocks)
      if (useAppStore.getState().forceMode
        ? isInBounds(snapped, def.widthCm, def.heightCm, def.depthCm, rot, def.blocks)
        : isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm, rot, movingId, def.blocks)) {
        newPos = snapped
      }
    }

    // Restore the grid at original position first (moveCargo will handle the rest)
    const grid = getVoxelGrid()
    const result = def.blocks
      ? voxelizeComposite(def.blocks, origPos, rot)
      : voxelize(def.widthCm, def.heightCm, def.depthCm, origPos, rot)
    if (result.usesFastPath) {
      const { min, max } = result.aabb
      grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, movingId)
    } else {
      grid.fillVoxels(result.voxels, movingId)
    }

    if (newPos !== origPos) {
      store.moveCargo(movingId, newPos)
    }

    movingInstanceRef.current = null
    moveOrigPosRef.current = null
    renderer.updateGhost(null, 0, 0, 0, 'invalid')
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRotateStart = useCallback((_screenX: number, _screenY: number) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const store = useAppStore.getState()
    const selectedId = store.selectedInstanceId
    if (selectedId === null) return

    const placement = store.placements.find((p) => p.instanceId === selectedId)
    if (!placement) return
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    // Save original rotation and position, remove from grid temporarily
    rotatingInstanceRef.current = selectedId
    rotateOrigRotRef.current = { ...placement.rotationDeg }
    rotateOrigPosRef.current = { ...placement.positionCm }
    rotateCurrRotRef.current = { ...placement.rotationDeg }
    const grid = getVoxelGrid()
    grid.clearObject(selectedId)

    // Show ghost at current position/rotation
    const pos = placement.positionCm
    const rot = placement.rotationDeg
    const validity = getGhostValidity(pos, def.widthCm, def.heightCm, def.depthCm, rot, selectedId, def.blocks)
    renderer.updateGhost(pos, def.widthCm, def.heightCm, def.depthCm, validity, rot, def.blocks)
  }, [])

  const handleRotateDrag = useCallback((dx: number, dy: number) => {
    const renderer = rendererRef.current
    if (!renderer) return

    const rotatingId = rotatingInstanceRef.current
    const origPos = rotateOrigPosRef.current
    if (rotatingId === null || !origPos) return

    const store = useAppStore.getState()
    const placement = store.placements.find((p) => p.instanceId === rotatingId)
    if (!placement) return
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) return

    // Accumulate rotation: horizontal → Y axis, vertical → X axis
    const curr = rotateCurrRotRef.current
    curr.y += dx * ROTATION_SENSITIVITY
    curr.x -= dy * ROTATION_SENSITIVITY

    const validity = getGhostValidity(origPos, def.widthCm, def.heightCm, def.depthCm, curr, rotatingId, def.blocks)
    renderer.updateGhost(origPos, def.widthCm, def.heightCm, def.depthCm, validity, curr, def.blocks)
  }, [])

  const handleRotateEnd = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const rotatingId = rotatingInstanceRef.current
    const origRot = rotateOrigRotRef.current
    const origPos = rotateOrigPosRef.current
    if (rotatingId === null || !origRot || !origPos) return

    const store = useAppStore.getState()
    const placement = store.placements.find((p) => p.instanceId === rotatingId)
    if (!placement) {
      rotatingInstanceRef.current = null
      rotateOrigRotRef.current = null
      rotateOrigPosRef.current = null
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
      return
    }
    const def = store.cargoDefs.find((d) => d.id === placement.cargoDefId)
    if (!def) {
      rotatingInstanceRef.current = null
      rotateOrigRotRef.current = null
      rotateOrigPosRef.current = null
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
      return
    }

    const currRot = rotateCurrRotRef.current

    // Restore the grid at original position/rotation first
    const grid = getVoxelGrid()
    const restoreResult = def.blocks
      ? voxelizeComposite(def.blocks, origPos, origRot)
      : voxelize(def.widthCm, def.heightCm, def.depthCm, origPos, origRot)
    if (restoreResult.usesFastPath) {
      const { min, max } = restoreResult.aabb
      grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, rotatingId)
    } else {
      grid.fillVoxels(restoreResult.voxels, rotatingId)
    }

    // Check if rotation actually changed
    const rotChanged = currRot.x !== origRot.x || currRot.y !== origRot.y || currRot.z !== origRot.z
    if (rotChanged) {
      store.rotateCargo(rotatingId, currRot)
    }

    rotatingInstanceRef.current = null
    rotateOrigRotRef.current = null
    rotateOrigPosRef.current = null
    renderer.updateGhost(null, 0, 0, 0, 'invalid')
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let unsub: (() => void) | undefined

    const init = async () => {
      const renderer = new Renderer()
      await renderer.init(canvas)
      if (disposed) { renderer.dispose(); return }
      setLoading(false)

      rendererRef.current = renderer

      // Initialize label renderer
      if (containerRef.current) {
        renderer.initLabels(containerRef.current)
        renderer.initAxisIndicator(containerRef.current)
      }

      // Set up click, move, and rotate callbacks
      renderer.cameraController.onClick = handleClick
      renderer.cameraController.onMoveStart = handleMoveStart
      renderer.cameraController.onMove = handleMove
      renderer.cameraController.onMoveEnd = handleMoveEnd
      renderer.cameraController.onRotateStart = handleRotateStart
      renderer.cameraController.onRotateDrag = handleRotateDrag
      renderer.cameraController.onRotateEnd = handleRotateEnd

      // Reset cameraView to 'free' when user orbits, cancel any transition
      renderer.cameraController.onOrbitStart = () => {
        renderer.cancelTransition()
        useAppStore.getState().setCameraView('free')
      }

      // Set initial size
      const div = containerRef.current
      if (div) {
        const rect = div.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const w = Math.floor(rect.width * dpr)
        const h = Math.floor(rect.height * dpr)
        if (w > 0 && h > 0) {
          canvas.width = w
          canvas.height = h
          renderer.resize(w, h)
        }
      }

      // Update container geometry
      const storeState = useAppStore.getState()
      renderer.updateContainer(
        storeState.container.widthCm,
        storeState.container.heightCm,
        storeState.container.depthCm,
      )

      // Subscribe to store changes
      let prevContainerKey = `${storeState.container.widthCm}-${storeState.container.heightCm}-${storeState.container.depthCm}`

      unsub = useAppStore.subscribe((state, prevState) => {
        if (state.renderVersion !== prevState.renderVersion) {
          renderer.selectedInstanceId = state.selectedInstanceId
          renderer.updateInstances(state.placements, state.cargoDefs)

          // Check if container changed
          const containerKey = `${state.container.widthCm}-${state.container.heightCm}-${state.container.depthCm}`
          if (containerKey !== prevContainerKey) {
            prevContainerKey = containerKey
            renderer.updateContainer(
              state.container.widthCm,
              state.container.heightCm,
              state.container.depthCm,
            )
          }

          // Sync showGrid
          renderer.showGrid = state.showGrid

          // Update labels
          renderer.updateLabels(state.placements, state.cargoDefs)
        }

        // Update selection highlight even if renderVersion didn't change
        if (state.selectedInstanceId !== prevState.selectedInstanceId) {
          renderer.selectedInstanceId = state.selectedInstanceId
          renderer.updateInstances(state.placements, state.cargoDefs)

          // Update moveEnabled on camera controller based on selection
          const hasSelection = state.selectedInstanceId !== null
          renderer.cameraController.setMoveEnabled(hasSelection)
        }

        // Camera view change — animate to preset
        if (state.cameraView !== prevState.cameraView && state.cameraView !== 'free') {
          const preset = CAMERA_PRESETS[state.cameraView]
          if (preset) {
            renderer.animateToPreset(preset.theta, preset.phi)
          }
        }

        // showGrid change (even if renderVersion didn't change, e.g. toggle only)
        if (state.showGrid !== prevState.showGrid) {
          renderer.showGrid = state.showGrid
        }

        // showLabels change
        if (state.showLabels !== prevState.showLabels) {
          renderer.showLabels = state.showLabels
          if (state.showLabels) {
            renderer.updateLabels(state.placements, state.cargoDefs)
          } else {
            renderer.updateLabels([], [])
          }
        }
      })

      renderer.startRenderLoop()
    }

    init()

    return () => {
      disposed = true
      unsub?.()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [handleClick, handleMoveStart, handleMove, handleMoveEnd, handleRotateStart, handleRotateDrag, handleRotateEnd])

  // ResizeObserver
  useEffect(() => {
    const div = containerRef.current
    const canvas = canvasRef.current
    if (!div || !canvas) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const dpr = window.devicePixelRatio || 1
        const w = Math.floor(width * dpr)
        const h = Math.floor(height * dpr)
        if (w > 0 && h > 0) {
          canvas.width = w
          canvas.height = h
          rendererRef.current?.resize(w, h)
        }
      }
    })
    observer.observe(div)
    return () => observer.disconnect()
  }, [])

  // WASD / Arrow key pan
  const pressedKeysRef = useRef(new Set<string>())
  const PAN_SPEED = 3

  useEffect(() => {
    const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (PAN_KEYS.has(e.key)) {
        e.preventDefault()
        pressedKeysRef.current.add(e.key)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.key)
    }
    const handleBlur = () => {
      pressedKeysRef.current.clear()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    let rafId = 0
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const keys = pressedKeysRef.current
      if (keys.size === 0) return
      const renderer = rendererRef.current
      if (!renderer) return

      let dx = 0
      let dy = 0
      if (keys.has('a') || keys.has('ArrowLeft'))  dx += PAN_SPEED
      if (keys.has('d') || keys.has('ArrowRight')) dx -= PAN_SPEED
      if (keys.has('w') || keys.has('ArrowUp'))    dy += PAN_SPEED
      if (keys.has('s') || keys.has('ArrowDown'))  dy -= PAN_SPEED
      if (dx !== 0 || dy !== 0) {
        renderer.camera.pan(dx, dy)
      }
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      cancelAnimationFrame(rafId)
    }
  }, [])

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return

    const cargoDefId = e.dataTransfer.types.includes('text/plain') ? 'pending' : null
    if (!cargoDefId) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const screenX = (e.clientX - rect.left) * dpr
    const screenY = (e.clientY - rect.top) * dpr

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)

    // Try to get the cargo def from drag state
    const store = useAppStore.getState()
    const dragState = store.dragState
    if (!dragState) return

    const def = store.cargoDefs.find((d) => d.id === dragState.cargoDefId)
    if (!def || !floorHit) {
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
      return
    }

    const rot = dragState.currentRotation
    const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, rot, undefined, def.blocks)
    const validity = getGhostValidity(snapped, def.widthCm, def.heightCm, def.depthCm, rot, undefined, def.blocks)
    renderer.updateGhost(snapped, def.widthCm, def.heightCm, def.depthCm, validity, rot, def.blocks)
    store.setDragState({ ...dragState, currentPosition: snapped, isValid: validity !== 'invalid' })
  }, [])

  const handleDragLeave = useCallback(() => {
    const renderer = rendererRef.current
    if (renderer) {
      renderer.updateGhost(null, 0, 0, 0, 'invalid')
    }
    useAppStore.getState().setDragState(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return

    const cargoDefId = e.dataTransfer.getData('text/plain')
    if (!cargoDefId) return

    const store = useAppStore.getState()
    const def = store.cargoDefs.find((d) => d.id === cargoDefId)
    if (!def) return

    const dragState = store.dragState
    const rot = dragState?.currentRotation ?? { x: 0, y: 0, z: 0 }

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const screenX = (e.clientX - rect.left) * dpr
    const screenY = (e.clientY - rect.top) * dpr

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)

    if (floorHit) {
      const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, rot, undefined, def.blocks)
      if (useAppStore.getState().forceMode
        ? isInBounds(snapped, def.widthCm, def.heightCm, def.depthCm, rot, def.blocks)
        : isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm, rot, undefined, def.blocks)) {
        store.placeCargo(cargoDefId, snapped, rot)
      }
    }

    renderer.updateGhost(null, 0, 0, 0, 'invalid')
    store.setDragState(null)
  }, [])

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      {loading && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  )
}
