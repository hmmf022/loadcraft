import { useRef } from 'react'
import type { EditorState, EditorAction } from '../state/types'
import { compressBlocks, expandBlocks } from '../../core/ShapeCompressor'
import { validateShapeData } from '../../core/ShapeParser'
import type { ShapeData } from '../../core/ShapeParser'

import { downloadJson } from '../../core/SaveLoad'
import styles from './ExportDialog.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

export function ExportDialog({ state, dispatch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const blocks = compressBlocks(state.blocks, 1)
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
          const cells = expandBlocks(data.blocks, data.gridSize)
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
