import type { Vec3, GridStats } from './types'

export class VoxelGrid {
  readonly width: number
  readonly height: number
  readonly depth: number
  private data: Uint16Array
  occupiedCount: number = 0
  private objectCells: Map<number, Set<number>> = new Map()

  constructor(width: number, height: number, depth: number) {
    this.width = width
    this.height = height
    this.depth = depth
    this.data = new Uint16Array(width * height * depth)
  }

  private index(x: number, y: number, z: number): number {
    return x + this.width * (y + this.height * z)
  }

  isInBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth
  }

  get(x: number, y: number, z: number): number {
    if (!this.isInBounds(x, y, z)) return 0
    return this.data[this.index(x, y, z)]!
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.isInBounds(x, y, z)) return
    const idx = this.index(x, y, z)
    const old = this.data[idx]!
    if (old === id) return
    this.data[idx] = id

    // Update occupiedCount
    if (old === 0 && id !== 0) this.occupiedCount++
    else if (old !== 0 && id === 0) this.occupiedCount--

    // Update objectCells reverse lookup
    if (old !== 0) {
      const set = this.objectCells.get(old)
      if (set) {
        set.delete(idx)
        if (set.size === 0) this.objectCells.delete(old)
      }
    }
    if (id !== 0) {
      let set = this.objectCells.get(id)
      if (!set) {
        set = new Set()
        this.objectCells.set(id, set)
      }
      set.add(idx)
    }
  }

  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    // Clamp to bounds
    const cx0 = Math.max(0, x0)
    const cy0 = Math.max(0, y0)
    const cz0 = Math.max(0, z0)
    const cx1 = Math.min(this.width - 1, x1)
    const cy1 = Math.min(this.height - 1, y1)
    const cz1 = Math.min(this.depth - 1, z1)

    // Pre-fetch or create the target set for bulk insert
    let targetSet: Set<number> | undefined
    if (id !== 0) {
      targetSet = this.objectCells.get(id)
      if (!targetSet) {
        targetSet = new Set()
        this.objectCells.set(id, targetSet)
      }
    }

    for (let z = cz0; z <= cz1; z++) {
      for (let y = cy0; y <= cy1; y++) {
        const start = this.index(cx0, y, z)
        const end = this.index(cx1, y, z)

        // Count occupancy changes and update reverse lookup before overwriting
        for (let i = start; i <= end; i++) {
          const old = this.data[i]!
          if (old === id) continue
          if (old === 0 && id !== 0) this.occupiedCount++
          else if (old !== 0 && id === 0) this.occupiedCount--

          // Remove from old object's set
          if (old !== 0) {
            const set = this.objectCells.get(old)
            if (set) {
              set.delete(i)
              if (set.size === 0) this.objectCells.delete(old)
            }
          }
          // Add to new object's set
          if (targetSet) {
            targetSet.add(i)
          }
        }

        this.data.fill(id, start, end + 1)
      }
    }
  }

  fillVoxels(voxels: Vec3[], id: number): void {
    for (const v of voxels) {
      this.set(v.x, v.y, v.z, id)
    }
  }

  clearObject(id: number): void {
    const cells = this.objectCells.get(id)
    if (!cells) return
    this.occupiedCount -= cells.size
    for (const idx of cells) {
      this.data[idx] = 0
    }
    this.objectCells.delete(id)
  }

  hasCollision(voxels: Vec3[], excludeId?: number): boolean {
    for (const v of voxels) {
      if (!this.isInBounds(v.x, v.y, v.z)) return true
      const val = this.data[this.index(v.x, v.y, v.z)]!
      if (val !== 0 && val !== excludeId) return true
    }
    return false
  }

  computeStats(): GridStats {
    const total = this.data.length
    return {
      totalVoxels: total,
      occupiedVoxels: this.occupiedCount,
      fillRate: total > 0 ? this.occupiedCount / total : 0,
    }
  }

  clone(): VoxelGrid {
    const copy = new VoxelGrid(this.width, this.height, this.depth)
    copy.data.set(this.data)
    copy.occupiedCount = this.occupiedCount
    for (const [id, cells] of this.objectCells) {
      copy.objectCells.set(id, new Set(cells))
    }
    return copy
  }

  clear(): void {
    this.data.fill(0)
    this.occupiedCount = 0
    this.objectCells.clear()
  }
}
