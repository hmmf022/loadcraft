import { useAppStore } from '../state/store'
import type { Vec3, CargoItemDef } from '../core/types'
import { OccupancyMap } from '../core/OccupancyMap'
import { computeRotatedAABB } from '../core/Voxelizer'
import { ORIENTATIONS } from '../core/AutoPacker'
import { useTranslation } from '../i18n'
import styles from './CargoList.module.css'

/** Y-axis-only orientations for noFlip items */
const NOFLIP_ORIENTATIONS: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 90, z: 0 },
]

export function CargoList() {
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removeCargoDef = useAppStore((s) => s.removeCargoDef)
  const placeCargo = useAppStore((s) => s.placeCargo)
  const { t } = useTranslation()

  const handlePlace = (defId: string) => {
    const state = useAppStore.getState()
    const def = state.cargoDefs.find((d) => d.id === defId)
    if (!def) return

    const result = findPlacementWithRotation(def)
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

/** Try all rotation candidates and find the first placement position */
function findPlacementWithRotation(
  def: CargoItemDef,
): { position: Vec3; rotation: Vec3 } | null {
  const state = useAppStore.getState()
  const orientations = def.noFlip ? NOFLIP_ORIENTATIONS : ORIENTATIONS

  // Deduplicate orientations by effective AABB size
  const seen = new Set<string>()
  const candidates: { rot: Vec3; effW: number; effH: number; effD: number; offsetX: number; offsetY: number; offsetZ: number }[] = []
  for (const rot of orientations) {
    const aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, { x: 0, y: 0, z: 0 }, rot)
    const effW = aabb.max.x - aabb.min.x
    const effH = aabb.max.y - aabb.min.y
    const effD = aabb.max.z - aabb.min.z
    const key = `${effW},${effH},${effD}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ rot, effW, effH, effD, offsetX: -aabb.min.x, offsetY: -aabb.min.y, offsetZ: -aabb.min.z })
  }

  const map = OccupancyMap.fromPlacements(
    state.placements, state.cargoDefs, state.container,
  )

  for (const c of candidates) {
    const position = map.findPosition(c.effW, c.effH, c.effD)
    if (position) {
      return {
        position: {
          x: position.x + c.offsetX,
          y: position.y + c.offsetY,
          z: position.z + c.offsetZ,
        },
        rotation: c.rot,
      }
    }
  }

  return null
}
