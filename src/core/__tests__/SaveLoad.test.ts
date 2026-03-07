import { describe, it, expect } from 'vitest'
import { validateSaveData, serializeSaveData } from '../SaveLoad'
import type { SaveData } from '../SaveLoad'

const validData: SaveData = {
  version: 1,
  container: { widthCm: 590, heightCm: 239, depthCm: 235, maxPayloadKg: 28200 },
  cargoDefs: [
    { id: 'abc', name: 'Box', widthCm: 50, heightCm: 50, depthCm: 50, weightKg: 100, color: '#ff0000' },
  ],
  placements: [
    { instanceId: 1, cargoDefId: 'abc', positionCm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
  ],
  nextInstanceId: 2,
}

describe('validateSaveData', () => {
  it('accepts valid data', () => {
    expect(validateSaveData(validData)).toBe(true)
  })

  it('accepts data with empty arrays', () => {
    const data = { ...validData, cargoDefs: [], placements: [] }
    expect(validateSaveData(data)).toBe(true)
  })

  it('rejects null', () => {
    expect(validateSaveData(null)).toBe(false)
  })

  it('rejects wrong version', () => {
    expect(validateSaveData({ ...validData, version: 2 })).toBe(false)
  })

  it('rejects missing container', () => {
    const { container: _container, ...rest } = validData
    void _container
    expect(validateSaveData(rest)).toBe(false)
  })

  it('rejects invalid container fields', () => {
    expect(validateSaveData({
      ...validData,
      container: { ...validData.container, widthCm: -1 },
    })).toBe(false)
  })

  it('rejects invalid cargoDef', () => {
    expect(validateSaveData({
      ...validData,
      cargoDefs: [{ id: 123 }], // id should be string
    })).toBe(false)
  })

  it('rejects invalid placement', () => {
    expect(validateSaveData({
      ...validData,
      placements: [{ instanceId: 'not-a-number' }],
    })).toBe(false)
  })

  it('rejects invalid nextInstanceId', () => {
    expect(validateSaveData({ ...validData, nextInstanceId: 0 })).toBe(false)
    expect(validateSaveData({ ...validData, nextInstanceId: -1 })).toBe(false)
  })

  it('accepts data with stagedItems', () => {
    const data = { ...validData, stagedItems: [{ cargoDefId: 'abc', count: 3 }] }
    expect(validateSaveData(data)).toBe(true)
  })

  it('accepts data without stagedItems (backward compat)', () => {
    expect(validateSaveData(validData)).toBe(true)
  })

  it('rejects invalid stagedItems (non-array)', () => {
    expect(validateSaveData({ ...validData, stagedItems: 'bad' })).toBe(false)
  })

  it('rejects invalid stagedItems entries', () => {
    expect(validateSaveData({ ...validData, stagedItems: [{ cargoDefId: 123, count: 1 }] })).toBe(false)
    expect(validateSaveData({ ...validData, stagedItems: [{ cargoDefId: 'abc', count: 0 }] })).toBe(false)
  })
})

describe('serializeSaveData', () => {
  it('round-trips through serialize then parse+validate', () => {
    const json = serializeSaveData({
      container: validData.container,
      cargoDefs: validData.cargoDefs,
      placements: validData.placements,
      nextInstanceId: validData.nextInstanceId,
    })

    const parsed = JSON.parse(json)
    expect(validateSaveData(parsed)).toBe(true)
    expect(parsed.version).toBe(1)
    expect(parsed.container.widthCm).toBe(590)
    expect(parsed.cargoDefs).toHaveLength(1)
    expect(parsed.placements).toHaveLength(1)
    expect(parsed.nextInstanceId).toBe(2)
  })
})
