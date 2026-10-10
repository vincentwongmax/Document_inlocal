import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Category, CustomCurrency, QuickPreset, Settings, TravelTrip, TxType, Wallet, WalletState } from '@/types'
import { Keys, readJSON, writeJSON, remove, walletSettingsKey } from '@/lib/storage'
import { defaultSettings } from '@/lib/defaults'
import { CURRENCIES, fetchRates, defaultRates } from '@/lib/currency'
import { iconForCategory } from '@/lib/icons'
import { uid } from '@/lib/id'
import { isHexColor } from '@/lib/color'
import {
  cleanWalletName,
  defaultWallet,
  newWallet,
  normalizeWallets,
  safeWalletColor,
  safeWalletIcon,
  uniqueWalletName,
  walletNameOk,
} from '@/lib/wallets'

/** 舊資料沒有 icon 欄位 → 依內建 id／分類名稱補上，避免每個地方都要做 fallback */
function withIcons(list: Category[]): Category[] {
  return list.map((c) => (c.icon ? c : { ...c, icon: iconForCategory(c) }))
}

/** 單一則快速備註的字數上限（記帳頁備註欄本身是 80 字，這裡留得比較短才好按） */
export const QUICK_NOTE_MAX = 20

/**
 * 舊資料／異常資料的 activeTrip 正規化：形狀不對就當「沒有旅行」。
 * ⚠ 不能直接信 `saved.activeTrip`——localStorage 可能是任何東西。
 */
function normTrip(v: unknown): TravelTrip | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<TravelTrip>
  if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !o.name.trim()) return null
  return {
    id: o.id,
    name: o.name.trim(),
    startDate: typeof o.startDate === 'string' ? o.startDate : '',
    endDate: typeof o.endDate === 'string' ? o.endDate : '',
    currency: typeof o.currency === 'string' ? o.currency : '',
    prevCurrency: typeof o.prevCurrency === 'string' ? o.prevCurrency : '',
    mode1: o.mode1 === true,
    mode2: o.mode2 === true,
    // 0.1.36：建立／結束時間（舊資料沒有，留空＝不知道）
    ...(typeof o.createdAt === 'string' && o.createdAt ? { createdAt: o.createdAt } : {}),
    ...(typeof o.endedAt === 'string' && o.endedAt ? { endedAt: o.endedAt } : {}),
    // 0.1.39：旅行顏色（舊資料沒有 → 省略；顯示層回退 DEFAULT_TRIP_COLOR）
    ...(isHexColor(o.color) ? { color: o.color.trim() } : {}),
    // 0.1.41：隱藏的過去旅行（「過去的旅行」列表收起來，點底部才展開；預設不隱藏）
    ...(o.hidden === true ? { hidden: true } : {}),
  }
}

/**
 * 自訂貨幣（0.1.44）的正規化：
 * - code 必須是 3 個大寫英文字母（照 ISO 4217 的樣子）、不能撞內建 12 種
 * - name 空的就沿用 code；同一個 code 只留第一筆
 */
