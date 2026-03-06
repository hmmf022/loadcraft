import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SimulatorSession } from '../session.js'

const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

export function registerPlacementTools(server: McpServer, session: SimulatorSession): void {
  server.tool(
    'place_cargo',
    'Place a cargo item at a specified position (cm). Optionally specify rotation (degrees).',
    {
      cargoDefId: z.string().describe('Cargo definition ID'),
      position: vec3Schema.describe('Position in cm {x, y, z}'),
      rotation: vec3Schema.optional().describe('Rotation in degrees {x, y, z}. Default: {0,0,0}'),
    },
    async (args) => {
      const result = session.placeCargo(args.cargoDefId, args.position, args.rotation)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, instanceId: result.instanceId }, null, 2) }],
      }
    },
  )

  server.tool(
    'remove_cargo',
    'Remove a placed cargo item by its instance ID',
    {
      instanceId: z.number().int().positive().describe('Instance ID of the placed cargo'),
    },
    async (args) => {
      const result = session.removePlacement(args.instanceId)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'move_cargo',
    'Move a placed cargo item to a new position (cm)',
    {
      instanceId: z.number().int().positive().describe('Instance ID of the placed cargo'),
      position: vec3Schema.describe('New position in cm {x, y, z}'),
    },
    async (args) => {
      const result = session.moveCargo(args.instanceId, args.position)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'rotate_cargo',
    'Rotate a placed cargo item. Position auto-corrects to stay within container.',
    {
      instanceId: z.number().int().positive().describe('Instance ID of the placed cargo'),
      rotation: vec3Schema.describe('New rotation in degrees {x, y, z}'),
    },
    async (args) => {
      const result = session.rotateCargo(args.instanceId, args.rotation)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }],
      }
    },
  )

  server.tool(
    'drop_cargo',
    'Drop a cargo item down (gravity) to the lowest valid Y position',
    {
      instanceId: z.number().int().positive().describe('Instance ID of the placed cargo'),
    },
    async (args) => {
      const result = session.dropCargo(args.instanceId)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, newY: result.newY }, null, 2) }],
      }
    },
  )

  server.tool(
    'auto_pack',
    'Automatically pack all defined cargo items into the container using shelf-packing algorithm',
    {},
    async () => {
      const result = session.autoPackCargo()
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          placed: result.placed,
          failed: result.failed,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'find_position',
    'Find the next available position to place a cargo item (using OccupancyMap)',
    {
      cargoDefId: z.string().describe('Cargo definition ID'),
    },
    async (args) => {
      const result = session.findPosition(args.cargoDefId)
      if (!result.position) {
        return {
          content: [{ type: 'text' as const, text: 'No available position found' }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ position: result.position }, null, 2) }],
      }
    },
  )
}
