import Papa from 'papaparse'
import type { CargoItemDef } from './types'

export interface ImportResult {
  defs: CargoItemDef[]
  errors: string[]
}

const RANDOM_COLORS = [
  '#4a90d9', '#d94a4a', '#4ad97a', '#d9c04a', '#9b4ad9',
  '#4ad9d9', '#d97a4a', '#7a4ad9', '#4ad94a', '#d94a9b',
]

function randomColor(): string {
  return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)]!
}

export function parseCargoCSV(csvText: string): ImportResult {
  const errors: string[] = []
  const defs: CargoItemDef[] = []

  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      errors.push(`Row ${(e.row ?? 0) + 1}: ${e.message}`)
    }
  }

  const requiredFields = ['name', 'widthCm', 'heightCm', 'depthCm', 'weightKg']
  if (result.data.length > 0) {
    const headers = Object.keys(result.data[0]!)
    for (const f of requiredFields) {
      if (!headers.includes(f)) {
        errors.push(`Required column missing: ${f}`)
        return { defs, errors }
      }
    }
  }

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i]!
    const rowNum = i + 2 // 1-indexed + header row

    const name = row['name']?.trim()
    if (!name) {
      errors.push(`Row ${rowNum}: name is empty`)
      continue
    }

    const widthCm = parseFloat(row['widthCm'] ?? '')
    const heightCm = parseFloat(row['heightCm'] ?? '')
    const depthCm = parseFloat(row['depthCm'] ?? '')
    const weightKg = parseFloat(row['weightKg'] ?? '')

    if (isNaN(widthCm) || widthCm <= 0) {
      errors.push(`Row ${rowNum}: invalid widthCm`)
      continue
    }
    if (isNaN(heightCm) || heightCm <= 0) {
      errors.push(`Row ${rowNum}: invalid heightCm`)
      continue
    }
    if (isNaN(depthCm) || depthCm <= 0) {
      errors.push(`Row ${rowNum}: invalid depthCm`)
      continue
    }
    if (isNaN(weightKg) || weightKg <= 0) {
      errors.push(`Row ${rowNum}: invalid weightKg`)
      continue
    }

    const color = row['color']?.trim() || randomColor()

    defs.push({
      id: crypto.randomUUID(),
      name,
      widthCm,
      heightCm,
      depthCm,
      weightKg,
      color,
    })
  }

  return { defs, errors }
}

export function parseCargoJSON(jsonText: string): ImportResult {
  const errors: string[] = []
  const defs: CargoItemDef[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { defs, errors: ['Invalid JSON format'] }
  }

  if (!Array.isArray(parsed)) {
    return { defs, errors: ['JSON must be an array of cargo definitions'] }
  }

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>
    const idx = i + 1

    const name = typeof item['name'] === 'string' ? item['name'].trim() : ''
    if (!name) {
      errors.push(`Item ${idx}: name is missing or empty`)
      continue
    }

    const widthCm = Number(item['widthCm'])
    const heightCm = Number(item['heightCm'])
    const depthCm = Number(item['depthCm'])
    const weightKg = Number(item['weightKg'])

    if (isNaN(widthCm) || widthCm <= 0) {
      errors.push(`Item ${idx}: invalid widthCm`)
      continue
    }
    if (isNaN(heightCm) || heightCm <= 0) {
      errors.push(`Item ${idx}: invalid heightCm`)
      continue
    }
    if (isNaN(depthCm) || depthCm <= 0) {
      errors.push(`Item ${idx}: invalid depthCm`)
      continue
    }
    if (isNaN(weightKg) || weightKg <= 0) {
      errors.push(`Item ${idx}: invalid weightKg`)
      continue
    }

    const color = typeof item['color'] === 'string' && item['color'].trim()
      ? item['color'].trim()
      : randomColor()

    defs.push({
      id: crypto.randomUUID(),
      name,
      widthCm,
      heightCm,
      depthCm,
      weightKg,
      color,
    })
  }

  return { defs, errors }
}

export function parseCargoFile(content: string, fileName: string): ImportResult {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'csv') {
    return parseCargoCSV(content)
  }
  if (ext === 'json') {
    return parseCargoJSON(content)
  }
  return { defs: [], errors: [`Unsupported file type: .${ext}`] }
}