function normCustomCurrencies(v: unknown): CustomCurrency[] {
  if (!Array.isArray(v)) return []
  const out: CustomCurrency[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    const o = raw as Partial<CustomCurrency>
    const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : ''
    if (!/^[A-Z]{3}$/.test(code) || seen.has(code) || MAP_HAS_BUILTIN(code)) continue
    seen.add(code)
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : code
    out.push({ code, name })
  }
  return out
}
function MAP_HAS_BUILTIN(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code)
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
    // ⚠ 缺欄位（舊資料）時要回空字串＝「沒有設定預設分類」，不能拿 base 的（base 是空的，
    //   但萬一以後改了預設值，舊使用者不該被莫名其妙預選）
    defaultCategoryId:
      typeof saved.defaultCategoryId === 'string' ? saved.defaultCategoryId : '',
    visibleCurrencies: Array.isArray(saved.visibleCurrencies)
      ? saved.visibleCurrencies
      : base.visibleCurrencies,
    rateCurrencies: Array.isArray(saved.rateCurrencies)
      ? saved.rateCurrencies
      : base.rateCurrencies,
    // ⚠ 一定要用 Array.isArray 判斷：使用者可能刻意把快速備註全部刪光（存成 []），
    // 那時要尊重「空的」，不能拿預設值把它們叫回來
    quickNotes: Array.isArray(saved.quickNotes) ? saved.quickNotes : base.quickNotes,
    // ⚠ 同上：使用者可以把快速金額全部刪光（存成 []），那時要尊重「空的」
    // ⚠ 舊資料的 preset 沒有 currency 欄位（0.1.32 才加的）→ 每一筆補空字串＝「預設」，
    //   不然 v-model 綁上去會是 undefined
    quickPresets: Array.isArray(saved.quickPresets)
      ? saved.quickPresets.map((p) => ({ ...p, currency: p.currency ?? '' }))
      : base.quickPresets,
    // 自訂貨幣（0.1.44）：每一筆過一次正規化（code 3 個大寫字母、不撞內建、去重）
    customCurrencies: Array.isArray(saved.customCurrencies)
      ? normCustomCurrencies(saved.customCurrencies)
      : base.customCurrencies,
    // 旅行模式（0.1.35）：舊資料沒有這個欄位 → null＝沒有旅行；形狀不對也當沒有
    activeTrip: normTrip(saved.activeTrip),
    // 旅行模式（0.1.36）：已結束的旅行。每一筆照樣過一次 normTrip（形狀不對的丟掉）
    tripHistory: Array.isArray(saved.tripHistory)
      ? saved.tripHistory.map(normTrip).filter((t): t is TravelTrip => t !== null)
      : base.tripHistory,
  }
}

/** 讀出「錢包清單 ＋ 當前錢包」，並在必要時做單錢包 → 多錢包的遷移 */
function loadRoot(): { root: WalletState; migratedSettings: Settings | null } {
  const saved = readJSON<Partial<WalletState>>(Keys.WALLETS_KEY)
  if (saved && Array.isArray(saved.wallets) && saved.wallets.length) {
    const wallets = normalizeWallets(saved.wallets)
    const activeWalletId = wallets.some((w) => w.id === saved.activeWalletId)
      ? (saved.activeWalletId as string)
      : wallets[0].id
    const root: WalletState = { wallets, activeWalletId }
    // ⚠ 這裡一定要落地：下面的 watcher 不是 immediate，若遷移／正規化之後什麼都沒動，
    // localStorage 就會一直沒有這個鍵，重載又走一次遷移
    writeJSON(Keys.WALLETS_KEY, root)
    return { root, migratedSettings: null }
  }

  // ── 遷移：多錢包之前，全 App 只有一份設定（Keys.SETTINGS_KEY）──
  // 把它整份搬進一個預設錢包，記錄則在 records store 補上同一個 walletId。
  // ⚠ 舊鍵刻意「不刪」：萬一遷移過程有意外，使用者的原始設定還在。
  const legacy = readJSON<Partial<Settings>>(Keys.SETTINGS_KEY)
  const w = defaultWallet('我的錢包')
  const s = merge(defaultSettings(legacy?.baseCurrency ?? 'MOP'), legacy ?? {})
  writeJSON(walletSettingsKey(w.id), s)
  const root: WalletState = { wallets: [w], activeWalletId: w.id }
  writeJSON(Keys.WALLETS_KEY, root)
  return { root, migratedSettings: s }
}

/** 讀出某個錢包的設定（缺的欄位用預設值補） */
function loadWalletSettings(id: string): Settings {
  const saved = readJSON<Partial<Settings>>(walletSettingsKey(id))
  return merge(defaultSettings(saved?.baseCurrency ?? 'MOP'), saved ?? {})
}

