import { shapeToCargoItemDef, validateShapeData } from '../core/ShapeParser'
import type { CargoItemDef } from '../core/types'

const CAR_PART_FILES = [
  'front-bumper', 'rear-bumper',
  'door-left', 'door-right',
  'front-seat', 'rear-seat-bench',
  'tire-rubber', 'wheel-rim',
  'hood', 'windshield',
  'fender-left', 'fender-right',
  'engine-block', 'dashboard',
]

export async function loadCarPartsSamples(): Promise<CargoItemDef[]> {
  const defs: CargoItemDef[] = []
  const results = await Promise.allSettled(
    CAR_PART_FILES.map((name) =>
      fetch(`/samples/car-parts/${name}.shape.json`).then((r) => r.json())
    )
  )
  for (const result of results) {
    if (result.status === 'fulfilled' && validateShapeData(result.value)) {
      defs.push(shapeToCargoItemDef(result.value))
    }
  }
  return defs
}
