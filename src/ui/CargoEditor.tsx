import { useState, useRef } from 'react'
import { useAppStore } from '../state/store'
import { parseCargoFile } from '../core/ImportParser'
import { loadCarPartsSamples } from '../data/loadCarPartsSamples'
import styles from './CargoEditor.module.css'

interface FormState {
  name: string
  widthCm: string
  heightCm: string
  depthCm: string
  weightKg: string
  color: string
}

const defaultForm: FormState = {
  name: '',
  widthCm: '',
  heightCm: '',
  depthCm: '',
  weightKg: '',
  color: '#4a90d9',
}

export function CargoEditor() {
  const [form, setForm] = useState<FormState>(defaultForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const addCargoDef = useAppStore((s) => s.addCargoDef)
  const importCargoDefs = useAppStore((s) => s.importCargoDefs)
  const container = useAppStore((s) => s.container)
  const addToast = useAppStore((s) => s.addToast)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!form.name.trim()) newErrors['name'] = '名前を入力してください'

    const w = parseFloat(form.widthCm)
    const h = parseFloat(form.heightCm)
    const d = parseFloat(form.depthCm)
    const wt = parseFloat(form.weightKg)

    if (isNaN(w) || w <= 0) newErrors['widthCm'] = '幅は0より大きい値を入力してください'
    else if (w > container.widthCm) newErrors['widthCm'] = 'コンテナの幅を超えています'

    if (isNaN(h) || h <= 0) newErrors['heightCm'] = '高さは0より大きい値を入力してください'
    else if (h > container.heightCm) newErrors['heightCm'] = 'コンテナの高さを超えています'

    if (isNaN(d) || d <= 0) newErrors['depthCm'] = '奥行は0より大きい値を入力してください'
    else if (d > container.depthCm) newErrors['depthCm'] = 'コンテナの奥行を超えています'

    if (isNaN(wt) || wt <= 0) newErrors['weightKg'] = '重量は0より大きい値を入力してください'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    addCargoDef({
      id: crypto.randomUUID(),
      name: form.name.trim(),
      widthCm: parseFloat(form.widthCm),
      heightCm: parseFloat(form.heightCm),
      depthCm: parseFloat(form.depthCm),
      weightKg: parseFloat(form.weightKg),
      color: form.color,
    })
    setForm(defaultForm)
    setErrors({})
  }

  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleLoadSamples = async () => {
    try {
      const defs = await loadCarPartsSamples()
      if (defs.length > 0) {
        importCargoDefs(defs)
        addToast(`${defs.length}件のサンプルを読み込みました`, 'success')
      } else {
        addToast('サンプルの読み込みに失敗しました', 'error')
      }
    } catch {
      addToast('サンプルの読み込みに失敗しました', 'error')
    }
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const result = parseCargoFile(reader.result as string, file.name)
      if (result.defs.length > 0) {
        importCargoDefs(result.defs)
        addToast(`${result.defs.length}件インポートしました`, 'success')
      }
      if (result.errors.length > 0) {
        addToast(`インポートエラー: ${result.errors[0]}`, 'error')
      }
    }
    reader.readAsText(file)

    e.target.value = ''
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label}>名前</label>
        <input
          type="text"
          value={form.name}
          onChange={handleChange('name')}
          className={styles.input}
          placeholder="荷物名"
        />
        {errors['name'] && <span className={styles.error}>{errors['name']}</span>}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>幅 (cm)</label>
          <input
            type="number"
            value={form.widthCm}
            onChange={handleChange('widthCm')}
            className={styles.input}
            min="1"
            step="1"
          />
          {errors['widthCm'] && <span className={styles.error}>{errors['widthCm']}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label}>高さ (cm)</label>
          <input
            type="number"
            value={form.heightCm}
            onChange={handleChange('heightCm')}
            className={styles.input}
            min="1"
            step="1"
          />
          {errors['heightCm'] && <span className={styles.error}>{errors['heightCm']}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label}>奥行 (cm)</label>
          <input
            type="number"
            value={form.depthCm}
            onChange={handleChange('depthCm')}
            className={styles.input}
            min="1"
            step="1"
          />
          {errors['depthCm'] && <span className={styles.error}>{errors['depthCm']}</span>}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>重量 (kg)</label>
          <input
            type="number"
            value={form.weightKg}
            onChange={handleChange('weightKg')}
            className={styles.input}
            min="0.1"
            step="0.1"
          />
          {errors['weightKg'] && <span className={styles.error}>{errors['weightKg']}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label}>色</label>
          <input
            type="color"
            value={form.color}
            onChange={handleChange('color')}
            className={styles.colorInput}
          />
        </div>
      </div>

      <div className={styles.row}>
        <button type="submit" className={styles.addButton}>
          追加
        </button>
        <button type="button" className={styles.importButton} onClick={handleImportClick}>
          インポート
        </button>
        <button type="button" className={styles.importButton} onClick={handleLoadSamples}>
          サンプル
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>
    </form>
  )
}
