import { useReducer, useRef, useCallback, useState } from 'react'
import { editorReducer } from './state/editorReducer'
import { EditorHistory } from './state/history'
import { initialEditorState } from './state/types'
import type { EditorAction } from './state/types'
import { EditorCanvas } from './ui/EditorCanvas'
import { EditorToolBar } from './ui/EditorToolBar'
import { ColorPalette } from './ui/ColorPalette'
import { ShapeInfoPanel } from './ui/ShapeInfoPanel'
import { ExportDialog } from './ui/ExportDialog'
import styles from './EditorApp.module.css'

export function EditorApp() {
  const [state, rawDispatch] = useReducer(editorReducer, initialEditorState)
  const historyRef = useRef(new EditorHistory())
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncHistory = useCallback(() => {
    const history = historyRef.current
    setCanUndo(history.canUndo)
    setCanRedo(history.canRedo)
  }, [])

  // Wrap dispatch to record history for block-modifying actions
  const dispatch = useCallback((action: EditorAction) => {
    const history = historyRef.current

    if (action.type === 'UNDO') {
      const blocks = history.undo()
      if (blocks) {
        rawDispatch({ type: 'RESTORE', blocks })
      }
      syncHistory()
      return
    }

    if (action.type === 'REDO') {
      const blocks = history.redo()
      if (blocks) {
        rawDispatch({ type: 'RESTORE', blocks })
      }
      syncHistory()
      return
    }

    // For block-modifying actions, capture before state
    const isBlockAction = action.type === 'PLACE_BLOCK' || action.type === 'REMOVE_BLOCK' ||
      action.type === 'PAINT_BLOCK' || action.type === 'CLEAR_ALL'

    if (isBlockAction) {
      const beforeBlocks = new Map(state.blocks)
      rawDispatch(action)
      // Compute the "after" state via reducer directly
      const afterState = editorReducer(state, action)
      if (afterState.blocks !== state.blocks) {
        history.push({
          before: beforeBlocks,
          after: new Map(afterState.blocks),
        })
        syncHistory()
      }
      return
    }

    rawDispatch(action)
  }, [state, syncHistory])

  return (
    <div className={styles.layout}>
      <div className={styles.sidebar}>
        <ShapeInfoPanel state={state} dispatch={dispatch} />
        <div className={styles.separator} />
        <ColorPalette state={state} dispatch={dispatch} />
        <div className={styles.separator} />
        <ExportDialog state={state} dispatch={dispatch} />
        <div className={styles.sidebarFooter}>
          <a href="/index.html" target="_blank" rel="noopener noreferrer" className={styles.navLink}>
            コンテナシミュレータを開く &rarr;
          </a>
        </div>
      </div>
      <div className={styles.canvasArea}>
        <EditorCanvas state={state} dispatch={dispatch} />
        <EditorToolBar state={state} dispatch={dispatch} canUndo={canUndo} canRedo={canRedo} />
      </div>
    </div>
  )
}
