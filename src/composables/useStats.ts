import { computed, type Ref } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import type { TxRecord, TxType } from '@/types'
import { dayKey, monthKey, recentMonths, previousRange, daysInclusive } from '@/lib/date'

export interface CatStat {
  id: string
  name: string
  color: string
  /** 含所有子分類的總額 */
  total: number
  /** 只算直接掛在自己身上的金額（不含子分類） */
  own: number
  count: number
  /** 佔全體的比例 */
  ratio: number
  /** 佔上一層的比例（頂層等於 ratio）；展開子分類時用這個畫長條與百分比 */
  parentRatio: number
  children: CatStat[]
}

export interface DateRange {
  /** YYYY-MM-DD，含當日 */
  start: string
  end: string
}

export interface Bucket {
  key: string
  label: string
  expense: number
  income: number
}

export function useStats(range: Ref<DateRange>) {
  const records = useRecordsStore()
  const settings = useSettingsStore()

  /**
   * 0.1.28：統計頁所有金額一律即時換算成「目前的主幣別」。
   * 0.1.36：改成「目前的**顯示幣別**」——旅行進行中＝旅行貨幣
   * （使用者：「打開旅行模式時，記帳頁面和統計頁面以旅行中的貨幣顯示」）；
   * 沒有旅行時與舊行為完全相同（＝主幣別）。
   * 0.1.53：改用記錄自己凍結的匯率（`displayOf`）——已記錄數據的匯率是固定的。
   * ⚠ 以前用 `r.baseAmount`（記帳當下凍結的值），主幣別改了它不會跟著變。
   * ⚠ 只換顯示；存的資料完全不動。下面的 computed 都依賴 settings，會自動重算。
   */
  const amt = (r: TxRecord) => settings.displayOf(r)

  /**
   * 落在選取區間內的記錄。
   * 0.1.63：排除「不計入統計」的記錄（明細裡標記的，或所屬分類整棵被標記的）——
   * 使用者原話：「在記錄明細頁面中，增加該筆資料不計入統計按鈕…在統計頁面也要
   * 列明哪些記錄沒有計入統計」。所以統計的一切數字（收支、佔比、長條圖、趨勢、
   * 最大支出）都不含它們；被排除的改由下面的 `excludedRows` 單獨列出。
   */
  const rows = computed(() => {
    const { start, end } = range.value
    return records.records.filter((r) => {
      if (records.isExcluded(r)) return false
      const k = dayKey(r.occurredAt)
      return k >= start && k <= end
    })
  })

  /** 0.1.63：區間內「不計入統計」的記錄（統計頁要單獨列出來給使用者看） */
  const excludedRows = computed(() => {
    const { start, end } = range.value
    return records.records.filter((r) => {
      if (!records.isExcluded(r)) return false
      const k = dayKey(r.occurredAt)
      return k >= start && k <= end
    })
  })

  const income = computed(() =>
    rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + amt(r), 0),
  )
  const expense = computed(() =>
    rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + amt(r), 0),
  )
  const balance = computed(() => income.value - expense.value)
  /**
   * 0.1.75：數量模式 —— 沒有收支之分，全部記錄加總成一個「合計」。
   * （記錄的 `type` 欄位還在，只是數量模式下沒有任何區分它的畫面。）
   */
  const total = computed(() => rows.value.reduce((s, r) => s + amt(r), 0))

  /**
   * 分類統計（含子分類）。
   * 每個節點的 total 會把自己底下所有子分類的金額都算進來，
   * 所以頂層那一列就是「餐飲全部多少」，展開才看早餐／午餐／晚餐各多少。
   *
   * 旅行模式（0.1.35）：有 `tripId` 標記的記錄**不進**原分類的統計（不被污染），
   * 改成一顆獨立的頂層節點「旅行名」（琥珀色），底下按原分類的大類分組 ——
   * 也就是「日本旅行 → 餐飲／交通…」的樹。
   * 0.1.36 起：標記結束後**保留**，所以改成「所有有 `tripId` 的記錄」都按各自的
   * 旅行分組（不只 `activeTrip`），旅行名用 `settings.tripById()` 查——
   * 結束過的旅行照樣有自己的節點。
   */
  function byCategory(type: TxType | null): CatStat[] {
    // 先把旅行記錄撈出來做成獨立節點（要在算 grand 之前，比例才會對）
    // 0.1.75：type 傳 null ＝不分收支（數量模式）
    const tripRowsAll = rows.value.filter((r) => r.tripId && (type === null || r.type === type))
    const tripNodes: CatStat[] = []
    if (tripRowsAll.length) {
      // 按旅行分組（同一個 tripId 一顆節點；照 rows 的順序，新的旅行節點在後面）
      const perTrip = new Map<string, { rows: TxRecord[] }>()
      for (const r of tripRowsAll) {
        const cur = perTrip.get(r.tripId!) ?? { rows: [] }
        cur.rows.push(r)
        perTrip.set(r.tripId!, cur)
      }
      for (const [tid, { rows: list }] of perTrip) {
        const per = new Map<string, { total: number; count: number }>()
        for (const r of list) {
          // 旅行節點底下按「原分類的大類」分組（子分類併進大類）
          const root = settings.pathOf(r.categoryId)[0]?.id ?? r.categoryId
          const cur = per.get(root) ?? { total: 0, count: 0 }
          cur.total += amt(r)
          cur.count += 1
          per.set(root, cur)
        }
        const children: CatStat[] = [...per.entries()]
          .map(([id, v]) => {
            const c = settings.category(id)
            return {
              id,
              name: c?.name ?? '未分類',
              color: c?.color ?? '#8a857c',
              total: v.total,
              own: v.total,
              count: v.count,
              ratio: 0,
              parentRatio: 0,
              children: [],
            }
          })
          .sort((a, b) => b.total - a.total)
        const total = children.reduce((s, k) => s + k.total, 0)
        tripNodes.push({
          id: `trip:${tid}`,
          // 旅行名：進行中的旅行 tripById 一定查得到；結束過的從 tripHistory 查
          name: settings.tripById(tid)?.name ?? '旅行',
          color: '#d9a326',
          total,
          own: 0,
          count: list.length,
          ratio: 0,
          parentRatio: 0,
          children,
        })
      }
    }

    // 先算出「直接掛在某個分類身上」的金額（旅行記錄不算進來）
    const own = new Map<string, { total: number; count: number }>()
    for (const r of rows.value) {
      if (type !== null && r.type !== type) continue
      if (r.tripId) continue
      const cur = own.get(r.categoryId) ?? { total: 0, count: 0 }
      cur.total += amt(r)
      cur.count += 1
      own.set(r.categoryId, cur)
    }
    const grand = [...own.values()].reduce((s, v) => s + v.total, 0) + tripNodes.reduce((s, n) => s + n.total, 0) || 1
    const used = new Set<string>()

    const build = (parentId: string | null): CatStat[] => {
      const out: CatStat[] = []
      for (const c of settings.childrenOf(parentId)) {
        const o = own.get(c.id) ?? { total: 0, count: 0 }
        const kids = build(c.id)
        const total = o.total + kids.reduce((s, k) => s + k.total, 0)
        const count = o.count + kids.reduce((s, k) => s + k.count, 0)
        if (total <= 0 && !kids.length) continue
        used.add(c.id)
        out.push({
          id: c.id,
          name: c.name,
          color: c.color,
          total,
          own: o.total,
          count,
          ratio: total / grand,
          parentRatio: 0,
          children: kids,
        })
      }
      return out.sort((a, b) => b.total - a.total)
    }

    const top = build(null)

    // 旅行節點掛進頂層（每個有記錄的旅行一顆；結束過的也會在）
    for (const n of tripNodes) {
      n.ratio = n.total / grand
      top.push(n)
    }

    // 已刪除（封存）或查不到的分類：補在最上層，金額才不會憑空消失
    for (const [id, v] of own) {
      if (used.has(id)) continue
      const c = settings.category(id)
      top.push({
        id,
        name: c?.name ?? '未分類',
        color: c?.color ?? '#8a857c',
        total: v.total,
        own: v.total,
        count: v.count,
        ratio: v.total / grand,
        parentRatio: 0,
        children: [],
      })
    }
    top.sort((a, b) => b.total - a.total)

    // 由上往下補上「佔上一層」的比例
    const fill = (list: CatStat[], parentTotal: number) => {
      for (const n of list) {
        n.parentRatio = n.total / (parentTotal > 0 ? parentTotal : 1)
        fill(n.children, n.total)
      }
    }
    fill(top, grand)
    return top
  }

  const expenseByCat = computed(() => byCategory('expense'))
  const incomeByCat = computed(() => byCategory('income'))
  /** 0.1.75：數量模式 —— 不分收支的全部分類統計 */
  const totalByCat = computed(() => byCategory(null))

  /** 區間天數；超過 92 天改用月為單位，避免長條圖擠成一團 */
  const spanDays = computed(() => daysInclusive(range.value.start, range.value.end))
  const granularity = computed<'day' | 'month'>(() => (spanDays.value > 92 ? 'month' : 'day'))

  /** 區間收支：依粒度分桶（月粒度會補齊空月份） */
  const daily = computed<Bucket[]>(() => {
    const map = new Map<string, Bucket>()
    const ensure = (key: string, label: string) => {
      let b = map.get(key)
      if (!b) {
        b = { key, label, expense: 0, income: 0 }
        map.set(key, b)
      }
      return b
    }

    if (granularity.value === 'month') {
      const [sy, sm] = range.value.start.split('-').map(Number)
      const [ey, em] = range.value.end.split('-').map(Number)
      const total = (ey - sy) * 12 + (em - sm) + 1
      for (let i = 0; i < Math.max(1, total); i++) {
        const d = new Date(sy, sm - 1 + i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        ensure(key, d.getFullYear() !== sy ? `${key.slice(2)}` : `${d.getMonth() + 1}月`)
      }
      for (const r of rows.value) {
        const b = ensure(monthKey(r.occurredAt), '')
        if (r.type === 'expense') b.expense += amt(r)
        else b.income += amt(r)
      }
    } else {
      for (const r of rows.value) {
        const k = dayKey(r.occurredAt)
        const b = ensure(k, String(Number(k.split('-')[2])))
        if (r.type === 'expense') b.expense += amt(r)
        else b.income += amt(r)
      }
    }

    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  })

  /** 以區間結束月為基準的近六個月趨勢 */
  const trend = computed(() => {
    const [ey, em] = range.value.end.split('-').map(Number)
    const from = new Date(ey, em - 1, 1)
    return recentMonths(6, from).map((m) => {
      const list = records.records.filter((r) => monthKey(r.occurredAt) === m && !records.isExcluded(r))
      return {
        month: m,
        expense: list.filter((r) => r.type === 'expense').reduce((s, r) => s + amt(r), 0),
        income: list.filter((r) => r.type === 'income').reduce((s, r) => s + amt(r), 0),
      }
    })
  })

  /** 與「前一個等長區間」的支出變化 */
  const prevRange = computed(() => previousRange(range.value.start, range.value.end))
  const prevExpense = computed(() => {
    const { start, end } = prevRange.value
    return records.records
      .filter((r) => {
        const k = dayKey(r.occurredAt)
        return k >= start && k <= end && r.type === 'expense' && !records.isExcluded(r)
      })
      .reduce((s, r) => s + amt(r), 0)
  })
  /** 0.1.75：數量模式 —— 前期「合計」（不分收支） */
  const prevTotal = computed(() => {
    const { start, end } = prevRange.value
    return records.records
      .filter((r) => {
        const k = dayKey(r.occurredAt)
        return k >= start && k <= end && !records.isExcluded(r)
      })
      .reduce((s, r) => s + amt(r), 0)
  })
  const momChange = computed(() => {
    if (!prevExpense.value) return null
    return (expense.value - prevExpense.value) / prevExpense.value
  })
  /** 0.1.75：數量模式的「較前期」變化（合計版） */
  const totalChange = computed(() => {
    if (!prevTotal.value) return null
    return (total.value - prevTotal.value) / prevTotal.value
  })

  /**
   * 區間最大（前 5 筆）。
   * 0.1.72：改成**依收支類型**取 —— 使用者原話：「如果用戶選擇了收入的話，
   * 區間最大的支出，改成區間最大的收入；若用戶選擇了支出，則保持不變」（需求 8）。
   * ⚠ 用一般函式（不是 computed）：類型是 StatsView 的狀態，這裡不方便吃它；
   *   呼叫端用 computed 包就有快取。
   * 0.1.75：`type` 傳 null ＝不分類型（數量模式）＝全部記錄一起比大小。
   */
  function topRecordsOf(type: TxType | null): TxRecord[] {
    return [...rows.value]
      .filter((r) => (type === null || r.type === type))
      .sort((a, b) => amt(b) - amt(a))
      .slice(0, 5)
  }

  /** 相容舊呼叫：區間最大**支出** */
  const topRecords = computed(() => topRecordsOf('expense'))

  /**
   * 累計（全部時間）。0.1.63：收支改吃 store 的 `totalIncome`／`totalExpense`
   * ——那兩個已經排除「不計入統計」的記錄；筆數仍指全部記錄（資訊用）。
   */
  const allTime = computed(() => ({
    count: records.records.length,
    income: records.totalIncome,
    expense: records.totalExpense,
  }))

  return {
    rows,
    excludedRows,
    spanDays,
    granularity,
    income,
    expense,
    balance,
    total,
    expenseByCat,
    incomeByCat,
    totalByCat,
    daily,
    trend,
    prevRange,
    prevExpense,
    prevTotal,
    momChange,
    totalChange,
    topRecords,
    topRecordsOf,
    allTime,
    monthList: (n = 24) => recentMonths(n).reverse(),
  }
}