export const useSettingsStore = defineStore('settings', () => {
  const { root: bootRoot, migratedSettings } = loadRoot()
  /** App 層級：錢包清單 + 當前錢包 */
  const root = ref<WalletState>(bootRoot)

  /**
   * ⚠ 這個 `state` 是「**當前錢包**的設定」，不是全 App 的設定。
   * 形狀與單錢包時代完全相同，所以既有程式碼讀 `settings.state.xxx` 不必改；
   * 差別只在切換錢包時它會整份換掉。
   */
  const state = ref<Settings>(migratedSettings ?? loadWalletSettings(root.value.activeWalletId))

  // 舊資料第一次載入若有補上圖示，立刻回寫一次，讓匯出檔也帶得到 icon
  const loadedShapes = migratedSettings ?? readJSON<Partial<Settings>>(walletSettingsKey(root.value.activeWalletId))
  if (loadedShapes?.categories?.length && loadedShapes.categories.some((c) => !c.icon)) {
    writeJSON(walletSettingsKey(root.value.activeWalletId), state.value)
  }

  watch(
    state,
    (v) => {
      // 寫進「當前錢包」的鍵；切換錢包時 setActiveWallet 會先把舊的那份落地
      writeJSON(walletSettingsKey(root.value.activeWalletId), v)
    },
    { deep: true },
  )

  watch(
    root,
    (v) => {
      writeJSON(Keys.WALLETS_KEY, v)
    },
    { deep: true },
  )

  /* ── 錢包 ─────────────────────────────────────────────── */
  const wallets = computed(() => root.value.wallets)
  const activeWalletId = computed(() => root.value.activeWalletId)
  const activeWallet = computed<Wallet>(
    () => root.value.wallets.find((w) => w.id === root.value.activeWalletId) ?? root.value.wallets[0],
  )

  /**
   * 切換錢包。回傳 false 代表找不到那個錢包。
   * ⚠ 一定要**先**把當前這份設定寫回去再換（不能只靠上面的 watcher：
   * 它是 microtask 才跑，那時 activeWalletId 已經變了，會把舊內容寫進新鍵）。
   */
  function setActiveWallet(id: string): boolean {
    if (id === root.value.activeWalletId) return true
    if (!root.value.wallets.some((w) => w.id === id)) return false
    writeJSON(walletSettingsKey(root.value.activeWalletId), state.value)
    root.value.activeWalletId = id
    state.value = loadWalletSettings(id)
    return true
  }

  /**
   * 新增錢包。新錢包會有自己一份預設設定，主幣別沿用當前錢包的
   * （比一開就跳回 MOP 合理），分類則是內建那一套。
   */
  function addWallet(name: string, color?: string, icon?: string): Wallet | null {
    const n = cleanWalletName(name)
    if (!walletNameOk(n, root.value.wallets)) return null
    const w = newWallet(uniqueWalletName(n, root.value.wallets.map((x) => x.name)), color, icon)
    root.value.wallets.push(w)
    writeJSON(walletSettingsKey(w.id), defaultSettings(state.value.baseCurrency))
    return w
  }

  /** 改名。空白、太長、與別人重複都不收，回傳 false（呼叫端負責還原輸入框） */
  function renameWallet(id: string, name: string): boolean {
    const w = root.value.wallets.find((x) => x.id === id)
    if (!w) return false
    const n = cleanWalletName(name)
    if (!n || n === w.name) return n === w.name
    if (!walletNameOk(n, root.value.wallets.filter((x) => x.id !== id))) return false
    w.name = n
    return true
  }

  function updateWallet(id: string, patch: { color?: string; icon?: string }): boolean {
    const w = root.value.wallets.find((x) => x.id === id)
    if (!w) return false
    if (patch.color !== undefined) w.color = safeWalletColor(patch.color)
    if (patch.icon !== undefined) w.icon = safeWalletIcon(patch.icon)
    return true
  }

  /**
   * 刪除錢包。
   * ⚠ 只擋「最後一個」——「裡面還有記錄」的判斷需要 records store，
   * 兩邊互相 import 會形成循環，所以那條由呼叫端（WalletSection）負責擋。
   * 刪除時會把該錢包的設定鍵一起清掉，免得留下孤兒資料。
   */
  function removeWallet(id: string): { ok: boolean; reason: string } {
    if (root.value.wallets.length <= 1) return { ok: false, reason: '至少要保留一個錢包' }
    const idx = root.value.wallets.findIndex((w) => w.id === id)
    if (idx < 0) return { ok: false, reason: '找不到這個錢包' }
    root.value.wallets.splice(idx, 1)
    if (root.value.activeWalletId === id) {
      // 刪掉的是當前錢包 → 換到第一個（先落地？不用：內容要跟著消失）
      root.value.activeWalletId = root.value.wallets[0].id
      state.value = loadWalletSettings(root.value.activeWalletId)
    }
    remove(walletSettingsKey(id))
    return { ok: true, reason: '' }
  }

  /** 排序：把 from 位置搬到 to 位置（拖曳用） */
  function moveWallet(from: number, to: number): boolean {
    const list = root.value.wallets
    if (from < 0 || from >= list.length) return false
    const t = Math.max(0, Math.min(list.length - 1, to))
    if (t === from) return false
    const [w] = list.splice(from, 1)
    list.splice(t, 0, w)
    return true
  }

  /** 匯入用：把一組錢包併進來（id 已存在就沿用本地的） */
  function upsertWallets(list: Wallet[], settingsByWallet?: Record<string, Settings>) {
    for (const w of normalizeWallets(list)) {
      const exists = root.value.wallets.find((x) => x.id === w.id)
      if (exists) continue
      root.value.wallets.push({
        ...w,
        name: uniqueWalletName(w.name, root.value.wallets.map((x) => x.name)),
      })
      const s = settingsByWallet?.[w.id]
      writeJSON(walletSettingsKey(w.id), s ? merge(defaultSettings(s.baseCurrency ?? 'MOP'), s) : defaultSettings())
    }
  }

  /**
   * 某個錢包的設定。
   * ⚠ 當前錢包一律回記憶體裡的那份：磁碟上可能是幾毫秒前的舊值
   * （watcher 是 microtask 才寫），匯出時拿到舊的會很莫名其妙。
   */
  function settingsOf(walletId: string): Settings {
    if (walletId === root.value.activeWalletId) return state.value
    return loadWalletSettings(walletId)
  }

  /** 全部錢包的設定（匯出備份用） */
  function allWalletSettings(): Record<string, Settings> {
    const out: Record<string, Settings> = {}
    for (const w of root.value.wallets) out[w.id] = settingsOf(w.id)
    return out
  }

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

  /**
   * 把「某幣別的金額」換算成「**目前**的主幣別」（0.1.28）。
   *
   * 使用者原話：「當主幣別設定做其他的貨幣時，記錄頁和統計頁中的記錄也要更改做
   * 用戶指定的貨幣，例如本來主幣是 MOP，現在改成 HKD，那記錄也要變成 HKD
   * （即使原記錄是用 MOP 記錄的就用匯率算出數字）」。
   *
   * ⚠⚠ 為什麼不用 `record.baseAmount`：那是**記帳當下**用當時的主幣別凍結的
   *   （`records.ts` 建立時寫死），主幣別後來改了它也不會跟著變 ——
   *   這正是使用者看到的問題。顯示一律用這裡即時換算。
   *
   * ⚠ **只換「顯示」，不改任何存的資料**：`amount`／`rate`／`baseAmount` 都保持原樣
   *   （那是歷史事實：當時用什麼幣別、當時換算成多少）。換回去也算得回來。
   * ⚠ 匯率表缺某個幣別時 `rate()` 會回 1 → 顯示「原數字＋新幣別符號」，
   *   這是刻意的降級（總比顯示 0 或 NaN 好），離線時也是這樣。
   */
  function toBase(amount: number, code: string): number {
    const v = (Number.isFinite(amount) ? amount : 0) * rate(code)
    return Number.isFinite(v) ? v : 0
  }

  /**
   * 「顯示幣別」（0.1.36）：旅行進行中＝**旅行貨幣**；沒有旅行＝主幣別。
   *
   * 使用者原話（0.1.36）：「用戶打開旅行模式時，記帳頁面和統計頁面以旅行中的貨幣顯示」。
   * 記錄頁／統計頁／記帳通知的所有金額顯示都改用這裡（`toDisplay` + 這個 computed）。
   */
  const displayCurrency = computed(() => state.value.activeTrip?.currency || state.value.baseCurrency)

  /**
   * 把「某幣別的金額」換算成「**目前**的顯示幣別」（0.1.36）。
   *
   * - 沒有旅行時＝`toBase`（完全等值，零行為變化——主幣別顯示的舊約定照舊）。
   * - 旅行中：先換成主幣、再換成旅行貨幣（`amount × rate(code) ÷ rate(旅行貨幣)`）。
   *
   * ⚠ 一樣**只換顯示，不改任何存的資料**；`RecordSheet` 的「詳細資訊」與匯出檔
   *   維持記帳當下的歷史事實（`baseAmount`／`baseCurrency`），刻意不換。
   */
  function toDisplay(amount: number, code: string): number {
    const dc = state.value.activeTrip?.currency
    if (!dc || dc === state.value.baseCurrency) return toBase(amount, code)
    const v = toBase(amount, code) / rate(dc)
    return Number.isFinite(v) ? v : 0
  }

  async function setBaseCurrency(code: string) {
    state.value.baseCurrency = code
    const rates = defaultRates(code)
    keepCustomRates(rates)
    state.value.rates = rates
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

  /* ── 自訂貨幣（0.1.44）──────────────────────────────────
   * 使用者原話：「增加一個區塊，用戶可以新增或修改或刪除一個現在沒有選單中的貨幣，
   * 自訂匯率，（用戶記錄後，如果DEL 這個匯率的選單，也不影響已記錄的數據）」。
   * - 匯率存進 `rates` map（跟內建幣別同一個地方）→ rate()／toBase／toDisplay 全部自動支援。
   * - **刪除只從選單移除，rates 留著**：已記錄的資料用自己凍結的 rate；
   *   顯示層（即時換算）也還查得到匯率——記錄的數據完全不影響。
   * - ⚠ 不能設為**主幣別**（主幣別切換會整組重算 defaultRates，自訂幣別沒有交叉匯率來源）；
   *   可以設為記帳幣別／記錄幣別／旅行貨幣。
   */
  /** 內建 12 種＋自訂，合起來給各處的幣別 <select> 用（自訂的 symbol 就是 code） */
  const allCurrencies = computed(() => [
    ...CURRENCIES,
    ...state.value.customCurrencies.map((c) => ({ code: c.code, name: c.name, symbol: c.code })),
  ])

  function addCustomCurrency(code: string, name: string, rate: number): boolean {
    const c = code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(c)) return false
    if (CURRENCIES.some((x) => x.code === c)) return false
    if (state.value.customCurrencies.some((x) => x.code === c)) return false
    state.value.customCurrencies.push({ code: c, name: name.trim() || c })
    if (isFinite(rate) && rate > 0) state.value.rates[c] = rate
    return true
  }

  function updateCustomCurrency(code: string, patch: { name?: string; rate?: number }) {
    const c = state.value.customCurrencies.find((x) => x.code === code)
    if (!c) return
    if (typeof patch.name === 'string' && patch.name.trim()) c.name = patch.name.trim()
    if (typeof patch.rate === 'number' && isFinite(patch.rate) && patch.rate > 0) {
      state.value.rates[code] = patch.rate
    }
  }

  function removeCustomCurrency(code: string) {
    const i = state.value.customCurrencies.findIndex((x) => x.code === code)
    if (i >= 0) state.value.customCurrencies.splice(i, 1)
    // ⚠ 刻意不刪 rates[code]：舊記錄的顯示換算照舊（「刪除不影響已記錄的數據」）
  }

  /**
   * 線上更新／切換主幣別會整組重建 `rates`——**自訂幣別的匯率不在 API 回傳裡**，
   * 重建後要把它們補回去（沒補的話自訂幣別的顯示換算會退化成 ×1）。
   */
  function keepCustomRates(newRates: Record<string, number>) {
    for (const c of state.value.customCurrencies) {
      const old = state.value.rates[c.code]
      if (typeof old === 'number' && old > 0) newRates[c.code] = old
    }
  }

  /** 線上更新匯率；失敗則沿用舊匯率（回傳 false） */
  async function refreshRates(): Promise<boolean> {
    try {
      const { rates, updatedAt } = await fetchRates(state.value.baseCurrency)
      keepCustomRates(rates)
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

  /* ── 預設分類（跟上面的「常用分類」完全獨立）──────────────
   * 常用分類＝主頁顯示哪幾顆按鈕；預設分類＝記帳頁預先選中哪一個。
   * 兩者互不影響：這裡的動作不會去動 favoriteCategories。
   */
  const defaultCategoryId = computed(() => state.value.defaultCategoryId)
  /** 被指定為預設的那個分類（已封存或不存在時回 null，呼叫端要自己退回預設行為） */
  const defaultCategory = computed(() => {
    const id = state.value.defaultCategoryId
    if (!id) return null
    const c = category(id)
    return c && !c.archived ? c : null
  })

  /** 設為預設分類；傳空字串 = 取消預設 */
  function setDefaultCategory(id: string) {
    const c = id ? category(id) : null
    state.value.defaultCategoryId = c && !c.archived ? c.id : ''
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

  /* ── 快速金額預設（0.1.29）───────────────────────────── */
  /** 記帳頁金額上方那排方鈕；數量由使用者在設定頁決定，可以是空的 */
  const quickPresets = computed(() => state.value.quickPresets)

  /** 新增一組（金額先給 0，讓使用者自己填） */
  function addQuickPreset(): QuickPreset {
    const p: QuickPreset = {
      id: uid(),
      amount: 0,
      type: 'expense',
      categoryId: '',
      note: '',
      currency: '',
    }
    state.value.quickPresets.push(p)
    return p
  }

  /** 改其中一組；找不到 id 就不動作 */
  function updateQuickPreset(id: string, patch: Partial<Omit<QuickPreset, 'id'>>) {
    const p = state.value.quickPresets.find((x) => x.id === id)
    if (!p) return
    if (patch.amount !== undefined) {
      // 金額：只收有限且 ≥ 0 的數字，其他（NaN／負數）一律歸 0＝「不帶入金額」
      const n = Number(patch.amount)
      p.amount = Number.isFinite(n) && n >= 0 ? n : 0
    }
    if (patch.type !== undefined) p.type = patch.type
    if (patch.categoryId !== undefined) p.categoryId = patch.categoryId
    if (patch.note !== undefined) p.note = patch.note
    if (patch.currency !== undefined) p.currency = patch.currency
  }

  function removeQuickPreset(id: string) {
    const i = state.value.quickPresets.findIndex((x) => x.id === id)
    if (i >= 0) state.value.quickPresets.splice(i, 1)
  }

  /* ── 旅行模式（0.1.35）─────────────────────────────────
   * 一次只有一個進行中的旅行（使用者拍板）。
   * ⚠ 記錄本身（蓋 tripId／解除標記）在 records store——這裡只管「旅行本體」與幣別，
   *   避免兩個 store 互相 import（records 已經 import settings，反過來會成循環）。
   */
  const activeTrip = computed(() => state.value.activeTrip)

  /**
   * 0.1.41：「查看旅行記錄」的**持久過濾模式**（使用者原話：「打開後，用戶無論如何
   * 切換頁面，再回到記錄的頁面時，也要是（只查看當前旅行的資料的模式），直到用戶
   * 關閉這個模式或完成旅行」）。
   * - 存的是**旅行 id**；null＝模式關閉（記錄頁回到一般區間查詢）。
   * - ⚠ 刻意**不放进 state**（不持久化到 localStorage）：SPA 內切頁保持（Pinia store
   *   不因路由切換銷毀），刷新／重開 App 就重置——檢視模式不該跨 session 殘留。
   * - 清除時機：記錄頁 chip 的 ✕、TravelSheet 的關、`finishTrip()`（結束旅行自動關）。
   * - 與 URL `?trip=`（0.1.38，一次性查看）並存：記錄頁 URL 優先、store 為後備。
   */
  const tripViewFilter = ref<string | null>(null)

  /** 開／關「只看這趟旅行」模式（傳 null＝關） */
  function setTripViewFilter(id: string | null) {
    tripViewFilter.value = typeof id === 'string' && id ? id : null
  }

  /**
   * 開始旅行：把旅行本體存進當前錢包的設定。
   * 設了旅行貨幣時，同時把記帳幣別切過去，並把**原幣別**快照在 `prevCurrency`
   * （結束旅行時恢復用）——快照只發生在開始時，中途改旅行貨幣不會蓋掉它。
   */
  function startTrip(input: {
    name: string
    startDate: string
    endDate: string
    currency: string
    mode1: boolean
    mode2: boolean
    /** 旅行顏色（0.1.39）；空字串／怪值＝不存（顯示回退琥珀） */
    color?: string
  }): TravelTrip {
    const currency = input.currency || ''
    const trip: TravelTrip = {
      id: uid('trip'),
      name: input.name.trim() || '旅行',
      startDate: input.startDate || '',
      endDate: input.endDate || '',
      currency,
      prevCurrency: currency ? state.value.inputCurrency : '',
      mode1: input.mode1 === true,
      mode2: input.mode2 === true,
      // 0.1.36：記下建立時間（「過去的旅行」列表要用）
      createdAt: new Date().toISOString(),
      // 0.1.39：旅行顏色（TravelSheet 的色板一定會帶一個；這裡只做最後防線）
      ...(isHexColor(input.color) ? { color: input.color.trim() } : {}),
    }
    state.value.activeTrip = trip
    if (currency) state.value.inputCurrency = currency
    return trip
  }

  /**
   * 旅行進行中改內容（名稱／日期／貨幣／模式）。
   * 貨幣變了要跟著重切記帳幣別：切到新幣別；切回「不自動切換」（空字串）＝
   * 恢復開始前快照的那個幣別。
   */
  function updateActiveTrip(patch: Partial<Omit<TravelTrip, 'id' | 'prevCurrency'>>) {
    const t = state.value.activeTrip
    if (!t) return
    if (patch.name !== undefined && patch.name.trim()) t.name = patch.name.trim()
    if (patch.startDate !== undefined) t.startDate = patch.startDate
    if (patch.endDate !== undefined) t.endDate = patch.endDate
    if (patch.mode1 !== undefined) t.mode1 = patch.mode1 === true
    if (patch.mode2 !== undefined) t.mode2 = patch.mode2 === true
    if (patch.currency !== undefined && patch.currency !== t.currency) {
      t.currency = patch.currency
      state.value.inputCurrency = t.currency || t.prevCurrency || state.value.inputCurrency
    }
    // 0.1.39：旅行顏色（旅行中在 TravelSheet 點色板＝即時生效）
    if (patch.color !== undefined) t.color = isHexColor(patch.color) ? patch.color.trim() : undefined
  }

  /**
   * 結束旅行（0.1.36 改）：
   * - 旅行本體從 `activeTrip` 移進 `tripHistory`（蓋上 endedAt）——「過去的旅行」的來源
   * - 記帳幣別恢復成開始前的快照
   * - ⚠ **不解除記錄的標記**（使用者拍板：結束後標籤保留，回歸一般記錄沒有意義）。
   *   記錄歸組／統計節點靠 `tripById()` 查名，結束過的旅行照樣顯示。
   */
  function finishTrip(): TravelTrip | null {
    const t = state.value.activeTrip
    if (!t) return null
    if (t.prevCurrency) state.value.inputCurrency = t.prevCurrency
    state.value.tripHistory.push({ ...t, endedAt: new Date().toISOString() })
    state.value.activeTrip = null
    // 0.1.41：「查看旅行記錄」的持久過濾隨結束旅行自動關閉（使用者：
    // 「直到用戶關閉這個模式或完成旅行」）——不管從哪裡結束都會走到這裡
    tripViewFilter.value = null
    return t
  }

  /**
   * 查旅行（0.1.36）：先查進行中的，再查已結束的。
   * 記錄頁歸組組名、統計頁節點名、搜索比對都靠它——
   * 這樣結束過的旅行也查得到名字（標記保留後這是唯一的名稱來源）。
   */
  function tripById(id: string): TravelTrip | undefined {
    if (!id) return undefined
    return (
      state.value.activeTrip?.id === id
        ? state.value.activeTrip
        : state.value.tripHistory.find((t) => t.id === id)
    )
  }

  /**
   * 修改「過去的旅行」（0.1.37）：只動 tripHistory 裡的那一筆。
   * 名稱是記錄頁組名／統計節點名／搜索比對的來源（畫面一律經 `tripById()` 即時查），
   * 所以改名後那些地方會跟著變——記錄本體不用動。
   * ⚠ 只收歷史旅行；進行中的旅行照舊走 `updateActiveTrip()`（TravelSheet）。
   */
  function updateTripHistory(
    id: string,
    patch: Partial<Pick<TravelTrip, 'name' | 'startDate' | 'endDate' | 'currency' | 'hidden'>>,
  ) {
    const t = state.value.tripHistory.find((x) => x.id === id)
    if (!t) return
    if (patch.name !== undefined && patch.name.trim()) t.name = patch.name.trim()
    if (patch.startDate !== undefined) t.startDate = patch.startDate
    if (patch.endDate !== undefined) t.endDate = patch.endDate
    if (patch.currency !== undefined) t.currency = patch.currency
    // 0.1.41：隱藏／取消隱藏（TripHistorySheet 詳情裡的按鈕）
    if (patch.hidden !== undefined) t.hidden = patch.hidden === true
  }

  /**
   * 刪除「過去的旅行」（0.1.37）：從 tripHistory 移除並回傳被刪的那筆。
   * ⚠ 只刪旅行本體；**記錄的 tripId 由呼叫端負責清**（TripHistorySheet 會接著叫
   * `records.clearTripTag()`）——維持 records→settings 的單向依賴，settings 不回頭改記錄。
   */
  function deleteTripHistory(id: string): TravelTrip | null {
    const i = state.value.tripHistory.findIndex((x) => x.id === id)
    if (i < 0) return null
    return state.value.tripHistory.splice(i, 1)[0] ?? null
  }

  function restoreDefaults() {
    state.value.categories = JSON.parse(JSON.stringify(defaultSettings().categories))
  }

  return {
    state,
    /* ── 錢包 ── */
    wallets,
    activeWalletId,
    activeWallet,
    setActiveWallet,
    addWallet,
    renameWallet,
    updateWallet,
    removeWallet,
    moveWallet,
    upsertWallets,
    settingsOf,
    allWalletSettings,
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
    toBase,
    displayCurrency,
    toDisplay,
    preferredCurrency,
    setPreferredCurrency,
    setBaseCurrency,
    setInputCurrency,
    setRate,
    refreshRates,
    /* ── 自訂貨幣 ── */
    allCurrencies,
    addCustomCurrency,
    updateCustomCurrency,
    removeCustomCurrency,
    addCategory,
    updateCategory,
    removeCategory,
    defaultCategoryId,
    defaultCategory,
    setDefaultCategory,
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
    quickPresets,
    addQuickPreset,
    updateQuickPreset,
    removeQuickPreset,
    /* ── 旅行模式 ── */
    activeTrip,
    tripHistory: computed(() => state.value.tripHistory),
    tripById,
    tripViewFilter,
    setTripViewFilter,
    updateTripHistory,
    deleteTripHistory,
    startTrip,
    updateActiveTrip,
    finishTrip,
    restoreDefaults,
  }
})
