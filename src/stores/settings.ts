import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Category, QuickItem, Settings, TxType } from '@/types'
import { Keys, readJSON, writeJSON } from '@/lib/storage'
import { defaultSettings } from '@/lib/defaults'
import { fetchRates, defaultRates } from '@/lib/currency'
import { uid } from '@/lib/id'

function merge(base: Settings, saved: Partial<Settings>): Settings {
  return {
    ...base,
    ...saved,
    rates: { ...base.rates, ...(saved.rates ?? {}) },
    categories:
      saved.categories && saved.categories.length ? saved.categories : base.categories,
    quickItems: Array.isArray(saved.quickItems) ? saved.quickItems : base.quickItems,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const loaded = readJSON<Settings>(Keys.SETTINGS_KEY)
  const state = ref<Settings>(merge(defaultSettings(loaded?.baseCurrency ?? 'MOP'), loaded ?? {}))

  watch(
    state,
    (v) => {
      writeJSON(Keys.SETTINGS_KEY, v)
    },
    { deep: true },
  )

  const baseCurrency = computed(() => state.value.baseCurrency)
  const inputCurrency = computed(() => state.value.inputCurrency)
  const categories = computed(() => state.value.categories.filter((c) => !c.archived))
  const preferredCurrency = computed(() => state.value.preferredCurrency)
  const categoriesByType = computed(() => (type: TxType) =>
    state.value.categories.filter((c) => !c.archived && c.type === type),
  )

  function category(id: string): Category | undefined {
    return state.value.categories.find((c) => c.id === id)
  }

  function rate(code: string): number {
    const r = state.value.rates[code]
    return typeof r === 'number' && r > 0 ? r : 1
  }

  async function setBaseCurrency(code: string) {
    state.value.baseCurrency = code
    state.value.rates = defaultRates(code)
    state.value.ratesUpdatedAt = null
    if (state.value.inputCurrency === state.value.baseCurrency) state.value.inputCurrency = code
  }

  function setInputCurrency(code: string) {
    state.value.inputCurrency = code
  }

  function setPreferredCurrency(code: string) {
    state.value.preferredCurrency = code
  }

  function setRate(code: string, value: number) {
    if (!isFinite(value) || value <= 0) return
    state.value.rates[code] = value
  }

  /** 線上更新匯率；失敗則沿用舊匯率（回傳 false） */
  async function refreshRates(): Promise<boolean> {
    try {
      const { rates, updatedAt } = await fetchRates(state.value.baseCurrency)
      state.value.rates = rates
      state.value.ratesUpdatedAt = updatedAt
      return true
    } catch (e) {
      console.warn('[settings] 匯率更新失敗，沿用既有匯率', e)
      return false
    }
  }

  /* ── 分類管理 ─────────────────────────────────────────── */
  function addCategory(name: string, type: TxType, color: string) {
    const c: Category = { id: uid('c'), name: name.trim(), type, color, builtin: false, archived: false }
    state.value.categories.push(c)
    return c
  }

  function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'type'>>) {
    const c = state.value.categories.find((x) => x.id === id)
    if (!c) return
    if (patch.name !== undefined) c.name = patch.name.trim() || c.name
    if (patch.color !== undefined) c.color = patch.color
    if (patch.type !== undefined) c.type = patch.type
  }

  function removeCategory(id: string) {
    const c = state.value.categories.find((x) => x.id === id)
    if (!c || c.builtin) return false
    // 已被使用的自訂分類改為封存，避免記錄指向空分類
    c.archived = true
    return true
  }

  /* ── 快速記帳常用清單 ─────────────────────────────────── */
  function addQuickItem(item: Omit<QuickItem, 'id'>): QuickItem {
    const q: QuickItem = { ...item, id: uid('q') }
    state.value.quickItems.push(q)
    return q
  }

  function updateQuickItem(id: string, patch: Partial<Omit<QuickItem, 'id'>>) {
    const q = state.value.quickItems.find((x) => x.id === id)
    if (!q) return
    Object.assign(q, patch)
  }

  function removeQuickItem(id: string) {
    const i = state.value.quickItems.findIndex((x) => x.id === id)
    if (i >= 0) state.value.quickItems.splice(i, 1)
  }

  function restoreDefaults() {
    state.value.categories = JSON.parse(JSON.stringify(defaultSettings().categories))
  }

  return {
    state,
    baseCurrency,
    inputCurrency,
    categories,
    categoriesByType,
    category,
    rate,
    preferredCurrency,
    setPreferredCurrency,
    setBaseCurrency,
    setInputCurrency,
    setRate,
    refreshRates,
    addCategory,
    updateCategory,
    removeCategory,
    addQuickItem,
    updateQuickItem,
    removeQuickItem,
    restoreDefaults,
  }
})
