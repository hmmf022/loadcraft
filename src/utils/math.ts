// Column-major Mat4 as Float32Array(16), WebGPU clip Z=[0,1]

export function vec3Add(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function vec3Sub(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function vec3Scale(v: { x: number; y: number; z: number }, s: number) {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function vec3Cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function vec3Dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function vec3Length(v: { x: number; y: number; z: number }) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

export function vec3Normalize(v: { x: number; y: number; z: number }) {
  const len = vec3Length(v)
  if (len === 0) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

// Column-major 4x4 matrix utilities

export function mat4Identity() {
  const m = new Float32Array(16)
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1
  return m
}

export function mat4Multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!
      }
      out[col * 4 + row] = sum
    }
  }
  return out
}

// WebGPU perspective: Z maps to [0,1]
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number) {
  const f = 1.0 / Math.tan(fovY / 2)
  const rangeInv = 1.0 / (near - far)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = far * rangeInv        // maps to [0,1] for WebGPU
  m[11] = -1
  m[14] = near * far * rangeInv
  return m
}

export function mat4LookAt(
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
) {
  const f = vec3Normalize(vec3Sub(target, eye))
  const s = vec3Normalize(vec3Cross(f, up))
  const u = vec3Cross(s, f)
  const m = new Float32Array(16)
  m[0] = s.x; m[1] = u.x; m[2] = -f.x; m[3] = 0
  m[4] = s.y; m[5] = u.y; m[6] = -f.y; m[7] = 0
  m[8] = s.z; m[9] = u.z; m[10] = -f.z; m[11] = 0
  m[12] = -vec3Dot(s, eye)
  m[13] = -vec3Dot(u, eye)
  m[14] = vec3Dot(f, eye)
  m[15] = 1
  return m
}

export function mat4Translation(x: number, y: number, z: number) {
  const m = mat4Identity()
  m[12] = x; m[13] = y; m[14] = z
  return m
}

export function mat4Scaling(sx: number, sy: number, sz: number) {
  const m = new Float32Array(16)
  m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1
  return m
}

export function mat4Inverse(m: Float32Array) {
  const out = new Float32Array(16)
  const m00 = m[0]!, m01 = m[1]!, m02 = m[2]!, m03 = m[3]!
  const m10 = m[4]!, m11 = m[5]!, m12 = m[6]!, m13 = m[7]!
  const m20 = m[8]!, m21 = m[9]!, m22 = m[10]!, m23 = m[11]!
  const m30 = m[12]!, m31 = m[13]!, m32 = m[14]!, m33 = m[15]!

  const b00 = m00 * m11 - m01 * m10
  const b01 = m00 * m12 - m02 * m10
  const b02 = m00 * m13 - m03 * m10
  const b03 = m01 * m12 - m02 * m11
  const b04 = m01 * m13 - m03 * m11
  const b05 = m02 * m13 - m03 * m12
  const b06 = m20 * m31 - m21 * m30
  const b07 = m20 * m32 - m22 * m30
  const b08 = m20 * m33 - m23 * m30
  const b09 = m21 * m32 - m22 * m31
  const b10 = m21 * m33 - m23 * m31
  const b11 = m22 * m33 - m23 * m32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < 1e-10) return mat4Identity()
  det = 1.0 / det

  out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * det
  out[1] = (m02 * b10 - m01 * b11 - m03 * b09) * det
  out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * det
  out[3] = (m22 * b04 - m21 * b05 - m23 * b03) * det
  out[4] = (m12 * b08 - m10 * b11 - m13 * b07) * det
  out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * det
  out[6] = (m32 * b02 - m30 * b05 - m33 * b01) * det
  out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * det
  out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * det
  out[9] = (m01 * b08 - m00 * b10 - m03 * b06) * det
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det

  return out
}
