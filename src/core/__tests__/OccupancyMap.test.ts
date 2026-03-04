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
  it('empty map → findPosition returns back wall position', () => {
    const map = new OccupancyMap(100, 100, 100)
    // 奥壁=X=0 から配置
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

  it('prefers back wall over front positions', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill back wall area: x=0..30
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 20, z: 30 } })
    // 30x10x30 item: back wall at x=0 is occupied y=0..20
    // Should place at next Z slot at back wall (x=0, z=30) rather than go to front
    const pos = map.findPosition(30, 10, 30)
    expect(pos).toEqual({ x: 0, y: 0, z: 30 })
  })

  it('places next to existing item at back wall', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill back half: x=0..50
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 100, z: 100 } })
    // Item 40x10x10 should go as close to back wall as possible: x=50
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
    // Two 30x20x30 items at back wall (X=0)
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 20, z: 30 } })
    map.markAABB({ min: { x: 0, y: 0, z: 30 }, max: { x: 30, y: 20, z: 60 } })
    // 30x10x30 item should go to the next Z slot at back wall
    const pos = map.findPosition(30, 10, 30)
    expect(pos).toEqual({ x: 0, y: 0, z: 60 })
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
    // Back wall (x=0..10) at z=50..60 is free → place there
    const pos = map.findPosition(10, 10, 10)
    expect(pos).toEqual({ x: 0, y: 0, z: 50 })
  })

  it('fills back wall upward before moving to front', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill back wall floor: x=0..30, z=0..100
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 40, z: 100 } })
    // Fill front area floor
    map.markAABB({ min: { x: 30, y: 0, z: 0 }, max: { x: 100, y: 10, z: 100 } })
    // Should prefer stacking on back wall (x=0, y=40) over front (x=30, y=10)
    const pos = map.findPosition(30, 10, 10)
    expect(pos!.x).toBe(0)
    expect(pos!.y).toBe(40)
  })

  it('stacks on top when floor is fully occupied', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Fill entire floor to height 20
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 20, z: 100 } })
    // No floor space left, must stack — back wall preferred (X=0)
    const pos = map.findPosition(10, 10, 10)
    expect(pos).toEqual({ x: 0, y: 20, z: 0 })
  })

  it('wall-building pattern: fills Z then stacks Y before moving X forward', () => {
    const map = new OccupancyMap(100, 100, 100)
    // Place 30x20x30 items and verify wall-building order
    // 1st: back wall floor (X=0)
    const pos1 = map.findPosition(30, 20, 30)
    expect(pos1).toEqual({ x: 0, y: 0, z: 0 })
    map.markAABB({ min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 20, z: 30 } })

    // 2nd: next Z slot at back wall
    const pos2 = map.findPosition(30, 20, 30)
    expect(pos2).toEqual({ x: 0, y: 0, z: 30 })
    map.markAABB({ min: { x: 0, y: 0, z: 30 }, max: { x: 30, y: 20, z: 60 } })

    // 3rd: next Z slot at back wall
    const pos3 = map.findPosition(30, 20, 30)
    expect(pos3).toEqual({ x: 0, y: 0, z: 60 })
    map.markAABB({ min: { x: 0, y: 0, z: 60 }, max: { x: 30, y: 20, z: 90 } })

    // 4th: back wall stack (y=20), since Z floor is mostly full
    const pos4 = map.findPosition(30, 20, 30)
    expect(pos4).toEqual({ x: 0, y: 20, z: 0 })
  })
})
