import { ContainerSelector } from './ContainerSelector'
import { CargoEditor } from './CargoEditor'
import { CargoList } from './CargoList'
import { PlacementControls } from './PlacementControls'
import { StatsPanel } from './StatsPanel'
import styles from './Sidebar.module.css'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside className={`${styles.sidebar} ${className ?? ''}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Container Simulator</h1>
      </div>
      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>コンテナ設定</h2>
          <ContainerSelector />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>貨物定義</h2>
          <CargoEditor />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>貨物一覧</h2>
          <CargoList />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>配置操作</h2>
          <PlacementControls />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>統計情報</h2>
          <StatsPanel />
        </section>
      </div>
    </aside>
  )
}
