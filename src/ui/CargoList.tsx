import { useAppStore } from '../state/store'
import { getVoxelGrid } from '../core/voxelGridSingleton'
import type { Vec3, ShapeBlock } from '../core/types'
import { voxelize, voxelizeComposite } from '../core/Voxelizer'
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
    const rotationDeg: Vec3 = { x: 0, y: 0, z: 0 }
    const position = findPlacementPosition(
      def.widthCm, def.heightCm, def.depthCm,
      state.container, rotationDeg, def.blocks,
    )
    if (position) {
      placeCargo(defId, position, rotationDeg)
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

// Auto-placement using VoxelGrid for precise collision detection.
// Voxelizes once at origin; reuses shape via offset for each candidate position.
function findPlacementPosition(
  w: number, h: number, d: number,
  container: { widthCm: number; heightCm: number; depthCm: number },
  rotationDeg: Vec3,
  blocks?: ShapeBlock[],
): Vec3 | null {
  const grid = getVoxelGrid()

  // === Voxelize once at origin ===
  const origin: Vec3 = { x: 0, y: 0, z: 0 }
  const result = blocks
    ? voxelizeComposite(blocks, origin, rotationDeg)
    : voxelize(w, h, d, origin, rotationDeg)

  const aabb = result.aabb
  const aabbW = aabb.max.x - aabb.min.x
  const aabbH = aabb.max.y - aabb.min.y
  const aabbD = aabb.max.z - aabb.min.z

  // Search range: AABB offset by candidate position must fit in container
  const minX = Math.max(0, Math.ceil(-aabb.min.x))
  const maxX = Math.floor(container.widthCm - aabbW - aabb.min.x)
  const minY = Math.max(0, Math.ceil(-aabb.min.y))
  const maxY = Math.floor(container.heightCm - aabbH - aabb.min.y)
  const minZ = Math.max(0, Math.ceil(-aabb.min.z))
  const maxZ = Math.floor(container.depthCm - aabbD - aabb.min.z)

  // === Fast path: axis-aligned — AABB direct scan with corner rejection ===
  if (result.usesFastPath) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          // Corner check: fast rejection (~90% of candidates)
          const x1 = x + aabbW - 1, y1 = y + aabbH - 1, z1 = z + aabbD - 1
          if (grid.get(x, y, z) !== 0) continue
          if (grid.get(x1, y, z) !== 0) continue
          if (grid.get(x, y1, z) !== 0) continue
          if (grid.get(x, y, z1) !== 0) continue
          if (grid.get(x1, y1, z) !== 0) continue
          if (grid.get(x1, y, z1) !== 0) continue
          if (grid.get(x, y1, z1) !== 0) continue
          if (grid.get(x1, y1, z1) !== 0) continue

          // Full AABB voxel scan
          let collision = false
          for (let vz = z; vz < z + aabbD && !collision; vz++)
            for (let vy = y; vy < y + aabbH && !collision; vy++)
              for (let vx = x; vx < x + aabbW && !collision; vx++)
                if (grid.get(vx, vy, vz) !== 0) collision = true
          if (!collision) return { x, y, z }
        }
      }
    }
    return null
  }

  // === Slow path: offset pre-computed voxels for each candidate ===
  const baseVoxels = result.voxels
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        let collision = false
        for (const v of baseVoxels) {
          const gx = v.x + x, gy = v.y + y, gz = v.z + z
          if (!grid.isInBounds(gx, gy, gz)) { collision = true; break }
          if (grid.get(gx, gy, gz) !== 0) { collision = true; break }
        }
        if (!collision) return { x, y, z }
      }
    }
  }
  return null
}
