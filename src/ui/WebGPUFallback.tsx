export function WebGPUFallback() {
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
      <h2 style={{ marginBottom: '16px' }}>WebGPU is not available</h2>
      <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
        This application requires WebGPU for 3D rendering.
      </p>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
        Please use a supported browser:
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
