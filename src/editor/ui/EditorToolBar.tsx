import type { EditorState, EditorAction } from '../state/types'
import { useTranslation } from '../../i18n'
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
  const { t, language, setLanguage } = useTranslation()

  return (
    <div className={styles.toolbar}>
      <button
        className={`${styles.button} ${state.currentTool === 'place' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'place' })}
        title={t.editor.placeTitle}
      >
        {t.editor.place}
      </button>
      <button
        className={`${styles.button} ${state.currentTool === 'erase' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'erase' })}
        title={t.editor.eraseTitle}
      >
        {t.editor.erase}
      </button>
      <button
        className={`${styles.button} ${state.currentTool === 'paint' ? styles.active : ''}`}
        onClick={() => dispatch({ type: 'SET_TOOL', tool: 'paint' })}
        title={t.editor.paintTitle}
      >
        {t.editor.paint}
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        disabled={!canUndo}
        onClick={() => dispatch({ type: 'UNDO' })}
        title={t.editor.undoTitle}
      >
        {t.editor.undo}
      </button>
      <button
        className={styles.button}
        disabled={!canRedo}
        onClick={() => dispatch({ type: 'REDO' })}
        title={t.editor.redoTitle}
      >
        {t.editor.redo}
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        disabled={state.blocks.size === 0}
        onClick={() => {
          if (state.blocks.size > 0 && confirm(t.editor.clearConfirm)) {
            dispatch({ type: 'CLEAR_ALL' })
          }
        }}
        title={t.editor.clearTitle}
      >
        {t.editor.clear}
      </button>
      <div className={styles.separator} />
      <button
        className={styles.button}
        onClick={onToggleTheme}
        title={t.editor.themeToggle}
      >
        {theme === 'dark' ? 'Dark' : 'Light'}
      </button>
      <button
        className={styles.button}
        onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}
      >
        {t.common.langLabel}
      </button>
    </div>
  )
}
