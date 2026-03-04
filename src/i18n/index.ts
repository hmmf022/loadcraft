import { create } from 'zustand'
import type { Language, TranslationDict } from './types'
import { en } from './en'
import { ja } from './ja'

const STORAGE_KEY = 'loadcraft-lang'

const translations: Record<Language, TranslationDict> = { en, ja }

function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'ja') return stored
  const nav = navigator.language
  if (nav.startsWith('ja')) return 'ja'
  return 'en'
}

interface I18nState {
  language: Language
  setLanguage: (l: Language) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  language: detectLanguage(),
  setLanguage: (language) => {
    localStorage.setItem(STORAGE_KEY, language)
    set({ language })
  },
}))

export function useTranslation() {
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)
  return { t: translations[language], language, setLanguage }
}

/** Non-React accessor for use in store.ts */
export function getTranslation(): TranslationDict {
  return translations[useI18nStore.getState().language]
}

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
}

export type { Language, TranslationDict }
