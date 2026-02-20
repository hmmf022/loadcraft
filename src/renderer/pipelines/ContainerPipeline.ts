import containerShader from '../shaders/container.wgsl?raw'

// Container wireframe as screen-space quads: 12 edges, each edge = 4 vertices + 6 indices
function createContainerGeometry(w: number, h: number, d: number) {
  // prettier-ignore
  const corners = [
    [0,0,0], [w,0,0], [w,h,0], [0,h,0],
    [0,0,d], [w,0,d], [w,h,d], [0,h,d],
  ]
  // prettier-ignore
  const edges = [
    [0,1],[1,2],[2,3],[3,0],  // front
    [4,5],[5,6],[6,7],[7,4],  // back
    [0,4],[1,5],[2,6],[3,7],  // connecting
  ]

  // 12 edges × 4 vertices × 8 floats (position_a:3, position_b:3, expand:1, end_select:1)
  const vertices = new Float32Array(12 * 4 * 8)
  const indices = new Uint16Array(12 * 6)

  for (let i = 0; i < 12; i++) {
    const ai = edges[i]![0]!
    const bi = edges[i]![1]!
    const a = corners[ai]!
    const b = corners[bi]!
    const base = i * 4

    for (let v = 0; v < 4; v++) {
      const off = (base + v) * 8
      vertices[off + 0] = a[0]!  // position_a
      vertices[off + 1] = a[1]!
      vertices[off + 2] = a[2]!
      vertices[off + 3] = b[0]!  // position_b
      vertices[off + 4] = b[1]!
      vertices[off + 5] = b[2]!
      vertices[off + 6] = (v & 1) ? 1 : -1  // expand
      vertices[off + 7] = (v & 2) ? 1 : 0   // end_select
    }

    // 2 triangles: [0,1,2], [2,1,3]
    const idx = i * 6
    indices[idx + 0] = base
    indices[idx + 1] = base + 1
    indices[idx + 2] = base + 2
    indices[idx + 3] = base + 2
    indices[idx + 4] = base + 1
    indices[idx + 5] = base + 3
  }

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
        arrayStride: 32, // 8 floats × 4 bytes
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position_a
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // position_b
          { shaderLocation: 2, offset: 24, format: 'float32' },   // expand
          { shaderLocation: 3, offset: 28, format: 'float32' },   // end_select
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
