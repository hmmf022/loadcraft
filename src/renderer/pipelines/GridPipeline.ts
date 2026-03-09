import gridShader from '../shaders/grid.wgsl?raw'

function createGridGeometry(size: number, positiveOnly: boolean) {
  // Each vertex: position(3) + uv(2) = 5 floats
  // prettier-ignore
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3])

  if (positiveOnly) {
    // 0...size (editor: shows boundary aligned with positive coordinate space)
    // prettier-ignore
    const vertices = new Float32Array([
      0,    0, 0,     0, 0,
      size, 0, 0,     1, 0,
      size, 0, size,  1, 1,
      0,    0, size,  0, 1,
    ])
    return { vertices, indices }
  }

  // -half...+half (simulator: centered around origin for full visibility)
  const half = size / 2
  // prettier-ignore
  const vertices = new Float32Array([
    -half, 0, -half,  0, 0,
     half, 0, -half,  1, 0,
     half, 0,  half,  1, 1,
    -half, 0,  half,  0, 1,
  ])
  return { vertices, indices }
}

export function createGridPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
  options?: { positiveOnly?: boolean },
) {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [cameraBindGroupLayout],
  })

  const shaderModule = device.createShaderModule({ code: gridShader })

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 20, // 5 floats * 4 bytes
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
          { shaderLocation: 1, offset: 12, format: 'float32x2' }, // uv
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
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  })

  const { vertices, indices } = createGridGeometry(10000, options?.positiveOnly ?? false) // 100m grid

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
  }
}
