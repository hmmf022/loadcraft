import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SimulatorSession } from '../session.js'

export function registerCargoTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'add_cargo_def',
    'Define a new cargo type with dimensions (cm), weight (kg), and color',
    {
      name: z.string().describe('Name of the cargo item'),
      widthCm: z.number().positive().describe('Width in cm'),
      heightCm: z.number().positive().describe('Height in cm'),
      depthCm: z.number().positive().describe('Depth in cm'),
      weightKg: z.number().positive().describe('Weight in kg'),
      color: z.string().default('#4a90d9').describe('Color as hex string (e.g. "#FF0000")'),
      noFlip: z.boolean().optional().describe('Keep Y-axis upright (only Y-axis rotations)'),
      noStack: z.boolean().optional().describe('No stacking allowed on top'),
      maxStackWeightKg: z.number().optional().describe('Max weight allowed on top (kg)'),
    },
    async (args) => {
      const id = crypto.randomUUID()
      session.addCargoDef({
        id,
        name: args.name,
        widthCm: args.widthCm,
        heightCm: args.heightCm,
        depthCm: args.depthCm,
        weightKg: args.weightKg,
        color: args.color,
        ...(args.noFlip !== undefined && { noFlip: args.noFlip }),
        ...(args.noStack !== undefined && { noStack: args.noStack }),
        ...(args.maxStackWeightKg !== undefined && { maxStackWeightKg: args.maxStackWeightKg }),
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, id, name: args.name }, null, 2) }],
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
    'import_cargo',
    'Import cargo definitions from CSV or JSON string',
    {
      content: z.string().describe('CSV or JSON string with cargo definitions'),
      format: z.enum(['csv', 'json']).describe('Format of the content'),
    },
    async (args) => {
      const result = session.importCargo(args.content, args.format)
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
}
