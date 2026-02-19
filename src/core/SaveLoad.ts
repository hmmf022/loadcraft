import type { ContainerDef, CargoItemDef, PlacedCargo } from './types'

export interface SaveData {
  version: 1
  container: ContainerDef
  cargoDefs: CargoItemDef[]
  placements: PlacedCargo[]
  nextInstanceId: number
}

export function validateSaveData(data: unknown): data is SaveData {
  if (typeof data !== 'object' || data === null) return false

  const d = data as Record<string, unknown>
  if (d['version'] !== 1) return false

  // Validate container
  const c = d['container']
  if (typeof c !== 'object' || c === null) return false
  const container = c as Record<string, unknown>
  if (typeof container['widthCm'] !== 'number' || container['widthCm'] <= 0) return false
  if (typeof container['heightCm'] !== 'number' || container['heightCm'] <= 0) return false
  if (typeof container['depthCm'] !== 'number' || container['depthCm'] <= 0) return false
  if (typeof container['maxPayloadKg'] !== 'number' || container['maxPayloadKg'] <= 0) return false

  // Validate cargoDefs array
  if (!Array.isArray(d['cargoDefs'])) return false
  for (const def of d['cargoDefs'] as unknown[]) {
    if (typeof def !== 'object' || def === null) return false
    const cd = def as Record<string, unknown>
    if (typeof cd['id'] !== 'string') return false
    if (typeof cd['name'] !== 'string') return false
    if (typeof cd['widthCm'] !== 'number' || cd['widthCm'] <= 0) return false
    if (typeof cd['heightCm'] !== 'number' || cd['heightCm'] <= 0) return false
    if (typeof cd['depthCm'] !== 'number' || cd['depthCm'] <= 0) return false
    if (typeof cd['weightKg'] !== 'number' || cd['weightKg'] <= 0) return false
    if (typeof cd['color'] !== 'string') return false
    // Optional blocks field for composite shapes
    if (cd['blocks'] !== undefined) {
      if (!Array.isArray(cd['blocks'])) return false
      for (const b of cd['blocks'] as unknown[]) {
        if (typeof b !== 'object' || b === null) return false
        const sb = b as Record<string, unknown>
        if (typeof sb['x'] !== 'number') return false
        if (typeof sb['y'] !== 'number') return false
        if (typeof sb['z'] !== 'number') return false
        if (typeof sb['w'] !== 'number' || sb['w'] <= 0) return false
        if (typeof sb['h'] !== 'number' || sb['h'] <= 0) return false
        if (typeof sb['d'] !== 'number' || sb['d'] <= 0) return false
        if (typeof sb['color'] !== 'string') return false
      }
    }
  }

  // Validate placements array
  if (!Array.isArray(d['placements'])) return false
  for (const p of d['placements'] as unknown[]) {
    if (typeof p !== 'object' || p === null) return false
    const pl = p as Record<string, unknown>
    if (typeof pl['instanceId'] !== 'number') return false
    if (typeof pl['cargoDefId'] !== 'string') return false
    if (!isVec3(pl['positionCm'])) return false
    if (!isVec3(pl['rotationDeg'])) return false
  }

  // Validate nextInstanceId
  if (typeof d['nextInstanceId'] !== 'number' || d['nextInstanceId'] < 1) return false

  return true
}

function isVec3(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return typeof obj['x'] === 'number' && typeof obj['y'] === 'number' && typeof obj['z'] === 'number'
}

export function serializeSaveData(state: {
  container: ContainerDef
  cargoDefs: CargoItemDef[]
  placements: PlacedCargo[]
  nextInstanceId: number
}): string {
  const data: SaveData = {
    version: 1,
    container: state.container,
    cargoDefs: state.cargoDefs,
    placements: state.placements,
    nextInstanceId: state.nextInstanceId,
  }
  return JSON.stringify(data, null, 2)
}

export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
