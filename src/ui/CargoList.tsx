import { useAppStore } from '../state/store'
import { getVoxelGrid } from '../core/voxelGridSingleton'
import type { Vec3 } from '../core/types'
import styles from './CargoList.module.css'

export function CargoList() {
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const removeCargoDef = useAppStore((s) => s.removeCargoDef)
  const placeCargo = useAppStore((s) => s.placeCargo)

  const handlePlace = (defId: string) => {
    const state = useAppStore.getState()
    const def = state.cargoDefs.find((d) => d.id === defId)
    if (!def) return

    // Auto-placement: find first available position using VoxelGrid
    const position = findPlacementPosition(def.widthCm, def.heightCm, def.depthCm, state.container)
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
        貨物が定義されていません。上のフォームから貨物を追加してください。
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

// Auto-placement using VoxelGrid for precise collision detection
function findPlacementPosition(
  w: number, h: number, d: number,
  container: { widthCm: number; heightCm: number; depthCm: number },
): Vec3 | null {
  const cw = container.widthCm
  const ch = container.heightCm
  const cd = container.depthCm
  const grid = getVoxelGrid()

  const step = 1 // 1cm precision with VoxelGrid

  for (let y = 0; y + h <= ch; y += step) {
    for (let z = 0; z + d <= cd; z += step) {
      for (let x = 0; x + w <= cw; x += step) {
        // Quick check: test corner voxels first for fast rejection
        if (grid.get(x, y, z) !== 0) continue
        if (grid.get(x + w - 1, y, z) !== 0) continue
        if (grid.get(x, y + h - 1, z) !== 0) continue
        if (grid.get(x, y, z + d - 1) !== 0) continue

        // Full check using hasCollision
        const voxels: Vec3[] = []
        let collision = false
        for (let vz = z; vz < z + d && !collision; vz++) {
          for (let vy = y; vy < y + h && !collision; vy++) {
            for (let vx = x; vx < x + w && !collision; vx++) {
              if (grid.get(vx, vy, vz) !== 0) {
                collision = true
              }
              voxels.push({ x: vx, y: vy, z: vz })
            }
          }
        }
        if (!collision) {
          return { x, y, z }
        }
      }
    }
  }
  return null
}
