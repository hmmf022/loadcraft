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
    'list_placements',
    'List all placed cargo items with their positions, rotations, and cargo definition info',
    {},
    async () => {
      const list = session.placements.map((p) => {
        const def = session.cargoDefs.find((d) => d.id === p.cargoDefId)
        return {
          instanceId: p.instanceId,
          cargoDefId: p.cargoDefId,
          name: def?.name ?? 'unknown',
          position: p.positionCm,
          rotation: p.rotationDeg,
          widthCm: def?.widthCm ?? 0,
          heightCm: def?.heightCm ?? 0,
          depthCm: def?.depthCm ?? 0,
          color: def?.color ?? '#000000',
          hasBlocks: !!(def?.blocks),
        }
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: list.length, placements: list }, null, 2) }],
      }
    },
  )

  server.tool(
    'get_placement',
    'Get detailed info about a single placed cargo item by instance ID',
    {
      instanceId: z.number().int().positive().describe('Instance ID of the placed cargo'),
    },
    async (args) => {
      const placement = session.placements.find((p) => p.instanceId === args.instanceId)
      if (!placement) {
        return { content: [{ type: 'text' as const, text: 'Placement not found' }], isError: true }
      }
      const def = session.cargoDefs.find((d) => d.id === placement.cargoDefId)
      if (!def) {
        return { content: [{ type: 'text' as const, text: 'Cargo definition not found' }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          instanceId: placement.instanceId,
          cargoDefId: placement.cargoDefId,
          name: def.name,
          positionCm: placement.positionCm,
          rotationDeg: placement.rotationDeg,
          def: {
            widthCm: def.widthCm,
            heightCm: def.heightCm,
            depthCm: def.depthCm,
            weightKg: def.weightKg,
            color: def.color,
            hasBlocks: !!def.blocks,
            noFlip: def.noFlip ?? false,
            noStack: def.noStack ?? false,
            maxStackWeightKg: def.maxStackWeightKg,
          },
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'place_cargo',
    'Place a cargo item at a specified position (cm). Optionally specify rotation (degrees). Use force=true to allow overlapping placement.',
    {
      cargoDefId: z.string().describe('Cargo definition ID'),
      position: vec3Schema.describe('Position in cm {x, y, z}'),
      rotation: vec3Schema.optional().describe('Rotation in degrees {x, y, z}. Default: {0,0,0}'),
      force: z.boolean().optional().describe('If true, skip collision check and allow overlapping placement. Default: false'),
    },
    async (args) => {
      const result = session.placeCargo(args.cargoDefId, args.position, args.rotation, args.force)
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
    'Auto-pack cargo into the container. mode="pack_staged" places staged items around existing placements (default). mode="repack" clears all placements and re-packs everything (existing + staged). Max 500 items.',
    {
      mode: z.enum(['repack', 'pack_staged']).default('pack_staged').describe('Pack mode: "repack" or "pack_staged"'),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000).describe('Timeout in milliseconds (default 30s, max 120s)'),
    },
    async (args) => {
      const mode = args.mode === 'repack' ? 'repack' : 'packStaged'
      const deadline = Date.now() + args.timeout_ms
      const result = session.autoPackCargo(mode, deadline)
      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: result.error,
              placed: result.placed,
              failed: result.failed,
              failureReasons: result.failureReasons,
            }, null, 2),
          }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          placed: result.placed,
          failed: result.failed,
          failureReasons: result.failureReasons,
        }, null, 2) }],
      }
    },
  )

  server.tool(
    'restage_placements',
    'Remove placed cargo and return them to the staging area. Useful after load_state to re-pack with auto_pack(mode: "pack_staged").',
    {
      instanceIds: z.array(z.number().int()).optional().describe('Instance IDs to restage. Omit to restage ALL placements.'),
    },
    async (args) => {
      const result = session.restagePlacements(args.instanceIds)
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error! }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: true,
          restaged: result.restaged,
          stagedItems: session.listStaged(),
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
