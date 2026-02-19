import type { ShapeBlock } from './types'
import type { EditorBlock } from '../editor/state/types'
import { blockKey } from '../editor/state/types'

/**
 * Compress individual voxel cells into rectangular blocks.
 * Groups by color, then greedily extends X→Y→Z.
 */
export function compressBlocks(cells: Map<string, EditorBlock>, gridSize: number): ShapeBlock[] {
  if (cells.size === 0) return []

  // Compute origin offset (min x,y,z)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (const block of cells.values()) {
    if (block.x < minX) minX = block.x
    if (block.y < minY) minY = block.y
    if (block.z < minZ) minZ = block.z
  }

  // Group cells by color
  const byColor = new Map<string, Set<string>>()
  for (const [key, block] of cells) {
    let group = byColor.get(block.color)
    if (!group) {
      group = new Set()
      byColor.set(block.color, group)
    }
    group.add(key)
  }

  const result: ShapeBlock[] = []

  for (const [color, group] of byColor) {
    const visited = new Set<string>()

    // Sort cells by z, y, x for deterministic greedy scan
    const sortedKeys = [...group].sort((a, b) => {
      const [ax, ay, az] = a.split(',').map(Number) as [number, number, number]
      const [bx, by, bz] = b.split(',').map(Number) as [number, number, number]
      if (az !== bz) return az - bz
      if (ay !== by) return ay - by
      return ax - bx
    })

    for (const key of sortedKeys) {
      if (visited.has(key)) continue

      const cell = cells.get(key)!
      const sx = cell.x, sy = cell.y, sz = cell.z

      // Extend in +X
      let ex = sx
      while (true) {
        const nextKey = blockKey(ex + 1, sy, sz)
        if (!group.has(nextKey) || visited.has(nextKey)) break
        ex++
      }

      // Extend in +Y (all X columns must be present)
      let ey = sy
      yLoop: while (true) {
        for (let x = sx; x <= ex; x++) {
          const testKey = blockKey(x, ey + 1, sz)
          if (!group.has(testKey) || visited.has(testKey)) break yLoop
        }
        ey++
      }

      // Extend in +Z (all XY face must be present)
      let ez = sz
      zLoop: while (true) {
        for (let y = sy; y <= ey; y++) {
          for (let x = sx; x <= ex; x++) {
            const testKey = blockKey(x, y, ez + 1)
            if (!group.has(testKey) || visited.has(testKey)) break zLoop
          }
        }
        ez++
      }

      // Mark as visited
      for (let z = sz; z <= ez; z++) {
        for (let y = sy; y <= ey; y++) {
          for (let x = sx; x <= ex; x++) {
            visited.add(blockKey(x, y, z))
          }
        }
      }

      result.push({
        x: (sx - minX) * gridSize,
        y: (sy - minY) * gridSize,
        z: (sz - minZ) * gridSize,
        w: (ex - sx + 1) * gridSize,
        h: (ey - sy + 1) * gridSize,
        d: (ez - sz + 1) * gridSize,
        color,
      })
    }
  }

  return result
}

/**
 * Expand compressed ShapeBlocks back to individual editor cells.
 */
export function expandBlocks(shapeBlocks: ShapeBlock[], gridSize: number): Map<string, EditorBlock> {
  const cells = new Map<string, EditorBlock>()

  // Compute origin offset for the shape blocks
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (const block of shapeBlocks) {
    if (block.x < minX) minX = block.x
    if (block.y < minY) minY = block.y
    if (block.z < minZ) minZ = block.z
  }

  for (const block of shapeBlocks) {
    const cellsX = Math.round(block.w / gridSize)
    const cellsY = Math.round(block.h / gridSize)
    const cellsZ = Math.round(block.d / gridSize)
    const baseX = Math.round((block.x - minX) / gridSize)
    const baseY = Math.round((block.y - minY) / gridSize)
    const baseZ = Math.round((block.z - minZ) / gridSize)

    for (let dz = 0; dz < cellsZ; dz++) {
      for (let dy = 0; dy < cellsY; dy++) {
        for (let dx = 0; dx < cellsX; dx++) {
          const x = baseX + dx
          const y = baseY + dy
          const z = baseZ + dz
          const key = blockKey(x, y, z)
          cells.set(key, { x, y, z, color: block.color })
        }
      }
    }
  }

  return cells
}
