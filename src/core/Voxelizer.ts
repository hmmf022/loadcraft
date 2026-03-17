import type { Vec3, ShapeBlock } from './types'

export interface VoxelizeResult {
  voxels: Vec3[]
  usesFastPath: boolean
  aabb: { min: Vec3; max: Vec3 }
}

const DEG_TO_RAD = Math.PI / 180

/** Check if all rotation components are multiples of 90 degrees */
export function isAxisAligned(rotationDeg: Vec3): boolean {
  const mod = (v: number) => {
    const m = ((v % 360) + 360) % 360
    return m % 90 < 0.001 || (90 - (m % 90)) < 0.001
  }
  return mod(rotationDeg.x) && mod(rotationDeg.y) && mod(rotationDeg.z)
}

/** Build 3x3 rotation matrix (row-major) for Y-X-Z order: R = Rz * Rx * Ry */
function buildRotation3x3(rotDeg: Vec3): number[] {
  const rx = rotDeg.x * DEG_TO_RAD
  const ry = rotDeg.y * DEG_TO_RAD
  const rz = rotDeg.z * DEG_TO_RAD
  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cz = Math.cos(rz), sz = Math.sin(rz)

  // R = Rz * Rx * Ry (row-major, standard right-hand rotation)
  return [
    cz * cy - sz * sx * sy,   -sz * cx,   cz * sy + sz * sx * cy,
    sz * cy + cz * sx * sy,    cz * cx,   sz * sy - cz * sx * cy,
    -cx * sy,                   sx,        cx * cy,
  ]
}

/** Rotate a point by the 3x3 matrix (row-major) */
function rotatePoint(m: number[], x: number, y: number, z: number): Vec3 {
  return {
    x: m[0]! * x + m[1]! * y + m[2]! * z,
    y: m[3]! * x + m[4]! * y + m[5]! * z,
    z: m[6]! * x + m[7]! * y + m[8]! * z,
  }
}

/** Snap near-integer values to avoid floating-point floor/ceil overshoot */
const snap = (v: number) => Math.abs(v - Math.round(v)) < 0.001 ? Math.round(v) : v

/** Internal: compute AABB from a pre-built rotation matrix */
function computeAABBFromMatrix(
  w: number, h: number, d: number,
  position: Vec3, rot: number[],
  exact: boolean,
): { min: Vec3; max: Vec3 } {
  const corners = [
    [0, 0, 0], [w, 0, 0], [0, h, 0], [0, 0, d],
    [w, h, 0], [w, 0, d], [0, h, d], [w, h, d],
  ]

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const [cx, cy, cz] of corners) {
    const p = rotatePoint(rot, cx!, cy!, cz!)
    const px = p.x + position.x
    const py = p.y + position.y
    const pz = p.z + position.z
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (pz < minZ) minZ = pz
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
    if (pz > maxZ) maxZ = pz
  }

  if (exact) {
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    }
  }

  return {
    min: { x: Math.floor(snap(minX)), y: Math.floor(snap(minY)), z: Math.floor(snap(minZ)) },
    max: { x: Math.ceil(snap(maxX)), y: Math.ceil(snap(maxY)), z: Math.ceil(snap(maxZ)) },
  }
}

/** Compute the AABB of a rotated box at the given position.
 *  exact=true returns raw floating-point bounds (for picking);
 *  exact=false (default) snaps to integer voxel bounds.
 */
export function computeRotatedAABB(
  w: number, h: number, d: number,
  position: Vec3, rotationDeg: Vec3,
  exact = false,
): { min: Vec3; max: Vec3 } {
  const rot = buildRotation3x3(rotationDeg)
  return computeAABBFromMatrix(w, h, d, position, rot, exact)
}

/**
 * Voxelize a box with dimensions (w,h,d) placed at position with given rotation.
 *
 * Fast path (axis-aligned): returns empty voxels array, AABB only. Caller uses fillBox.
 * Slow path (arbitrary rotation): returns list of occupied voxel coordinates.
 */
