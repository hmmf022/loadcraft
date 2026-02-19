import type { EditorState, EditorAction } from '../state/types'
import styles from './ColorPalette.module.css'

const PRESET_COLORS = [
  '#4a90d9', '#d94a4a', '#4ad97a', '#d9c04a',
  '#9b4ad9', '#4ad9d9', '#d97a4a', '#7a4ad9',
  '#e06090', '#60e0a0', '#a0a0a0', '#f0f0f0',
  '#2060a0', '#a02020', '#20a040', '#a08020',
]

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

export function ColorPalette({ state, dispatch }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>Color</div>
      <div className={styles.grid}>
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`${styles.swatch} ${state.currentColor === color ? styles.selected : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => dispatch({ type: 'SET_COLOR', color })}
            title={color}
          />
        ))}
      </div>
      <div className={styles.customRow}>
        <input
          type="color"
          value={state.currentColor}
          onChange={(e) => dispatch({ type: 'SET_COLOR', color: e.target.value })}
          className={styles.colorInput}
        />
        <input
          type="text"
          value={state.currentColor}
          onChange={(e) => {
            const val = e.target.value
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
              dispatch({ type: 'SET_COLOR', color: val })
            }
          }}
          className={styles.hexInput}
          maxLength={7}
          placeholder="#RRGGBB"
        />
      </div>
    </div>
  )
}
