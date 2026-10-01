import { computed, type Ref } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { dayKey, monthKey, recentMonths } from '@/lib/date'

export interface CatStat {
  id: string
  name: string
  color: string
  total: number
  count: number
  ratio: number
}

export function useStats(month: Ref<string>) {
  const records = useRecordsStore()
  const settings = useSettingsStore()

  const inMonth = computed(() => records.records.filter((r) => monthKey(r.occurredAt) === month.value))

  const income = computed(() =>
    inMonth.value.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
  )
  const expense = computed(() =>
    inMonth.value.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
  )
  const balance = computed(() => income.value - expense.value)

  function byCategory(type: 'expense' | 'income'): CatStat[] {
    const map = new Map<string, { total: number; count: number }>()
    for (const r of inMonth.value) {
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

  /** 當月每日累積支出 */
  const daily = computed(() => {
    const days = new Map<string, { expense: number; income: number }>()
    for (const r of inMonth.value) {
      const k = dayKey(r.occurredAt)
      const cur = days.get(k) ?? { expense: 0, income: 0 }
      if (r.type === 'expense') cur.expense += r.baseAmount
      else cur.income += r.baseAmount
      days.set(k, cur)
    }
    return [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  })

  /** 近 6 個月趨勢 */
  const trend = computed(() => {
    const months = recentMonths(6)
    return months.map((m) => {
      const rows = records.records.filter((r) => monthKey(r.occurredAt) === m)
      return {
        month: m,
        expense: rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
        income: rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
      }
    })
  })

  /** 與上個月的支出變化 */
  const momChange = computed(() => {
    const t = trend.value
    if (t.length < 2) return null
    const prev = t[t.length - 2].expense
    const cur = t[t.length - 1].expense
    if (!prev) return null
    return (cur - prev) / prev
  })

  const topRecords = computed(() =>
    [...inMonth.value].filter((r) => r.type === 'expense').sort((a, b) => b.baseAmount - a.baseAmount).slice(0, 5),
  )

  const allTime = computed(() => ({
    count: records.records.length,
    income: records.totalIncome,
    expense: records.totalExpense,
  }))

  return {
    inMonth,
    income,
    expense,
    balance,
    expenseByCat,
    incomeByCat,
    daily,
    trend,
    momChange,
    topRecords,
    allTime,
    monthList: (n = 24) => recentMonths(n).reverse(),
  }
}
