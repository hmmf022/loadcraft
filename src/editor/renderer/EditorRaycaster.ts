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
      max: { x: (block.x + 1) * gs, y: (block.y + 1) * gs, z: (block.z + 1) * gs },
    }

    const hit = intersectRayAABBWithFace(ray, aabb)
    if (hit && (closest === null || hit.distance < closest.hit.distance)) {
      closest = { key, hit, block }
    }
  }

  if (!closest) return null

  const { key, hit, block } = closest
  const adjacentCell = {
    x: block.x + hit.faceNormal.x,
    y: block.y + hit.faceNormal.y,
    z: block.z + hit.faceNormal.z,
  }

  return {
    blockKey: key,
    distance: hit.distance,
    faceNormal: hit.faceNormal,
    adjacentCell,
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
): { x: number; y: number; z: number } | null {
  // Try block pick first
  const blockResult = pickBlock(screenX, screenY, canvasW, canvasH, inverseViewProj, blocks, gridSize)
  if (blockResult) {
    const { x, y, z } = blockResult.adjacentCell
    // Bounds check for adjacent cell
    if (x >= 0 && y >= 0 && z >= 0 && x < maxCells && y < maxCells && z < maxCells) {
      return { x, y, z }
    }
  }

  // Fall back to floor pick
  return pickFloor(screenX, screenY, canvasW, canvasH, inverseViewProj, gridSize, maxCells)
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
