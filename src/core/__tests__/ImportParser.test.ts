import { describe, it, expect } from 'vitest'
import { parseCargoCSV, parseCargoJSON, parseCargoFile } from '../ImportParser'

describe('parseCargoCSV', () => {
  it('parses valid CSV', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg,color
Box A,50,40,30,100,#ff0000
Box B,60,50,40,200,#00ff00`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(result.defs[0]!.name).toBe('Box A')
    expect(result.defs[0]!.widthCm).toBe(50)
    expect(result.defs[0]!.color).toBe('#ff0000')
    expect(result.defs[1]!.name).toBe('Box B')
  })

  it('assigns random color when color column is empty', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg,color
Box A,50,40,30,100,`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('works when color column is absent', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
Box A,50,40,30,100`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.color).toBeTruthy()
  })

  it('reports error for missing required column', () => {
    const csv = `name,widthCm,heightCm
Box A,50,40`

    const result = parseCargoCSV(csv)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.includes('depthCm'))).toBe(true)
  })

  it('reports error for invalid numeric values', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
Box A,abc,40,30,100`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(0)
    expect(result.errors.some((e) => e.includes('widthCm'))).toBe(true)
  })

  it('reports error for empty name', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
,50,40,30,100`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(0)
    expect(result.errors.some((e) => e.includes('name'))).toBe(true)
  })

  it('generates unique IDs for each def', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
A,10,10,10,10
B,20,20,20,20`

    const result = parseCargoCSV(csv)
    expect(result.defs[0]!.id).not.toBe(result.defs[1]!.id)
  })

  it('parses constraint columns (maxStackWeightKg, noStack, noFlip)', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg,maxStackWeightKg,noStack,noFlip
Fragile,50,40,30,100,50,true,false
Glass,60,50,40,200,,false,true`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(2)
    expect(result.defs[0]!.maxStackWeightKg).toBe(50)
    expect(result.defs[0]!.noStack).toBe(true)
    expect(result.defs[0]!.noFlip).toBeUndefined()
    expect(result.defs[1]!.maxStackWeightKg).toBeUndefined()
    expect(result.defs[1]!.noStack).toBeUndefined()
    expect(result.defs[1]!.noFlip).toBe(true)
  })

  it('backward compatible: no constraint columns', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
Box,50,40,30,100`

    const result = parseCargoCSV(csv)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.maxStackWeightKg).toBeUndefined()
    expect(result.defs[0]!.noStack).toBeUndefined()
    expect(result.defs[0]!.noFlip).toBeUndefined()
  })
})

describe('parseCargoJSON', () => {
  it('parses valid JSON array', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: 50, heightCm: 40, depthCm: 30, weightKg: 100, color: '#ff0000' },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.defs[0]!.name).toBe('Box')
  })

  it('assigns random color when color is missing', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: 50, heightCm: 40, depthCm: 30, weightKg: 100 },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.color).toBeTruthy()
  })

  it('reports error for invalid JSON', () => {
    const result = parseCargoJSON('not json')
    expect(result.errors).toEqual(['Invalid JSON format'])
  })

  it('reports error for non-array JSON', () => {
    const result = parseCargoJSON('{"name": "test"}')
    expect(result.errors).toEqual(['JSON is not a valid cargo array or shape file'])
  })

  it('reports error for items with invalid fields', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: -5, heightCm: 40, depthCm: 30, weightKg: 100 },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(0)
    expect(result.errors.some((e) => e.includes('widthCm'))).toBe(true)
  })

  it('parses constraint fields (maxStackWeightKg, noStack, noFlip)', () => {
    const json = JSON.stringify([
      { name: 'Fragile', widthCm: 50, heightCm: 40, depthCm: 30, weightKg: 100, maxStackWeightKg: 50, noStack: true, noFlip: true },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.maxStackWeightKg).toBe(50)
    expect(result.defs[0]!.noStack).toBe(true)
    expect(result.defs[0]!.noFlip).toBe(true)
  })

  it('backward compatible: no constraint fields', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: 50, heightCm: 40, depthCm: 30, weightKg: 100 },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0]!.maxStackWeightKg).toBeUndefined()
    expect(result.defs[0]!.noStack).toBeUndefined()
    expect(result.defs[0]!.noFlip).toBeUndefined()
  })

  it('parses ShapeData JSON (version=1) as composite cargo', () => {
    const shapeData = {
      version: 1,
      name: 'L-Shape',
      gridSize: 10,
      blocks: [
        { x: 0, y: 0, z: 0, w: 30, h: 20, d: 10, color: '#ff0000' },
        { x: 0, y: 0, z: 10, w: 10, h: 20, d: 10, color: '#00ff00' },
      ],
      weightKg: 50,
    }

    const result = parseCargoJSON(JSON.stringify(shapeData))
    expect(result.errors).toHaveLength(0)
    expect(result.defs).toHaveLength(1)
    const def = result.defs[0]!
    expect(def.name).toBe('L-Shape')
    expect(def.weightKg).toBe(50)
    expect(def.blocks).toHaveLength(2)
    expect(def.widthCm).toBe(30)
    expect(def.heightCm).toBe(20)
    expect(def.depthCm).toBe(20)
  })
})

describe('parseCargoFile', () => {
  it('routes .csv files to CSV parser', () => {
    const csv = `name,widthCm,heightCm,depthCm,weightKg
Box,50,40,30,100`

    const result = parseCargoFile(csv, 'cargo.csv')
    expect(result.defs).toHaveLength(1)
  })

  it('routes .json files to JSON parser', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: 50, heightCm: 40, depthCm: 30, weightKg: 100 },
    ])

    const result = parseCargoFile(json, 'cargo.json')
    expect(result.defs).toHaveLength(1)
  })

  it('returns error for unsupported file type', () => {
    const result = parseCargoFile('data', 'cargo.txt')
    expect(result.errors).toEqual(['Unsupported file type: .txt'])
  })
})
