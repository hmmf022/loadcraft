import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { CanvasPanel } from './CanvasPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { WebGPUFallback } from './WebGPUFallback'
import { ToolBar } from './ToolBar'
import { HelpOverlay } from './HelpOverlay'
import { ViewButtons } from './ViewButtons'
import { useAppStore } from '../state/store'
import styles from './App.module.css'

export function App() {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip text inputs
      const target = e.target as HTMLElement
      const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.ctrlKey && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        useAppStore.getState().redo()
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        useAppStore.getState().undo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
        const selected = useAppStore.getState().selectedInstanceId
        if (selected !== null) {
          e.preventDefault()
          useAppStore.getState().removePlacement(selected)
        }
      } else if (e.key === 'Escape') {
        useAppStore.getState().setSelectedInstanceId(null)
        useAppStore.getState().setDragState(null)
      } else if (!isTextInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Rotation shortcuts
        const store = useAppStore.getState()
        const dragState = store.dragState

        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault()
          const delta = e.shiftKey ? -90 : 90
          if (dragState) {
            // D&D中: update dragState rotation
            const rot = dragState.currentRotation
            store.setDragState({ ...dragState, currentRotation: { ...rot, y: rot.y + delta } })
          } else if (store.selectedInstanceId !== null) {
            const placement = store.placements.find((p) => p.instanceId === store.selectedInstanceId)
            if (placement) {
              store.rotateCargo(store.selectedInstanceId, {
                ...placement.rotationDeg,
                y: placement.rotationDeg.y + delta,
              })
            }
          }
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault()
          if (dragState) {
            const rot = dragState.currentRotation
            store.setDragState({ ...dragState, currentRotation: { ...rot, x: rot.x + 90 } })
          } else if (store.selectedInstanceId !== null) {
            const placement = store.placements.find((p) => p.instanceId === store.selectedInstanceId)
            if (placement) {
              store.rotateCargo(store.selectedInstanceId, {
                ...placement.rotationDeg,
                x: placement.rotationDeg.x + 90,
              })
            }
          }
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          if (dragState) {
            const rot = dragState.currentRotation
            store.setDragState({ ...dragState, currentRotation: { ...rot, z: rot.z + 90 } })
          } else if (store.selectedInstanceId !== null) {
            const placement = store.placements.find((p) => p.instanceId === store.selectedInstanceId)
            if (placement) {
              store.rotateCargo(store.selectedInstanceId, {
                ...placement.rotationDeg,
                z: placement.rotationDeg.z + 90,
              })
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className={styles.appLayout}>
      <Sidebar />
      <div className={styles.canvasArea}>
        <ErrorBoundary fallback={<WebGPUFallback />}>
          <CanvasPanel />
        </ErrorBoundary>
        <ToolBar />
        <HelpOverlay />
        <ViewButtons />
      </div>
    </div>
  )
}
