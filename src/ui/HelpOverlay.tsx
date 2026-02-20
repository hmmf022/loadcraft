import styles from './HelpOverlay.module.css'

const HELP_ITEMS: { key: string; desc: string }[] = [
  { key: '左ドラッグ', desc: 'カメラ回転' },
  { key: '右ドラッグ / 中ボタン', desc: 'カメラ移動' },
  { key: 'ホイール', desc: 'ズーム' },
  { key: 'クリック', desc: '荷物を選択' },
  { key: '左ドラッグ（選択時）', desc: '荷物を移動' },
  { key: 'Shift+左ドラッグ（選択時）', desc: '荷物を自由回転' },
  { key: 'D&D（サイドバーから）', desc: '荷物を配置' },
  { key: 'R / Shift+R', desc: 'Y軸回転 (+90° / -90°)' },
  { key: 'T / Shift+T', desc: 'X軸回転 (+90° / -90°)' },
  { key: 'F / Shift+F', desc: 'Z軸回転 (+90° / -90°)' },
  { key: 'Ctrl+Z / Ctrl+Y', desc: '元に戻す / やり直し' },
  { key: 'Delete', desc: '選択中の荷物を削除' },
  { key: 'Escape', desc: '選択解除' },
]

export function HelpOverlay() {
  return (
    <div className={styles.overlay}>
      <ul className={styles.list}>
        {HELP_ITEMS.map((item) => (
          <li key={item.key} className={styles.item}>
            <span className={styles.key}>{item.key}</span>: {item.desc}
          </li>
        ))}
      </ul>
    </div>
  )
}
