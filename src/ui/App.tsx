import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { CanvasPanel } from './CanvasPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { WebGPUFallback } from './WebGPUFallback'
import { ToolBar } from './ToolBar'
import { HelpOverlay } from './HelpOverlay'
import { useAppStore } from '../state/store'
import styles from './App.module.css'

export function App() {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        useAppStore.getState().redo()
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        useAppStore.getState().undo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Avoid intercepting text input
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

        const selected = useAppStore.getState().selectedInstanceId
        if (selected !== null) {
          e.preventDefault()
          useAppStore.getState().removePlacement(selected)
        }
      } else if (e.key === 'Escape') {
        useAppStore.getState().setSelectedInstanceId(null)
        useAppStore.getState().setDragState(null)
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
      </div>
    </div>
  )
}
