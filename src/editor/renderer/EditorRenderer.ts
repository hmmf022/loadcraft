import { OrbitCamera, CAMERA_UNIFORM_SIZE } from '../../renderer/Camera'
import { EditorCameraController } from './EditorCameraController'
import { ViewTransition } from '../../renderer/ViewTransition'
import { createCargoPipeline, createGhostPipeline, INSTANCE_BYTE_SIZE } from '../../renderer/pipelines/CargoPipeline'
import { createGridPipeline } from '../../renderer/pipelines/GridPipeline'
import { mat4Translation, mat4Scaling, mat4Multiply } from '../../utils/math'
import type { EditorBlock } from '../state/types'

function hexToRGBA(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b, 1.0]
}

export class EditorRenderer {
  private canvas!: HTMLCanvasElement
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat
  private depthTexture!: GPUTexture

  camera: OrbitCamera
  cameraController!: EditorCameraController

  // Camera resources
  private cameraUniformBuffer!: GPUBuffer
  private cameraBindGroup!: GPUBindGroup
  private cameraBindGroupLayout!: GPUBindGroupLayout

  // Cargo (block) pipeline
  private blockPipeline!: GPURenderPipeline
  private blockVertexBuffer!: GPUBuffer
  private blockIndexBuffer!: GPUBuffer
  private blockIndexCount = 0
  private instanceBuffer: GPUBuffer | null = null
  private instanceBindGroup: GPUBindGroup | null = null
  private instanceBindGroupLayout!: GPUBindGroupLayout
  private instanceCount = 0

  // Ghost pipeline
  private ghostPipeline!: GPURenderPipeline
  private ghostBuffer: GPUBuffer | null = null
  private ghostBindGroup: GPUBindGroup | null = null
  private ghostVisible = false

  // Grid pipeline
  private gridPipeline!: GPURenderPipeline
  private gridVertexBuffer!: GPUBuffer
  private gridIndexBuffer!: GPUBuffer
  private gridIndexCount = 0

  private viewTransition: ViewTransition

  private clearColor = { r: 0.12, g: 0.12, b: 0.15 }

  private animationId = 0
  private disposed = false

  constructor() {
    this.camera = new OrbitCamera()
    this.camera.setConstraints({ minRadius: 30 })
    // Default camera for editor: look at origin, closer zoom
    this.camera.setState({
      target: { x: 250, y: 250, z: 250 },
      radius: 1500,
      theta: Math.PI / 4,
      phi: Math.PI / 4,
    })
    this.viewTransition = new ViewTransition(this.camera)
  }

  animateToPreset(theta: number, phi: number, target?: { x: number; y: number; z: number }): void {
    this.viewTransition.transitionTo(theta, phi, target)
  }

  cancelTransition(): void {
    this.viewTransition.cancel()
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
    this.cameraController = new EditorCameraController(this.camera, this.canvas)
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
    // Block pipeline (reuses CargoPipeline)
    const cargo = createCargoPipeline(this.device, this.format, this.cameraBindGroupLayout)
    this.blockPipeline = cargo.pipeline
    this.blockVertexBuffer = cargo.vertexBuffer
    this.blockIndexBuffer = cargo.indexBuffer
    this.blockIndexCount = cargo.indexCount
    this.instanceBindGroupLayout = cargo.instanceBindGroupLayout

    // Ghost pipeline
    const ghost = createGhostPipeline(this.device, this.format, this.cameraBindGroupLayout, cargo.instanceBindGroupLayout)
    this.ghostPipeline = ghost.pipeline

    // Grid pipeline
    const grid = createGridPipeline(this.device, this.format, this.cameraBindGroupLayout)
    this.gridPipeline = grid.pipeline
    this.gridVertexBuffer = grid.vertexBuffer
    this.gridIndexBuffer = grid.indexBuffer
    this.gridIndexCount = grid.indexCount
  }

