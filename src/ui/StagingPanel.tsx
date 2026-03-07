import { useAppStore } from '../state/store'
import { useTranslation } from '../i18n'
import styles from './StagingPanel.module.css'

export function StagingPanel() {
  const stagedItems = useAppStore((s) => s.stagedItems)
  const cargoDefs = useAppStore((s) => s.cargoDefs)
  const unstageCargo = useAppStore((s) => s.unstageCargo)
  const stageCargo = useAppStore((s) => s.stageCargo)
  const clearStaged = useAppStore((s) => s.clearStaged)
  const autoPackCargo = useAppStore((s) => s.autoPackCargo)
  const placements = useAppStore((s) => s.placements)
  const { t } = useTranslation()

  const handleRepackAll = () => {
    if (placements.length > 0 && !confirm(t.staging.confirmRepack)) return
    autoPackCargo('repack')
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
      <div className={styles.actions}>
        <button
          className={styles.packButton}
          onClick={() => autoPackCargo('packStaged')}
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
    </div>
  )
}