export function voxelize(
  w: number, h: number, d: number,
  position: Vec3, rotationDeg: Vec3,
): VoxelizeResult {
  if (isAxisAligned(rotationDeg)) {
    const aabb = computeRotatedAABB(w, h, d, position, rotationDeg)
    return { voxels: [], usesFastPath: true, aabb }
  }

  // Slow path: build rotation matrix once for both AABB and voxel enumeration
  const fwd = buildRotation3x3(rotationDeg)
  const aabb = computeAABBFromMatrix(w, h, d, position, fwd, false)

  // Inverse of orthogonal rotation matrix = transpose
  const invRot = [fwd[0]!, fwd[3]!, fwd[6]!, fwd[1]!, fwd[4]!, fwd[7]!, fwd[2]!, fwd[5]!, fwd[8]!]
  const voxels: Vec3[] = []

  for (let vz = aabb.min.z; vz < aabb.max.z; vz++) {
    for (let vy = aabb.min.y; vy < aabb.max.y; vy++) {
      for (let vx = aabb.min.x; vx < aabb.max.x; vx++) {
        const cx = vx + 0.5 - position.x
        const cy = vy + 0.5 - position.y
        const cz = vz + 0.5 - position.z
        const local = rotatePoint(invRot, cx, cy, cz)
        if (local.x >= 0 && local.x <= w &&
            local.y >= 0 && local.y <= h &&
            local.z >= 0 && local.z <= d) {
          voxels.push({ x: vx, y: vy, z: vz })
        }
      }
    }
  }

  return { voxels, usesFastPath: false, aabb }
}

/**
 * Voxelize a composite shape (multiple blocks) at a given position with rotation.
 * Each block is individually voxelized and the results are unioned.
 * Always uses slow path (returns voxel list).
 */
