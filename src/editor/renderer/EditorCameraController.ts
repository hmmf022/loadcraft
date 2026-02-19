import type { OrbitCamera } from '../../renderer/Camera'

export type ClickCallback = (screenX: number, screenY: number) => void
export type HoverCallback = (screenX: number, screenY: number) => void

export class EditorCameraController {
  private camera: OrbitCamera
  private canvas: HTMLCanvasElement
  private isDragging = false
  private button = -1
  private lastX = 0
  private lastY = 0
  private startX = 0
  private startY = 0

  private rotateSensitivity = 0.005
  private zoomSensitivity = 0.001
  private clickThreshold = 5

  onClick: ClickCallback | null = null
  onHover: HoverCallback | null = null
  onOrbitStart: (() => void) | null = null

  private _onMouseDown: (e: MouseEvent) => void
  private _onMouseMove: (e: MouseEvent) => void
  private _onMouseUp: (e: MouseEvent) => void
  private _onWheel: (e: WheelEvent) => void
  private _onContextMenu: (e: Event) => void

  constructor(camera: OrbitCamera, canvas: HTMLCanvasElement) {
    this.camera = camera
    this.canvas = canvas

    this._onMouseDown = (e: MouseEvent) => {
      this.isDragging = true
      this.button = e.button
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.startX = e.clientX
      this.startY = e.clientY
      e.preventDefault()
    }

    this._onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) {
        // Hover: update ghost position
        const rect = this.canvas.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        this.onHover?.(
          (e.clientX - rect.left) * dpr,
          (e.clientY - rect.top) * dpr,
        )
        return
      }

      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY

      if (this.button === 0) {
        // Left button: orbit
        this.onOrbitStart?.()
        this.camera.rotate(-dx * this.rotateSensitivity, -dy * this.rotateSensitivity)
      } else if (this.button === 1 || this.button === 2) {
        // Middle/Right button: pan
        this.camera.pan(dx, dy)
      }
    }

    this._onMouseUp = (e: MouseEvent) => {
      if (this.isDragging && this.button === 0) {
        const totalDx = e.clientX - this.startX
        const totalDy = e.clientY - this.startY
        const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy)

        if (totalDist < this.clickThreshold) {
          const rect = this.canvas.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          this.onClick?.(
            (e.clientX - rect.left) * dpr,
            (e.clientY - rect.top) * dpr,
          )
        }
      }
      this.isDragging = false
      this.button = -1
    }

    this._onWheel = (e: WheelEvent) => {
      e.preventDefault()
      this.camera.zoom(e.deltaY * this.zoomSensitivity)
    }

    this._onContextMenu = (e: Event) => {
      e.preventDefault()
    }

    this.canvas.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this._onContextMenu)
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    this.canvas.removeEventListener('wheel', this._onWheel)
    this.canvas.removeEventListener('contextmenu', this._onContextMenu)
  }
}
