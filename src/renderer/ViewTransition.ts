import type { OrbitCamera } from './Camera'

const DURATION = 300 // ms
const TWO_PI = Math.PI * 2

export class ViewTransition {
  private camera: OrbitCamera
  private active = false
  private startTime = 0
  private fromTheta = 0
  private fromPhi = 0
  private toTheta = 0
  private toPhi = 0

  constructor(camera: OrbitCamera) {
    this.camera = camera
  }

  transitionTo(theta: number, phi: number): void {
    this.fromTheta = this.camera.theta
    this.fromPhi = this.camera.phi
    this.toTheta = theta
    this.toPhi = phi
    this.startTime = performance.now()
    this.active = true
  }

  /** Call every frame. Returns true while animating. */
  update(): boolean {
    if (!this.active) return false

    const elapsed = performance.now() - this.startTime
    const t = Math.min(elapsed / DURATION, 1)
    const eased = 1 - (1 - t) ** 3 // ease-out cubic

    const theta = this.fromTheta + shortestAngleDelta(this.fromTheta, this.toTheta) * eased
    const phi = this.fromPhi + (this.toPhi - this.fromPhi) * eased

    this.camera.setState({ theta, phi })

    if (t >= 1) {
      this.active = false
    }
    return this.active
  }

  cancel(): void {
    this.active = false
  }

  get isActive(): boolean {
    return this.active
  }
}

/** Compute the shortest-path delta between two angles */
function shortestAngleDelta(from: number, to: number): number {
  const delta = ((to - from) % TWO_PI + TWO_PI + Math.PI) % TWO_PI - Math.PI
  return delta
}
