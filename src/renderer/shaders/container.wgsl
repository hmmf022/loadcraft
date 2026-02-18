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

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) worldPos: vec3f,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let worldPos = container.modelMatrix * vec4f(input.position, 1.0);
  let worldNormal = normalize((container.modelMatrix * vec4f(input.normal, 0.0)).xyz);

  var output: VertexOutput;
  output.position = camera.viewProj * worldPos;
  output.worldNormal = worldNormal;
  output.worldPos = worldPos.xyz;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let lightDir = normalize(vec3f(0.3, 1.0, 0.5));
  let NdotL = max(dot(normalize(input.worldNormal), lightDir), 0.0);
  let ambient = 0.4;
  let diffuse = NdotL * 0.6;
  let finalColor = container.color.rgb * (ambient + diffuse);
  return vec4f(finalColor, container.color.a);
}
