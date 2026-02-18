import { useRef, useEffect, useCallback } from 'react'
import { Renderer } from '../renderer/Renderer'
import { useAppStore } from '../state/store'
import { pick, screenToRay, intersectRayPlane } from '../renderer/Raycaster'
import type { PickItem } from '../renderer/Raycaster'
import type { Vec3 } from '../core/types'
import { getVoxelGrid } from '../core/voxelGridSingleton'
import styles from './CanvasPanel.module.css'

/** Build AABB pick items from current placements */
function buildPickItems(): PickItem[] {
  const state = useAppStore.getState()
  const defMap = new Map<string, { widthCm: number; heightCm: number; depthCm: number }>()
  for (const d of state.cargoDefs) {
    defMap.set(d.id, d)
  }
  const items: PickItem[] = []
  for (const p of state.placements) {
    const def = defMap.get(p.cargoDefId)
    if (!def) continue
    items.push({
      instanceId: p.instanceId,
      aabb: {
        min: { x: p.positionCm.x, y: p.positionCm.y, z: p.positionCm.z },
        max: {
          x: p.positionCm.x + def.widthCm,
          y: p.positionCm.y + def.heightCm,
          z: p.positionCm.z + def.depthCm,
        },
      },
    })
  }
  return items
}

/** Check if a position is valid for placing cargo */
function isValidPosition(pos: Vec3, widthCm: number, heightCm: number, depthCm: number, excludeInstanceId?: number): boolean {
  const grid = getVoxelGrid()
  const x0 = Math.round(pos.x)
  const y0 = Math.round(pos.y)
  const z0 = Math.round(pos.z)
  const x1 = x0 + widthCm - 1
  const y1 = y0 + heightCm - 1
  const z1 = z0 + depthCm - 1

  // Bounds check
  if (x0 < 0 || y0 < 0 || z0 < 0) return false
  if (x1 >= grid.width || y1 >= grid.height || z1 >= grid.depth) return false

  // Collision check using voxels
  const voxels: Vec3[] = []
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        voxels.push({ x, y, z })
      }
    }
  }
  return !grid.hasCollision(voxels, excludeInstanceId)
}

/**
 * Snap position: determine X,Z from hit point, then find the lowest valid Y
 * (gravity stacking — cargo drops down and lands on top of existing items)
 */
function snapPosition(hitPoint: Vec3, widthCm: number, heightCm: number, depthCm: number, excludeInstanceId?: number): Vec3 {
  const state = useAppStore.getState()
  const cw = state.container.widthCm
  const ch = state.container.heightCm
  const cd = state.container.depthCm

  let x = Math.round(hitPoint.x - widthCm / 2)
  let z = Math.round(hitPoint.z - depthCm / 2)

  // Clamp to container bounds
  x = Math.max(0, Math.min(x, cw - widthCm))
  z = Math.max(0, Math.min(z, cd - depthCm))

  // Find the lowest valid Y by scanning the VoxelGrid from bottom up
  const grid = getVoxelGrid()
  let bestY = 0

  for (let y = 0; y + heightCm <= ch; y++) {
    // Check if this Y level has a collision
    let collision = false
    for (let vz = z; vz < z + depthCm && !collision; vz++) {
      for (let vx = x; vx < x + widthCm && !collision; vx++) {
        const val = grid.get(vx, y, vz)
        if (val !== 0 && val !== excludeInstanceId) {
          collision = true
        }
      }
    }
    if (!collision) {
      // Check if the entire box fits starting from this Y
      let boxFits = true
      for (let vy = y; vy < y + heightCm && boxFits; vy++) {
        for (let vz = z; vz < z + depthCm && boxFits; vz++) {
          for (let vx = x; vx < x + widthCm && boxFits; vx++) {
            const val = grid.get(vx, vy, vz)
            if (val !== 0 && val !== excludeInstanceId) {
              boxFits = false
            }
          }
        }
      }
      if (boxFits) {
        bestY = y
        break
      }
    }
  }

  return { x, y: bestY, z }
}

export function CanvasPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)

  // Track which instanceId is being moved (for clearing from grid)
  const movingInstanceRef = useRef<number | null>(null)
  const moveOrigPosRef = useRef<Vec3 | null>(null)

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
    const valid = isValidPosition(pos, def.widthCm, def.heightCm, def.depthCm, selectedId)
    renderer.updateGhost(pos, def.widthCm, def.heightCm, def.depthCm, valid)
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

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)
    if (!floorHit) return

    const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, movingId)
    const valid = isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm, movingId)
    renderer.updateGhost(snapped, def.widthCm, def.heightCm, def.depthCm, valid)
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
      renderer.updateGhost(null, 0, 0, 0, false)
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
      renderer.updateGhost(null, 0, 0, 0, false)
      return
    }

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)

    let newPos = origPos
    if (floorHit) {
      const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm, movingId)
      if (isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm, movingId)) {
        newPos = snapped
      }
    }

    // Restore the grid at original position first (moveCargo will handle the rest)
    const grid = getVoxelGrid()
    const ox = Math.round(origPos.x)
    const oy = Math.round(origPos.y)
    const oz = Math.round(origPos.z)
    grid.fillBox(ox, oy, oz, ox + def.widthCm - 1, oy + def.heightCm - 1, oz + def.depthCm - 1, movingId)

    if (newPos !== origPos) {
      store.moveCargo(movingId, newPos)
    }

    movingInstanceRef.current = null
    moveOrigPosRef.current = null
    renderer.updateGhost(null, 0, 0, 0, false)
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

      rendererRef.current = renderer

      // Set up click and move callbacks
      renderer.cameraController.onClick = handleClick
      renderer.cameraController.onMoveStart = handleMoveStart
      renderer.cameraController.onMove = handleMove
      renderer.cameraController.onMoveEnd = handleMoveEnd

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
        }

        // Update selection highlight even if renderVersion didn't change
        if (state.selectedInstanceId !== prevState.selectedInstanceId) {
          renderer.selectedInstanceId = state.selectedInstanceId
          renderer.updateInstances(state.placements, state.cargoDefs)

          // Update moveEnabled on camera controller based on selection
          const hasSelection = state.selectedInstanceId !== null
          renderer.cameraController.setMoveEnabled(hasSelection)
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
  }, [handleClick, handleMoveStart, handleMove, handleMoveEnd])

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
      renderer.updateGhost(null, 0, 0, 0, false)
      return
    }

    const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm)
    const valid = isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm)
    renderer.updateGhost(snapped, def.widthCm, def.heightCm, def.depthCm, valid)
    store.setDragState({ ...dragState, currentPosition: snapped, isValid: valid })
  }, [])

  const handleDragLeave = useCallback(() => {
    const renderer = rendererRef.current
    if (renderer) {
      renderer.updateGhost(null, 0, 0, 0, false)
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

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const screenX = (e.clientX - rect.left) * dpr
    const screenY = (e.clientY - rect.top) * dpr

    const invVP = renderer.camera.getInverseViewProjMatrix()
    const ray = screenToRay(screenX, screenY, canvas.width, canvas.height, invVP)
    const floorHit = intersectRayPlane(ray, 0)

    if (floorHit) {
      const snapped = snapPosition(floorHit, def.widthCm, def.heightCm, def.depthCm)
      if (isValidPosition(snapped, def.widthCm, def.heightCm, def.depthCm)) {
        store.placeCargo(cargoDefId, snapped)
      }
    }

    renderer.updateGhost(null, 0, 0, 0, false)
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
    </div>
  )
}
