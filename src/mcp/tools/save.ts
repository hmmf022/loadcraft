import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { SimulatorSession } from '../session.js'

export function registerSaveTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'save_state',
    'Export the current simulation state as JSON. If filePath is given, writes to that file; otherwise returns the JSON string.',
    {
      filePath: z.string().optional().describe('Optional file path to write the state JSON to'),
    },
    async (args) => {
      const json = session.serialize()
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
          content: [{ type: 'text' as const, text: JSON.stringify({ success: true, filePath: absPath }, null, 2) }],
        }
      }
      return {
        content: [{ type: 'text' as const, text: json }],
      }
    },
  )

  server.tool(
    'load_state',
    'Load simulation state from a JSON string or a file path (replaces current state). Provide exactly one of json or filePath.',
    {
      json: z.string().optional().describe('JSON string of saved state (SaveData format)'),
      filePath: z.string().optional().describe('File path to read saved state from'),
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

      const result = session.loadFromSaveData(jsonStr)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          container: session.container,
          cargoDefCount: session.cargoDefs.length,
          placementCount: session.placements.length,
        }, null, 2) }],
      }
    },
  )
}
