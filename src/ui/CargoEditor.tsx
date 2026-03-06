import { useState, useRef } from 'react'
import { useAppStore } from '../state/store'
import { parseCargoFile } from '../core/ImportParser'
import { loadCarPartsSamples } from '../data/loadCarPartsSamples'
import { useTranslation, interpolate } from '../i18n'
import styles from './CargoEditor.module.css'

interface FormState {
  name: string
  widthCm: string
  heightCm: string
  depthCm: string
  weightKg: string
  color: string
  noStack: boolean
  noFlip: boolean
  maxStackWeightKg: string
}

const defaultForm: FormState = {
  name: '',
  widthCm: '',
  heightCm: '',
  depthCm: '',
  weightKg: '',
  color: '#4a90d9',
  noStack: false,
  noFlip: false,
  maxStackWeightKg: '',
}

export function CargoEditor() {
  const [form, setForm] = useState<FormState>(defaultForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const addCargoDef = useAppStore((s) => s.addCargoDef)
  const importCargoDefs = useAppStore((s) => s.importCargoDefs)
  const container = useAppStore((s) => s.container)
  const addToast = useAppStore((s) => s.addToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const handleChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const handleCheckbox = (field: 'noStack' | 'noFlip') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.checked }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!form.name.trim()) newErrors['name'] = t.cargoEditor.nameRequired

    const w = parseFloat(form.widthCm)
    const h = parseFloat(form.heightCm)
    const d = parseFloat(form.depthCm)
    const wt = parseFloat(form.weightKg)

    if (isNaN(w) || w <= 0) newErrors['widthCm'] = t.cargoEditor.widthPositive
    else if (w > container.widthCm) newErrors['widthCm'] = t.cargoEditor.widthExceeds

    if (isNaN(h) || h <= 0) newErrors['heightCm'] = t.cargoEditor.heightPositive
    else if (h > container.heightCm) newErrors['heightCm'] = t.cargoEditor.heightExceeds

    if (isNaN(d) || d <= 0) newErrors['depthCm'] = t.cargoEditor.depthPositive
    else if (d > container.depthCm) newErrors['depthCm'] = t.cargoEditor.depthExceeds

    if (isNaN(wt) || wt <= 0) newErrors['weightKg'] = t.cargoEditor.weightPositive

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const def: Parameters<typeof addCargoDef>[0] = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      widthCm: parseFloat(form.widthCm),
      heightCm: parseFloat(form.heightCm),
      depthCm: parseFloat(form.depthCm),
      weightKg: parseFloat(form.weightKg),
      color: form.color,
    }
    if (form.noStack) def.noStack = true
    if (form.noFlip) def.noFlip = true
    const maxStack = parseFloat(form.maxStackWeightKg)
    if (!isNaN(maxStack) && maxStack >= 0) def.maxStackWeightKg = maxStack
    addCargoDef(def)
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
        addToast(interpolate(t.cargoEditor.samplesLoaded, { count: defs.length }), 'success')
      } else {
        addToast(t.cargoEditor.samplesError, 'error')
      }
    } catch {
      addToast(t.cargoEditor.samplesError, 'error')
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
        addToast(interpolate(t.cargoEditor.importedCount, { count: result.defs.length }), 'success')
      }
      if (result.errors.length > 0) {
        addToast(interpolate(t.cargoEditor.importError, { error: result.errors[0]! }), 'error')
      }
    }
    reader.readAsText(file)

    e.target.value = ''
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label}>{t.cargoEditor.name}</label>
        <input
          type="text"
          value={form.name}
          onChange={handleChange('name')}
          className={styles.input}
          placeholder={t.cargoEditor.namePlaceholder}
        />
        {errors['name'] && <span className={styles.error}>{errors['name']}</span>}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>{t.cargoEditor.width}</label>
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
          <label className={styles.label}>{t.cargoEditor.height}</label>
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
          <label className={styles.label}>{t.cargoEditor.depth}</label>
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
          <label className={styles.label}>{t.cargoEditor.weight}</label>
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
          <label className={styles.label}>{t.cargoEditor.color}</label>
          <input
            type="color"
            value={form.color}
            onChange={handleChange('color')}
            className={styles.colorInput}
          />
        </div>
      </div>

      <div className={styles.row}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={form.noStack}
            onChange={handleCheckbox('noStack')}
          />
          {t.cargoEditor.noStack}
        </label>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={form.noFlip}
            onChange={handleCheckbox('noFlip')}
          />
          {t.cargoEditor.noFlip}
        </label>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>{t.cargoEditor.maxStackWeight}</label>
          <input
            type="number"
            value={form.maxStackWeightKg}
            onChange={handleChange('maxStackWeightKg')}
            className={styles.input}
            min="0"
            step="1"
            placeholder="∞"
          />
        </div>
      </div>

      <div className={styles.row}>
        <button type="submit" className={styles.addButton}>
          {t.cargoEditor.add}
        </button>
        <button type="button" className={styles.importButton} onClick={handleImportClick}>
          {t.cargoEditor.import}
        </button>
        <button type="button" className={styles.importButton} onClick={handleLoadSamples}>
          {t.cargoEditor.samples}
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
