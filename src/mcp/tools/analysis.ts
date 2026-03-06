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

  server.tool(
    'check_stack_constraints',
    'Check stack weight constraints for all placements. Returns violations where weight on top exceeds maxStackWeightKg or noStack is set.',
    {},
    async () => {
      const result = session.checkStackConstraintsAll()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          violationCount: result.violations.length,
          violations: result.violations,
        }, null, 2) }],
      }
    },
  )
}
