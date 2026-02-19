interface Vec3 {
  x: number
  y: number
  z: number
}

interface LabelData {
  instanceId: number
  text: string
  worldPosition: Vec3
}

export class LabelRenderer {
  private parent: HTMLElement
  private container: HTMLDivElement
  private labels: LabelData[] = []
  private elements = new Map<number, HTMLDivElement>()

  constructor(parentElement: HTMLElement) {
    this.parent = parentElement
    this.container = document.createElement('div')
    this.container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;'
    this.parent.appendChild(this.container)
  }

  updateLabels(labels: LabelData[]): void {
    this.labels = labels

    // Remove old labels not in new set
    const newIds = new Set(labels.map((l) => l.instanceId))
    for (const [id, el] of this.elements) {
      if (!newIds.has(id)) {
        el.remove()
        this.elements.delete(id)
      }
    }

    // Add/update labels
    for (const label of labels) {
      let el = this.elements.get(label.instanceId)
      if (!el) {
        el = document.createElement('div')
        el.style.cssText =
          'position:absolute;background:rgba(0,0,0,0.75);color:#fff;font-size:11px;' +
          'padding:2px 6px;border-radius:3px;pointer-events:none;white-space:nowrap;' +
          'will-change:transform;transform:translate(-50%,-100%);'
        this.container.appendChild(el)
        this.elements.set(label.instanceId, el)
      }
      el.textContent = label.text
    }
  }

  project(vpMatrix: Float32Array, cameraPos: Vec3, canvasW: number, canvasH: number, dpr: number): void {
    for (const label of this.labels) {
      const el = this.elements.get(label.instanceId)
      if (!el) continue

      const wp = label.worldPosition

      // Column-major mat4 * vec4
      const x = vpMatrix[0]! * wp.x + vpMatrix[4]! * wp.y + vpMatrix[8]! * wp.z + vpMatrix[12]!
      const y = vpMatrix[1]! * wp.x + vpMatrix[5]! * wp.y + vpMatrix[9]! * wp.z + vpMatrix[13]!
      const w = vpMatrix[3]! * wp.x + vpMatrix[7]! * wp.y + vpMatrix[11]! * wp.z + vpMatrix[15]!

      // Behind camera
      if (w <= 0) {
        el.style.display = 'none'
        continue
      }

      const ndcX = x / w
      const ndcY = y / w

      // Screen coordinates (CSS pixels)
      const sx = ((ndcX + 1) * 0.5 * canvasW) / dpr
      const sy = ((1 - ndcY) * 0.5 * canvasH) / dpr

      // Distance fade
      const dx = wp.x - cameraPos.x
      const dy = wp.y - cameraPos.y
      const dz = wp.z - cameraPos.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist > 5000) {
        el.style.display = 'none'
        continue
      }

      let opacity = 1
      if (dist > 3000) {
        opacity = 1 - (dist - 3000) / 2000
      }

      el.style.display = ''
      el.style.opacity = String(opacity)
      el.style.left = `${sx}px`
      el.style.top = `${sy}px`
    }
  }

  dispose(): void {
    this.container.remove()
    this.elements.clear()
    this.labels = []
  }
}
