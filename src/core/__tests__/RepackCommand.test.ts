import { describe, it, expect } from 'vitest'
import { VoxelGrid } from '../VoxelGrid'
import { RepackCommand } from '../History'
import type { PlacedCargo, CargoItemDef, Vec3 } from '../types'
import type { VoxelizeResult } from '../Voxelizer'
import type { VoxelizeFn } from '../History'
import { voxelize } from '../Voxelizer'

function makeDef(id: string, w: number, h: number, d: number): CargoItemDef {
  return { id, name: id, widthCm: w, heightCm: h, depthCm: d, weightKg: 1, color: '#ff0000' }
}

function makePlacement(instanceId: number, defId: string, pos: Vec3): PlacedCargo {
  return { instanceId, cargoDefId: defId, positionCm: pos, rotationDeg: { x: 0, y: 0, z: 0 } }
}

const testVoxelizeFn: VoxelizeFn = (def, pos, _rot) => {
  return voxelize(def.widthCm, def.heightCm, def.depthCm, pos, _rot)
}

function fillFromResult(grid: VoxelGrid, result: VoxelizeResult, id: number): void {
  if (result.usesFastPath) {
    const { min, max } = result.aabb
    grid.fillBox(min.x, min.y, min.z, max.x - 1, max.y - 1, max.z - 1, id)
  } else {
    grid.fillVoxels(result.voxels, id)
  }
}

describe('RepackCommand', () => {
  it('execute clears grid and fills added items', () => {
    const grid = new VoxelGrid(20, 20, 20)
    const defA = makeDef('a', 5, 5, 5)

    // Pre-fill grid with old placement
    const oldResult = voxelize(5, 5, 5, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    fillFromResult(grid, oldResult, 1)
    expect(grid.get(0, 0, 0)).toBe(1)

    // New placement at different position
    const newPlacement = makePlacement(2, 'a', { x: 10, y: 0, z: 0 })
    const newResult = voxelize(5, 5, 5, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })

    const cmd = new RepackCommand(
      [{ placement: makePlacement(1, 'a', { x: 0, y: 0, z: 0 }), def: defA }],
      [{ placement: newPlacement, result: newResult }],
      testVoxelizeFn,
    )

    cmd.execute(grid)

    // Old position should be cleared
    expect(grid.get(0, 0, 0)).toBe(0)
    // New position should be filled
    expect(grid.get(10, 0, 0)).toBe(2)
    expect(grid.get(14, 4, 4)).toBe(2)
  })

  it('undo restores removed items via lazy voxelization', () => {
    const grid = new VoxelGrid(20, 20, 20)
    const defA = makeDef('a', 5, 5, 5)

    const oldPlacement = makePlacement(1, 'a', { x: 0, y: 0, z: 0 })
    const newPlacement = makePlacement(2, 'a', { x: 10, y: 0, z: 0 })
    const newResult = voxelize(5, 5, 5, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })

    const cmd = new RepackCommand(
      [{ placement: oldPlacement, def: defA }],
      [{ placement: newPlacement, result: newResult }],
      testVoxelizeFn,
    )

    // Execute first
    cmd.execute(grid)
    expect(grid.get(10, 0, 0)).toBe(2)
    expect(grid.get(0, 0, 0)).toBe(0)

    // Undo
    cmd.undo(grid)

    // Old placement should be restored
    expect(grid.get(0, 0, 0)).toBe(1)
    expect(grid.get(4, 4, 4)).toBe(1)
    // New placement should be gone
    expect(grid.get(10, 0, 0)).toBe(0)
  })

  it('execute then undo preserves occupiedCount', () => {
    const grid = new VoxelGrid(20, 20, 20)
    const defA = makeDef('a', 5, 5, 5)
    const defB = makeDef('b', 3, 3, 3)

    // Pre-fill with two placements
    const resultA = voxelize(5, 5, 5, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    fillFromResult(grid, resultA, 1)
    const resultB = voxelize(3, 3, 3, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    fillFromResult(grid, resultB, 2)
    const originalOccupied = grid.occupiedCount // 125 + 27 = 152

    // Repack: both items moved
    const newResultA = voxelize(5, 5, 5, { x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 })
    const newResultB = voxelize(3, 3, 3, { x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 0 })

    const cmd = new RepackCommand(
      [
        { placement: makePlacement(1, 'a', { x: 0, y: 0, z: 0 }), def: defA },
        { placement: makePlacement(2, 'b', { x: 5, y: 0, z: 0 }), def: defB },
      ],
      [
        { placement: makePlacement(3, 'a', { x: 0, y: 0, z: 5 }), result: newResultA },
        { placement: makePlacement(4, 'b', { x: 5, y: 0, z: 5 }), result: newResultB },
      ],
      testVoxelizeFn,
    )

    cmd.execute(grid)
    expect(grid.occupiedCount).toBe(originalOccupied)

    cmd.undo(grid)
    expect(grid.occupiedCount).toBe(originalOccupied)
    // Verify original positions restored
    expect(grid.get(0, 0, 0)).toBe(1)
    expect(grid.get(5, 0, 0)).toBe(2)
  })

  it('getDescription includes item count', () => {
    const defA = makeDef('a', 2, 2, 2)
    const result = voxelize(2, 2, 2, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    const cmd = new RepackCommand(
      [{ placement: makePlacement(1, 'a', { x: 0, y: 0, z: 0 }), def: defA }],
      [
        { placement: makePlacement(2, 'a', { x: 0, y: 0, z: 0 }), result },
        { placement: makePlacement(3, 'a', { x: 2, y: 0, z: 0 }), result },
      ],
      testVoxelizeFn,
    )
    expect(cmd.getDescription()).toBe('Repack (2 items)')
  })
})
