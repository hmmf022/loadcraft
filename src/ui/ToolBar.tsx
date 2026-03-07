import { useRef } from 'react'
import { useAppStore } from '../state/store'
import { validateSaveData } from '../core/SaveLoad'
import { useTranslation } from '../i18n'
import styles from './ToolBar.module.css'

const SNAP_SIZES = [1, 5, 10]

export function ToolBar() {
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const showGrid = useAppStore((s) => s.showGrid)
  const toggleGrid = useAppStore((s) => s.toggleGrid)
  const showLabels = useAppStore((s) => s.showLabels)
  const toggleLabels = useAppStore((s) => s.toggleLabels)
  const forceMode = useAppStore((s) => s.forceMode)
  const toggleForceMode = useAppStore((s) => s.toggleForceMode)
  const checkInterference = useAppStore((s) => s.checkInterference)
  const snapToGrid = useAppStore((s) => s.snapToGrid)
  const toggleSnap = useAppStore((s) => s.toggleSnap)
  const gridSizeCm = useAppStore((s) => s.gridSizeCm)
  const setGridSize = useAppStore((s) => s.setGridSize)
  const saveState = useAppStore((s) => s.saveState)
  const loadState = useAppStore((s) => s.loadState)
  const addToast = useAppStore((s) => s.addToast)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t, language, setLanguage } = useTranslation()

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
          addToast(t.toasts.loaded, 'success')
        } else {
          addToast(t.toasts.invalidSaveFile, 'error')
        }
      } catch {
        addToast(t.toasts.loadError, 'error')
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
      <button className={styles.button} onClick={() => { saveState(); addToast(t.toasts.saved, 'success') }}>
        {t.toolbar.save}
      </button>
      <button className={styles.button} onClick={handleLoad}>
        {t.toolbar.load}
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
      <button
        className={`${styles.button} ${showLabels ? styles.active : ''}`}
        onClick={toggleLabels}
      >
        Labels
      </button>
      <button
        className={`${styles.button} ${forceMode ? styles.forceActive : ''}`}
        onClick={toggleForceMode}
      >
        {t.toolbar.force}
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
      <button className={styles.button} onClick={checkInterference}>
        {t.toolbar.check}
      </button>
      <div className={styles.separator} />
      <a
        href="/editor.html"
        target="_blank"
        rel="noopener noreferrer"
        className={styles.button}
      >
        {t.toolbar.editor}
      </a>
      <button
        className={styles.button}
        onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}
      >
        {t.common.langLabel}
      </button>
    </div>
  )
}
