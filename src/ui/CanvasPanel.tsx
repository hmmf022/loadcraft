import { useRef, useEffect } from 'react'
import { Renderer } from '../renderer/Renderer'
import { useAppStore } from '../state/store'
import styles from './CanvasPanel.module.css'

export function CanvasPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let unsub: (() => void) | undefined

    const init = async () => {
      try {
        const renderer = new Renderer()
        await renderer.init(canvas)
        if (disposed) { renderer.dispose(); return }

        rendererRef.current = renderer

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
        })

        renderer.startRenderLoop()
      } catch (e) {
        console.error('WebGPU initialization failed:', e)
      }
    }

    init()

    return () => {
      disposed = true
      unsub?.()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

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

  return (
    <div ref={containerRef} className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  )
}
