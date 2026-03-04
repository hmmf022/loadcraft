import { useTranslation } from '../i18n'
import styles from './HelpOverlay.module.css'

export function HelpOverlay() {
  const { t } = useTranslation()

  const items = [
    { key: t.help.leftDrag, desc: t.help.cameraRotate },
    { key: t.help.rightDrag, desc: t.help.cameraPan },
    { key: t.help.wheel, desc: t.help.zoom },
    { key: t.help.click, desc: t.help.selectCargo },
    { key: t.help.leftDragSelected, desc: t.help.moveCargo },
    { key: t.help.shiftLeftDrag, desc: t.help.freeRotate },
    { key: t.help.dndSidebar, desc: t.help.placeCargo },
    { key: t.help.rKey, desc: t.help.yAxisRotation },
    { key: t.help.tKey, desc: t.help.xAxisRotation },
    { key: t.help.fKey, desc: t.help.zAxisRotation },
    { key: t.help.gKey, desc: t.help.dropCargo },
    { key: t.help.ctrlZ, desc: t.help.undoRedo },
    { key: t.help.deleteKey, desc: t.help.deleteCargo },
    { key: t.help.escKey, desc: t.help.deselect },
  ]

  return (
    <div className={styles.overlay}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key} className={styles.item}>
            <span className={styles.key}>{item.key}</span>: {item.desc}
          </li>
        ))}
      </ul>
    </div>
  )
}
