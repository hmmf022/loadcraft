import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SimulatorSession } from './session.js'
import { registerContainerTools } from './tools/container.js'
import { registerCargoTools } from './tools/cargo.js'
import { registerPlacementTools } from './tools/placement.js'
import { registerAnalysisTools } from './tools/analysis.js'
import { registerHistoryTools } from './tools/history.js'
import { registerSaveTools } from './tools/save.js'

const server = new McpServer({
  name: 'loadcraft',
  version: '0.1.0',
})

const session = new SimulatorSession()

registerContainerTools(server, session)
registerCargoTools(server, session)
registerPlacementTools(server, session)
registerAnalysisTools(server, session)
registerHistoryTools(server, session)
registerSaveTools(server, session)

const transport = new StdioServerTransport()
await server.connect(transport)