  updateBlocks(blocks: Map<string, EditorBlock>, gridSize: number): void {
    this.instanceCount = blocks.size
    if (this.instanceCount === 0) {
      this.instanceBuffer?.destroy()
      this.instanceBuffer = null
      this.instanceBindGroup = null
      return
    }

    const dataSize = this.instanceCount * INSTANCE_BYTE_SIZE
    const data = new Float32Array(this.instanceCount * 20)
    const gs = gridSize

    let i = 0
    for (const block of blocks.values()) {
      const bw = block.w * gs
      const bh = block.h * gs
      const bd = block.d * gs
      // Model matrix: T(x*gs + bw/2, y*gs + bh/2, z*gs + bd/2) * S(bw, bh, bd)
      const t = mat4Translation(block.x * gs + bw / 2, block.y * gs + bh / 2, block.z * gs + bd / 2)
      const s = mat4Scaling(bw, bh, bd)
      const modelMatrix = mat4Multiply(t, s)

      const offset = i * 20
      data.set(modelMatrix, offset)

      const [r, g, b, a] = hexToRGBA(block.color)
      data[offset + 16] = r
      data[offset + 17] = g
      data[offset + 18] = b
      data[offset + 19] = a
      i++
    }

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

  updateGhostBlock(
    position: { x: number; y: number; z: number } | null,
    gridSize: number,
    color: string,
    validity: 'valid' | 'invalid',
    size?: { w: number; h: number; d: number },
  ): void {
    if (!position) {
      this.ghostVisible = false
      return
    }

    this.ghostVisible = true
    const gs = gridSize
    const data = new Float32Array(20)

    const bw = (size?.w ?? 1) * gs
    const bh = (size?.h ?? 1) * gs
    const bd = (size?.d ?? 1) * gs
    const t = mat4Translation(position.x * gs + bw / 2, position.y * gs + bh / 2, position.z * gs + bd / 2)
    const s = mat4Scaling(bw, bh, bd)
    const modelMatrix = mat4Multiply(t, s)
    data.set(modelMatrix, 0)

    if (validity === 'valid') {
      const [r, g, b] = hexToRGBA(color)
      data[16] = r; data[17] = g; data[18] = b; data[19] = 0.4
    } else {
      data[16] = 0.9; data[17] = 0.2; data[18] = 0.2; data[19] = 0.4
    }

    if (this.ghostBuffer) {
      this.ghostBuffer.destroy()
    }
    this.ghostBuffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.ghostBuffer, 0, data)

    this.ghostBindGroup = this.device.createBindGroup({
      layout: this.instanceBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.ghostBuffer } }],
    })
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

    this.viewTransition.update()

    // Update camera uniform
    const cameraData = this.camera.getUniformData()
    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, cameraData)

    const commandEncoder = this.device.createCommandEncoder()
    const textureView = this.context.getCurrentTexture().createView()
    const depthView = this.depthTexture.createView()

    // Pass 1: Blocks (opaque, instanced) - clears the framebuffer
    const pass1 = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: this.clearColor.r, g: this.clearColor.g, b: this.clearColor.b, a: 1.0 },
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'clear',
        depthClearValue: 1.0,
        depthStoreOp: 'store',
      },
    })
    pass1.setPipeline(this.blockPipeline)
    pass1.setBindGroup(0, this.cameraBindGroup)
    pass1.setVertexBuffer(0, this.blockVertexBuffer)
    pass1.setIndexBuffer(this.blockIndexBuffer, 'uint16')
    if (this.instanceCount > 0 && this.instanceBindGroup) {
      pass1.setBindGroup(1, this.instanceBindGroup)
      pass1.drawIndexed(this.blockIndexCount, this.instanceCount)
    }
    pass1.end()

    // Pass 1.5: Ghost (transparent)
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
      ghostPass.setVertexBuffer(0, this.blockVertexBuffer)
      ghostPass.setIndexBuffer(this.blockIndexBuffer, 'uint16')
      ghostPass.drawIndexed(this.blockIndexCount, 1)
      ghostPass.end()
    }

    // Pass 2: Floor grid
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

  setClearColor(r: number, g: number, b: number): void {
    this.clearColor = { r, g, b }
  }

  dispose(): void {
    this.disposed = true
    this.stopRenderLoop()
    this.cameraController?.dispose()
    this.cameraUniformBuffer?.destroy()
    this.blockVertexBuffer?.destroy()
    this.blockIndexBuffer?.destroy()
    this.instanceBuffer?.destroy()
    this.ghostBuffer?.destroy()
    this.gridVertexBuffer?.destroy()
    this.gridIndexBuffer?.destroy()
    this.depthTexture?.destroy()
    this.device?.destroy()
  }
}
