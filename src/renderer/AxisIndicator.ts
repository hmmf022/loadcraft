const AXIS_SIZE = 120 // CSS pixels
const AXIS_LENGTH = 40 // px from center to tip
const DOT_RADIUS = 8
const BG_RADIUS = 52

interface AxisDef {
  label: string
  color: string
  sx: number // screen x offset from center
  sy: number // screen y offset from center (canvas-down)
  depth: number // view-space z for sorting
}

export class AxisIndicator {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor(parentElement: HTMLElement) {
    this.canvas = document.createElement('canvas')
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = AXIS_SIZE * dpr
    this.canvas.height = AXIS_SIZE * dpr
    this.canvas.style.cssText =
      `position:absolute;bottom:8px;left:8px;width:${AXIS_SIZE}px;height:${AXIS_SIZE}px;pointer-events:none;`
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.scale(dpr, dpr)
    parentElement.appendChild(this.canvas)
  }

  update(viewMatrix: Float32Array): void {
    const ctx = this.ctx
    const cx = AXIS_SIZE / 2
    const cy = AXIS_SIZE / 2

    // Reset transform for clear (DPR scale is persistent)
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, AXIS_SIZE, AXIS_SIZE)

    // Background circle
    ctx.beginPath()
    ctx.arc(cx, cy, BG_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fill()

    // Extract screen projections from view matrix (column-major)
    // X axis (1,0,0) → screen_x = vm[0], screen_y = vm[1], depth = vm[2]
    // Y axis (0,1,0) → screen_x = vm[4], screen_y = vm[5], depth = vm[6]
    // Z axis (0,0,1) → screen_x = vm[8], screen_y = vm[9], depth = vm[10]
    const axes: AxisDef[] = [
      { label: 'X', color: '#e74c3c', sx: viewMatrix[0]!, sy: -viewMatrix[1]!, depth: viewMatrix[2]! },
      { label: 'Y', color: '#2ecc71', sx: viewMatrix[4]!, sy: -viewMatrix[5]!, depth: viewMatrix[6]! },
      { label: 'Z', color: '#3498db', sx: viewMatrix[8]!, sy: -viewMatrix[9]!, depth: viewMatrix[10]! },
    ]

    // Depth sort: draw farthest first (painter's algorithm)
    axes.sort((a, b) => a.depth - b.depth)

    ctx.lineCap = 'round'
    ctx.lineWidth = 2.5

    for (const axis of axes) {
      const tipX = cx + axis.sx * AXIS_LENGTH
      const tipY = cy + axis.sy * AXIS_LENGTH

      // Line from center to tip
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(tipX, tipY)
      ctx.strokeStyle = axis.color
      ctx.stroke()

      // Endpoint dot
      ctx.beginPath()
      ctx.arc(tipX, tipY, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = axis.color
      ctx.fill()

      // Label
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(axis.label, tipX, tipY)
    }
  }

  dispose(): void {
    this.canvas.remove()
  }
}
