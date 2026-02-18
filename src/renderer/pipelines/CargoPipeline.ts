import cargoShader from '../shaders/cargo.wgsl?raw'

// Unit cube: 24 vertices (4 per face, unique normals), 36 indices
function createUnitCubeGeometry() {
  // Each vertex: position(3) + normal(3) = 6 floats
  // prettier-ignore
  const vertices = new Float32Array([
    // Front face (z=+0.5, normal 0,0,1)
    -0.5, -0.5,  0.5,  0, 0, 1,
     0.5, -0.5,  0.5,  0, 0, 1,
     0.5,  0.5,  0.5,  0, 0, 1,
    -0.5,  0.5,  0.5,  0, 0, 1,
    // Back face (z=-0.5, normal 0,0,-1)
     0.5, -0.5, -0.5,  0, 0, -1,
    -0.5, -0.5, -0.5,  0, 0, -1,
    -0.5,  0.5, -0.5,  0, 0, -1,
     0.5,  0.5, -0.5,  0, 0, -1,
    // Top face (y=+0.5, normal 0,1,0)
    -0.5,  0.5,  0.5,  0, 1, 0,
     0.5,  0.5,  0.5,  0, 1, 0,
     0.5,  0.5, -0.5,  0, 1, 0,
    -0.5,  0.5, -0.5,  0, 1, 0,
    // Bottom face (y=-0.5, normal 0,-1,0)
    -0.5, -0.5, -0.5,  0, -1, 0,
     0.5, -0.5, -0.5,  0, -1, 0,
     0.5, -0.5,  0.5,  0, -1, 0,
    -0.5, -0.5,  0.5,  0, -1, 0,
    // Right face (x=+0.5, normal 1,0,0)
     0.5, -0.5,  0.5,  1, 0, 0,
     0.5, -0.5, -0.5,  1, 0, 0,
     0.5,  0.5, -0.5,  1, 0, 0,
     0.5,  0.5,  0.5,  1, 0, 0,
    // Left face (x=-0.5, normal -1,0,0)
    -0.5, -0.5, -0.5,  -1, 0, 0,
    -0.5, -0.5,  0.5,  -1, 0, 0,
    -0.5,  0.5,  0.5,  -1, 0, 0,
    -0.5,  0.5, -0.5,  -1, 0, 0,
  ])

  // prettier-ignore
  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,  // front
     4,  5,  6,   4,  6,  7,  // back
     8,  9, 10,   8, 10, 11,  // top
    12, 13, 14,  12, 14, 15,  // bottom
    16, 17, 18,  16, 18, 19,  // right
    20, 21, 22,  20, 22, 23,  // left
  ])

  return { vertices, indices }
}

export const INSTANCE_BYTE_SIZE = 80 // 20 floats: mat4x4 (16) + vec4 (4)

export function createCargoPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
) {
  const instanceBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'read-only-storage' },
    }],
  })

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [cameraBindGroupLayout, instanceBindGroupLayout],
  })

  const shaderModule = device.createShaderModule({ code: cargoShader })

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 24, // 6 floats * 4 bytes
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
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
      cullMode: 'back',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  })

  const { vertices, indices } = createUnitCubeGeometry()

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
    instanceBindGroupLayout,
  }
}
