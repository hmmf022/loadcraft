import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CONTAINER_PRESETS } from '../../core/types.js'
import type { SimulatorSession } from '../session.js'

export function registerContainerTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'list_container_presets',
    'List available container presets (20ft, 40ft, etc.)',
    {},
    async () => {
      const presets = CONTAINER_PRESETS.map((p) => ({
        name: p.name,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        depthCm: p.depthCm,
        maxPayloadKg: p.maxPayloadKg,
      }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(presets, null, 2) }] }
    },
  )

  server.tool(
    'set_container',
    'Set the container size. Use a preset name or specify custom dimensions (cm). Resets all placements.',
    {
      preset: z.string().optional().describe('Preset name (e.g. "20ft Standard", "40ft Standard", "40ft High Cube")'),
      widthCm: z.number().positive().optional().describe('Custom width in cm'),
      heightCm: z.number().positive().optional().describe('Custom height in cm'),
      depthCm: z.number().positive().optional().describe('Custom depth in cm'),
      maxPayloadKg: z.number().positive().optional().describe('Max payload in kg'),
    },
    async (args) => {
      if (args.preset) {
        const preset = CONTAINER_PRESETS.find((p) => p.name === args.preset)
        if (!preset) {
          return {
            content: [{ type: 'text' as const, text: `Preset not found: ${args.preset}. Use list_container_presets to see available presets.` }],
            isError: true,
          }
        }
        session.setContainer({
          widthCm: preset.widthCm,
          heightCm: preset.heightCm,
          depthCm: preset.depthCm,
          maxPayloadKg: preset.maxPayloadKg,
        })
      } else {
        if (!args.widthCm || !args.heightCm || !args.depthCm || !args.maxPayloadKg) {
          return {
            content: [{ type: 'text' as const, text: 'Provide either preset name or all custom dimensions (widthCm, heightCm, depthCm, maxPayloadKg)' }],
            isError: true,
          }
        }
        if (args.widthCm > 2000 || args.heightCm > 2000 || args.depthCm > 2000) {
          return {
            content: [{ type: 'text' as const, text: 'Each dimension must be <= 2000cm due to memory constraints' }],
            isError: true,
          }
        }
        session.setContainer({
          widthCm: args.widthCm,
          heightCm: args.heightCm,
          depthCm: args.depthCm,
          maxPayloadKg: args.maxPayloadKg,
        })
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, container: session.container }, null, 2) }],
      }
    },
  )
}
