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
    if (block.x + block.w > maxX) maxX = block.x + block.w
    if (block.y + block.h > maxY) maxY = block.y + block.h
    if (block.z + block.d > maxZ) maxZ = block.z + block.d
  }

  const gs = state.gridSize
  return {
    w: (maxX - minX) * gs,
    h: (maxY - minY) * gs,
    d: (maxZ - minZ) * gs,
  }
}

function clampBrush(v: number): number {
  return Math.max(1, Math.min(300, Math.round(v)))
}

export function ShapeInfoPanel({ state, dispatch }: Props) {
  const bbox = computeBoundingBox(state)

  const setBrush = (axis: 'w' | 'h' | 'd', value: string) => {
    const v = parseInt(value, 10)
    if (isNaN(v)) return
    const clamped = clampBrush(v)
    dispatch({
      type: 'SET_BRUSH_SIZE',
      w: axis === 'w' ? clamped : state.brushW,
      h: axis === 'h' ? clamped : state.brushH,
      d: axis === 'd' ? clamped : state.brushD,
    })
  }

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

      <div className={styles.field}>
        <span className={styles.label}>Brush Size (cm)</span>
        <div className={styles.brushInputs}>
          <label className={styles.brushField}>
            W
            <input
              type="number"
              value={state.brushW}
              min={1}
              max={300}
              onChange={(e) => setBrush('w', e.target.value)}
              className={styles.brushInput}
            />
          </label>
          <span className={styles.brushSep}>x</span>
          <label className={styles.brushField}>
            H
            <input
              type="number"
              value={state.brushH}
              min={1}
              max={300}
              onChange={(e) => setBrush('h', e.target.value)}
              className={styles.brushInput}
            />
          </label>
          <span className={styles.brushSep}>x</span>
          <label className={styles.brushField}>
            D
            <input
              type="number"
              value={state.brushD}
              min={1}
              max={300}
              onChange={(e) => setBrush('d', e.target.value)}
              className={styles.brushInput}
            />
          </label>
        </div>
      </div>

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
      </div>
    </div>
  )
}
