import type { EditorState, EditorAction } from '../state/types'
import styles from './EditorToolBar.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
  canUndo: boolean
  canRedo: boolean
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function EditorToolBar({ state, dispatch, canUndo, canRedo, theme, onToggleTheme }: Props) {

  return (
    <div className={styles.toolbar}>
      <button
        className={`${styles.button} ${state.currentTool === 'place' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'place' })}
        title="配置 (1)"
      >
        Place
      </button>
      <button
        className={`${styles.button} ${state.currentTool === 'erase' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'erase' })}
        title="削除 (2)"
      >
        Erase
      </button>
      <button
        className={`${styles.button} ${state.currentTool === 'paint' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'paint' })}
        title="塗替 (3)"
      >
        Paint
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        disabled={!canUndo}
        onClick={() => dispatch({ type: 'UNDO' })}
        title="元に戻す (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        className={styles.button}
        disabled={!canRedo}
        onClick={() => dispatch({ type: 'REDO' })}
        title="やり直し (Ctrl+Y)"
      >
        Redo
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        disabled={state.blocks.size === 0}
        onClick={() => {
          if (state.blocks.size > 0 && confirm('全ブロックをクリアしますか？')) {
            dispatch({ type: 'CLEAR_ALL' })
          }
        }}
        title="全クリア"
      >
        Clear
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        onClick={onToggleTheme}
        title="テーマ切替"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </div>
  )
}
