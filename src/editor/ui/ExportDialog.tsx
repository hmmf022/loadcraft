import { useRef } from 'react'
import type { EditorState, EditorAction } from '../state/types'
import { validateShapeData } from '../../core/ShapeParser'
import type { ShapeData } from '../../core/ShapeParser'
import { compressBlocks, expandBlocks } from '../../core/ShapeCompressor'

import { downloadJson } from '../../core/SaveLoad'
import { useTranslation } from '../../i18n'
import styles from './ExportDialog.module.css'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
}

export function ExportDialog({ state, dispatch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const handleExport = () => {
    const blocks = compressBlocks(state.blocks, state.gridSize)
    const shapeData: ShapeData = {
      version: 1,
      name: state.shapeName,
      gridSize: state.gridSize,
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
          alert(t.editor.invalidShapeFile)
        }
      } catch {
        alert(t.editor.fileReadError)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className={styles.container}>
      <div className={styles.label}>{t.editor.file}</div>
      <div className={styles.buttons}>
        <button
          className={styles.button}
          onClick={handleExport}
          disabled={state.blocks.size === 0}
        >
          {t.editor.exportJson}
        </button>
        <button
          className={styles.button}
          onClick={handleImport}
        >
          {t.editor.importJson}
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
