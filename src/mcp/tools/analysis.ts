import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SimulatorSession } from '../session.js'

export function registerAnalysisTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'get_status',
    'Get current simulation status: container, placement count, weight, fill rate, center of gravity, grid stats',
    {},
    async () => {
      const status = session.getStatus()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      }
    },
  )

  server.tool(
    'check_interference',
    'Check all placement pairs for AABB overlap (interference)',
    {},
    async () => {
      const result = session.checkInterferenceAll()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          interferenceCount: result.pairs.length,
          pairs: result.pairs,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'check_support',
    'Check support (gravity) for all placed cargo items. Items need >= 80% bottom face supported.',
    {},
    async () => {
      const result = session.checkSupportAll()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    },
  )
}
