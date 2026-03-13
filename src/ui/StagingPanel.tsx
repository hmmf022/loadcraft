import { useAppStore } from '../state/store'
import { useTranslation } from '../i18n'
import type { PackFailureCode } from '../core/AutoPacker'
import type { PackStrategy } from '../core/AutoPacker'
import styles from './StagingPanel.module.css'

const STRATEGY_OPTIONS: PackStrategy[] = ['default', 'layer', 'wall', 'lff']

export function StagingPanel() {
  const stagedItems = useAppStore((s) => s.stagedItems)
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const unstageCargo = useAppStore((s) => s.unstageCargo)
  const stageCargo = useAppStore((s) => s.stageCargo)
  const clearStaged = useAppStore((s) => s.clearStaged)
  const autoPackCargo = useAppStore((s) => s.autoPackCargo)
  const autoPackFailures = useAppStore((s) => s.autoPackFailures)
  const placements = useAppStore((s) => s.placements)
  const packStrategy = useAppStore((s) => s.packStrategy)
  const setPackStrategy = useAppStore((s) => s.setPackStrategy)
  const { t } = useTranslation()

  const getFailureLabel = (code: PackFailureCode): string => {
    if (code === 'OUT_OF_BOUNDS') return t.packFailure.outOfBounds
    if (code === 'NO_FEASIBLE_POSITION') return t.packFailure.noFeasiblePosition
    if (code === 'COLLISION') return t.packFailure.collision
    if (code === 'NO_SUPPORT') return t.packFailure.noSupport
    return t.packFailure.stackConstraint
  }

  const strategyLabel = (s: PackStrategy): string => {
    if (s === 'default') return t.staging.strategyDefault
    if (s === 'layer') return t.staging.strategyLayer
    if (s === 'wall') return t.staging.strategyWall
    return t.staging.strategyLff
  }

  const handleRepackAll = () => {
    if (placements.length > 0 && !confirm(t.staging.confirmRepack)) return
    autoPackCargo('repack', packStrategy)
  }

  const handleDragStart = (e: React.DragEvent, cargoDefId: string) => {
    e.dataTransfer.setData('text/plain', cargoDefId)
    e.dataTransfer.effectAllowed = 'copy'
    useAppStore.getState().setDragState({
      cargoDefId,
      currentPosition: null,
      currentRotation: { x: 0, y: 0, z: 0 },
      isValid: false,
      fromStaging: true,
    })
  }

  const handleDragEnd = () => {
    useAppStore.getState().setDragState(null)
  }

  return (
    <div className={styles.panel}>
      {stagedItems.length === 0 ? (
        <div className={styles.empty}>{t.staging.empty}</div>
      ) : (
        stagedItems.map((si) => {
          const def = cargoDefs.find((d) => d.id === si.cargoDefId)
          if (!def) return null
          return (
            <div
              key={si.cargoDefId}
              className={styles.item}
              draggable
              onDragStart={(e) => handleDragStart(e, si.cargoDefId)}
              onDragEnd={handleDragEnd}
            >
              <span className={styles.colorSwatch} style={{ backgroundColor: def.color }} />
              <span className={styles.itemName}>{def.name}</span>
              <span className={styles.count}>&times;{si.count}</span>
              <button
                className={styles.countBtn}
                onClick={() => unstageCargo(si.cargoDefId)}
              >
                &minus;
              </button>
              <button
                className={styles.countBtn}
                onClick={() => stageCargo(si.cargoDefId)}
              >
                +
              </button>
            </div>
          )
        })
      )}
      <div className={styles.strategyRow}>
        <span className={styles.strategyLabel}>{t.staging.strategy}</span>
        <select
          className={styles.strategySelect}
          value={packStrategy}
          onChange={(e) => setPackStrategy(e.target.value as PackStrategy)}
        >
          {STRATEGY_OPTIONS.map((s) => (
            <option key={s} value={s}>{strategyLabel(s)}</option>
          ))}
        </select>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.packButton}
          onClick={() => autoPackCargo('packStaged', packStrategy)}
          disabled={stagedItems.length === 0}
        >
          {t.staging.packStaged}
        </button>
        <button
          className={styles.repackButton}
          onClick={handleRepackAll}
          disabled={placements.length === 0 && stagedItems.length === 0}
        >
          {t.staging.repackAll}
        </button>
        {stagedItems.length > 0 && (
          <button className={styles.clearButton} onClick={clearStaged}>
            {t.staging.clearStage}
          </button>
        )}
      </div>
      {autoPackFailures.length > 0 && (
        <div className={styles.failurePanel}>
          <div className={styles.failureTitle}>{t.packFailure.title}</div>
          <div className={styles.failureList}>
            {autoPackFailures.slice(0, 6).map((item, idx) => (
              <div key={`${item.cargoDefId}:${idx}`} className={styles.failureItem}>
                <span className={styles.failureName}>{item.cargoName}</span>
                <span className={styles.failureReason}>{getFailureLabel(item.code)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
