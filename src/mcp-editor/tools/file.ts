import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { EditorSession } from '../session.js'

export function registerFileTools(server: McpServer, session: EditorSession): void {
  server.tool(
    'export_shape',
    'Export the current shape as ShapeData JSON (gridSize is always 1cm blocks for MCP). If filePath is given, writes to that file; otherwise returns the JSON string.',
    {
      filePath: z.string().optional().describe('Optional file path to write the shape JSON to'),
    },
    async (args) => {
      if (session.state.blocks.size === 0) {
        return { content: [{ type: 'text' as const, text: 'No blocks to export' }], isError: true }
      }

      const { json } = session.exportShape()

      if (args.filePath) {
        const absPath = resolve(args.filePath)
        try {
          await writeFile(absPath, json, 'utf-8')
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: true, filePath: absPath, blockCount: session.state.blocks.size }, null, 2) }],
        }
      }

      return {
        content: [{ type: 'text' as const, text: json }],
      }
    },
  )

  server.tool(
    'import_shape',
    'Import a ShapeData JSON (replaces current shape). MCP only supports gridSize=1 (1cm blocks). Provide exactly one of json or filePath.',
    {
      json: z.string().optional().describe('ShapeData JSON string'),
      filePath: z.string().optional().describe('File path to read ShapeData from'),
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

      const result = session.importShape(jsonStr)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          shapeName: session.state.shapeName,
          weightKg: session.state.weightKg,
          blockCount: result.blockCount,
        }, null, 2) }],
      }
    },
  )
}
