import { useState } from 'react'
import { useAppStore } from '../state/store'
import { CONTAINER_PRESETS } from '../core/types'
import { useTranslation } from '../i18n'
import styles from './ContainerSelector.module.css'

const CUSTOM_IDX = CONTAINER_PRESETS.length

export function ContainerSelector() {
  const [presetIdx, setPresetIdx] = useState(0)
  const [customW, setCustomW] = useState(400)
  const [customH, setCustomH] = useState(200)
  const [customD, setCustomD] = useState(300)
  const setContainer = useAppStore((s) => s.setContainer)
  const container = useAppStore((s) => s.container)
  const { t } = useTranslation()

  const confirmChange = (): boolean => {
    const placements = useAppStore.getState().placements
    if (placements.length > 0) {
      if (!confirm(t.container.confirmChange)) {
        return false
      }
    }
    return true
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value)

    if (idx === CUSTOM_IDX) {
      // Switch to custom mode (don't change container yet)
      setPresetIdx(CUSTOM_IDX)
      return
    }

    const preset = CONTAINER_PRESETS[idx]
    if (!preset) return

    if (!confirmChange()) return

    setPresetIdx(idx)
    setContainer({
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      depthCm: preset.depthCm,
      maxPayloadKg: preset.maxPayloadKg,
    })
  }

  const handleApplyCustom = () => {
    const w = Math.max(10, Math.min(2000, customW))
    const h = Math.max(10, Math.min(2000, customH))
    const d = Math.max(10, Math.min(2000, customD))

    if (!confirmChange()) return

    setContainer({
      widthCm: w,
      heightCm: h,
      depthCm: d,
      maxPayloadKg: 30000,
    })
  }

  const isCustom = presetIdx === CUSTOM_IDX

  return (
    <div className={styles.selector}>
      <select value={presetIdx} onChange={handleChange} className={styles.select}>
        {CONTAINER_PRESETS.map((p, i) => (
          <option key={p.name} value={i}>{p.name}</option>
        ))}
        <option value={CUSTOM_IDX}>{t.container.custom}</option>
      </select>

      {isCustom ? (
        <div className={styles.customInputs}>
          <div className={styles.inputRow}>
            <label className={styles.inputLabel}>{t.container.width}</label>
            <input
              type="number"
              className={styles.input}
              value={customW}
              min={10}
              max={2000}
              onChange={(e) => setCustomW(parseInt(e.target.value) || 10)}
            />
          </div>
          <div className={styles.inputRow}>
            <label className={styles.inputLabel}>{t.container.height}</label>
            <input
              type="number"
              className={styles.input}
              value={customH}
              min={10}
              max={2000}
              onChange={(e) => setCustomH(parseInt(e.target.value) || 10)}
            />
          </div>
          <div className={styles.inputRow}>
            <label className={styles.inputLabel}>{t.container.depth}</label>
            <input
              type="number"
              className={styles.input}
              value={customD}
              min={10}
              max={2000}
              onChange={(e) => setCustomD(parseInt(e.target.value) || 10)}
            />
          </div>
          <button className={styles.applyButton} onClick={handleApplyCustom}>
            {t.container.apply}
          </button>
        </div>
      ) : (
        <div className={styles.info}>
          <span className={styles.dims}>
            {container.widthCm} × {container.heightCm} × {container.depthCm} cm
          </span>
        </div>
      )}
    </div>
  )
}
