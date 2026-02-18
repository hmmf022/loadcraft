struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};

struct InstanceData {
  modelMatrix: mat4x4f,
  color: vec4f,
};

struct InstancesBuffer {
  instances: array<InstanceData>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(1) @binding(0) var<storage, read> instancesBuffer: InstancesBuffer;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) worldPos: vec3f,
  @location(2) color: vec4f,
};

@vertex
fn vs_main(input: VertexInput, @builtin(instance_index) instanceIdx: u32) -> VertexOutput {
  let instance = instancesBuffer.instances[instanceIdx];
  let worldPos = instance.modelMatrix * vec4f(input.position, 1.0);
  let worldNormal = normalize((instance.modelMatrix * vec4f(input.normal, 0.0)).xyz);

  var output: VertexOutput;
  output.position = camera.viewProj * worldPos;
  output.worldNormal = worldNormal;
  output.worldPos = worldPos.xyz;
  output.color = instance.color;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let lightDir = normalize(vec3f(0.3, 1.0, 0.5));
  let NdotL = max(dot(normalize(input.worldNormal), lightDir), 0.0);
  let ambient = 0.3;
  let diffuse = NdotL * 0.7;

  var baseColor = input.color.rgb;

  // Selection highlight: alpha > 1.5 signals selected state
  if (input.color.a > 1.5) {
    baseColor = min(baseColor * 1.3, vec3f(1.0));
    let finalColor = baseColor * (ambient + diffuse);
    // Add a bright rim effect
    let viewDir = normalize(camera.cameraPos - input.worldPos);
    let rim = 1.0 - max(dot(normalize(input.worldNormal), viewDir), 0.0);
    let rimColor = vec3f(0.4, 0.7, 1.0) * pow(rim, 2.0) * 0.5;
    return vec4f(finalColor + rimColor, 1.0);
  }

  let finalColor = baseColor * (ambient + diffuse);
  return vec4f(finalColor, input.color.a);
}
