import type { Vec3, PlacedCargo, CargoItemDef, ContainerDef, ShapeBlock } from './types'
import { computeRotatedAABB, rotateVec3 } from './Voxelizer'

/**
 * 2D height map over the container's XZ plane.
 * Each cell stores the maximum occupied Y (in cm) for that column.
 * Replaces VoxelGrid scanning for placement search and snap-to-stack operations.
 */
export class OccupancyMap {
  private heightMap: Uint16Array
  private cellSize: number
  private cellsX: number
  private cellsZ: number
  private containerH: number

  constructor(widthCm: number, heightCm: number, depthCm: number, cellSize = 10) {
    this.cellSize = cellSize
    this.cellsX = Math.ceil(widthCm / cellSize)
    this.cellsZ = Math.ceil(depthCm / cellSize)
    this.containerH = heightCm
    this.heightMap = new Uint16Array(this.cellsX * this.cellsZ)
  }

  /** Record an AABB's footprint: for each covered XZ cell, update maxY */
  markAABB(aabb: { min: Vec3; max: Vec3 }): void {
    const cs = this.cellSize
    const minCX = Math.max(0, Math.floor(aabb.min.x / cs))
    const maxCX = Math.min(this.cellsX - 1, Math.ceil(aabb.max.x / cs) - 1)
    const minCZ = Math.max(0, Math.floor(aabb.min.z / cs))
    const maxCZ = Math.min(this.cellsZ - 1, Math.ceil(aabb.max.z / cs) - 1)
    const topY = Math.ceil(aabb.max.y)

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const idx = cx + this.cellsX * cz
        if (topY > this.heightMap[idx]!) {
          this.heightMap[idx] = topY
        }
      }
    }
  }

  /** Get the maximum occupied height under a footprint starting at (x,z) with size w×d (all in cm) */
  getStackHeight(x: number, z: number, w: number, d: number): number {
    const cs = this.cellSize
    const minCX = Math.max(0, Math.floor(x / cs))
    const maxCX = Math.min(this.cellsX - 1, Math.ceil((x + w) / cs) - 1)
    const minCZ = Math.max(0, Math.floor(z / cs))
    const maxCZ = Math.min(this.cellsZ - 1, Math.ceil((z + d) / cs) - 1)

    let maxH = 0
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const h = this.heightMap[cx + this.cellsX * cz]!
        if (h > maxH) maxH = h
      }
    }
    return maxH
  }

  /** Find the first position where a w×h×d item fits (wall-building from back wall X=0).
   *  Scans X from 0→max, Z from 0→max, and picks the position
   *  with the smallest X (closest to back wall), breaking ties by lowest Y. */
  findPosition(w: number, h: number, d: number): Vec3 | null {
    const cs = this.cellSize
    const itemCellsW = Math.ceil(w / cs)
    const itemCellsD = Math.ceil(d / cs)

    let bestPos: Vec3 | null = null
    let bestY = Infinity
    let bestX = Infinity

    // X を画面奥(0)から手前(max)へ
    for (let cx = 0; cx <= this.cellsX - itemCellsW; cx++) {
      for (let cz = 0; cz <= this.cellsZ - itemCellsD; cz++) {
        let maxH = 0
        for (let dx = 0; dx < itemCellsW; dx++) {
          for (let dz = 0; dz < itemCellsD; dz++) {
            const val = this.heightMap[(cx + dx) + this.cellsX * (cz + dz)]!
            if (val > maxH) maxH = val
          }
        }
        const xPos = cx * cs
        if (maxH + h <= this.containerH) {
          // 画面奥(X=0)優先 → 同X帯なら低Y優先
          if (xPos < bestX || (xPos === bestX && maxH < bestY)) {
            bestX = xPos
            bestY = maxH
            bestPos = { x: xPos, y: maxH, z: cz * cs }
          }
        }
      }
    }

    return bestPos
  }

  /** Build from current placements. Optionally exclude one instanceId (for move operations). */
  static fromPlacements(
    placements: PlacedCargo[],
    cargoDefs: CargoItemDef[],
    container: ContainerDef,
    excludeInstanceId?: number,
  ): OccupancyMap {
    const map = new OccupancyMap(container.widthCm, container.heightCm, container.depthCm)
    const defMap = new Map<string, CargoItemDef>()
    for (const d of cargoDefs) {
      defMap.set(d.id, d)
    }

    for (const p of placements) {
      if (p.instanceId === excludeInstanceId) continue
      const def = defMap.get(p.cargoDefId)
      if (!def) continue

      if (def.blocks) {
        markCompositeBlocks(map, def.blocks, p.positionCm, p.rotationDeg)
      } else {
        const aabb = computeRotatedAABB(
          def.widthCm, def.heightCm, def.depthCm,
          p.positionCm, p.rotationDeg,
        )
        map.markAABB(aabb)
      }
    }
    return map
  }
}

/** Mark each block of a composite shape individually */
function markCompositeBlocks(
  map: OccupancyMap,
  blocks: ShapeBlock[],
  position: Vec3,
  rotationDeg: Vec3,
): void {
  for (const block of blocks) {
    // Block offset must be rotated by the shape's rotation (same as buildPickItems in CanvasPanel)
    const rotatedOffset = rotateVec3(
      { x: block.x, y: block.y, z: block.z },
      rotationDeg,
    )
    const aabb = computeRotatedAABB(
      block.w, block.h, block.d,
      {
        x: position.x + rotatedOffset.x,
        y: position.y + rotatedOffset.y,
        z: position.z + rotatedOffset.z,
      },
      rotationDeg,
    )
    map.markAABB(aabb)
  }
}
