import axisShader from '../shaders/axis.wgsl?raw'

function createAxisGeometry() {
  const len = 5000 // 50m axis length
  // 6 vertices: 2 per axis, each vertex = position(3) + color(3) = 6 floats
  // prettier-ignore
  const vertices = new Float32Array([
    // X axis (red)
    0, 0, 0,   1, 0, 0,
    len, 0, 0, 1, 0, 0,
    // Y axis (green)
    0, 0, 0,   0, 1, 0,
    0, len, 0, 0, 1, 0,
    // Z axis (blue)
    0, 0, 0,   0, 0, 1,
    0, 0, len, 0, 0, 1,
  ])

  return { vertices, vertexCount: 6 }
}

export function createAxisPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraBindGroupLayout: GPUBindGroupLayout,
) {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [cameraBindGroupLayout],
  })

  const shaderModule = device.createShaderModule({ code: axisShader })

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 24, // 6 floats * 4 bytes
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // color
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
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  })

  const { vertices, vertexCount } = createAxisGeometry()

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertexBuffer, 0, vertices)

  return {
    pipeline,
    vertexBuffer,
    vertexCount,
  }
}
