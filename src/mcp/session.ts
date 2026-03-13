import { SimulatorSession as BaseSimulatorSession, voxelizeCargo } from '../core/SimulatorSession.js'
import type { PlacedCargo, StagedItem, AutoPackMode } from '../core/types.js'
import type { PackFailureReason } from '../core/AutoPacker.js'
import type { VoxelizeResult } from '../core/Voxelizer.js'
import { PlaceCommand, RepackCommand, BatchCommand } from '../core/History.js'
import { serializeSaveData } from '../core/SaveLoad.js'
import { execFileSync } from 'node:child_process'

class McpSimulatorSession extends BaseSimulatorSession {
  private static readonly RUST_BIN = process.env['AUTOPACK_RUST_BIN']

  override autoPackCargo(
    mode: AutoPackMode = 'packStaged',
    deadlineMs?: number,
  ): { success: boolean; placed: number; failed: number; failureReasons: PackFailureReason[]; error?: string } {
    if (McpSimulatorSession.RUST_BIN) {
      return this.autoPackCargoViaRust(mode, deadlineMs)
    }
    return super.autoPackCargo(mode, deadlineMs)
  }

  private autoPackViaRust(
    mode: AutoPackMode,
    timeoutMs: number,
  ): { placements: PlacedCargo[]; nextInstanceId: number; failedDefIds: string[]; failureReasons: PackFailureReason[]; stagedItems: StagedItem[] } {
    const saveJson = serializeSaveData({
      container: this.container,
      cargoDefs: this.cargoDefs,
      placements: this.placements,
      nextInstanceId: this.nextInstanceId,
      stagedItems: this.stagedItems,
    })
    const rustMode = mode === 'packStaged' ? 'pack_staged' : 'repack'
    const raw = execFileSync(McpSimulatorSession.RUST_BIN!, [
      '-m', rustMode, '-t', String(timeoutMs), '-s', 'default',
    ], { input: saveJson, encoding: 'utf8', timeout: timeoutMs + 5000 })
    return JSON.parse(raw)
  }

  private autoPackCargoViaRust(
    mode: AutoPackMode,
    deadlineMs?: number,
  ): { success: boolean; placed: number; failed: number; failureReasons: PackFailureReason[]; error?: string } {
    const timeoutMs = deadlineMs ?? 30000

    try {
      const rustResult = this.autoPackViaRust(mode, timeoutMs)

      if (rustResult.placements.length === 0) {
        this.stagedItems = rustResult.stagedItems
        return {
          success: false,
          placed: 0,
          failed: rustResult.failedDefIds.length,
          failureReasons: rustResult.failureReasons,
          error: 'No items could be placed',
        }
      }

      if (mode === 'repack') {
        const removedEntries: { placement: PlacedCargo; result: VoxelizeResult }[] = []
        for (const p of this.placements) {
          const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
          if (!def) continue
          removedEntries.push({ placement: p, result: voxelizeCargo(def, p.positionCm, p.rotationDeg) })
        }

        const addedEntries: { placement: PlacedCargo; result: VoxelizeResult }[] = []
        for (const p of rustResult.placements) {
          const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
          if (!def) continue
          addedEntries.push({ placement: p, result: voxelizeCargo(def, p.positionCm, p.rotationDeg) })
        }

        const repackCmd = new RepackCommand(removedEntries, addedEntries)
        this.history.executeCommand(repackCmd, this.grid)

        this.placements = rustResult.placements
        this.nextInstanceId = rustResult.nextInstanceId
        this.stagedItems = rustResult.stagedItems
      } else {
        const commands: PlaceCommand[] = []
        for (const p of rustResult.placements) {
          const def = this.cargoDefs.find((d) => d.id === p.cargoDefId)
          if (!def) continue
          const r = voxelizeCargo(def, p.positionCm, p.rotationDeg)
          commands.push(new PlaceCommand(p.instanceId, r, def.name, p))
        }

        const batch = new BatchCommand(commands)
        this.history.executeCommand(batch, this.grid)

        this.placements = [...this.placements, ...rustResult.placements]
        this.nextInstanceId = rustResult.nextInstanceId
        this.stagedItems = rustResult.stagedItems
      }

      return {
        success: true,
        placed: rustResult.placements.length,
        failed: rustResult.failedDefIds.length,
        failureReasons: rustResult.failureReasons,
      }
    } catch (e) {
      return {
        success: false,
        placed: 0,
        failed: 0,
        failureReasons: [],
        error: `Rust autopack failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
}

export { McpSimulatorSession as SimulatorSession }
