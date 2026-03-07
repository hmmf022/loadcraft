export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ContainerPreset {
  name: string
  widthCm: number
  heightCm: number
  depthCm: number
  maxPayloadKg: number
}

export interface ContainerDef {
  widthCm: number
  heightCm: number
  depthCm: number
  maxPayloadKg: number
}

export interface ShapeBlock {
  x: number; y: number; z: number  // cm offset from shape origin
  w: number; h: number; d: number  // cm dimensions
  color: string                     // "#RRGGBB"
}

export interface CargoItemDef {
  id: string
  name: string
  widthCm: number      // bounding box width (auto-computed for composite shapes)
  heightCm: number
  depthCm: number
  weightKg: number
  color: string
  blocks?: ShapeBlock[] // undefined = conventional box (backward compatible)
  maxStackWeightKg?: number  // max weight allowed on top (kg). undefined=unlimited
  noStack?: boolean          // no stacking allowed (sugar for maxStackWeightKg=0)
  noFlip?: boolean           // keep Y-axis upright: only Y-axis rotations allowed
}

export interface PlacedCargo {
  instanceId: number
  cargoDefId: string
  positionCm: Vec3
  rotationDeg: Vec3
}

export interface PlacementState {
  container: ContainerDef
  cargoDefs: CargoItemDef[]
  placements: PlacedCargo[]
  nextInstanceId: number
}

export interface WeightResult {
  totalWeightKg: number
  centerOfGravity: Vec3
  fillRatePercent: number
  overweight: boolean
}

export interface GridStats {
  totalVoxels: number
  occupiedVoxels: number
  fillRate: number
}

export interface DragState {
  cargoDefId: string
  currentPosition: Vec3 | null
  currentRotation: Vec3
  isValid: boolean
  fromStaging?: boolean
}

export interface StagedItem {
  cargoDefId: string
  count: number
}

export type AutoPackMode = 'repack' | 'packStaged'

export type CameraView = 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'isometric'

export const CONTAINER_PRESETS: ContainerPreset[] = [
  { name: '20ft Standard', widthCm: 590, heightCm: 239, depthCm: 235, maxPayloadKg: 28200 },
  { name: '40ft Standard', widthCm: 1203, heightCm: 239, depthCm: 235, maxPayloadKg: 26680 },
  { name: '40ft High Cube', widthCm: 1203, heightCm: 269, depthCm: 235, maxPayloadKg: 26460 },
]
