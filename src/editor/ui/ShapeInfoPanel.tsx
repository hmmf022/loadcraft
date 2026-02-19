import { DISPLAY_SCALE } from '../state/types'
import type { EditorState, EditorAction } from '../state/types'
import styles from './ShapeInfoPanel.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

function computeBoundingBox(state: EditorState): { w: number; h: number; d: number } {
  if (state.blocks.size === 0) return { w: 0, h: 0, d: 0 }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const block of state.blocks.values()) {
    if (block.x < minX) minX = block.x
    if (block.y < minY) minY = block.y
    if (block.z < minZ) minZ = block.z
    if (block.x + 1 > maxX) maxX = block.x + 1
    if (block.y + 1 > maxY) maxY = block.y + 1
    if (block.z + 1 > maxZ) maxZ = block.z + 1
  }

  const gs = state.gridSize
  return {
    w: (maxX - minX) * gs,
    h: (maxY - minY) * gs,
    d: (maxZ - minZ) * gs,
  }
}

export function ShapeInfoPanel({ state, dispatch }: Props) {
  const bbox = computeBoundingBox(state)

  return (
    <div className={styles.container}>
      <div className={styles.title}>Shape Editor</div>

      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          type="text"
          value={state.shapeName}
          onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Weight (kg)</span>
        <input
          type="number"
          value={state.weightKg}
          min={0.1}
          step={0.1}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v > 0) {
              dispatch({ type: 'SET_WEIGHT', weight: v })
            }
          }}
          className={styles.input}
        />
      </label>

      <div className={styles.info}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Blocks</span>
          <span className={styles.infoValue}>{state.blocks.size}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>BBox (cm)</span>
          <span className={styles.infoValue}>
            {bbox.w} x {bbox.h} x {bbox.d}
          </span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Grid</span>
          <span className={styles.infoValue}>
            {DISPLAY_SCALE}x display (1 cell = 1cm)
          </span>
        </div>
      </div>
    </div>
  )
}
