import { ContainerSelector } from './ContainerSelector'
import { CargoEditor } from './CargoEditor'
import { CargoList } from './CargoList'
import styles from './Sidebar.module.css'

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
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
      </div>
    </aside>
  )
}
