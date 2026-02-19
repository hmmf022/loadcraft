import { useAppStore } from '../state/store'
import styles from './StatsPanel.module.css'

export function StatsPanel() {
  const weightResult = useAppStore((s) => s.weightResult)
  const cogDeviation = useAppStore((s) => s.cogDeviation)
  const supportResults = useAppStore((s) => s.supportResults)
  const container = useAppStore((s) => s.container)
  const placements = useAppStore((s) => s.placements)

  const weightPercent = container.maxPayloadKg > 0
    ? (weightResult.totalWeightKg / container.maxPayloadKg) * 100
    : 0

  const weightBarClass = weightPercent >= 100
    ? styles.barDanger
    : weightPercent >= 80
      ? styles.barWarning
      : styles.barNormal

  const unsupportedCount = Array.from(supportResults.values()).filter((r) => !r.supported).length

  const warnings: string[] = []
  if (weightResult.overweight) {
    warnings.push('過積載: 最大積載量を超えています')
  }
  if (cogDeviation && !cogDeviation.isBalanced) {
    warnings.push('重心偏り: コンテナ中心から大きくずれています')
  }
  if (unsupportedCount > 0) {
    warnings.push(`浮遊荷物: ${unsupportedCount}個の荷物が十分に支持されていません`)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.stat}>
        <div className={styles.statHeader}>
          <span className={styles.statLabel}>重量</span>
          <span className={styles.statValue}>
            {weightResult.totalWeightKg.toFixed(1)} / {container.maxPayloadKg} kg
          </span>
        </div>
        <div className={styles.barBg}>
          <div
            className={`${styles.bar} ${weightBarClass}`}
            style={{ width: `${Math.min(weightPercent, 100)}%` }}
          />
        </div>
      </div>

      <div className={styles.stat}>
        <div className={styles.statHeader}>
          <span className={styles.statLabel}>充填率</span>
          <span className={styles.statValue}>{weightResult.fillRatePercent.toFixed(1)}%</span>
        </div>
        <div className={styles.barBg}>
          <div
            className={`${styles.bar} ${styles.barNormal}`}
            style={{ width: `${Math.min(weightResult.fillRatePercent, 100)}%` }}
          />
        </div>
      </div>

      {placements.length > 0 && (
        <div className={styles.stat}>
          <span className={styles.statLabel}>重心位置</span>
          <span className={styles.statValueSmall}>
            X: {weightResult.centerOfGravity.x.toFixed(1)},
            Y: {weightResult.centerOfGravity.y.toFixed(1)},
            Z: {weightResult.centerOfGravity.z.toFixed(1)} cm
          </span>
        </div>
      )}

      <div className={styles.stat}>
        <span className={styles.statLabel}>配置数</span>
        <span className={styles.statValue}>{placements.length}</span>
      </div>

      {warnings.length > 0 && (
        <div className={styles.warnings}>
          {warnings.map((w, i) => (
            <div key={i} className={styles.warning}>{w}</div>
          ))}
        </div>
      )}
    </div>
  )
}