export function voxelizeComposite(
  blocks: ShapeBlock[],
  position: Vec3,
  rotationDeg: Vec3,
): VoxelizeResult {
  if (blocks.length === 0) {
    return { voxels: [], usesFastPath: false, aabb: { min: position, max: position } }
  }

  const rot = buildRotation3x3(rotationDeg)
  // Hoist inverse rotation outside the block loop (same for all blocks)
  const invRot = [rot[0]!, rot[3]!, rot[6]!, rot[1]!, rot[4]!, rot[7]!, rot[2]!, rot[5]!, rot[8]!]

  // Pre-pass: compute all block AABBs and the global AABB
  interface BlockBounds {
    vMinX: number; vMinY: number; vMinZ: number
    vMaxX: number; vMaxY: number; vMaxZ: number
    block: ShapeBlock
  }
  const blockBounds: BlockBounds[] = []

  let globalMinX = Infinity, globalMinY = Infinity, globalMinZ = Infinity
  let globalMaxX = -Infinity, globalMaxY = -Infinity, globalMaxZ = -Infinity

  for (const block of blocks) {
    const corners = [
      [block.x, block.y, block.z],
      [block.x + block.w, block.y, block.z],
      [block.x, block.y + block.h, block.z],
      [block.x, block.y, block.z + block.d],
      [block.x + block.w, block.y + block.h, block.z],
      [block.x + block.w, block.y, block.z + block.d],
      [block.x, block.y + block.h, block.z + block.d],
      [block.x + block.w, block.y + block.h, block.z + block.d],
    ]

    let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity
    let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity

    for (const [cx, cy, cz] of corners) {
      const p = rotatePoint(rot, cx!, cy!, cz!)
      const px = p.x + position.x
      const py = p.y + position.y
      const pz = p.z + position.z
      if (px < bMinX) bMinX = px; if (py < bMinY) bMinY = py; if (pz < bMinZ) bMinZ = pz
      if (px > bMaxX) bMaxX = px; if (py > bMaxY) bMaxY = py; if (pz > bMaxZ) bMaxZ = pz
    }

    const vMinX = Math.floor(snap(bMinX)), vMinY = Math.floor(snap(bMinY)), vMinZ = Math.floor(snap(bMinZ))
    const vMaxX = Math.ceil(snap(bMaxX)), vMaxY = Math.ceil(snap(bMaxY)), vMaxZ = Math.ceil(snap(bMaxZ))

    if (vMinX < globalMinX) globalMinX = vMinX; if (vMinY < globalMinY) globalMinY = vMinY; if (vMinZ < globalMinZ) globalMinZ = vMinZ
    if (vMaxX > globalMaxX) globalMaxX = vMaxX; if (vMaxY > globalMaxY) globalMaxY = vMaxY; if (vMaxZ > globalMaxZ) globalMaxZ = vMaxZ

    blockBounds.push({ vMinX, vMinY, vMinZ, vMaxX, vMaxY, vMaxZ, block })
  }

  // Check if any block AABBs overlap (if not, skip deduplication set entirely)
  let hasOverlap = false
  if (blockBounds.length > 1) {
    for (let i = 0; i < blockBounds.length && !hasOverlap; i++) {
      for (let j = i + 1; j < blockBounds.length && !hasOverlap; j++) {
        const a = blockBounds[i]!
        const b = blockBounds[j]!
        if (a.vMinX < b.vMaxX && a.vMaxX > b.vMinX &&
            a.vMinY < b.vMaxY && a.vMaxY > b.vMinY &&
            a.vMinZ < b.vMaxZ && a.vMaxZ > b.vMinZ) {
          hasOverlap = true
        }
      }
    }
  }

  const allVoxels: Vec3[] = []

  if (hasOverlap) {
    // Use numeric hash for deduplication (avoids string allocation + GC pressure)
    const rangeX = globalMaxX - globalMinX
    const rangeY = globalMaxY - globalMinY
    const voxelSet = new Set<number>()

    for (const bb of blockBounds) {
      const block = bb.block
      for (let vz = bb.vMinZ; vz < bb.vMaxZ; vz++) {
        for (let vy = bb.vMinY; vy < bb.vMaxY; vy++) {
          for (let vx = bb.vMinX; vx < bb.vMaxX; vx++) {
            const key = (vx - globalMinX) + rangeX * ((vy - globalMinY) + rangeY * (vz - globalMinZ))
            if (voxelSet.has(key)) continue
            const cx = vx + 0.5 - position.x
            const cy = vy + 0.5 - position.y
            const cz = vz + 0.5 - position.z
            const local = rotatePoint(invRot, cx, cy, cz)
            if (local.x >= block.x && local.x <= block.x + block.w &&
                local.y >= block.y && local.y <= block.y + block.h &&
                local.z >= block.z && local.z <= block.z + block.d) {
              voxelSet.add(key)
              allVoxels.push({ x: vx, y: vy, z: vz })
            }
          }
        }
      }
    }
  } else {
    // No overlap between blocks: concatenate without deduplication
    for (const bb of blockBounds) {
      const block = bb.block
      for (let vz = bb.vMinZ; vz < bb.vMaxZ; vz++) {
        for (let vy = bb.vMinY; vy < bb.vMaxY; vy++) {
          for (let vx = bb.vMinX; vx < bb.vMaxX; vx++) {
            const cx = vx + 0.5 - position.x
            const cy = vy + 0.5 - position.y
            const cz = vz + 0.5 - position.z
            const local = rotatePoint(invRot, cx, cy, cz)
            if (local.x >= block.x && local.x <= block.x + block.w &&
                local.y >= block.y && local.y <= block.y + block.h &&
                local.z >= block.z && local.z <= block.z + block.d) {
              allVoxels.push({ x: vx, y: vy, z: vz })
            }
          }
        }
      }
    }
  }

  return {
    voxels: allVoxels,
    usesFastPath: false,
    aabb: {
      min: { x: globalMinX, y: globalMinY, z: globalMinZ },
      max: { x: globalMaxX, y: globalMaxY, z: globalMaxZ },
    },
  }
}

/** Rotate a Vec3 by Y-X-Z Euler angles (same rotation order used throughout the engine) */
export function rotateVec3(v: Vec3, rotationDeg: Vec3): Vec3 {
  const m = buildRotation3x3(rotationDeg)
  return rotatePoint(m, v.x, v.y, v.z)
}
