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

/** 單一則快速備註的字數上限（記帳頁備註欄本身是 80 字，這裡留得比較短才好按） */
export const QUICK_NOTE_MAX = 20

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
    // ⚠ 一定要用 Array.isArray 判斷：使用者可能刻意把快速備註全部刪光（存成 []），
    // 那時要尊重「空的」，不能拿預設值把它們叫回來
    quickNotes: Array.isArray(saved.quickNotes) ? saved.quickNotes : base.quickNotes,
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
  /** 某個收支類型的頂層大類（子分類不算） */
  const topCategoriesByType = computed(() => (type: TxType) =>
    state.value.categories.filter((c) => !c.archived && c.type === type && !c.parentId),
  )

  function category(id: string): Category | undefined {
    return state.value.categories.find((c) => c.id === id)
  }

  /* ── 分類樹（子分類） ─────────────────────────────────── */
  /** 直接子分類（未封存，照原始順序） */
  function childrenOf(id: string | null): Category[] {
    return state.value.categories.filter((c) => !c.archived && (c.parentId ?? null) === id)
  }

  function hasChildren(id: string): boolean {
    return state.value.categories.some((c) => !c.archived && c.parentId === id)
  }

  /**
   * 從根到自己的路徑（含自己）。
   * 用 visited 防止資料異常造成的無限迴圈。
   */
  function pathOf(id: string): Category[] {
    const out: Category[] = []
    const seen = new Set<string>()
    let cur = category(id)
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.unshift(cur)
      cur = cur.parentId ? category(cur.parentId) : undefined
    }
    return out
  }

  /** 自己＋所有後代（多層）的 id */
  function descendantIds(id: string): string[] {
    const out: string[] = []
    const walk = (pid: string) => {
      for (const c of state.value.categories) {
        if (c.archived || c.parentId !== pid) continue
        out.push(c.id)
        walk(c.id)
      }
    }
    walk(id)
    return out
  }

  /** 「餐飲 › 早餐」這種完整路徑名稱（下拉、搜尋用） */
  function fullNameOf(id: string): string {
    return pathOf(id)
      .map((c) => c.name)
      .join(' › ')
  }

  /** 能否刪除：有子分類時要先處理完子分類 */
  function canRemove(id: string): { ok: boolean; reason: string } {
    const c = category(id)
    if (!c || c.archived) return { ok: false, reason: '找不到這個分類' }
    const n = childrenOf(id).length
    if (n > 0) return { ok: false, reason: `還有 ${n} 個子分類，請先刪除或移出子分類` }
    return { ok: true, reason: '' }
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
  /**
   * 新增分類。給 parentId 就是建立子分類：
   * 收支類型與顏色預設沿用上層，整條路徑才會一致。
   */
  function addCategory(
    name: string,
    type: TxType,
    color: string,
    icon?: string,
    parentId: string | null = null,
  ) {
    const parent = parentId ? category(parentId) : undefined
    const c: Category = {
      id: uid('c'),
      name: name.trim(),
      type: parent ? parent.type : type,
      color: parent ? parent.color : color,
      icon: icon || iconForCategory({ id: '', name }),
      builtin: false,
      archived: false,
      parentId: parent ? parent.id : null,
    }
    state.value.categories.push(c)
    return c
  }

  function updateCategory(
    id: string,
    patch: Partial<Pick<Category, 'name' | 'color' | 'type' | 'icon' | 'parentId'>>,
  ) {
    const c = state.value.categories.find((x) => x.id === id)
    if (!c) return
    if (patch.name !== undefined) c.name = patch.name.trim() || c.name
    if (patch.color !== undefined) c.color = patch.color
    if (patch.icon !== undefined) c.icon = patch.icon

    // 換上層：不能是自己、不能是自己的後代（會形成環），且類型要一致
    if (patch.parentId !== undefined) {
      const next = patch.parentId ?? null
      if (next !== id && !(next && descendantIds(id).includes(next))) {
        const p = next ? category(next) : undefined
        if (!next || (p && !p.archived)) c.parentId = next
      }
    }

    // 改類型要連整條子樹一起改，否則會出現「支出大類底下掛收入子分類」
    if (patch.type !== undefined && patch.type !== c.type) {
      for (const d of descendantIds(id)) {
        const sub = category(d)
        if (sub) sub.type = patch.type
      }
      c.type = patch.type
    }
  }

  /**
   * 刪除分類（內建分類也可刪），但底下還有子分類時不給刪。
   * 一律改為封存而非真的從陣列移除，避免既有記錄指向不存在的分類。
   */
  function removeCategory(id: string): boolean {
    if (!canRemove(id).ok) return false
    const c = category(id)
    if (!c) return false
    c.archived = true
    // 同時從常用分類移除，否則常用清單會留下一個已經看不見的分類
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

  /* ── 快速備註 ─────────────────────────────────────────── */
  const quickNotes = computed(() => state.value.quickNotes)

  /**
   * 新增一個快速備註。空白／太長／已經有同樣的都不收，回傳 false。
   * 重複判斷用 trim 後的字串，避免「M記」與「M記 」變成兩個。
   */
  function addQuickNote(text: string): boolean {
    const t = text.trim()
    if (!t || t.length > QUICK_NOTE_MAX) return false
    if (state.value.quickNotes.includes(t)) return false
    state.value.quickNotes.push(t)
    return true
  }

  /** 改第 i 個（改不動時回傳 false，呼叫端負責把輸入框還原） */
  function updateQuickNote(i: number, text: string): boolean {
    const list = state.value.quickNotes
    if (!Number.isInteger(i) || i < 0 || i >= list.length) return false
    const t = text.trim()
    if (!t || t.length > QUICK_NOTE_MAX) return false
    if (list.some((x, j) => j !== i && x === t)) return false
    list[i] = t
    return true
  }

  function removeQuickNote(i: number) {
    if (Number.isInteger(i) && i >= 0 && i < state.value.quickNotes.length) {
      state.value.quickNotes.splice(i, 1)
    }
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
    topCategoriesByType,
    category,
    childrenOf,
    hasChildren,
    pathOf,
    descendantIds,
    fullNameOf,
    canRemove,
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
    quickNotes,
    addQuickNote,
    updateQuickNote,
    removeQuickNote,
    restoreDefaults,
  }
})
