import { mat4Perspective, mat4LookAt, mat4Multiply, mat4Inverse } from '../utils/math'

const CAMERA_UNIFORM_SIZE = 208 // 52 floats * 4 bytes

export class OrbitCamera {
  theta = Math.PI / 4   // azimuth
  phi = Math.PI / 4     // elevation
  radius = 2000
  target = { x: 295, y: 120, z: 118 } // center of 20ft container

  private fovY = (45 * Math.PI) / 180
  private near = 1
  private far = 20000
  private aspect = 1

  private minRadius = 100
  private maxRadius = 8000
  private minPhi = 0.01
  private maxPhi = Math.PI - 0.01

  private dirty = true
  private viewMatrix: Float32Array = new Float32Array(16)
  private projMatrix: Float32Array = new Float32Array(16)
  private viewProjMatrix: Float32Array = new Float32Array(16)
  private eyePosition = { x: 0, y: 0, z: 0 }

  rotate(deltaTheta: number, deltaPhi: number): void {
    this.theta += deltaTheta
    this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi + deltaPhi))
    this.dirty = true
  }

  zoom(delta: number): void {
    this.radius *= 1 + delta
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius))
    this.dirty = true
  }

  pan(deltaX: number, deltaY: number): void {
    const panSpeed = this.radius * 0.001
    // Extract right and up vectors from view matrix
    this.updateIfDirty()
    const right = {
      x: this.viewMatrix[0]!,
      y: this.viewMatrix[4]!,
      z: this.viewMatrix[8]!,
    }
    const up = {
      x: this.viewMatrix[1]!,
      y: this.viewMatrix[5]!,
      z: this.viewMatrix[9]!,
    }
    this.target.x += (-right.x * deltaX + up.x * deltaY) * panSpeed
    this.target.y += (-right.y * deltaX + up.y * deltaY) * panSpeed
    this.target.z += (-right.z * deltaX + up.z * deltaY) * panSpeed
    this.dirty = true
  }

  setAspect(aspect: number): void {
    this.aspect = aspect
    this.dirty = true
  }

  setState(state: { theta?: number; phi?: number; radius?: number; target?: { x: number; y: number; z: number } }): void {
    if (state.theta !== undefined) this.theta = state.theta
    if (state.phi !== undefined) this.phi = state.phi
    if (state.radius !== undefined) this.radius = state.radius
    if (state.target) this.target = { ...state.target }
    this.dirty = true
  }

  private updateIfDirty(): void {
    if (!this.dirty) return
    this.dirty = false

    // Compute eye position from spherical coordinates
    this.eyePosition = {
      x: this.radius * Math.sin(this.phi) * Math.sin(this.theta) + this.target.x,
      y: this.radius * Math.cos(this.phi) + this.target.y,
      z: this.radius * Math.sin(this.phi) * Math.cos(this.theta) + this.target.z,
    }

    this.viewMatrix = mat4LookAt(this.eyePosition, this.target, { x: 0, y: 1, z: 0 })
    this.projMatrix = mat4Perspective(this.fovY, this.aspect, this.near, this.far)
    this.viewProjMatrix = mat4Multiply(this.projMatrix, this.viewMatrix)
  }

  getUniformData() {
    this.updateIfDirty()
    const data = new Float32Array(52) // 208 bytes
    data.set(this.viewProjMatrix, 0)  // offset 0
    data.set(this.viewMatrix, 16)     // offset 16
    data.set(this.projMatrix, 32)     // offset 32
    data[48] = this.eyePosition.x     // offset 48
    data[49] = this.eyePosition.y
    data[50] = this.eyePosition.z
    data[51] = 0 // padding
    return data
  }

  getInverseViewProjMatrix() {
    this.updateIfDirty()
    return mat4Inverse(this.viewProjMatrix)
  }

  setConstraints(opts: { minRadius?: number; maxRadius?: number; minPhi?: number; maxPhi?: number }): void {
    if (opts.minRadius !== undefined) this.minRadius = opts.minRadius
    if (opts.maxRadius !== undefined) this.maxRadius = opts.maxRadius
    if (opts.minPhi !== undefined) this.minPhi = opts.minPhi
    if (opts.maxPhi !== undefined) this.maxPhi = opts.maxPhi
    this.dirty = true
  }

  markDirty(): void {
    this.dirty = true
  }
}

export { CAMERA_UNIFORM_SIZE }
