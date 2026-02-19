struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

struct ContainerUniform {
  modelMatrix: mat4x4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(1) @binding(0) var<uniform> container: ContainerUniform;

@vertex
fn vs_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
  let worldPos = container.modelMatrix * vec4f(position, 1.0);
  return camera.viewProj * worldPos;
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return container.color;
}
