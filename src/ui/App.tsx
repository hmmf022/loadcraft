import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { CanvasPanel } from './CanvasPanel'
import { useAppStore } from '../state/store'
import styles from './App.module.css'

export function App() {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        useAppStore.getState().undo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      } else if (e.key === 'Delete') {
        const selected = useAppStore.getState().selectedInstanceId
        if (selected !== null) {
          useAppStore.getState().removePlacement(selected)
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
        <CanvasPanel />
      </div>
    </div>
  )
}
