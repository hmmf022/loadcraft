import { ContainerSelector } from './ContainerSelector'
import { CargoEditor } from './CargoEditor'
import { CargoList } from './CargoList'
import { PlacementControls } from './PlacementControls'
import { StatsPanel } from './StatsPanel'
import { useTranslation } from '../i18n'
import styles from './Sidebar.module.css'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const { t } = useTranslation()

  return (
    <aside className={`${styles.sidebar} ${className ?? ''}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t.sidebar.title}</h1>
      </div>
      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.sidebar.containerSettings}</h2>
          <ContainerSelector />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.sidebar.cargoDefinition}</h2>
          <CargoEditor />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.sidebar.cargoList}</h2>
          <CargoList />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.sidebar.placementControls}</h2>
          <PlacementControls />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.sidebar.statistics}</h2>
          <StatsPanel />
        </section>
      </div>
    </aside>
  )
}
