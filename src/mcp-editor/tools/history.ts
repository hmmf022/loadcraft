import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { EditorSession } from '../session.js'

export function registerHistoryTools(server: McpServer, session: EditorSession): void {
  server.tool(
    'undo',
    'Undo the last block operation.',
    {},
    async () => {
      const result = session.undo()
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: 'Nothing to undo' }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          blockCount: session.state.blocks.size,
          canUndo: session.history.canUndo,
          canRedo: session.history.canRedo,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'redo',
    'Redo the last undone operation.',
    {},
    async () => {
      const result = session.redo()
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: 'Nothing to redo' }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          blockCount: session.state.blocks.size,
          canUndo: session.history.canUndo,
          canRedo: session.history.canRedo,
        }, null, 2) }],
      }
    },
  )
}
