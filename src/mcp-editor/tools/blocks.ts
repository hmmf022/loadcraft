import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EditorSession } from '../session.js'

export function registerBlockTools(server: McpServer, session: EditorSession): void {
  server.tool(
    'place_block',
    'Place a 1×1×1 block at the given position. For region placement, use fill_region.',
    {
      x: z.number().int().min(0).describe('X position (cells)'),
      y: z.number().int().min(0).describe('Y position (cells)'),
      z: z.number().int().min(0).describe('Z position (cells)'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Block color (#RRGGBB). Defaults to currentColor.'),
    },
    async (args) => {
      const result = session.placeBlock(args.x, args.y, args.z, args.color)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          block: { x: args.x, y: args.y, z: args.z, w: 1, h: 1, d: 1 },
          blockCount: session.state.blocks.size,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'remove_block',
    'Remove a block by its origin position. Use find_block_at to find the origin of a block at any coordinate.',
    {
      x: z.number().int().describe('X origin of the block'),
      y: z.number().int().describe('Y origin of the block'),
      z: z.number().int().describe('Z origin of the block'),
    },
    async (args) => {
      const result = session.removeBlock(args.x, args.y, args.z)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          blockCount: session.state.blocks.size,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'paint_block',
    'Recolor a block at its origin position.',
    {
      x: z.number().int().describe('X origin of the block'),
      y: z.number().int().describe('Y origin of the block'),
      z: z.number().int().describe('Z origin of the block'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('New color (#RRGGBB)'),
    },
    async (args) => {
      const result = session.paintBlock(args.x, args.y, args.z, args.color)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'clear_all',
    'Remove all blocks from the shape.',
    {},
    async () => {
      const result = session.clearAll()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          removedBlocks: result.blockCount,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'fill_region',
    'Fill a rectangular region with 1x1x1 blocks. Single undo entry. Max 1,000,000 cells.',
    {
      x: z.number().int().min(0).describe('Start X position'),
      y: z.number().int().min(0).describe('Start Y position'),
      z: z.number().int().min(0).describe('Start Z position'),
      w: z.number().int().min(1).describe('Width (cells)'),
      h: z.number().int().min(1).describe('Height (cells)'),
      d: z.number().int().min(1).describe('Depth (cells)'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Fill color (#RRGGBB). Defaults to currentColor.'),
    },
    async (args) => {
      const result = session.fillRegion(args.x, args.y, args.z, args.w, args.h, args.d, args.color)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          placed: result.placed,
          skipped: result.skipped,
          blockCount: session.state.blocks.size,
        }, null, 2) }],
      }
    },
  )
}
