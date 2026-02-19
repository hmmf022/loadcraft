import { useRef, useEffect, useCallback, useState, useInsertionEffect } from 'react'
import { EditorRenderer } from '../renderer/EditorRenderer'
import { getPlacementTarget, getBlockTarget } from '../renderer/EditorRaycaster'
import { blockKey, DISPLAY_SCALE } from '../state/types'
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
      const target = getPlacementTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE, s.maxCells,
      )
      if (target) {
        dispatchRef.current({ type: 'PLACE_BLOCK', ...target, color: s.currentColor })
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
      const target = getPlacementTarget(
        screenX, screenY, canvas.width, canvas.height, invVP,
        s.blocks, DISPLAY_SCALE, s.maxCells,
      )
      if (target) {
        const key = blockKey(target.x, target.y, target.z)
        const occupied = s.blocks.has(key)
        renderer.updateGhostBlock(
          target, DISPLAY_SCALE, s.currentColor,
          occupied ? 'invalid' : 'valid',
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
      {loading && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  )
}
