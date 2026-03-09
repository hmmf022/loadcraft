import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { SimulatorSession } from '../session.js'

export function registerCargoTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'add_cargo_def',
    'Define a new cargo type. For simple boxes, provide widthCm/heightCm/depthCm. For composite shapes, provide blocks (array of {x,y,z,w,h,d,color}) and dimensions are auto-computed from AABB.',
    {
      name: z.string().describe('Name of the cargo item'),
      widthCm: z.number().positive().optional().describe('Width in cm (required for simple boxes, auto-computed if blocks given)'),
      heightCm: z.number().positive().optional().describe('Height in cm (required for simple boxes, auto-computed if blocks given)'),
      depthCm: z.number().positive().optional().describe('Depth in cm (required for simple boxes, auto-computed if blocks given)'),
      weightKg: z.number().positive().describe('Weight in kg'),
      color: z.string().default('#4a90d9').describe('Color as hex string (e.g. "#FF0000")'),
      blocks: z.array(z.object({
        x: z.number().min(0),
        y: z.number().min(0),
        z: z.number().min(0),
        w: z.number().positive(),
        h: z.number().positive(),
        d: z.number().positive(),
        color: z.string(),
      })).optional().describe('Composite shape blocks (overrides dimensions with AABB)'),
      noFlip: z.boolean().optional().describe('Keep Y-axis upright (only Y-axis rotations)'),
      noStack: z.boolean().optional().describe('No stacking allowed on top'),
      maxStackWeightKg: z.number().optional().describe('Max weight allowed on top (kg)'),
    },
    async (args) => {
      let widthCm = args.widthCm
      let heightCm = args.heightCm
      let depthCm = args.depthCm

      if (args.blocks && args.blocks.length > 0) {
        // Auto-compute AABB from blocks
        let maxX = 0, maxY = 0, maxZ = 0
        for (const b of args.blocks) {
          maxX = Math.max(maxX, b.x + b.w)
          maxY = Math.max(maxY, b.y + b.h)
          maxZ = Math.max(maxZ, b.z + b.d)
        }
        widthCm = widthCm ?? maxX
        heightCm = heightCm ?? maxY
        depthCm = depthCm ?? maxZ
      }

      if (!widthCm || !heightCm || !depthCm) {
        return {
          content: [{ type: 'text' as const, text: 'widthCm, heightCm, and depthCm are required when blocks are not provided' }],
          isError: true,
        }
      }

      const id = crypto.randomUUID()
      session.addCargoDef({
        id,
        name: args.name,
        widthCm,
        heightCm,
        depthCm,
        weightKg: args.weightKg,
        color: args.color,
        ...(args.blocks && { blocks: args.blocks }),
        ...(args.noFlip !== undefined && { noFlip: args.noFlip }),
        ...(args.noStack !== undefined && { noStack: args.noStack }),
        ...(args.maxStackWeightKg !== undefined && { maxStackWeightKg: args.maxStackWeightKg }),
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, id, name: args.name, hasBlocks: !!args.blocks }, null, 2) }],
      }
    },
  )

  server.tool(
    'list_cargo_defs',
    'List all defined cargo types',
    {},
    async () => {
      const defs = session.cargoDefs.map((d) => ({
        id: d.id,
        name: d.name,
        widthCm: d.widthCm,
        heightCm: d.heightCm,
        depthCm: d.depthCm,
        weightKg: d.weightKg,
        color: d.color,
        hasBlocks: !!d.blocks,
      }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(defs, null, 2) }] }
    },
  )

  server.tool(
    'remove_cargo_def',
    'Remove a cargo definition and all its placements',
    {
      id: z.string().describe('Cargo definition ID'),
    },
    async (args) => {
      const exists = session.cargoDefs.some((d) => d.id === args.id)
      if (!exists) {
        return {
          content: [{ type: 'text' as const, text: 'Cargo definition not found' }],
          isError: true,
        }
      }
      const result = session.removeCargoDef(args.id)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, removedPlacements: result.removedPlacements }, null, 2) }],
      }
    },
  )

  server.tool(
    'update_cargo_def',
    'Update an existing cargo definition. Dimension changes are rejected if the def has active placements.',
    {
      id: z.string().describe('Cargo definition ID'),
      name: z.string().optional().describe('New name'),
      widthCm: z.number().positive().optional().describe('New width in cm'),
      heightCm: z.number().positive().optional().describe('New height in cm'),
      depthCm: z.number().positive().optional().describe('New depth in cm'),
      weightKg: z.number().positive().optional().describe('New weight in kg'),
      color: z.string().optional().describe('New color as hex string'),
      noFlip: z.boolean().optional().describe('Keep Y-axis upright (only Y-axis rotations)'),
      noStack: z.boolean().optional().describe('No stacking allowed on top'),
      maxStackWeightKg: z.number().optional().describe('Max weight allowed on top (kg)'),
    },
    async (args) => {
      const { id, ...updates } = args
      const result = session.updateCargoDef(id, updates)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'stage_cargo',
    'Add items to the staging area for auto-packing',
    {
      cargoDefId: z.string().describe('Cargo definition ID'),
      count: z.number().int().positive().default(1).describe('Number of items to stage'),
    },
    async (args) => {
      const result = session.stageCargo(args.cargoDefId, args.count)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'unstage_cargo',
    'Remove items from the staging area',
    {
      cargoDefId: z.string().describe('Cargo definition ID'),
      count: z.number().int().positive().default(1).describe('Number of items to unstage'),
    },
    async (args) => {
      const result = session.unstageCargo(args.cargoDefId, args.count)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'list_staged',
    'List all items in the staging area',
    {},
    async () => {
      const staged = session.listStaged()
      const items = staged.map((s) => {
        const def = session.cargoDefs.find((d) => d.id === s.cargoDefId)
        return { cargoDefId: s.cargoDefId, name: def?.name ?? 'unknown', count: s.count }
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: items.length, items }, null, 2) }],
      }
    },
  )

  server.tool(
    'import_cargo',
    'Import cargo definitions from CSV or JSON string. For format="json", ShapeData is auto-detected. MCP only accepts ShapeData with gridSize=1 (1cm blocks). JSON import is atomic: any validation error fails the whole import.',
    {
      content: z.string().describe('CSV or JSON string with cargo definitions'),
      format: z.enum(['csv', 'json']).describe('Format of the content'),
    },
    async (args) => {
      const result = session.importCargo(args.content, args.format)
      if (args.format === 'json' && result.errors.length > 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            importedCount: 0,
            imported: [],
            errors: result.errors,
          }, null, 2) }],
          isError: true,
        }
      }
      const imported = result.defs.map((d) => ({ id: d.id, name: d.name }))
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          importedCount: result.defs.length,
          imported,
          errors: result.errors,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'import_shape',
    'Import a voxel shape (ShapeData JSON) as a composite cargo definition. Accepts loadcraft-editor export_shape output. MCP only supports gridSize=1 (1cm blocks). Provide exactly one of json or filePath.',
    {
      json: z.string().optional().describe('ShapeData JSON string (from loadcraft-editor export_shape)'),
      filePath: z.string().optional().describe('File path to a .shape.json file'),
      noFlip: z.boolean().optional().describe('Keep Y-axis upright (only Y-axis rotations)'),
      noStack: z.boolean().optional().describe('No stacking allowed on top'),
      maxStackWeightKg: z.number().optional().describe('Max weight allowed on top (kg)'),
    },
    async (args) => {
      if (args.json && args.filePath) {
        return {
          content: [{ type: 'text' as const, text: 'Provide either json or filePath, not both.' }],
          isError: true,
        }
      }
      if (!args.json && !args.filePath) {
        return {
          content: [{ type: 'text' as const, text: 'Provide either json or filePath.' }],
          isError: true,
        }
      }

      let jsonStr: string
      if (args.filePath) {
        const absPath = resolve(args.filePath)
        try {
          jsonStr = await readFile(absPath, 'utf-8')
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `Failed to read file: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          }
        }
      } else {
        jsonStr = args.json!
      }

      const overrides = {
        ...(args.noFlip !== undefined && { noFlip: args.noFlip }),
        ...(args.noStack !== undefined && { noStack: args.noStack }),
        ...(args.maxStackWeightKg !== undefined && { maxStackWeightKg: args.maxStackWeightKg }),
      }

      const result = session.importShape(jsonStr, Object.keys(overrides).length > 0 ? overrides : undefined)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, id: result.id, name: result.name }, null, 2) }],
      }
    },
  )
}
