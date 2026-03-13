import { useAppStore } from '../state/store'
import { useTranslation } from '../i18n'
import styles from './CargoList.module.css'

export function CargoList() {
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removeCargoDef = useAppStore((s) => s.removeCargoDef)
  const placeCargo = useAppStore((s) => s.placeCargo)
  const stageCargo = useAppStore((s) => s.stageCargo)
  const { t } = useTranslation()

  const handlePlace = (defId: string) => {
    const state = useAppStore.getState()
    const result = state.findPlacementPosition(defId)
    if (result) {
      placeCargo(defId, result.position, result.rotation)
      const newState = useAppStore.getState()
      const placed = newState.placements[newState.placements.length - 1]
      if (placed) {
        newState.setSelectedInstanceId(placed.instanceId)
        newState.addToast(t.cargoList.placed, 'success')
      }
    } else {
      useAppStore.getState().addToast(t.cargoList.noPosition, 'error')
    }
  }

  const handleDelete = (defId: string) => {
    const state = useAppStore.getState()
    const hasPlacement = state.placements.some((p) => p.cargoDefId === defId)
    if (hasPlacement) {
      if (!confirm(t.cargoList.confirmDeleteDef)) return
    }
    removeCargoDef(defId)
  }

  const handleDragStart = (e: React.DragEvent, defId: string) => {
    e.dataTransfer.setData('text/plain', defId)
    e.dataTransfer.effectAllowed = 'copy'
    useAppStore.getState().setDragState({
      cargoDefId: defId,
      currentPosition: null,
      currentRotation: { x: 0, y: 0, z: 0 },
      isValid: false,
    })
  }

  const handleDragEnd = () => {
    useAppStore.getState().setDragState(null)
  }

  if (cargoDefs.length === 0) {
    return (
      <div className={styles.empty}>
        {t.cargoList.empty}
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {cargoDefs.map((def) => (
        <div
          key={def.id}
          className={styles.item}
          draggable
          onDragStart={(e) => handleDragStart(e, def.id)}
          onDragEnd={handleDragEnd}
        >
          <div className={styles.itemHeader}>
            <span
              className={styles.colorSwatch}
              style={{ backgroundColor: def.color }}
            />
            <span className={styles.itemName}>{def.name}</span>
          </div>
          <div className={styles.itemDetails}>
            <span className={styles.dims}>
              {def.widthCm}×{def.heightCm}×{def.depthCm} cm
            </span>
            <span className={styles.weight}>{def.weightKg} kg</span>
          </div>
          <div className={styles.itemActions}>
            <button
              className={styles.placeButton}
              onClick={() => handlePlace(def.id)}
            >
              {t.cargoList.place}
            </button>
            <button
              className={styles.stageButton}
              onClick={() => stageCargo(def.id)}
            >
              {t.cargoList.stage}
            </button>
            <button
              className={styles.deleteButton}
              onClick={() => handleDelete(def.id)}
            >
              {t.cargoList.delete}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
