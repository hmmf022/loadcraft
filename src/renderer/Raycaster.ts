import type { Vec3 } from '../core/types'
import { vec3Sub, vec3Normalize } from '../utils/math'

export interface Ray {
  origin: Vec3
  direction: Vec3
}

export interface AABB {
  min: Vec3
  max: Vec3
}

export interface RaycastHit {
  instanceId: number
  distance: number
  point: Vec3
}

/** Convert screen pixel coordinates to NDC [-1,1] range */
export function screenToNDC(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
): [number, number] {
  const ndcX = (screenX / canvasW) * 2 - 1
  const ndcY = 1 - (screenY / canvasH) * 2 // Y flipped
  return [ndcX, ndcY]
}

/** Construct a ray from NDC coordinates using inverse view-projection matrix */
export function constructRay(
  ndcX: number, ndcY: number,
  inverseViewProj: Float32Array,
): Ray {
  // WebGPU NDC Z range is [0, 1]
  const nearPoint = transformPoint(ndcX, ndcY, 0, inverseViewProj)
  const farPoint = transformPoint(ndcX, ndcY, 1, inverseViewProj)
  const direction = vec3Normalize(vec3Sub(farPoint, nearPoint))
  return { origin: nearPoint, direction }
}

/** Transform a clip-space point by inverse VP matrix, apply perspective divide */
function transformPoint(x: number, y: number, z: number, invVP: Float32Array): Vec3 {
  const w =
    invVP[3]! * x + invVP[7]! * y + invVP[11]! * z + invVP[15]!
  const ox =
    invVP[0]! * x + invVP[4]! * y + invVP[8]! * z + invVP[12]!
  const oy =
    invVP[1]! * x + invVP[5]! * y + invVP[9]! * z + invVP[13]!
  const oz =
    invVP[2]! * x + invVP[6]! * y + invVP[10]! * z + invVP[14]!
  return { x: ox / w, y: oy / w, z: oz / w }
}

/** Slab method ray-AABB intersection. Returns distance or null. */
export function intersectRayAABB(ray: Ray, aabb: AABB): number | null {
  let tmin = -Infinity
  let tmax = Infinity

  // X slab
  if (Math.abs(ray.direction.x) < 1e-10) {
    if (ray.origin.x < aabb.min.x || ray.origin.x > aabb.max.x) return null
  } else {
    const invD = 1 / ray.direction.x
    let t1 = (aabb.min.x - ray.origin.x) * invD
    let t2 = (aabb.max.x - ray.origin.x) * invD
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  // Y slab
  if (Math.abs(ray.direction.y) < 1e-10) {
    if (ray.origin.y < aabb.min.y || ray.origin.y > aabb.max.y) return null
  } else {
    const invD = 1 / ray.direction.y
    let t1 = (aabb.min.y - ray.origin.y) * invD
    let t2 = (aabb.max.y - ray.origin.y) * invD
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  // Z slab
  if (Math.abs(ray.direction.z) < 1e-10) {
    if (ray.origin.z < aabb.min.z || ray.origin.z > aabb.max.z) return null
  } else {
    const invD = 1 / ray.direction.z
    let t1 = (aabb.min.z - ray.origin.z) * invD
    let t2 = (aabb.max.z - ray.origin.z) * invD
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  if (tmax < 0) return null
  return tmin >= 0 ? tmin : tmax
}

export interface FaceHit {
  distance: number
  point: Vec3
  faceNormal: Vec3
}

/** Slab method ray-AABB intersection with face normal detection. */
export function intersectRayAABBWithFace(ray: Ray, aabb: AABB): FaceHit | null {
  let tmin = -Infinity
  let tmax = Infinity
  let tminAxis = -1
  let tminSign = 1

  // X slab
  if (Math.abs(ray.direction.x) < 1e-10) {
    if (ray.origin.x < aabb.min.x || ray.origin.x > aabb.max.x) return null
  } else {
    const invD = 1 / ray.direction.x
    let t1 = (aabb.min.x - ray.origin.x) * invD
    let t2 = (aabb.max.x - ray.origin.x) * invD
    let sign = 1
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = -1 }
    if (t1 > tmin) { tmin = t1; tminAxis = 0; tminSign = sign }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  // Y slab
  if (Math.abs(ray.direction.y) < 1e-10) {
    if (ray.origin.y < aabb.min.y || ray.origin.y > aabb.max.y) return null
  } else {
    const invD = 1 / ray.direction.y
    let t1 = (aabb.min.y - ray.origin.y) * invD
    let t2 = (aabb.max.y - ray.origin.y) * invD
    let sign = 1
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = -1 }
    if (t1 > tmin) { tmin = t1; tminAxis = 1; tminSign = sign }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  // Z slab
  if (Math.abs(ray.direction.z) < 1e-10) {
    if (ray.origin.z < aabb.min.z || ray.origin.z > aabb.max.z) return null
  } else {
    const invD = 1 / ray.direction.z
    let t1 = (aabb.min.z - ray.origin.z) * invD
    let t2 = (aabb.max.z - ray.origin.z) * invD
    let sign = 1
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = -1 }
    if (t1 > tmin) { tmin = t1; tminAxis = 2; tminSign = sign }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  if (tmax < 0) return null
  const t = tmin >= 0 ? tmin : tmax

  const point: Vec3 = {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  }

  // Determine face normal from the axis that determined tmin
  const faceNormal: Vec3 = { x: 0, y: 0, z: 0 }
  if (tminAxis === 0) faceNormal.x = -tminSign
  else if (tminAxis === 1) faceNormal.y = -tminSign
  else faceNormal.z = -tminSign

  return { distance: t, point, faceNormal }
}

export interface PickItem {
  instanceId: number
  aabb: AABB
}

/** Pick the closest intersecting AABB from screen coordinates */
export function pick(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
  items: PickItem[],
): RaycastHit | null {
  const [ndcX, ndcY] = screenToNDC(screenX, screenY, canvasW, canvasH)
  const ray = constructRay(ndcX, ndcY, inverseViewProj)

  let closest: RaycastHit | null = null

  for (const item of items) {
    const dist = intersectRayAABB(ray, item.aabb)
    if (dist !== null && (closest === null || dist < closest.distance)) {
      closest = {
        instanceId: item.instanceId,
        distance: dist,
        point: {
          x: ray.origin.x + ray.direction.x * dist,
          y: ray.origin.y + ray.direction.y * dist,
          z: ray.origin.z + ray.direction.z * dist,
        },
      }
    }
  }

  return closest
}

/** Intersect ray with a horizontal plane at Y=planeY */
export function intersectRayPlane(ray: Ray, planeY: number): Vec3 | null {
  if (Math.abs(ray.direction.y) < 1e-10) return null
  const t = (planeY - ray.origin.y) / ray.direction.y
  if (t < 0) return null
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: planeY,
    z: ray.origin.z + ray.direction.z * t,
  }
}

/** Construct ray from screen coordinates (convenience) */
export function screenToRay(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  inverseViewProj: Float32Array,
): Ray {
  const [ndcX, ndcY] = screenToNDC(screenX, screenY, canvasW, canvasH)
  return constructRay(ndcX, ndcY, inverseViewProj)
}
