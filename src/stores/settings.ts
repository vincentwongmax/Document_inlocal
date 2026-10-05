import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Category, Settings, TxType } from '@/types'
import { Keys, readJSON, writeJSON } from '@/lib/storage'
import { defaultSettings } from '@/lib/defaults'
import { fetchRates, defaultRates } from '@/lib/currency'
import { iconForCategory } from '@/lib/icons'
import { uid } from '@/lib/id'

/** 舊資料沒有 icon 欄位 → 依內建 id／分類名稱補上，避免每個地方都要做 fallback */
function withIcons(list: Category[]): Category[] {
  return list.map((c) => (c.icon ? c : { ...c, icon: iconForCategory(c) }))
}

function merge(base: Settings, saved: Partial<Settings>): Settings {
  return {
    ...base,
    ...saved,
    rates: { ...base.rates, ...(saved.rates ?? {}) },
    categories: withIcons(
      saved.categories && saved.categories.length ? saved.categories : base.categories,
    ),
    favoriteCategories: Array.isArray(saved.favoriteCategories)
      ? saved.favoriteCategories
      : base.favoriteCategories,
    visibleCurrencies: Array.isArray(saved.visibleCurrencies)
      ? saved.visibleCurrencies
      : base.visibleCurrencies,
    rateCurrencies: Array.isArray(saved.rateCurrencies)
      ? saved.rateCurrencies
      : base.rateCurrencies,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const loaded = readJSON<Settings>(Keys.SETTINGS_KEY)
  const state = ref<Settings>(merge(defaultSettings(loaded?.baseCurrency ?? 'MOP'), loaded ?? {}))

  // 舊資料第一次載入若有補上圖示，立刻回寫一次，讓匯出檔也帶得到 icon
  if (loaded?.categories?.length && loaded.categories.some((c) => !c.icon)) {
    writeJSON(Keys.SETTINGS_KEY, state.value)
  }

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
  function addCategory(name: string, type: TxType, color: string, icon?: string) {
    const c: Category = {
      id: uid('c'),
      name: name.trim(),
      type,
      color,
      icon: icon || iconForCategory({ id: '', name }),
      builtin: false,
      archived: false,
    }
    state.value.categories.push(c)
    return c
  }

  function updateCategory(
    id: string,
    patch: Partial<Pick<Category, 'name' | 'color' | 'type' | 'icon'>>,
  ) {
    const c = state.value.categories.find((x) => x.id === id)
    if (!c) return
    if (patch.name !== undefined) c.name = patch.name.trim() || c.name
    if (patch.color !== undefined) c.color = patch.color
    if (patch.type !== undefined) c.type = patch.type
    if (patch.icon !== undefined) c.icon = patch.icon
  }

  function removeCategory(id: string) {
    const c = state.value.categories.find((x) => x.id === id)
    if (!c || c.builtin) return false
    // 已被使用的自訂分類改為封存，避免記錄指向空分類
    c.archived = true
    // 同時從常用分類移除，否則常用清單會留下一個看不見的分類
    const i = state.value.favoriteCategories.indexOf(id)
    if (i >= 0) state.value.favoriteCategories.splice(i, 1)
    return true
  }

  /* ── 主頁常用分類 ─────────────────────────────────────── */
  const favoriteCategories = computed(() => state.value.favoriteCategories)

  function isFavorite(id: string): boolean {
    return state.value.favoriteCategories.includes(id)
  }

  function toggleFavorite(id: string) {
    const i = state.value.favoriteCategories.indexOf(id)
    if (i >= 0) state.value.favoriteCategories.splice(i, 1)
    else state.value.favoriteCategories.push(id)
  }

  /* ── 幣別顯示 ─────────────────────────────────────────── */
  const visibleCurrencies = computed(() => state.value.visibleCurrencies)

  function toggleVisibleCurrency(code: string) {
    const i = state.value.visibleCurrencies.indexOf(code)
    if (i >= 0) state.value.visibleCurrencies.splice(i, 1)
    else state.value.visibleCurrencies.push(code)
  }

  function toggleRateCurrency(code: string) {
    const i = state.value.rateCurrencies.indexOf(code)
    if (i >= 0) state.value.rateCurrencies.splice(i, 1)
    else state.value.rateCurrencies.push(code)
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
    favoriteCategories,
    isFavorite,
    toggleFavorite,
    visibleCurrencies,
    toggleVisibleCurrency,
    toggleRateCurrency,
    restoreDefaults,
  }
})
