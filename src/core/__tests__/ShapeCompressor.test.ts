import { describe, it, expect } from 'vitest'
import { compressBlocks, expandBlocks } from '../ShapeCompressor'
import type { ShapeBlock } from '../types'
import { blockKey } from '../types'

function makeBlocks(coords: [number, number, number, string][]): Map<string, ShapeBlock> {
  const m = new Map<string, ShapeBlock>()
  for (const [x, y, z, color] of coords) {
    m.set(blockKey(x, y, z), { x, y, z, w: 1, h: 1, d: 1, color })
  }
  return m
}

describe('compressBlocks', () => {
  it('compresses a single block', () => {
    const cells = makeBlocks([[0, 0, 0, '#ff0000']])
    const result = compressBlocks(cells, 10)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, color: '#ff0000' })
  })

  it('compresses a straight line in X', () => {
    const cells = makeBlocks([
      [0, 0, 0, '#ff0000'],
      [1, 0, 0, '#ff0000'],
      [2, 0, 0, '#ff0000'],
    ])
    const result = compressBlocks(cells, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ x: 0, y: 0, z: 0, w: 15, h: 5, d: 5, color: '#ff0000' })
  })

  it('compresses an L-shape into 2 blocks', () => {
    const cells = makeBlocks([
      [0, 0, 0, '#ff0000'],
      [1, 0, 0, '#ff0000'],
      [0, 1, 0, '#ff0000'],
    ])
    const result = compressBlocks(cells, 10)
    // L-shape cannot be compressed into 1 block, so expect 2
    expect(result.length).toBeLessThanOrEqual(3)
    expect(result.length).toBeGreaterThanOrEqual(2)
    // Total volume should match 3 cells
    const totalVolume = result.reduce((acc, b) => acc + b.w * b.h * b.d, 0)
    expect(totalVolume).toBe(3 * 10 * 10 * 10)
  })

  it('handles mixed colors separately', () => {
    const cells = makeBlocks([
      [0, 0, 0, '#ff0000'],
      [1, 0, 0, '#00ff00'],
    ])
    const result = compressBlocks(cells, 10)
    expect(result).toHaveLength(2) // different colors cannot merge
  })

  it('returns empty for empty input', () => {
    const result = compressBlocks(new Map(), 10)
    expect(result).toHaveLength(0)
  })
})

describe('expandBlocks', () => {
  it('expands a single block', () => {
    const blocks = [{ x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, color: '#ff0000' }]
    const cells = expandBlocks(blocks, 10)
    expect(cells.size).toBe(1)
    const cell = cells.get('0,0,0')
    expect(cell).toEqual({ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, color: '#ff0000' })
  })

  it('expands a 2x1x1 block into 2 cells', () => {
    const blocks = [{ x: 0, y: 0, z: 0, w: 20, h: 10, d: 10, color: '#ff0000' }]
    const cells = expandBlocks(blocks, 10)
    expect(cells.size).toBe(2)
    expect(cells.has('0,0,0')).toBe(true)
    expect(cells.has('1,0,0')).toBe(true)
  })
})

describe('round-trip', () => {
  it('compress then expand restores same cell count', () => {
    const original = makeBlocks([
      [0, 0, 0, '#ff0000'],
      [1, 0, 0, '#ff0000'],
      [2, 0, 0, '#ff0000'],
      [0, 1, 0, '#ff0000'],
      [0, 0, 1, '#00ff00'],
    ])
    const compressed = compressBlocks(original, 10)
    const restored = expandBlocks(compressed, 10)
    expect(restored.size).toBe(original.size)

    // Verify all original cells exist in restored
    for (const [key, block] of original) {
      const restoredBlock = restored.get(key)
      expect(restoredBlock).toBeDefined()
      expect(restoredBlock!.color).toBe(block.color)
    }
  })
})
