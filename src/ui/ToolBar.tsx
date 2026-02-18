import { useAppStore } from '../state/store'
import styles from './ToolBar.module.css'

export function ToolBar() {
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)

  return (
    <div className={styles.toolbar}>
      <button className={styles.button} disabled={!canUndo} onClick={undo}>
        Undo
      </button>
      <button className={styles.button} disabled={!canRedo} onClick={redo}>
        Redo
      </button>
      <div className={styles.separator} />
      <button className={styles.button} disabled title="Phase 4">
        Save
      </button>
      <button className={styles.button} disabled title="Phase 4">
        Load
      </button>
      <div className={styles.separator} />
      <button className={styles.button} disabled title="Phase 3">
        Grid
      </button>
      <button className={styles.button} disabled title="Phase 3">
        Snap
      </button>
    </div>
  )
}
