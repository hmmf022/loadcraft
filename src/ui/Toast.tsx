import { useAppStore } from '../state/store'
import styles from './Toast.module.css'

export function Toast() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.type]}`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
