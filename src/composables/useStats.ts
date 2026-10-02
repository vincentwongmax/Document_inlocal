import { computed, type Ref } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { dayKey, monthKey, recentMonths, previousRange, daysInclusive } from '@/lib/date'

export interface CatStat {
  id: string
  name: string
  color: string
  total: number
  count: number
  ratio: number
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

  /** 落在選取區間內的記錄 */
  const rows = computed(() => {
    const { start, end } = range.value
    return records.records.filter((r) => {
      const k = dayKey(r.occurredAt)
      return k >= start && k <= end
    })
  })

  const income = computed(() =>
    rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
  )
  const expense = computed(() =>
    rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
  )
  const balance = computed(() => income.value - expense.value)

  function byCategory(type: 'expense' | 'income'): CatStat[] {
    const map = new Map<string, { total: number; count: number }>()
    for (const r of rows.value) {
      if (r.type !== type) continue
      const cur = map.get(r.categoryId) ?? { total: 0, count: 0 }
      cur.total += r.baseAmount
      cur.count += 1
      map.set(r.categoryId, cur)
    }
    const total = [...map.values()].reduce((s, v) => s + v.total, 0) || 1
    return [...map.entries()]
      .map(([id, v]) => {
        const c = settings.category(id)
        return {
          id,
          name: c?.name ?? '未分類',
          color: c?.color ?? '#8a857c',
          total: v.total,
          count: v.count,
          ratio: v.total / total,
        }
      })
      .sort((a, b) => b.total - a.total)
  }

  const expenseByCat = computed(() => byCategory('expense'))
  const incomeByCat = computed(() => byCategory('income'))

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
        if (r.type === 'expense') b.expense += r.baseAmount
        else b.income += r.baseAmount
      }
    } else {
      for (const r of rows.value) {
        const k = dayKey(r.occurredAt)
        const b = ensure(k, String(Number(k.split('-')[2])))
        if (r.type === 'expense') b.expense += r.baseAmount
        else b.income += r.baseAmount
      }
    }

    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  })

  /** 以區間結束月為基準的近六個月趨勢 */
  const trend = computed(() => {
    const [ey, em] = range.value.end.split('-').map(Number)
    const from = new Date(ey, em - 1, 1)
    return recentMonths(6, from).map((m) => {
      const list = records.records.filter((r) => monthKey(r.occurredAt) === m)
      return {
        month: m,
        expense: list.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
        income: list.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
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
        return k >= start && k <= end && r.type === 'expense'
      })
      .reduce((s, r) => s + r.baseAmount, 0)
  })
  const momChange = computed(() => {
    if (!prevExpense.value) return null
    return (expense.value - prevExpense.value) / prevExpense.value
  })

  const topRecords = computed(() =>
    [...rows.value]
      .filter((r) => r.type === 'expense')
      .sort((a, b) => b.baseAmount - a.baseAmount)
      .slice(0, 5),
  )

  const allTime = computed(() => ({
    count: records.records.length,
    income: records.totalIncome,
    expense: records.totalExpense,
  }))

  return {
    rows,
    spanDays,
    granularity,
    income,
    expense,
    balance,
    expenseByCat,
    incomeByCat,
    daily,
    trend,
    prevRange,
    prevExpense,
    momChange,
    topRecords,
    allTime,
    monthList: (n = 24) => recentMonths(n).reverse(),
  }
}
