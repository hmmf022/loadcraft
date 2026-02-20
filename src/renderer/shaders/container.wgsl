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
  resolution: vec2f,
  lineWidth: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(1) @binding(0) var<uniform> container: ContainerUniform;

@vertex
fn vs_main(
  @location(0) position_a: vec3f,
  @location(1) position_b: vec3f,
  @location(2) expand: f32,
  @location(3) end_select: f32,
) -> @builtin(position) vec4f {
  let world_a = container.modelMatrix * vec4f(position_a, 1.0);
  let world_b = container.modelMatrix * vec4f(position_b, 1.0);
  let clip_a = camera.viewProj * world_a;
  let clip_b = camera.viewProj * world_b;

  // NDC coordinates
  let ndc_a = clip_a.xy / clip_a.w;
  let ndc_b = clip_b.xy / clip_b.w;

  // Screen-space direction and normal
  let dir = normalize(ndc_b - ndc_a);
  let normal = vec2f(-dir.y, dir.x);

  // Select endpoint
  let clip_pos = select(clip_a, clip_b, end_select > 0.5);

  // Convert lineWidth pixels to NDC offset
  let offset = normal * expand * container.lineWidth / container.resolution;

  return vec4f(clip_pos.xy + offset * clip_pos.w, clip_pos.zw);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return container.color;
}
