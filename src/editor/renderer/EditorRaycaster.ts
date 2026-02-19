import { screenToNDC, constructRay, intersectRayAABBWithFace, intersectRayPlane } from '../../renderer/Raycaster'
import type { Ray, AABB, FaceHit } from '../../renderer/Raycaster'
import type { Vec3 } from '../../core/types'
import type { EditorBlock } from '../state/types'

export interface BlockPickResult {
  blockKey: string
  distance: number
  faceNormal: Vec3
  adjacentCell: { x: number; y: number; z: number }
  hitCell: { x: number; y: number; z: number }
}

export interface FloorPickResult {
  x: number
  y: number
  z: number
}

/** Pick the closest block and determine which face was hit */
export function pickBlock(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
  blocks: Map<string, EditorBlock>,
  gridSize: number,
): BlockPickResult | null {
  const [ndcX, ndcY] = screenToNDC(screenX, screenY, canvasW, canvasH)
  const ray = constructRay(ndcX, ndcY, inverseViewProj)

  let closest: { key: string; hit: FaceHit; block: EditorBlock } | null = null

  for (const [key, block] of blocks) {
    const gs = gridSize
    const aabb: AABB = {
      min: { x: block.x * gs, y: block.y * gs, z: block.z * gs },
      max: { x: (block.x + block.w) * gs, y: (block.y + block.h) * gs, z: (block.z + block.d) * gs },
    }

    const hit = intersectRayAABBWithFace(ray, aabb)
    if (hit && (closest === null || hit.distance < closest.hit.distance)) {
      closest = { key, hit, block }
    }
  }

  if (!closest) return null

  const { key, hit, block } = closest

  return {
    blockKey: key,
    distance: hit.distance,
    faceNormal: hit.faceNormal,
    adjacentCell: { x: block.x, y: block.y, z: block.z },
    hitCell: { x: block.x, y: block.y, z: block.z },
  }
}

/** Pick the floor plane (Y=0) and return the grid cell */
export function pickFloor(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
  gridSize: number,
  maxCells: number,
): FloorPickResult | null {
  const [ndcX, ndcY] = screenToNDC(screenX, screenY, canvasW, canvasH)
  const ray = constructRay(ndcX, ndcY, inverseViewProj)

  const hit = intersectRayPlane(ray, 0)
  if (!hit) return null

  const gs = gridSize
  const x = Math.floor(hit.x / gs)
  const z = Math.floor(hit.z / gs)

  // Bounds check
  if (x < 0 || z < 0 || x >= maxCells || z >= maxCells) return null

  return { x, y: 0, z }
}

/** Get the target cell for placement: block face takes priority over floor */
export function getPlacementTarget(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
  blocks: Map<string, EditorBlock>,
  gridSize: number,
  maxCells: number,
  newBlockSize?: { w: number; h: number; d: number },
): { x: number; y: number; z: number } | null {
  const nw = newBlockSize?.w ?? 1
  const nh = newBlockSize?.h ?? 1
  const nd = newBlockSize?.d ?? 1

  // Try block pick first
  const blockResult = pickBlock(screenX, screenY, canvasW, canvasH, inverseViewProj, blocks, gridSize)
  if (blockResult) {
    const hitBlock = blocks.get(blockResult.blockKey)!
    const n = blockResult.faceNormal

    let x: number, y: number, z: number
    if (n.x === 1) {
      x = hitBlock.x + hitBlock.w
      y = hitBlock.y
      z = hitBlock.z
    } else if (n.x === -1) {
      x = hitBlock.x - nw
      y = hitBlock.y
      z = hitBlock.z
    } else if (n.y === 1) {
      x = hitBlock.x
      y = hitBlock.y + hitBlock.h
      z = hitBlock.z
    } else if (n.y === -1) {
      x = hitBlock.x
      y = hitBlock.y - nh
      z = hitBlock.z
    } else if (n.z === 1) {
      x = hitBlock.x
      y = hitBlock.y
      z = hitBlock.z + hitBlock.d
    } else {
      x = hitBlock.x
      y = hitBlock.y
      z = hitBlock.z - nd
    }

    // Bounds check for new block
    if (x >= 0 && y >= 0 && z >= 0 &&
        x + nw <= maxCells && y + nh <= maxCells && z + nd <= maxCells) {
      return { x, y, z }
    }
  }

  // Fall back to floor pick
  const floor = pickFloor(screenX, screenY, canvasW, canvasH, inverseViewProj, gridSize, maxCells)
  if (floor && floor.x + nw <= maxCells && floor.z + nd <= maxCells) {
    return floor
  }
  return null
}

/** Get the target cell for erase/paint: returns the hit block's cell */
export function getBlockTarget(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
  blocks: Map<string, EditorBlock>,
  gridSize: number,
): { x: number; y: number; z: number } | null {
  const blockResult = pickBlock(screenX, screenY, canvasW, canvasH, inverseViewProj, blocks, gridSize)
  if (!blockResult) return null
  return blockResult.hitCell
}

/** Construct a ray from screen coordinates for external use */
export function screenToEditorRay(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
): Ray {
  const [ndcX, ndcY] = screenToNDC(screenX, screenY, canvasW, canvasH)
  return constructRay(ndcX, ndcY, inverseViewProj)
}
