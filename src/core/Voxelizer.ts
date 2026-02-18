import type { Vec3 } from './types'

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

/** Compute the AABB of a rotated box at the given position */
export function computeRotatedAABB(
  w: number, h: number, d: number,
  position: Vec3, rotationDeg: Vec3,
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
