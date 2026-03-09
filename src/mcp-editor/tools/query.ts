import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EditorSession } from '../session.js'

export function registerQueryTools(server: McpServer, session: EditorSession): void {
  server.tool(
    'list_blocks',
    'List all blocks with their position, size, and color.',
    {},
    async () => {
      const blocks = session.listBlocks()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          blockCount: blocks.length,
          blocks: blocks.map((b) => ({
            x: b.x, y: b.y, z: b.z,
            w: b.w, h: b.h, d: b.d,
            color: b.color,
          })),
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'get_status',
    'Get shape name, weight, block count, bounding box, and undo/redo state.',
    {},
    async () => {
      const status = session.getStatus()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      }
    },
  )

  server.tool(
    'find_block_at',
    'Find which block contains the given coordinate. Returns the block origin, size, and color.',
    {
      x: z.number().int().min(0).describe('X coordinate to search'),
      y: z.number().int().min(0).describe('Y coordinate to search'),
      z: z.number().int().min(0).describe('Z coordinate to search'),
    },
    async (args) => {
      const block = session.findBlockAt(args.x, args.y, args.z)
      if (!block) {
        return {
          content: [{ type: 'text' as const, text: `No block found at (${args.x},${args.y},${args.z})` }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          found: true,
          block: { x: block.x, y: block.y, z: block.z, w: block.w, h: block.h, d: block.d, color: block.color },
        }, null, 2) }],
      }
    },
  )
}
