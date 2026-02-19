struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) uv: vec2f,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let worldPos = vec4f(input.position, 1.0);
  var output: VertexOutput;
  output.position = camera.viewProj * worldPos;
  output.worldPos = input.position;
  output.uv = input.uv;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let gridSpacing = 100.0; // 100cm = 1m
  let lineWidth = 1.5;

  let coord = input.worldPos.xz / gridSpacing;
  let grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  let line = min(grid.x, grid.y);
  let lineAlpha = 1.0 - min(line / lineWidth, 1.0);

  let dist = length(input.worldPos.xz - camera.cameraPos.xz);
  let fade = 1.0 - smoothstep(3000.0, 5000.0, dist);

  let gridColor = vec3f(0.5, 0.5, 0.5);
  let alpha = lineAlpha * 0.8 * fade;
  if (alpha < 0.01) { discard; }
  return vec4f(gridColor, alpha);
}
