import containerShader from '../shaders/container.wgsl?raw'

// Container wireframe: 8 corner vertices, 12 edges as line-list
function createContainerGeometry(w: number, h: number, d: number) {
  // 8 corners, position only (3 floats each)
  // prettier-ignore
  const vertices = new Float32Array([
    0, 0, 0,  // 0: left-bottom-front
    w, 0, 0,  // 1: right-bottom-front
    w, h, 0,  // 2: right-top-front
    0, h, 0,  // 3: left-top-front
    0, 0, d,  // 4: left-bottom-back
    w, 0, d,  // 5: right-bottom-back
    w, h, d,  // 6: right-top-back
    0, h, d,  // 7: left-top-back
  ])

  // 12 edges (2 indices each)
  // prettier-ignore
  const indices = new Uint16Array([
    0, 1,  1, 2,  2, 3,  3, 0, // front face
    4, 5,  5, 6,  6, 7,  7, 4, // back face
    0, 4,  1, 5,  2, 6,  3, 7, // connecting edges
  ])

  return { vertices, indices }
}

export function createContainerPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
  containerW: number,
  containerH: number,
  containerD: number,
) {
  const containerBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    }],
  })

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [cameraBindGroupLayout, containerBindGroupLayout],
  })

  const shaderModule = device.createShaderModule({ code: containerShader })

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 12, // position only: 3 x float32
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
        writeMask: GPUColorWrite.ALL,
      }],
    },
    primitive: {
      topology: 'line-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  })

  const { vertices, indices } = createContainerGeometry(containerW, containerH, containerD)

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertexBuffer, 0, vertices)

  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, indices)

  return {
    pipeline,
    vertexBuffer,
    indexBuffer,
    indexCount: indices.length,
    containerBindGroupLayout,
  }
}
