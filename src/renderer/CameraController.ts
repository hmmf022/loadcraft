import type { OrbitCamera } from './Camera'

export class CameraController {
  private camera: OrbitCamera
  private canvas: HTMLCanvasElement
  private isDragging = false
  private button = -1
  private lastX = 0
  private lastY = 0

  private rotateSensitivity = 0.005
  private zoomSensitivity = 0.001

  private onMouseDown: (e: MouseEvent) => void
  private onMouseMove: (e: MouseEvent) => void
  private onMouseUp: (e: MouseEvent) => void
  private onWheel: (e: WheelEvent) => void
  private onContextMenu: (e: Event) => void

  constructor(camera: OrbitCamera, canvas: HTMLCanvasElement) {
    this.camera = camera
    this.canvas = canvas

    this.onMouseDown = (e: MouseEvent) => {
      this.isDragging = true
      this.button = e.button
      this.lastX = e.clientX
      this.lastY = e.clientY
      e.preventDefault()
    }

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY

      if (this.button === 0) {
        // Left button: orbit
        this.camera.rotate(-dx * this.rotateSensitivity, -dy * this.rotateSensitivity)
      } else if (this.button === 1 || this.button === 2) {
        // Middle/Right button: pan
        this.camera.pan(dx, dy)
      }
    }

    this.onMouseUp = () => {
      this.isDragging = false
      this.button = -1
    }

    this.onWheel = (e: WheelEvent) => {
      e.preventDefault()
      this.camera.zoom(e.deltaY * this.zoomSensitivity)
    }

    this.onContextMenu = (e: Event) => {
      e.preventDefault()
    }

    this.canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
  }
}
