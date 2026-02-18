import { useAppStore } from '../state/store'
import styles from './PlacementControls.module.css'

export function PlacementControls() {
  const selectedInstanceId = useAppStore((s) => s.selectedInstanceId)
  const placements = useAppStore((s) => s.placements)
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removePlacement = useAppStore((s) => s.removePlacement)
  const setSelectedInstanceId = useAppStore((s) => s.setSelectedInstanceId)

  if (selectedInstanceId === null) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>貨物を選択してください</div>
      </div>
    )
  }

  const placement = placements.find((p) => p.instanceId === selectedInstanceId)
  if (!placement) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>貨物を選択してください</div>
      </div>
    )
  }

  const def = cargoDefs.find((d) => d.id === placement.cargoDefId)
  if (!def) return null

  const pos = placement.positionCm

  return (
    <div className={styles.panel}>
      <div className={styles.info}>
        <div className={styles.infoHeader}>
          <span className={styles.colorSwatch} style={{ backgroundColor: def.color }} />
          <span className={styles.infoName}>{def.name}</span>
        </div>
        <div className={styles.infoDetails}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>位置</span>
            <span className={styles.detailValue}>
              X:{pos.x} Y:{pos.y} Z:{pos.z}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>寸法</span>
            <span className={styles.detailValue}>
              {def.widthCm} x {def.heightCm} x {def.depthCm} cm
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>重量</span>
            <span className={styles.detailValue}>{def.weightKg} kg</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.deleteButton}
            onClick={() => removePlacement(selectedInstanceId)}
          >
            削除
          </button>
          <button
            className={styles.deselectButton}
            onClick={() => setSelectedInstanceId(null)}
          >
            選択解除
          </button>
        </div>
      </div>
    </div>
  )
}
