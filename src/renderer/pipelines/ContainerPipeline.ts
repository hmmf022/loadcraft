import containerShader from '../shaders/container.wgsl?raw'

// Container box mesh: 5 walls (no front opening), with outward normals
function createContainerGeometry(w: number, h: number, d: number) {
  // Each vertex: position(3) + normal(3) = 6 floats
  // 5 faces (back, top, bottom, right, left), 4 vertices each = 20 vertices, 30 indices
  // prettier-ignore
  const vertices = new Float32Array([
    // Back face (z=d, normal 0,0,1 outward => facing inside we see it)
    0, 0, d,  0, 0, -1,
    w, 0, d,  0, 0, -1,
    w, h, d,  0, 0, -1,
    0, h, d,  0, 0, -1,
    // Top face (y=h, normal 0,1,0)
    0, h, 0,  0, 1, 0,
    w, h, 0,  0, 1, 0,
    w, h, d,  0, 1, 0,
    0, h, d,  0, 1, 0,
    // Bottom face (y=0, normal 0,-1,0)
    0, 0, 0,  0, -1, 0,
    0, 0, d,  0, -1, 0,
    w, 0, d,  0, -1, 0,
    w, 0, 0,  0, -1, 0,
    // Right face (x=w, normal 1,0,0)
    w, 0, 0,  1, 0, 0,
    w, 0, d,  1, 0, 0,
    w, h, d,  1, 0, 0,
    w, h, 0,  1, 0, 0,
    // Left face (x=0, normal -1,0,0)
    0, 0, 0,  -1, 0, 0,
    0, h, 0,  -1, 0, 0,
    0, h, d,  -1, 0, 0,
    0, 0, d,  -1, 0, 0,
  ])

  // prettier-ignore
  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
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

  // Sub-pass A: Back faces (transparent), cullMode='front' renders back faces
  const transparentPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
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
      cullMode: 'front', // Renders back faces
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  })

  // Sub-pass B: Front faces (opaque), cullMode='back' renders front faces
  const opaquePipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back', // Renders front faces
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
    transparentPipeline,
    opaquePipeline,
    vertexBuffer,
    indexBuffer,
    indexCount: indices.length,
    containerBindGroupLayout,
  }
}
