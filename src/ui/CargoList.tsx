import { useAppStore } from '../state/store'
import type { Vec3 } from '../core/types'
import { OccupancyMap } from '../core/OccupancyMap'
import { computeRotatedAABB } from '../core/Voxelizer'
import { useTranslation } from '../i18n'
import styles from './CargoList.module.css'

export function CargoList() {
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removeCargoDef = useAppStore((s) => s.removeCargoDef)
  const placeCargo = useAppStore((s) => s.placeCargo)
  const { t } = useTranslation()

  const handlePlace = (defId: string) => {
    const state = useAppStore.getState()
    const def = state.cargoDefs.find((d) => d.id === defId)
    if (!def) return

    const rotationDeg: Vec3 = { x: 0, y: 0, z: 0 }
    const position = findPlacementPosition(
      def.widthCm, def.heightCm, def.depthCm, rotationDeg,
    )
    if (position) {
      placeCargo(defId, position, rotationDeg)
    } else {
      alert(t.cargoList.noPosition)
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

// Auto-placement using OccupancyMap (height map) for O(1) Y-axis resolution.
function findPlacementPosition(
  w: number, h: number, d: number,
  rotationDeg: Vec3,
): Vec3 | null {
  const state = useAppStore.getState()
  const aabb = computeRotatedAABB(w, h, d, { x: 0, y: 0, z: 0 }, rotationDeg)
  const aabbW = aabb.max.x - aabb.min.x
  const aabbH = aabb.max.y - aabb.min.y
  const aabbD = aabb.max.z - aabb.min.z
  const map = OccupancyMap.fromPlacements(
    state.placements, state.cargoDefs, state.container,
  )
  return map.findPosition(aabbW, aabbH, aabbD)
}
