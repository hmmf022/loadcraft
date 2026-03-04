import { useAppStore } from '../state/store'
import { useTranslation } from '../i18n'
import styles from './PlacementControls.module.css'

export function PlacementControls() {
  const selectedInstanceId = useAppStore((s) => s.selectedInstanceId)
  const placements = useAppStore((s) => s.placements)
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removePlacement = useAppStore((s) => s.removePlacement)
  const setSelectedInstanceId = useAppStore((s) => s.setSelectedInstanceId)
  const rotateCargo = useAppStore((s) => s.rotateCargo)
  const dropCargo = useAppStore((s) => s.dropCargo)
  const { t } = useTranslation()

  if (selectedInstanceId === null) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>{t.placement.selectCargo}</div>
      </div>
    )
  }

  const placement = placements.find((p) => p.instanceId === selectedInstanceId)
  if (!placement) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>{t.placement.selectCargo}</div>
      </div>
    )
  }

  const def = cargoDefs.find((d) => d.id === placement.cargoDefId)
  if (!def) return null

  const pos = placement.positionCm
  const rot = placement.rotationDeg

  const handleRotate = (axis: 'x' | 'y' | 'z', delta: number) => {
    rotateCargo(selectedInstanceId, {
      ...rot,
      [axis]: rot[axis] + delta,
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.info}>
        <div className={styles.infoHeader}>
          <span className={styles.colorSwatch} style={{ backgroundColor: def.color }} />
          <span className={styles.infoName}>{def.name}</span>
        </div>
        <div className={styles.infoDetails}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.placement.position}</span>
            <span className={styles.detailValue}>
              X:{pos.x} Y:{pos.y} Z:{pos.z}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.placement.dimensions}</span>
            <span className={styles.detailValue}>
              {def.widthCm} x {def.heightCm} x {def.depthCm} cm
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.placement.weight}</span>
            <span className={styles.detailValue}>{def.weightKg} kg</span>
          </div>
        </div>

        <div className={styles.rotationSection}>
          <div className={styles.rotationLabel}>{t.placement.rotation}</div>
          <div className={styles.rotationRow}>
            <span className={styles.rotationAxis}>RX: {rot.x}°</span>
            <button className={styles.rotateButton} onClick={() => handleRotate('x', 90)}>+90°</button>
          </div>
          <div className={styles.rotationRow}>
            <span className={styles.rotationAxis}>RY: {rot.y}°</span>
            <button className={styles.rotateButton} onClick={() => handleRotate('y', 90)}>+90°</button>
          </div>
          <div className={styles.rotationRow}>
            <span className={styles.rotationAxis}>RZ: {rot.z}°</span>
            <button className={styles.rotateButton} onClick={() => handleRotate('z', 90)}>+90°</button>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.dropButton}
            onClick={() => dropCargo(selectedInstanceId)}
          >
            {t.placement.drop}
          </button>
          <button
            className={styles.deleteButton}
            onClick={() => removePlacement(selectedInstanceId)}
          >
            {t.placement.delete}
          </button>
          <button
            className={styles.deselectButton}
            onClick={() => setSelectedInstanceId(null)}
          >
            {t.placement.deselect}
          </button>
        </div>
      </div>
    </div>
  )
}
