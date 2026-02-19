import type { OrbitCamera } from './Camera'

export type ClickCallback = (screenX: number, screenY: number) => void
export type MoveStartCallback = (screenX: number, screenY: number) => void
export type MoveCallback = (screenX: number, screenY: number) => void
export type MoveEndCallback = (screenX: number, screenY: number) => void
export type RotateStartCallback = (screenX: number, screenY: number) => void
export type RotateDragCallback = (dx: number, dy: number) => void
export type RotateEndCallback = () => void

export class CameraController {
  private camera: OrbitCamera
  private canvas: HTMLCanvasElement
  private isDragging = false
  private button = -1
  private lastX = 0
  private lastY = 0
  private startX = 0
  private startY = 0
  // startTime reserved for future hold-to-move detection

  private rotateSensitivity = 0.005
  private zoomSensitivity = 0.001

  // Click detection: mouseup within 5px of mousedown = click
  private clickThreshold = 5

  // Move mode: selected object drag
  private moveMode = false
  private moveEnabled = false

  // Rotate mode: Shift+left drag to rotate selected object
  private rotateMode = false

  onClick: ClickCallback | null = null
  onMoveStart: MoveStartCallback | null = null
  onMove: MoveCallback | null = null
  onMoveEnd: MoveEndCallback | null = null
  onRotateStart: RotateStartCallback | null = null
  onRotateDrag: RotateDragCallback | null = null
  onRotateEnd: RotateEndCallback | null = null
  onOrbitStart: (() => void) | null = null

  /** Set to true when a selected object is under the cursor */
  setMoveEnabled(enabled: boolean): void {
    this.moveEnabled = enabled
  }

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
      // Record start time for potential hold detection
      this.moveMode = false
      e.preventDefault()
    }

    this._onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      const totalDx = e.clientX - this.startX
      const totalDy = e.clientY - this.startY
      const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy)
      this.lastX = e.clientX
      this.lastY = e.clientY

      if (this.button === 0) {
        // Check if we should enter move or rotate mode
        if (!this.moveMode && !this.rotateMode && this.moveEnabled && totalDist > this.clickThreshold) {
          if (e.shiftKey) {
            this.rotateMode = true
            const rect = this.canvas.getBoundingClientRect()
            this.onRotateStart?.(this.startX - rect.left, this.startY - rect.top)
          } else {
            this.moveMode = true
            const rect = this.canvas.getBoundingClientRect()
            this.onMoveStart?.(this.startX - rect.left, this.startY - rect.top)
          }
        }

        if (this.rotateMode) {
          this.onRotateDrag?.(dx, dy)
        } else if (this.moveMode) {
          const rect = this.canvas.getBoundingClientRect()
          this.onMove?.(e.clientX - rect.left, e.clientY - rect.top)
        } else {
          // Left button: orbit
          if (totalDist > this.clickThreshold) {
            this.onOrbitStart?.()
          }
          this.camera.rotate(-dx * this.rotateSensitivity, -dy * this.rotateSensitivity)
        }
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

        if (this.rotateMode) {
          this.onRotateEnd?.()
        } else if (this.moveMode) {
          const rect = this.canvas.getBoundingClientRect()
          this.onMoveEnd?.(e.clientX - rect.left, e.clientY - rect.top)
        } else if (totalDist < this.clickThreshold) {
          // Click detected
          const rect = this.canvas.getBoundingClientRect()
          this.onClick?.(e.clientX - rect.left, e.clientY - rect.top)
        }
      }
      this.isDragging = false
      this.button = -1
      this.moveMode = false
      this.rotateMode = false
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
