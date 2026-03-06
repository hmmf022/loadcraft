import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EditorSession } from '../session.js'

export function registerMetadataTools(server: McpServer, session: EditorSession): void {
  server.tool(
    'set_name',
    'Set the shape name.',
    {
      name: z.string().min(1).describe('Shape name'),
    },
    async (args) => {
      session.setName(args.name)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, name: args.name }, null, 2) }],
      }
    },
  )

  server.tool(
    'set_weight',
    'Set the shape weight in kg.',
    {
      weightKg: z.number().positive().describe('Weight in kilograms'),
    },
    async (args) => {
      session.setWeight(args.weightKg)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, weightKg: args.weightKg }, null, 2) }],
      }
    },
  )

  server.tool(
    'set_brush_size',
    'Set the default brush dimensions (1-300 cells per axis).',
    {
      w: z.number().int().min(1).max(300).describe('Brush width'),
      h: z.number().int().min(1).max(300).describe('Brush height'),
      d: z.number().int().min(1).max(300).describe('Brush depth'),
    },
    async (args) => {
      session.setBrushSize(args.w, args.h, args.d)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, brushSize: { w: args.w, h: args.h, d: args.d } }, null, 2) }],
      }
    },
  )

  server.tool(
    'set_color',
    'Set the default color for place and fill operations.',
    {
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Color in #RRGGBB format'),
    },
    async (args) => {
      session.setColor(args.color)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, color: args.color }, null, 2) }],
      }
    },
  )
}
