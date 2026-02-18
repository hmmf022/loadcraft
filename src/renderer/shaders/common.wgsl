struct CameraUniform {
  viewProj: mat4x4f,
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPos: vec3f,
  _padding: f32,
};
