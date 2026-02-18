import { OrbitCamera, CAMERA_UNIFORM_SIZE } from './Camera'
import { CameraController } from './CameraController'
import { createCargoPipeline, INSTANCE_BYTE_SIZE } from './pipelines/CargoPipeline'
import { createContainerPipelines } from './pipelines/ContainerPipeline'
import { createGridPipeline } from './pipelines/GridPipeline'
import { mat4Translation, mat4Scaling, mat4Multiply, mat4Identity } from '../utils/math'
import type { PlacedCargo, CargoItemDef } from '../core/types'

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
  private cameraController!: CameraController

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

  // Container pipeline
  private containerTransparentPipeline!: GPURenderPipeline
  private containerOpaquePipeline!: GPURenderPipeline
  private containerVertexBuffer!: GPUBuffer
  private containerIndexBuffer!: GPUBuffer
  private containerIndexCount = 0
  private containerUniformBuffer!: GPUBuffer
  private containerBindGroup!: GPUBindGroup
  private containerTransparentUniformBuffer!: GPUBuffer
  private containerTransparentBindGroup!: GPUBindGroup

  // Grid pipeline
  private gridPipeline!: GPURenderPipeline
  private gridVertexBuffer!: GPUBuffer
  private gridIndexBuffer!: GPUBuffer
  private gridIndexCount = 0

  private animationId = 0
  private disposed = false

  constructor() {
    this.camera = new OrbitCamera()
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

    // Container pipeline (default 20ft: 590 x 239 x 235)
    const container = createContainerPipelines(
      this.device, this.format, this.cameraBindGroupLayout,
      590, 239, 235,
    )
    this.containerTransparentPipeline = container.transparentPipeline
    this.containerOpaquePipeline = container.opaquePipeline
    this.containerVertexBuffer = container.vertexBuffer
    this.containerIndexBuffer = container.indexBuffer
    this.containerIndexCount = container.indexCount

    // Container uniforms - opaque (front faces, alpha=1.0)
    this.containerUniformBuffer = this.device.createBuffer({
      size: 80, // mat4x4 + vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const opaqueData = new Float32Array(20)
    opaqueData.set(mat4Identity(), 0) // model matrix = identity
    opaqueData.set([0.6, 0.65, 0.7, 1.0], 16) // steel blue-gray, opaque
    this.device.queue.writeBuffer(this.containerUniformBuffer, 0, opaqueData)

    this.containerBindGroup = this.device.createBindGroup({
      layout: container.containerBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.containerUniformBuffer } }],
    })

    // Container uniforms - transparent (back faces, alpha=0.3)
    this.containerTransparentUniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const transparentData = new Float32Array(20)
    transparentData.set(mat4Identity(), 0)
    transparentData.set([0.6, 0.65, 0.7, 0.3], 16) // same color, transparent
    this.device.queue.writeBuffer(this.containerTransparentUniformBuffer, 0, transparentData)

    this.containerTransparentBindGroup = this.device.createBindGroup({
      layout: container.containerBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.containerTransparentUniformBuffer } }],
    })

    // Grid pipeline
    const grid = createGridPipeline(this.device, this.format, this.cameraBindGroupLayout)
    this.gridPipeline = grid.pipeline
    this.gridVertexBuffer = grid.vertexBuffer
    this.gridIndexBuffer = grid.indexBuffer
    this.gridIndexCount = grid.indexCount
  }

  updateInstances(placements: PlacedCargo[], cargoDefs: CargoItemDef[]): void {
    this.instanceCount = placements.length
    if (this.instanceCount === 0) {
      this.instanceBuffer?.destroy()
      this.instanceBuffer = null
      this.instanceBindGroup = null
      return
    }

    const dataSize = this.instanceCount * INSTANCE_BYTE_SIZE
    const data = new Float32Array(this.instanceCount * 20)

    const defMap = new Map<string, CargoItemDef>()
    for (const def of cargoDefs) {
      defMap.set(def.id, def)
    }

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]!
      const def = defMap.get(p.cargoDefId)
      if (!def) continue

      const w = def.widthCm
      const h = def.heightCm
      const d = def.depthCm

      // Model matrix = Translation(px+w/2, py+h/2, pz+d/2) * Scale(w, h, d)
      const translation = mat4Translation(
        p.positionCm.x + w / 2,
        p.positionCm.y + h / 2,
        p.positionCm.z + d / 2,
      )
      const scale = mat4Scaling(w, h, d)
      const modelMatrix = mat4Multiply(translation, scale)

      const offset = i * 20
      data.set(modelMatrix, offset)

      const [r, g, b, a] = hexToRGBA(def.color)
      data[offset + 16] = r
      data[offset + 17] = g
      data[offset + 18] = b
      data[offset + 19] = a
    }

    // Recreate buffer if size changed
    if (this.instanceBuffer) {
      this.instanceBuffer.destroy()
    }
    this.instanceBuffer = this.device.createBuffer({
      size: dataSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.instanceBuffer, 0, data)

    this.instanceBindGroup = this.device.createBindGroup({
      layout: this.instanceBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.instanceBuffer } }],
    })
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
    const opaqueData = new Float32Array(20)
    opaqueData.set(mat4Identity(), 0)
    opaqueData.set([0.6, 0.65, 0.7, 1.0], 16)
    this.device.queue.writeBuffer(this.containerUniformBuffer, 0, opaqueData)

    const transparentData = new Float32Array(20)
    transparentData.set(mat4Identity(), 0)
    transparentData.set([0.6, 0.65, 0.7, 0.3], 16)
    this.device.queue.writeBuffer(this.containerTransparentUniformBuffer, 0, transparentData)

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
  }

  private render = (): void => {
    if (this.disposed) return

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

    // Pass 2: Container walls
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
    // Sub-pass A: Transparent back faces
    pass2.setPipeline(this.containerTransparentPipeline)
    pass2.setBindGroup(0, this.cameraBindGroup)
    pass2.setBindGroup(1, this.containerTransparentBindGroup)
    pass2.setVertexBuffer(0, this.containerVertexBuffer)
    pass2.setIndexBuffer(this.containerIndexBuffer, 'uint16')
    pass2.drawIndexed(this.containerIndexCount)
    // Sub-pass B: Opaque front faces
    pass2.setPipeline(this.containerOpaquePipeline)
    pass2.setBindGroup(1, this.containerBindGroup)
    pass2.drawIndexed(this.containerIndexCount)
    pass2.end()

    // Pass 3: Floor grid
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

    this.device.queue.submit([commandEncoder.finish()])

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
    this.cameraUniformBuffer?.destroy()
    this.cargoVertexBuffer?.destroy()
    this.cargoIndexBuffer?.destroy()
    this.instanceBuffer?.destroy()
    this.containerVertexBuffer?.destroy()
    this.containerIndexBuffer?.destroy()
    this.containerUniformBuffer?.destroy()
    this.containerTransparentUniformBuffer?.destroy()
    this.gridVertexBuffer?.destroy()
    this.gridIndexBuffer?.destroy()
    this.depthTexture?.destroy()
    this.device?.destroy()
  }
}
