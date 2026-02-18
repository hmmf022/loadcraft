import { useAppStore } from '../state/store'
import styles from './CargoList.module.css'

export function CargoList() {
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removeCargoDef = useAppStore((s) => s.removeCargoDef)
  const placeCargo = useAppStore((s) => s.placeCargo)

  const handlePlace = (defId: string) => {
    const state = useAppStore.getState()
    const def = state.cargoDefs.find((d) => d.id === defId)
    if (!def) return

    // Auto-placement: find first available position
    const position = findPlacementPosition(def.widthCm, def.heightCm, def.depthCm, state)
    if (position) {
      placeCargo(defId, position)
    } else {
      alert('配置可能な位置が見つかりません')
    }
  }

  const handleDelete = (defId: string) => {
    const state = useAppStore.getState()
    const hasPlacement = state.placements.some((p) => p.cargoDefId === defId)
    if (hasPlacement) {
      if (!confirm('この貨物定義の配置も同時に削除されます。続行しますか？')) return
    }
    removeCargoDef(defId)
  }

  if (cargoDefs.length === 0) {
    return (
      <div className={styles.empty}>
        貨物が定義されていません。上のフォームから貨物を追加してください。
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {cargoDefs.map((def) => (
        <div key={def.id} className={styles.item}>
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
              配置
            </button>
            <button
              className={styles.deleteButton}
              onClick={() => handleDelete(def.id)}
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Simple auto-placement: scan X→Z→Y for first non-colliding position
function findPlacementPosition(
  w: number, h: number, d: number,
  state: { container: { widthCm: number; heightCm: number; depthCm: number }; placements: { positionCm: { x: number; y: number; z: number }; cargoDefId: string }[]; cargoDefs: { id: string; widthCm: number; heightCm: number; depthCm: number }[] },
): { x: number; y: number; z: number } | null {
  const cw = state.container.widthCm
  const ch = state.container.heightCm
  const cd = state.container.depthCm

  // Build simple occupied grid from existing placements
  const occupied: { x: number; y: number; z: number; w: number; h: number; d: number }[] = []
  for (const p of state.placements) {
    const def = state.cargoDefs.find((d) => d.id === p.cargoDefId)
    if (def) {
      occupied.push({
        x: p.positionCm.x, y: p.positionCm.y, z: p.positionCm.z,
        w: def.widthCm, h: def.heightCm, d: def.depthCm,
      })
    }
  }

  const step = 10 // 10cm step for search

  for (let y = 0; y + h <= ch; y += step) {
    for (let z = 0; z + d <= cd; z += step) {
      for (let x = 0; x + w <= cw; x += step) {
        if (!hasBoxCollision(x, y, z, w, h, d, occupied)) {
          return { x, y, z }
        }
      }
    }
  }
  return null
}

function hasBoxCollision(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  occupied: { x: number; y: number; z: number; w: number; h: number; d: number }[],
): boolean {
  for (const o of occupied) {
    if (
      x < o.x + o.w && x + w > o.x &&
      y < o.y + o.h && y + h > o.y &&
      z < o.z + o.d && z + d > o.z
    ) {
      return true
    }
  }
  return false
}
