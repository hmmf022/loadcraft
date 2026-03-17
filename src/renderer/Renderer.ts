import { OrbitCamera, CAMERA_UNIFORM_SIZE } from './Camera'
import { CameraController } from './CameraController'
import { ViewTransition } from './ViewTransition'
import { LabelRenderer } from './LabelRenderer'
import { AxisIndicator } from './AxisIndicator'
import { createCargoPipeline, createGhostPipeline, INSTANCE_BYTE_SIZE } from './pipelines/CargoPipeline'
import { createContainerPipelines } from './pipelines/ContainerPipeline'
import { createGridPipeline } from './pipelines/GridPipeline'
import { mat4Translation, mat4Scaling, mat4Multiply, mat4Identity, mat4RotationX, mat4RotationY, mat4RotationZ } from '../utils/math'
import type { PlacedCargo, CargoItemDef, Vec3, ShapeBlock } from '../core/types'
import { computeRotatedAABB, rotateVec3 } from '../core/Voxelizer'

const DEG_TO_RAD = Math.PI / 180

function buildModelMatrix(pos: Vec3, rotDeg: Vec3, w: number, h: number, d: number) {
  const hasRotation = rotDeg.x !== 0 || rotDeg.y !== 0 || rotDeg.z !== 0
  if (!hasRotation) {
    // Fast path: same as before
    const t = mat4Translation(pos.x + w / 2, pos.y + h / 2, pos.z + d / 2)
    const s = mat4Scaling(w, h, d)
    return mat4Multiply(t, s)
  }
  // M = T(pos) * Rz * Rx * Ry * T(w/2, h/2, d/2) * S(w, h, d)
  const tPos = mat4Translation(pos.x, pos.y, pos.z)
  const ry = mat4RotationY(rotDeg.y * DEG_TO_RAD)
  const rx = mat4RotationX(rotDeg.x * DEG_TO_RAD)
  const rz = mat4RotationZ(rotDeg.z * DEG_TO_RAD)
  const tCenter = mat4Translation(w / 2, h / 2, d / 2)
  const s = mat4Scaling(w, h, d)
  // chain: tPos * rz * rx * ry * tCenter * s
  let m = mat4Multiply(tCenter, s)
  m = mat4Multiply(ry, m)
  m = mat4Multiply(rx, m)
  m = mat4Multiply(rz, m)
  m = mat4Multiply(tPos, m)
  return m
}

function buildCompositeBlockMatrix(
  pos: Vec3, rotDeg: Vec3,
  bx: number, by: number, bz: number,
  bw: number, bh: number, bd: number,
) {
  // M = T(pos) * Rz * Rx * Ry * T(bx + bw/2, by + bh/2, bz + bd/2) * S(bw, bh, bd)
  const tPos = mat4Translation(pos.x, pos.y, pos.z)
  const ry = mat4RotationY(rotDeg.y * DEG_TO_RAD)
  const rx = mat4RotationX(rotDeg.x * DEG_TO_RAD)
  const rz = mat4RotationZ(rotDeg.z * DEG_TO_RAD)
  const tBlock = mat4Translation(bx + bw / 2, by + bh / 2, bz + bd / 2)
  const s = mat4Scaling(bw, bh, bd)
  let m = mat4Multiply(tBlock, s)
  m = mat4Multiply(ry, m)
  m = mat4Multiply(rx, m)
  m = mat4Multiply(rz, m)
  m = mat4Multiply(tPos, m)
  return m
}

function hexToRGBA(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b, 1.0]
}

export class Renderer {
  private canvas!: HTMLCanvasElement
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat
  private depthTexture!: GPUTexture

  camera: OrbitCamera
  cameraController!: CameraController

  // Buffers
  private cameraUniformBuffer!: GPUBuffer
  private cameraBindGroup!: GPUBindGroup
  private cameraBindGroupLayout!: GPUBindGroupLayout

  // Cargo pipeline
  private cargoPipeline!: GPURenderPipeline
  private cargoVertexBuffer!: GPUBuffer
  private cargoIndexBuffer!: GPUBuffer
  private cargoIndexCount = 0
  private instanceBuffer: GPUBuffer | null = null
  private instanceBindGroup: GPUBindGroup | null = null
  private instanceBindGroupLayout!: GPUBindGroupLayout
  private instanceCount = 0
  private instanceBufferCapacity = 0

  // Ghost pipeline
  private ghostPipeline!: GPURenderPipeline
  private ghostBuffer: GPUBuffer | null = null
  private ghostBindGroup: GPUBindGroup | null = null
  private ghostVisible = false
  private ghostInstanceCount = 1
  private ghostBufferCapacity = 0

