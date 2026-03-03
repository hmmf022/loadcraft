import { describe, it, expect } from 'vitest'
import { OccupancyMap } from '../OccupancyMap'
import type { PlacedCargo, CargoItemDef, ContainerDef } from '../types'

const container: ContainerDef = {
  widthCm: 100,
  heightCm: 100,
  depthCm: 100,
  maxPayloadKg: 10000,
}

function makeDef(id: string, w: number, h: number, d: number): CargoItemDef {
  return { id, name: id, widthCm: w, heightCm: h, depthCm: d, weightKg: 10, color: '#ff0000' }
}

function makePlacement(instanceId: number, defId: string, x: number, y: number, z: number): PlacedCargo {
  return { instanceId, cargoDefId: defId, positionCm: { x, y, z }, rotationDeg: { x: 0, y: 0, z: 0 } }
}

describe('OccupancyMap', () => {
  it('empty map → findPosition returns (0, 0, 0)', () => {
    const map = new OccupancyMap(100, 100, 100)
    const pos = map.findPosition(20, 20, 20)
    expect(pos).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('findPosition returns null when item cannot fit', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Item taller than container
    const pos = map.findPosition(10, 110, 10)
    expect(pos).toBeNull()
  })

  it('findPosition returns null when floor is full', () => {
    const map = new OccupancyMap(100, 50, 100)
    // Fill entire floor to height 40
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 40, z: 100 } })
    // Try to place a 10x20x10 item — 40 + 20 = 60 > 50
    const pos = map.findPosition(10, 20, 10)
    expect(pos).toBeNull()
  })

  it('prefers floor over stacking', () => {
    const map = new OccupancyMap(100, 100, 100)
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 20, z: 30 } })
    // Item at (0,0,0) with size 30x20x30 is occupying y=0..20
    // Floor has free space at x>=30, so place there instead of stacking
    const pos = map.findPosition(30, 10, 30)
    expect(pos).toEqual({ x: 30, y: 0, z: 0 })
  })

  it('places next to existing item when space available', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill left side: x=0..50
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 100, z: 100 } })
    // Item 40x10x10 should go to x=50
    const pos = map.findPosition(40, 10, 10)
    expect(pos).toEqual({ x: 50, y: 0, z: 0 })
  })

  it('getStackHeight returns 0 for empty area', () => {
    const map = new OccupancyMap(100, 100, 100)
    expect(map.getStackHeight(0, 0, 20, 20)).toBe(0)
  })

  it('getStackHeight returns correct height after marking', () => {
    const map = new OccupancyMap(100, 100, 100)
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 25, z: 30 } })
    expect(map.getStackHeight(0, 0, 20, 20)).toBe(25)
    // Adjacent area should be 0
    expect(map.getStackHeight(40, 40, 20, 20)).toBe(0)
  })

  it('getStackHeight returns max of overlapping items', () => {
    const map = new OccupancyMap(100, 100, 100)
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 10, z: 20 } })
    map.markAABB({ min: { x: 10, y: 0, z: 0 }, max: { x: 30, y: 30, z: 20 } })
    // Footprint 0..30, z 0..20 should have max height 30
    expect(map.getStackHeight(0, 0, 30, 20)).toBe(30)
  })

  it('fromPlacements builds correct height map', () => {
    const defs = [makeDef('a', 30, 20, 30)]
    const placements = [makePlacement(1, 'a', 0, 0, 0)]
    const map = OccupancyMap.fromPlacements(placements, defs, container)
    expect(map.getStackHeight(0, 0, 30, 30)).toBe(20)
  })

  it('fromPlacements excludes specified instanceId', () => {
    const defs = [makeDef('a', 30, 20, 30)]
    const placements = [makePlacement(1, 'a', 0, 0, 0)]
    const map = OccupancyMap.fromPlacements(placements, defs, container, 1)
    expect(map.getStackHeight(0, 0, 30, 30)).toBe(0)
  })

  it('adjacent items do not interfere', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Two 30x20x30 items side by side
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 20, z: 30 } })
    map.markAABB({ min: { x: 30, y: 0, z: 0 }, max: { x: 60, y: 20, z: 30 } })
    // Floor has free space at x>=60, so place there instead of stacking
    const pos = map.findPosition(30, 10, 30)
    expect(pos).toEqual({ x: 60, y: 0, z: 0 })
  })

  it('findPosition with multiple placements via fromPlacements', () => {
    const defs = [makeDef('a', 50, 50, 50)]
    const placements = [
      makePlacement(1, 'a', 0, 0, 0),
      makePlacement(2, 'a', 50, 0, 0),
    ]
    const smallContainer: ContainerDef = {
      widthCm: 100, heightCm: 60, depthCm: 100, maxPayloadKg: 10000,
    }
    const map = OccupancyMap.fromPlacements(placements, defs, smallContainer)
    // Both items fill x=0..100, z=0..50, y=0..50
    // Floor has free space at z>=50, so place there instead of stacking
    const pos = map.findPosition(10, 10, 10)
    expect(pos).toEqual({ x: 0, y: 0, z: 50 })
  })

  it('fills lower layer before higher layer', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Column at z=0: height 40
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 40, z: 30 } })
    // Column at z=30: height 20
    map.markAABB({ min: { x: 0, y: 0, z: 30 }, max: { x: 30, y: 20, z: 60 } })
    // Fill the rest of the floor so no floor space remains
    map.markAABB({ min: { x: 30, y: 0, z: 0 }, max: { x: 100, y: 10, z: 100 } })
    map.markAABB({ min: { x: 0, y: 0, z: 60 }, max: { x: 30, y: 10, z: 100 } })
    // Should pick the lower layer (y=10) over higher layers
    const pos = map.findPosition(10, 10, 10)
    expect(pos!.y).toBe(10)
  })

  it('stacks on top when floor is fully occupied', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill entire floor to height 20
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 20, z: 100 } })
    // No floor space left, must stack
    const pos = map.findPosition(10, 10, 10)
    expect(pos).toEqual({ x: 0, y: 20, z: 0 })
  })
})
