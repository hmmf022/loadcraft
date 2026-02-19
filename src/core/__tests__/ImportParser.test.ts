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
    expect(result.errors).toEqual(['JSON must be an array of cargo definitions'])
  })

  it('reports error for items with invalid fields', () => {
    const json = JSON.stringify([
      { name: 'Box', widthCm: -5, heightCm: 40, depthCm: 30, weightKg: 100 },
    ])

    const result = parseCargoJSON(json)
    expect(result.defs).toHaveLength(0)
    expect(result.errors.some((e) => e.includes('widthCm'))).toBe(true)
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
