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

  // R = Rz * Rx * Ry (row-major)
  return [
    cz * cy + sz * sx * sy,    sz * cx,   cz * (-sy) + sz * sx * cy,
    -sz * cy + cz * sx * sy,   cz * cx,   sz * sy + cz * sx * cy,
    cx * sy,                   -sx,        cx * cy,
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

  // 8 corners of the box (origin-centered before rotation)
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

  // Snap near-integer values to avoid floating-point floor/ceil overshoot
  const snap = (v: number) => Math.abs(v - Math.round(v)) < 0.001 ? Math.round(v) : v

  return {
    min: { x: Math.floor(snap(minX)), y: Math.floor(snap(minY)), z: Math.floor(snap(minZ)) },
    max: { x: Math.ceil(snap(maxX)), y: Math.ceil(snap(maxY)), z: Math.ceil(snap(maxZ)) },
  }
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
  const aabb = computeRotatedAABB(w, h, d, position, rotationDeg)

  if (isAxisAligned(rotationDeg)) {
    return { voxels: [], usesFastPath: true, aabb }
  }

  // Slow path: enumerate voxels in AABB, check if center is inside the original box
  const invRot = buildRotation3x3({ x: -rotationDeg.x, y: -rotationDeg.y, z: -rotationDeg.z })
  const voxels: Vec3[] = []

  for (let vz = aabb.min.z; vz < aabb.max.z; vz++) {
    for (let vy = aabb.min.y; vy < aabb.max.y; vy++) {
      for (let vx = aabb.min.x; vx < aabb.max.x; vx++) {
        // Voxel center in world space (relative to position)
        const cx = vx + 0.5 - position.x
        const cy = vy + 0.5 - position.y
        const cz = vz + 0.5 - position.z

        // Inverse-rotate to local box space
        const local = rotatePoint(invRot, cx, cy, cz)

        // Check if inside [0, w] x [0, h] x [0, d]
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
  const allVoxels: Vec3[] = []
  const voxelSet = new Set<string>()

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const block of blocks) {
    // Block corners in local shape space
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

    // Find block AABB in world space
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

    const snap = (v: number) => Math.abs(v - Math.round(v)) < 0.001 ? Math.round(v) : v
    const vMinX = Math.floor(snap(bMinX)), vMinY = Math.floor(snap(bMinY)), vMinZ = Math.floor(snap(bMinZ))
    const vMaxX = Math.ceil(snap(bMaxX)), vMaxY = Math.ceil(snap(bMaxY)), vMaxZ = Math.ceil(snap(bMaxZ))

    // Update global AABB
    if (vMinX < minX) minX = vMinX; if (vMinY < minY) minY = vMinY; if (vMinZ < minZ) minZ = vMinZ
    if (vMaxX > maxX) maxX = vMaxX; if (vMaxY > maxY) maxY = vMaxY; if (vMaxZ > maxZ) maxZ = vMaxZ

    // Build inverse rotation for containment test
    const invRot = buildRotation3x3({ x: -rotationDeg.x, y: -rotationDeg.y, z: -rotationDeg.z })

    // Enumerate voxels in block AABB
    for (let vz = vMinZ; vz < vMaxZ; vz++) {
      for (let vy = vMinY; vy < vMaxY; vy++) {
        for (let vx = vMinX; vx < vMaxX; vx++) {
          const key = `${vx},${vy},${vz}`
          if (voxelSet.has(key)) continue

          // Voxel center in world space, relative to position
          const cx = vx + 0.5 - position.x
          const cy = vy + 0.5 - position.y
          const cz = vz + 0.5 - position.z

          // Inverse-rotate to local shape space
          const local = rotatePoint(invRot, cx, cy, cz)

          // Check if inside this block [block.x, block.x+block.w] × etc
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

  return {
    voxels: allVoxels,
    usesFastPath: false,
    aabb: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
  }
}
