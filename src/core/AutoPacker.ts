import type { CargoItemDef, ContainerDef, PlacedCargo } from './types'
import type { VoxelizeResult } from './Voxelizer'
import { voxelize, voxelizeComposite } from './Voxelizer'

export interface PackResult {
  placements: PlacedCargo[]
  voxelizeResults: VoxelizeResult[]
  failedDefIds: string[]
}

/**
 * AABB shelf-packing algorithm. No VoxelGrid, no rotation.
 * O(n) — cursor advances through rows/layers.
 */
export function autoPack(
  cargoDefs: CargoItemDef[],
  container: ContainerDef,
  startInstanceId: number,
): PackResult {
  const placements: PlacedCargo[] = []
  const voxelizeResults: VoxelizeResult[] = []
  const failedDefIds: string[] = []

  // 体積降順ソート
  const sorted = [...cargoDefs].sort((a, b) => {
    const volA = a.widthCm * a.heightCm * a.depthCm
    const volB = b.widthCm * b.heightCm * b.depthCm
    return volB - volA
  })

  let nextId = startInstanceId
  // カーソルを画面奥(X=0)から開始
  let cursorX = 0
  let cursorZ = 0
  let cursorY = 0
  let rowMaxD = 0
  let layerMaxH = 0

  for (const def of sorted) {
    const w = def.widthCm
    const h = def.heightCm
    const d = def.depthCm

    // Advance to next row if item doesn't fit in current row
    if (cursorX + w > container.widthCm) {
      cursorX = 0
      cursorZ += rowMaxD
      rowMaxD = 0
    }

    // Advance to next layer if item doesn't fit in current row of rows
    if (cursorZ + d > container.depthCm) {
      cursorZ = 0
      cursorX = 0
      cursorY += layerMaxH
      layerMaxH = 0
    }

    // Item doesn't fit vertically — skip
    if (cursorY + h > container.heightCm) {
      failedDefIds.push(def.id)
      continue
    }

    // Also check width/depth fit after cursor reset
    if (cursorX + w > container.widthCm || cursorZ + d > container.depthCm) {
      failedDefIds.push(def.id)
      continue
    }

    // 画面奥(X=0)から手前に向かって配置
    const pos = { x: cursorX, y: cursorY, z: cursorZ }
    const rot = { x: 0, y: 0, z: 0 }

    const result = def.blocks
      ? voxelizeComposite(def.blocks, pos, rot)
      : voxelize(w, h, d, pos, rot)

    placements.push({
      instanceId: nextId,
      cargoDefId: def.id,
      positionCm: pos,
      rotationDeg: rot,
    })
    voxelizeResults.push(result)
    nextId++

    cursorX += w
    rowMaxD = Math.max(rowMaxD, d)
    layerMaxH = Math.max(layerMaxH, h)
  }

  return { placements, voxelizeResults, failedDefIds }
}
