import { useRef } from 'react'
import { useAppStore } from '../state/store'
import { validateSaveData } from '../core/SaveLoad'
import styles from './ToolBar.module.css'

const SNAP_SIZES = [1, 5, 10]

export function ToolBar() {
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const showGrid = useAppStore((s) => s.showGrid)
  const toggleGrid = useAppStore((s) => s.toggleGrid)
  const snapToGrid = useAppStore((s) => s.snapToGrid)
  const toggleSnap = useAppStore((s) => s.toggleSnap)
  const gridSizeCm = useAppStore((s) => s.gridSizeCm)
  const setGridSize = useAppStore((s) => s.setGridSize)
  const saveState = useAppStore((s) => s.saveState)
  const loadState = useAppStore((s) => s.loadState)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLoad = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (validateSaveData(data)) {
          loadState(data)
        } else {
          alert('無効なセーブファイルです。')
        }
      } catch {
        alert('ファイルの読み込みに失敗しました。')
      }
    }
    reader.readAsText(file)

    // Reset so the same file can be loaded again
    e.target.value = ''
  }

  return (
    <div className={styles.toolbar}>
      <button className={styles.button} disabled={!canUndo} onClick={undo}>
        Undo
      </button>
      <button className={styles.button} disabled={!canRedo} onClick={redo}>
        Redo
      </button>
      <div className={styles.separator} />
      <button className={styles.button} onClick={saveState}>
        Save
      </button>
      <button className={styles.button} onClick={handleLoad}>
        Load
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div className={styles.separator} />
      <button
        className={`${styles.button} ${showGrid ? styles.active : ''}`}
        onClick={toggleGrid}
      >
        Grid
      </button>
      <button
        className={`${styles.button} ${snapToGrid ? styles.active : ''}`}
        onClick={toggleSnap}
      >
        Snap
      </button>
      {snapToGrid && (
        <select
          className={styles.snapSelect}
          value={gridSizeCm}
          onChange={(e) => setGridSize(parseInt(e.target.value))}
        >
          {SNAP_SIZES.map((s) => (
            <option key={s} value={s}>{s}cm</option>
          ))}
        </select>
      )}
    </div>
  )
}
