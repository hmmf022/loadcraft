import type { ContainerDef } from './types'
import { VoxelGrid } from './VoxelGrid'

let voxelGrid: VoxelGrid | null = null

export function getVoxelGrid(): VoxelGrid {
  if (!voxelGrid) throw new Error('VoxelGrid not initialized')
  return voxelGrid
}

export function createVoxelGrid(container: ContainerDef): VoxelGrid {
  voxelGrid = new VoxelGrid(container.widthCm, container.heightCm, container.depthCm)
  return voxelGrid
}

export function destroyVoxelGrid(): void {
  voxelGrid = null
}
