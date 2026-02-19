import { useRef } from 'react'
import type { EditorState, EditorAction, EditorBlock } from '../state/types'
import { blockKey } from '../state/types'
import { validateShapeData } from '../../core/ShapeParser'
import type { ShapeData } from '../../core/ShapeParser'
import type { ShapeBlock } from '../../core/types'

import { downloadJson } from '../../core/SaveLoad'
import styles from './ExportDialog.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

export function ExportDialog({ state, dispatch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    // Compute origin offset (min x,y,z)
    let minX = Infinity, minY = Infinity, minZ = Infinity
    for (const block of state.blocks.values()) {
      if (block.x < minX) minX = block.x
      if (block.y < minY) minY = block.y
      if (block.z < minZ) minZ = block.z
    }

    // Direct mapping: EditorBlock → ShapeBlock with origin normalization
    const blocks: ShapeBlock[] = []
    for (const block of state.blocks.values()) {
      blocks.push({
        x: (block.x - minX) * state.gridSize,
        y: (block.y - minY) * state.gridSize,
        z: (block.z - minZ) * state.gridSize,
        w: block.w * state.gridSize,
        h: block.h * state.gridSize,
        d: block.d * state.gridSize,
        color: block.color,
      })
    }

    const shapeData: ShapeData = {
      version: 1,
      name: state.shapeName,
      gridSize: 1,
      blocks,
      weightKg: state.weightKg,
    }
    const json = JSON.stringify(shapeData, null, 2)
    const filename = `${state.shapeName.replace(/[^a-zA-Z0-9_-]/g, '_')}.shape.json`
    downloadJson(json, filename)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (validateShapeData(data)) {
          // Direct mapping: ShapeBlock → EditorBlock
          const cells = new Map<string, EditorBlock>()
          for (const sb of data.blocks) {
            const x = Math.round(sb.x / data.gridSize)
            const y = Math.round(sb.y / data.gridSize)
            const z = Math.round(sb.z / data.gridSize)
            const w = Math.round(sb.w / data.gridSize)
            const h = Math.round(sb.h / data.gridSize)
            const d = Math.round(sb.d / data.gridSize)
            const key = blockKey(x, y, z)
            cells.set(key, { x, y, z, w, h, d, color: sb.color })
          }
          dispatch({
            type: 'LOAD_SHAPE',
            blocks: cells,
            name: data.name,
            weightKg: data.weightKg,
          })
        } else {
          alert('無効なシェイプファイルです')
        }
      } catch {
        alert('ファイルの読み込みに失敗しました')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className={styles.container}>
      <div className={styles.label}>File</div>
      <div className={styles.buttons}>
        <button
          className={styles.button}
          onClick={handleExport}
          disabled={state.blocks.size === 0}
        >
          Export JSON
        </button>
        <button
          className={styles.button}
          onClick={handleImport}
        >
          Import JSON
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