  // Container pipeline
  private containerPipeline!: GPURenderPipeline
  private containerVertexBuffer!: GPUBuffer
  private containerIndexBuffer!: GPUBuffer
  private containerIndexCount = 0
  private containerUniformBuffer!: GPUBuffer
  private containerBindGroup!: GPUBindGroup

  // Grid pipeline
  private gridPipeline!: GPURenderPipeline
  private gridVertexBuffer!: GPUBuffer
  private gridIndexBuffer!: GPUBuffer
  private gridIndexCount = 0

  private animationId = 0
  private disposed = false

  // Selection
  selectedInstanceId: number | null = null

  // Grid visibility
  showGrid = true

  // View transition
  private viewTransition: ViewTransition

  // Labels
  private labelRenderer: LabelRenderer | null = null
  showLabels = true

  // Axis indicator
  private axisIndicator: AxisIndicator | null = null

  constructor() {
    this.camera = new OrbitCamera()
    this.viewTransition = new ViewTransition(this.camera)
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas

    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser')
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('Failed to get GPU adapter')

    this.device = await adapter.requestDevice()
    this.context = canvas.getContext('webgpu')!
    this.format = navigator.gpu.getPreferredCanvasFormat()

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    })

    this.createDepthTexture()
    this.createCameraResources()
    this.createPipelines()
    this.cameraController = new CameraController(this.camera, this.canvas)
  }

  private createDepthTexture(): void {
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width || 1, this.canvas.height || 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private createCameraResources(): void {
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    })

    this.cameraUniformBuffer = this.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.cameraUniformBuffer },
      }],
    })
  }

  private createPipelines(): void {
    // Cargo pipeline
    const cargo = createCargoPipeline(this.device, this.format, this.cameraBindGroupLayout)
    this.cargoPipeline = cargo.pipeline
    this.cargoVertexBuffer = cargo.vertexBuffer
    this.cargoIndexBuffer = cargo.indexBuffer
    this.cargoIndexCount = cargo.indexCount
    this.instanceBindGroupLayout = cargo.instanceBindGroupLayout

    // Ghost pipeline (alpha blending, no depth write)
    const ghost = createGhostPipeline(this.device, this.format, this.cameraBindGroupLayout, cargo.instanceBindGroupLayout)
    this.ghostPipeline = ghost.pipeline

    // Container pipeline (default 20ft: 590 x 239 x 235)
    const container = createContainerPipelines(
      this.device, this.format, this.cameraBindGroupLayout,
      590, 239, 235,
    )
    this.containerPipeline = container.pipeline
    this.containerVertexBuffer = container.vertexBuffer
    this.containerIndexBuffer = container.indexBuffer
    this.containerIndexCount = container.indexCount

    // Container uniforms - wireframe color + resolution/lineWidth
    this.containerUniformBuffer = this.device.createBuffer({
      size: 96, // mat4x4(64) + vec4(16) + vec2(8) + f32(4) + pad(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const uniformData = new Float32Array(24)
    uniformData.set(mat4Identity(), 0) // model matrix = identity
    uniformData.set([0.75, 0.8, 0.85, 0.9], 16) // brighter semi-transparent gray
    uniformData[20] = this.canvas.width || 1   // resolution.x
    uniformData[21] = this.canvas.height || 1  // resolution.y
    uniformData[22] = 2.0                      // lineWidth (pixels)
    uniformData[23] = 0                        // padding
    this.device.queue.writeBuffer(this.containerUniformBuffer, 0, uniformData)

    this.containerBindGroup = this.device.createBindGroup({
      layout: container.containerBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.containerUniformBuffer } }],
    })

    // Grid pipeline
    const grid = createGridPipeline(this.device, this.format, this.cameraBindGroupLayout)
    this.gridPipeline = grid.pipeline
    this.gridVertexBuffer = grid.vertexBuffer
    this.gridIndexBuffer = grid.indexBuffer
    this.gridIndexCount = grid.indexCount
  }

  updateInstances(placements: PlacedCargo[], cargoDefs: CargoItemDef[]): void {
    const defMap = new Map<string, CargoItemDef>()
    for (const def of cargoDefs) {
      defMap.set(def.id, def)
    }

    // Count total instances (composite shapes = N blocks per placement)
    let totalInstances = 0
    for (const p of placements) {
      const def = defMap.get(p.cargoDefId)
      if (!def) continue
      totalInstances += def.blocks ? def.blocks.length : 1
    }

    this.instanceCount = totalInstances
    if (this.instanceCount === 0) {
      this.instanceBuffer?.destroy()
      this.instanceBuffer = null
      this.instanceBindGroup = null
      this.instanceBufferCapacity = 0
      return
    }

    const dataSize = this.instanceCount * INSTANCE_BYTE_SIZE
    const data = new Float32Array(this.instanceCount * 20)

    let idx = 0
    for (const p of placements) {
      const def = defMap.get(p.cargoDefId)
      if (!def) continue

      const isSelected = p.instanceId === this.selectedInstanceId

      if (def.blocks) {
        // Composite shape: one GPU instance per block
        for (const block of def.blocks) {
          // M = T(pos) * Rz * Rx * Ry * T(block.x + w/2, block.y + h/2, block.z + d/2) * S(w, h, d)
          const blockModelMatrix = buildCompositeBlockMatrix(
            p.positionCm, p.rotationDeg,
            block.x, block.y, block.z, block.w, block.h, block.d,
          )

          const offset = idx * 20
          data.set(blockModelMatrix, offset)

          const [r, g, b] = hexToRGBA(block.color)
          data[offset + 16] = r
          data[offset + 17] = g
          data[offset + 18] = b
          data[offset + 19] = isSelected ? 2.0 : 1.0
          idx++
        }
      } else {
        // Simple box
        const modelMatrix = buildModelMatrix(p.positionCm, p.rotationDeg, def.widthCm, def.heightCm, def.depthCm)

        const offset = idx * 20
        data.set(modelMatrix, offset)

        const [r, g, b] = hexToRGBA(def.color)
        data[offset + 16] = r
        data[offset + 17] = g
        data[offset + 18] = b
        data[offset + 19] = isSelected ? 2.0 : 1.0
        idx++
      }
    }

    // Reuse buffer if capacity is sufficient; otherwise grow by 2x
    if (dataSize > this.instanceBufferCapacity) {
      if (this.instanceBuffer) {
        this.instanceBuffer.destroy()
      }
      const newCapacity = dataSize * 2
      this.instanceBuffer = this.device.createBuffer({
        size: newCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.instanceBufferCapacity = newCapacity

      this.instanceBindGroup = this.device.createBindGroup({
        layout: this.instanceBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.instanceBuffer } }],
      })
    }
    this.device.queue.writeBuffer(this.instanceBuffer!, 0, data)
  }

  updateGhost(position: Vec3 | null, widthCm: number, heightCm: number, depthCm: number, validity: 'valid' | 'invalid' | 'floating' | 'force', rotationDeg?: Vec3, blocks?: ShapeBlock[]): void {
    if (!position) {
      this.ghostVisible = false
      this.ghostInstanceCount = 0
      return
    }

    this.ghostVisible = true
    const rot = rotationDeg ?? { x: 0, y: 0, z: 0 }

    let ghostColor: [number, number, number, number]
    if (validity === 'valid') {
      ghostColor = [0.3, 0.8, 0.3, 0.4]
    } else if (validity === 'floating') {
      ghostColor = [0.9, 0.8, 0.2, 0.4]
    } else if (validity === 'force') {
      ghostColor = [1.0, 0.6, 0.1, 0.4]
    } else {
      ghostColor = [0.9, 0.2, 0.2, 0.4]
    }

    if (blocks && blocks.length > 0) {
      // Composite ghost: one instance per block
      const count = blocks.length
      this.ghostInstanceCount = count
      const data = new Float32Array(count * 20)

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!
        const m = buildCompositeBlockMatrix(position, rot, b.x, b.y, b.z, b.w, b.h, b.d)
        const offset = i * 20
        data.set(m, offset)
        data[offset + 16] = ghostColor[0]
        data[offset + 17] = ghostColor[1]
        data[offset + 18] = ghostColor[2]
        data[offset + 19] = ghostColor[3]
      }

      this._updateGhostBuffer(data)
    } else {
      // Simple box ghost
      this.ghostInstanceCount = 1
      const data = new Float32Array(20)
      const modelMatrix = buildModelMatrix(position, rot, widthCm, heightCm, depthCm)
      data.set(modelMatrix, 0)
      data[16] = ghostColor[0]; data[17] = ghostColor[1]; data[18] = ghostColor[2]; data[19] = ghostColor[3]

      this._updateGhostBuffer(data)
    }
  }

  /** Reuse ghost buffer if capacity is sufficient; otherwise grow by 2x (min 32 blocks). */
  private _updateGhostBuffer(data: Float32Array): void {
    const dataSize = data.byteLength
    const MIN_GHOST_CAPACITY = 32 * INSTANCE_BYTE_SIZE

    if (dataSize > this.ghostBufferCapacity) {
      if (this.ghostBuffer) this.ghostBuffer.destroy()
      const newCapacity = Math.max(dataSize * 2, MIN_GHOST_CAPACITY)
      this.ghostBuffer = this.device.createBuffer({
        size: newCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.ghostBufferCapacity = newCapacity

      this.ghostBindGroup = this.device.createBindGroup({
        layout: this.instanceBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.ghostBuffer } }],
      })
    }
    this.device.queue.writeBuffer(this.ghostBuffer!, 0, data as unknown as ArrayBuffer)
  }

  updateContainer(w: number, h: number, d: number): void {
    // Rebuild container geometry
    const container = createContainerPipelines(
      this.device, this.format, this.cameraBindGroupLayout,
      w, h, d,
    )
    this.containerVertexBuffer.destroy()
    this.containerIndexBuffer.destroy()
    this.containerVertexBuffer = container.vertexBuffer
    this.containerIndexBuffer = container.indexBuffer
    this.containerIndexCount = container.indexCount

    // Update container uniforms
    const uniformData = new Float32Array(24)
    uniformData.set(mat4Identity(), 0)
    uniformData.set([0.75, 0.8, 0.85, 0.9], 16)
    uniformData[20] = this.canvas.width || 1
    uniformData[21] = this.canvas.height || 1
    uniformData[22] = 2.0
    uniformData[23] = 0
    this.device.queue.writeBuffer(this.containerUniformBuffer, 0, uniformData)

    // Update camera target to center of new container
    this.camera.setState({ target: { x: w / 2, y: h / 2, z: d / 2 } })
  }

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return
    this.canvas.width = width
    this.canvas.height = height
    this.depthTexture.destroy()
    this.createDepthTexture()
    this.camera.setAspect(width / height)
    // Update container uniform resolution
    const res = new Float32Array([width, height])
    this.device.queue.writeBuffer(this.containerUniformBuffer, 80, res)
  }

  animateToPreset(theta: number, phi: number): void {
    this.viewTransition.transitionTo(theta, phi)
  }

  cancelTransition(): void {
    this.viewTransition.cancel()
  }

  initLabels(parentElement: HTMLElement): void {
    this.labelRenderer = new LabelRenderer(parentElement)
  }

  initAxisIndicator(parentElement: HTMLElement): void {
    this.axisIndicator = new AxisIndicator(parentElement)
  }

  updateLabels(placements: PlacedCargo[], cargoDefs: CargoItemDef[]): void {
    if (!this.labelRenderer) return

    const defMap = new Map<string, CargoItemDef>()
    for (const def of cargoDefs) {
      defMap.set(def.id, def)
    }

    const labels = []
    for (const p of placements) {
      const def = defMap.get(p.cargoDefId)
      if (!def) continue
      let aabb: { min: Vec3; max: Vec3 }
      if (def.blocks) {
        // Composite shape: compute union AABB of all rotated blocks
        let minX = Infinity, minY = Infinity, minZ = Infinity
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
        for (const block of def.blocks) {
          const rotatedOffset = rotateVec3(
            { x: block.x, y: block.y, z: block.z },
            p.rotationDeg,
          )
          const blockAabb = computeRotatedAABB(
            block.w, block.h, block.d,
            {
              x: p.positionCm.x + rotatedOffset.x,
              y: p.positionCm.y + rotatedOffset.y,
              z: p.positionCm.z + rotatedOffset.z,
            },
            p.rotationDeg,
            true,
          )
          minX = Math.min(minX, blockAabb.min.x)
          minY = Math.min(minY, blockAabb.min.y)
          minZ = Math.min(minZ, blockAabb.min.z)
          maxX = Math.max(maxX, blockAabb.max.x)
          maxY = Math.max(maxY, blockAabb.max.y)
          maxZ = Math.max(maxZ, blockAabb.max.z)
        }
        aabb = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } }
      } else {
        aabb = computeRotatedAABB(def.widthCm, def.heightCm, def.depthCm, p.positionCm, p.rotationDeg, true)
      }
      labels.push({
        instanceId: p.instanceId,
        text: `${def.name} ${def.widthCm}x${def.heightCm}x${def.depthCm} ${def.weightKg}kg`,
        worldPosition: {
          x: (aabb.min.x + aabb.max.x) / 2,
          y: aabb.max.y,
          z: (aabb.min.z + aabb.max.z) / 2,
        },
      })
    }
    this.labelRenderer.updateLabels(labels)
  }

  private render = (): void => {
    if (this.disposed) return

    // Update view transition
    this.viewTransition.update()

    // Update camera uniform
    const cameraData = this.camera.getUniformData()
    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, cameraData)

    const commandEncoder = this.device.createCommandEncoder()
    const textureView = this.context.getCurrentTexture().createView()
    const depthView = this.depthTexture.createView()

    // Pass 1: Cargo (opaque, instanced) - clears the framebuffer
    const pass1 = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.95, g: 0.95, b: 0.95, a: 1.0 },
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'clear',
        depthClearValue: 1.0,
        depthStoreOp: 'store',
      },
    })
    pass1.setPipeline(this.cargoPipeline)
    pass1.setBindGroup(0, this.cameraBindGroup)
    pass1.setVertexBuffer(0, this.cargoVertexBuffer)
    pass1.setIndexBuffer(this.cargoIndexBuffer, 'uint16')
    if (this.instanceCount > 0 && this.instanceBindGroup) {
      pass1.setBindGroup(1, this.instanceBindGroup)
      pass1.drawIndexed(this.cargoIndexCount, this.instanceCount)
    }
    pass1.end()

    // Pass 1.5: Ghost (transparent, no depth write)
    if (this.ghostVisible && this.ghostBindGroup) {
      const ghostPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      })
      ghostPass.setPipeline(this.ghostPipeline)
      ghostPass.setBindGroup(0, this.cameraBindGroup)
      ghostPass.setBindGroup(1, this.ghostBindGroup)
      ghostPass.setVertexBuffer(0, this.cargoVertexBuffer)
      ghostPass.setIndexBuffer(this.cargoIndexBuffer, 'uint16')
      ghostPass.drawIndexed(this.cargoIndexCount, this.ghostInstanceCount)
      ghostPass.end()
    }

    // Pass 2: Container wireframe
    const pass2 = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    })
    pass2.setPipeline(this.containerPipeline)
    pass2.setBindGroup(0, this.cameraBindGroup)
    pass2.setBindGroup(1, this.containerBindGroup)
    pass2.setVertexBuffer(0, this.containerVertexBuffer)
    pass2.setIndexBuffer(this.containerIndexBuffer, 'uint16')
    pass2.drawIndexed(this.containerIndexCount)
    pass2.end()

    // Pass 3: Floor grid (conditional)
    if (this.showGrid) {
      const pass3 = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      })
      pass3.setPipeline(this.gridPipeline)
      pass3.setBindGroup(0, this.cameraBindGroup)
      pass3.setVertexBuffer(0, this.gridVertexBuffer)
      pass3.setIndexBuffer(this.gridIndexBuffer, 'uint16')
      pass3.drawIndexed(this.gridIndexCount)
      pass3.end()
    }

    this.device.queue.submit([commandEncoder.finish()])

    // Project labels onto screen
    if (this.labelRenderer && this.showLabels) {
      const vpData = this.camera.getUniformData()
      const vpMatrix = vpData.subarray(0, 16) // viewProjMatrix is first 16 floats
      const camPos = { x: vpData[48]!, y: vpData[49]!, z: vpData[50]! }
      const dpr = window.devicePixelRatio || 1
      this.labelRenderer.project(vpMatrix, camPos, this.canvas.width, this.canvas.height, dpr)
    }

    // Update axis indicator
    if (this.axisIndicator) {
      this.axisIndicator.update(cameraData.subarray(16, 32))
    }

    this.animationId = requestAnimationFrame(this.render)
  }

  startRenderLoop(): void {
    this.disposed = false
    this.animationId = requestAnimationFrame(this.render)
  }

  stopRenderLoop(): void {
    cancelAnimationFrame(this.animationId)
  }

  dispose(): void {
    this.disposed = true
    this.stopRenderLoop()
    this.cameraController?.dispose()
    this.labelRenderer?.dispose()
    this.axisIndicator?.dispose()
    this.cameraUniformBuffer?.destroy()
    this.cargoVertexBuffer?.destroy()
    this.cargoIndexBuffer?.destroy()
    this.instanceBuffer?.destroy()
    this.ghostBuffer?.destroy()
    this.containerVertexBuffer?.destroy()
    this.containerIndexBuffer?.destroy()
    this.containerUniformBuffer?.destroy()
    this.gridVertexBuffer?.destroy()
    this.gridIndexBuffer?.destroy()
    this.depthTexture?.destroy()
    this.device?.destroy()
  }
}
