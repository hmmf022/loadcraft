import { useTranslation } from '../i18n'

export function WebGPUFallback() {
  const { t } = useTranslation()

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '40px',
      color: 'var(--text-primary)',
      textAlign: 'center',
    }}>
      <h2 style={{ marginBottom: '16px' }}>{t.webgpuFallback.title}</h2>
      <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
        {t.webgpuFallback.description}
      </p>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
        {t.webgpuFallback.browserList}
      </p>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: '12px 0',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        <li>Chrome 113+ / Edge 113+</li>
        <li>Firefox Nightly (with flags enabled)</li>
        <li>Safari 18+ (macOS Sequoia / iOS 18)</li>
      </ul>
    </div>
  )
}
