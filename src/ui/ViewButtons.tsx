import { useAppStore } from '../state/store'
import type { CameraView } from '../core/types'
import styles from './ViewButtons.module.css'

const VIEWS: { view: CameraView; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'right', label: 'Right' },
  { view: 'top', label: 'Top' },
  { view: 'isometric', label: 'Iso' },
]

export function ViewButtons() {
  const cameraView = useAppStore((s) => s.cameraView)
  const setCameraView = useAppStore((s) => s.setCameraView)

  return (
    <div className={styles.container}>
      {VIEWS.map(({ view, label }) => (
        <button
          key={view}
          className={`${styles.button} ${cameraView === view ? styles.active : ''}`}
          onClick={() => setCameraView(view)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
