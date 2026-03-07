import { describe, it, expect } from 'vitest'
import { validateShapeData, shapeToCargoItemDef } from '../ShapeParser'

describe('validateShapeData', () => {
  const validShape = {
    version: 1,
    name: 'Test Shape',
    gridSize: 10,
    blocks: [
      { x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, color: '#ff0000' },
    ],
    weightKg: 5,
  }

  it('accepts valid data', () => {
    expect(validateShapeData(validShape)).toBe(true)
  })

  it('rejects wrong version', () => {
    expect(validateShapeData({ ...validShape, version: 2 })).toBe(false)
  })

  it('rejects empty name', () => {
    expect(validateShapeData({ ...validShape, name: '' })).toBe(false)
  })

  it('rejects invalid gridSize', () => {
    expect(validateShapeData({ ...validShape, gridSize: 7 })).toBe(false)
  })

  it('accepts gridSize 1, 5, 10', () => {
    expect(validateShapeData({ ...validShape, gridSize: 1 })).toBe(true)
    expect(validateShapeData({ ...validShape, gridSize: 5 })).toBe(true)
    expect(validateShapeData({ ...validShape, gridSize: 10 })).toBe(true)
  })

  it('rejects negative weightKg', () => {
    expect(validateShapeData({ ...validShape, weightKg: -1 })).toBe(false)
  })

  it('rejects zero weightKg', () => {
    expect(validateShapeData({ ...validShape, weightKg: 0 })).toBe(false)
  })

  it('rejects blocks with negative dimensions', () => {
    expect(validateShapeData({
      ...validShape,
      blocks: [{ x: 0, y: 0, z: 0, w: -10, h: 10, d: 10, color: '#ff0000' }],
    })).toBe(false)
  })

  it('rejects blocks with invalid color', () => {
    expect(validateShapeData({
      ...validShape,
      blocks: [{ x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, color: 'red' }],
    })).toBe(false)
  })

  it('rejects null', () => {
    expect(validateShapeData(null)).toBe(false)
  })

  it('rejects non-object', () => {
    expect(validateShapeData('string')).toBe(false)
  })
})

describe('shapeToCargoItemDef', () => {
  it('computes correct bounding box with gridSize=1', () => {
    const shape = {
      version: 1 as const,
      name: 'L Shape',
      gridSize: 1,
      blocks: [
        { x: 0, y: 0, z: 0, w: 20, h: 10, d: 10, color: '#ff0000' },
        { x: 0, y: 10, z: 0, w: 10, h: 10, d: 10, color: '#00ff00' },
      ],
      weightKg: 15,
    }
    const def = shapeToCargoItemDef(shape)
    expect(def.widthCm).toBe(20)
    expect(def.heightCm).toBe(20)
    expect(def.depthCm).toBe(10)
    expect(def.weightKg).toBe(15)
    expect(def.name).toBe('L Shape')
    expect(def.blocks).toEqual(shape.blocks)
    expect(def.id).toBeTruthy()
  })

  it('scales blocks by gridSize', () => {
    const shape = {
      version: 1 as const,
      name: 'Scaled',
      gridSize: 5,
      blocks: [
        { x: 0, y: 0, z: 0, w: 2, h: 3, d: 4, color: '#ff0000' },
      ],
      weightKg: 10,
    }
    const def = shapeToCargoItemDef(shape)
    expect(def.widthCm).toBe(10)
    expect(def.heightCm).toBe(15)
    expect(def.depthCm).toBe(20)
    expect(def.blocks).toEqual([
      { x: 0, y: 0, z: 0, w: 10, h: 15, d: 20, color: '#ff0000' },
    ])
  })

  it('scales block positions by gridSize', () => {
    const shape = {
      version: 1 as const,
      name: 'L Shape',
      gridSize: 10,
      blocks: [
        { x: 0, y: 0, z: 0, w: 2, h: 1, d: 1, color: '#ff0000' },
        { x: 0, y: 1, z: 0, w: 1, h: 1, d: 1, color: '#00ff00' },
      ],
      weightKg: 15,
    }
    const def = shapeToCargoItemDef(shape)
    expect(def.widthCm).toBe(20)
    expect(def.heightCm).toBe(20)
    expect(def.depthCm).toBe(10)
    expect(def.blocks).toEqual([
      { x: 0, y: 0, z: 0, w: 20, h: 10, d: 10, color: '#ff0000' },
      { x: 0, y: 10, z: 0, w: 10, h: 10, d: 10, color: '#00ff00' },
    ])
  })

  it('uses first block color', () => {
    const shape = {
      version: 1 as const,
      name: 'Test',
      gridSize: 1,
      blocks: [
        { x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, color: '#aabbcc' },
      ],
      weightKg: 1,
    }
    const def = shapeToCargoItemDef(shape)
    expect(def.color).toBe('#aabbcc')
  })
})
