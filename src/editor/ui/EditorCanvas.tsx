import { useRef, useEffect, useCallback, useState, useInsertionEffect } from 'react'
import { EditorRenderer } from '../renderer/EditorRenderer'
import { getPlacementTarget, getBlockTarget } from '../renderer/EditorRaycaster'
import { DISPLAY_SCALE, blocksOverlap } from '../state/types'
import type { EditorState, EditorAction } from '../state/types'
import styles from './EditorCanvas.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

const VIEW_PRESETS = [
  { name: 'Front', theta: 0,          phi: Math.PI / 2, targetYFactor: 0.15 },
  { name: 'Right', theta: Math.PI / 2, phi: Math.PI / 2, targetYFactor: 0.15 },
  { name: 'Top',   theta: 0,          phi: 0.01,        targetYFactor: 0 },
  { name: 'Iso',   theta: Math.PI / 4, phi: Math.PI / 4, targetYFactor: 0.5 },
] as const

export function EditorCanvas({ state, dispatch }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<EditorRenderer | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveView] = useState('Iso')

  // Keep refs to latest state for callbacks
  const stateRef = useRef(state)
  const dispatchRef = useRef(dispatch)
  useInsertionEffect(() => {
    stateRef.current = state
    dispatchRef.current = dispatch
  })

  const handleClick = useCallback((screenX: number, screenY: number) => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return

    const s = stateRef.current
    const invVP = renderer.camera.getInverseViewProjMatrix()

    if (s.currentTool === 'place') {
      const brushSize = { w: s.brushW, h: s.brushH, d: s.brushD }
      const target = getPlacementTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE, s.maxCells, brushSize,
      )
      if (target) {
        dispatchRef.current({ type: 'PLACE_BLOCK', ...target, ...brushSize, color: s.currentColor })
      }
    } else if (s.currentTool === 'erase') {
      const target = getBlockTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE,
      )
      if (target) {
        dispatchRef.current({ type: 'REMOVE_BLOCK', ...target })
      }
    } else if (s.currentTool === 'paint') {
      const target = getBlockTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE,
      )
      if (target) {
        dispatchRef.current({ type: 'PAINT_BLOCK', ...target, color: s.currentColor })
      }
    }
  }, [])

  const handleHover = useCallback((screenX: number, screenY: number) => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return

    const s = stateRef.current
    const invVP = renderer.camera.getInverseViewProjMatrix()

    if (s.currentTool === 'place') {
      const brushSize = { w: s.brushW, h: s.brushH, d: s.brushD }
      const target = getPlacementTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE, s.maxCells, brushSize,
      )
      if (target) {
        const candidate = { x: target.x, y: target.y, z: target.z, ...brushSize, color: '' }
        let occupied = false
        for (const existing of s.blocks.values()) {
          if (blocksOverlap(candidate, existing)) {
            occupied = true
            break
          }
        }
        renderer.updateGhostBlock(
          target, DISPLAY_SCALE, s.currentColor,
          occupied ? 'invalid' : 'valid',
          brushSize,
        )
      } else {
        renderer.updateGhostBlock(null, DISPLAY_SCALE, s.currentColor, 'valid')
      }
    } else {
      renderer.updateGhostBlock(null, DISPLAY_SCALE, s.currentColor, 'valid')
    }
  }, [])

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false

    const init = async () => {
      const renderer = new EditorRenderer()
      await renderer.init(canvas)
      if (disposed) { renderer.dispose(); return }
      setLoading(false)

      rendererRef.current = renderer

      renderer.cameraController.onClick = handleClick
      renderer.cameraController.onHover = handleHover
      renderer.cameraController.onOrbitStart = () => {
        renderer.cancelTransition()
        setActiveView('free')
      }

      // Set initial size
      const div = containerRef.current
      if (div) {
        const rect = div.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const w = Math.floor(rect.width * dpr)
        const h = Math.floor(rect.height * dpr)
        if (w > 0 && h > 0) {
          renderer.resize(w, h)
        }
      }

      // Set initial boundary
      renderer.updateBoundary(DISPLAY_SCALE, stateRef.current.maxCells)

      renderer.startRenderLoop()
    }

    init()

    return () => {
      disposed = true
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [handleClick, handleHover])

  // Sync blocks to renderer when state changes
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.updateBlocks(state.blocks, DISPLAY_SCALE)
  }, [state.blocks])

  // Sync boundary when gridSize changes
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.updateBoundary(DISPLAY_SCALE, state.maxCells)
  }, [state.maxCells])

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
          rendererRef.current?.resize(w, h)
        }
      }
    })
    observer.observe(div)
    return () => observer.disconnect()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.ctrlKey && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        dispatchRef.current({ type: 'UNDO' })
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        dispatchRef.current({ type: 'UNDO' })
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        dispatchRef.current({ type: 'REDO' })
      } else if (!isTextInput && !e.ctrlKey) {
        if (e.key === '1') {
          e.preventDefault()
          dispatchRef.current({ type: 'SET_TOOL', tool: 'place' })
        } else if (e.key === '2') {
          e.preventDefault()
          dispatchRef.current({ type: 'SET_TOOL', tool: 'erase' })
        } else if (e.key === '3') {
          e.preventDefault()
          dispatchRef.current({ type: 'SET_TOOL', tool: 'paint' })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Keyboard & D-pad pan
  const pressedKeysRef = useRef(new Set<string>())
  const PAN_SPEED = 3

  useEffect(() => {
    const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (isTextInput) return
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

  const panPointerDown = useCallback((dir: string) => {
    pressedKeysRef.current.add(dir)
  }, [])
  const panPointerUp = useCallback((dir: string) => {
    pressedKeysRef.current.delete(dir)
  }, [])

  const handleViewPreset = (preset: typeof VIEW_PRESETS[number]) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const size = DISPLAY_SCALE * stateRef.current.maxCells
    const center = size / 2
    const target = { x: center, y: size * preset.targetYFactor, z: center }
    renderer.animateToPreset(preset.theta, preset.phi, target)
    setActiveView(preset.name)
  }

  return (
    <div ref={containerRef} className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {!loading && (
        <div className={styles.viewButtons}>
          {VIEW_PRESETS.map((p) => (
            <button
              key={p.name}
              className={`${styles.viewButton} ${activeView === p.name ? styles.viewButtonActive : ''}`}
              onClick={() => handleViewPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {!loading && (
        <div className={styles.panPanel}>
          <div className={styles.panGrid}>
            <button
              className={styles.panBtn}
              style={{ gridArea: 'up' }}
              onPointerDown={() => panPointerDown('ArrowUp')}
              onPointerUp={() => panPointerUp('ArrowUp')}
              onPointerLeave={() => panPointerUp('ArrowUp')}
            >&#9650;</button>
            <button
              className={styles.panBtn}
              style={{ gridArea: 'left' }}
              onPointerDown={() => panPointerDown('ArrowLeft')}
              onPointerUp={() => panPointerUp('ArrowLeft')}
              onPointerLeave={() => panPointerUp('ArrowLeft')}
            >&#9664;</button>
            <button
              className={styles.panBtn}
              style={{ gridArea: 'right' }}
              onPointerDown={() => panPointerDown('ArrowRight')}
              onPointerUp={() => panPointerUp('ArrowRight')}
              onPointerLeave={() => panPointerUp('ArrowRight')}
            >&#9654;</button>
            <button
              className={styles.panBtn}
              style={{ gridArea: 'down' }}
              onPointerDown={() => panPointerDown('ArrowDown')}
              onPointerUp={() => panPointerUp('ArrowDown')}
              onPointerLeave={() => panPointerUp('ArrowDown')}
            >&#9660;</button>
          </div>
        </div>
      )}
      {loading && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  )
}
