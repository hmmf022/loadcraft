import { useState } from 'react'
import { useAppStore } from '../state/store'
import { CONTAINER_PRESETS } from '../core/types'
import styles from './ContainerSelector.module.css'

export function ContainerSelector() {
  const [presetIdx, setPresetIdx] = useState(0)
  const setContainer = useAppStore((s) => s.setContainer)

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value)
    const preset = CONTAINER_PRESETS[idx]
    if (!preset) return

    const placements = useAppStore.getState().placements
    if (placements.length > 0) {
      if (!confirm('コンテナを変更すると、すべての配置がクリアされます。続行しますか？')) {
        return
      }
    }

    setPresetIdx(idx)
    setContainer({
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      depthCm: preset.depthCm,
      maxPayloadKg: preset.maxPayloadKg,
    })
  }

  return (
    <div className={styles.selector}>
      <select value={presetIdx} onChange={handleChange} className={styles.select}>
        {CONTAINER_PRESETS.map((p, i) => (
          <option key={p.name} value={i}>{p.name}</option>
        ))}
      </select>
      <div className={styles.info}>
        {CONTAINER_PRESETS[presetIdx] && (
          <span className={styles.dims}>
            {CONTAINER_PRESETS[presetIdx]!.widthCm} × {CONTAINER_PRESETS[presetIdx]!.heightCm} × {CONTAINER_PRESETS[presetIdx]!.depthCm} cm
          </span>
        )}
      </div>
    </div>
  )
}
