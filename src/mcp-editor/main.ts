import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { EditorSession } from './session.js'
import { registerBlockTools } from './tools/blocks.js'
import { registerMetadataTools } from './tools/metadata.js'
import { registerQueryTools } from './tools/query.js'
import { registerHistoryTools } from './tools/history.js'
import { registerFileTools } from './tools/file.js'

const server = new McpServer({
  name: 'loadcraft-editor',
  version: '0.1.0',
})

const session = new EditorSession()

registerBlockTools(server, session)
registerMetadataTools(server, session)
registerQueryTools(server, session)
registerHistoryTools(server, session)
registerFileTools(server, session)

const transport = new StdioServerTransport()
await server.connect(transport)
