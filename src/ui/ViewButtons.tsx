import { useAppStore } from '../state/store'
import type { CameraView } from '../core/types'
import { useTranslation } from '../i18n'
import styles from './ViewButtons.module.css'

const VIEW_KEYS: CameraView[] = ['front', 'back', 'left', 'right', 'top', 'isometric']

export function ViewButtons() {
  const cameraView = useAppStore((s) => s.cameraView)
  const setCameraView = useAppStore((s) => s.setCameraView)
  const { t } = useTranslation()

  const labels: Record<CameraView, string> = {
    front: t.viewButtons.front,
    back: t.viewButtons.back,
    left: t.viewButtons.left,
    right: t.viewButtons.right,
    top: t.viewButtons.top,
    isometric: t.viewButtons.iso,
    free: '',
  }

  return (
    <div className={styles.container}>
      {VIEW_KEYS.map((view) => (
        <button
          key={view}
          className={`${styles.button} ${cameraView === view ? styles.active : ''}`}
          onClick={() => setCameraView(view)}
        >
          {labels[view]}
        </button>
      ))}
    </div>
  )
}
