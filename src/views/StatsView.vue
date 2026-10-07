<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { notify } from '@/lib/alerts'
import { useStats, type DateRange } from '@/composables/useStats'
import { fmtMoney, fmtNum } from '@/lib/currency'
import {
  addDays,
  dayKey,
  formatRange,
  monthKey,
  monthLabel,
  monthRange,
  todayKey,
  unitRange,
} from '@/lib/date'
import type { TxRecord } from '@/types'
import DonutChart from '@/components/charts/DonutChart.vue'
import TrendChart from '@/components/charts/TrendChart.vue'
import DailyChart from '@/components/charts/DailyChart.vue'
import RecordList from '@/components/RecordList.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import DateField from '@/components/DateField.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import SumDetailSheet from '@/components/SumDetailSheet.vue'
import type { DetailRow, DetailRank } from '@/components/SumDetailSheet.vue'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'

const settings = useSettingsStore()
const records = useRecordsStore()

/* ── 區間選擇 ───────────────────────────────────────────── */
const mode = ref<'day' | 'month' | 'year' | 'custom'>('month')
const month = ref(monthKey(new Date().toISOString()))
const year = ref(new Date().getFullYear().toString())
const day = ref(todayKey())
const start = ref(monthRange(month.value).start)
const end = ref(monthRange(month.value).end)

const range = computed<DateRange>(() => {
  if (mode.value === 'day') return { start: day.value, end: day.value }
  if (mode.value === 'month') return monthRange(month.value)
  if (mode.value === 'year') return unitRange('year', year.value)
  return start.value <= end.value
    ? { start: start.value, end: end.value }
    : { start: end.value, end: start.value }
})

/** 有記錄的年份 + 今年前後各一年 */
const years = computed(() => {
  const set = new Set<string>(records.records.map((r) => dayKey(r.occurredAt).slice(0, 4)))
  const now = new Date().getFullYear()
  set.add(String(now))
  set.add(String(now - 1))
  set.add(String(now + 1))
  return [...set].filter(Boolean).sort((a, b) => (a < b ? 1 : -1))
})

const st = useStats(range)
const base = computed(() => settings.baseCurrency)

const months = computed(() => st.monthList(24))
const monthIndex = computed(() => months.value.indexOf(month.value))
/**
 * 月份下拉是由「新到舊」排列（`recentMonths(24).reverse()`），所以往更早 = 往清單後面走。
 * 這裡讓 ‹ 代表更早、› 代表更晚，與日模式和記錄頁一致；
 * 直接寫 i + delta 的話 ‹ 會變成往更晚，而且在最新一個月時 ‹ 會失效、永遠回不了上個月。
 */
function shift(delta: number) {
  const i = monthIndex.value
  if (i < 0) return
  const next = months.value[i - delta]
  if (next) month.value = next
}

/** 月份／年份下拉與自訂日期互相同步，切換模式不會跳掉 */
watch(
  [month, year, day, mode],
  ([m, y, d]) => {
    const r =
      mode.value === 'year'
        ? unitRange('year', y)
        : mode.value === 'day'
          ? { start: d, end: d }
          : monthRange(m)
    start.value = r.start
    end.value = r.end
  },
  { immediate: true },
)

/** 同 monthbar 的月份邏輯：years 是由新到舊，往更早 = 往清單後面走 */
function shiftYear(delta: number) {
  const i = years.value.indexOf(year.value)
  const next = years.value[i - delta]
  if (next) year.value = next
}

function shiftDay(delta: number) {
  day.value = addDays(day.value, delta)
}

/**
 * 捷徑鈕：回到今天／本月／今年，比照模式的當前單位。
 * 目標值一定存在於選項裡 —— recentMonths 以當月結尾、years 也必定含今年，
 * 所以不必擔心 <select> 出現找不到對應 option 的空值。
 */
function goDay() {
  day.value = todayKey()
}
function goMonth() {
  month.value = monthKey(new Date().toISOString())
}
function goYear() {
  year.value = String(new Date().getFullYear())
}

function presetRange(key: string): DateRange {
  const today = todayKey()
  const y = today.slice(0, 4)
  if (key === 'month') return monthRange(monthKey(new Date().toISOString()))
  if (key === 'lastMonth') {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return monthRange(monthKey(d.toISOString()))
  }
  if (key === 'd7') return { start: addDays(today, -6), end: today }
  if (key === 'd30') return { start: addDays(today, -29), end: today }
  if (key === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` }
  // 全部：最早一筆記錄到今天
  const first = records.records.reduce<string | null>((min, r) => {
    const k = dayKey(r.occurredAt)
    return !min || k < min ? k : min
  }, null)
  return { start: first ?? `${y}-01-01`, end: today }
}

const PRESETS: { key: string; label: string }[] = [
  { key: 'd7', label: '近 7 天' },
  { key: 'd30', label: '近 30 天' },
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
]

function applyPreset(key: string) {
  const r = presetRange(key)
  start.value = r.start
  end.value = r.end
  mode.value = 'custom'
}

function isPreset(key: string): boolean {
  if (mode.value !== 'custom') return false
  const p = presetRange(key)
  return p.start === start.value && p.end === end.value
}

const rangeLabel = computed(() => formatRange(range.value.start, range.value.end))
const prevLabel = computed(() => formatRange(st.prevRange.value.start, st.prevRange.value.end))

/* ── 單筆明細 ───────────────────────────────────────────── */
const editingId = ref<string | null>(null)
const editing = computed(() => records.records.find((r) => r.id === editingId.value) ?? null)

function openRecord(id: string) {
  editingId.value = id
}

function saveEdit(patch: Partial<TxRecord>) {
  if (editingId.value) records.update(editingId.value, patch)
  editingId.value = null
  notify('已更新', 'ok')
}

function removeRecord(id: string) {
  const r = records.records.find((x) => x.id === id)
  records.remove(id)
  editingId.value = null
  notify('已刪除', 'info', {
    label: '復原',
    run: () => {
      if (r) records.restore(r)
    },
  })
}

const donutType = ref<'expense' | 'income'>('expense')
const donutItems = computed(() =>
  donutType.value === 'expense' ? st.expenseByCat.value : st.incomeByCat.value,
)
const donutTotal = computed(() => donutItems.value.reduce((s, i) => s + i.total, 0))

/* ── 分類佔比：展開看子分類 ─────────────────────────────── */
/** 已展開的分類 id（展開後才會列出它的子分類，多層就一直往下點） */
const openCats = ref<Set<string>>(new Set())
function toggleCat(id: string) {
  if (openCats.value.has(id)) openCats.value.delete(id)
  else openCats.value.add(id)
}
// 換收支類型時全部收合，避免上次的展開狀態對應到不存在的分類
watch(donutType, () => openCats.value.clear())

interface CatRow {
  id: string
  name: string
  color: string
  /** 分類圖示鍵值（從真正的 Category 查，子分類才會用自己的圖示） */
  icon: string
  total: number
  ratio: number
  depth: number
  hasKids: boolean
  open: boolean
  /** 「未細分」那一列不是真的分類，不能點 */
  pseudo?: boolean
}

/** 把樹攤平成一個陣列，depth 用來縮排；沒展開的分支不會出現 */
const donutRows = computed<CatRow[]>(() => {
  const out: CatRow[] = []
  const walk = (list: typeof donutItems.value, depth: number) => {
    for (const n of list) {
      const hasKids = n.children.length > 0
      const open = hasKids && openCats.value.has(n.id)
      out.push({
        id: n.id,
        name: n.name,
        color: n.color,
        icon: iconForCategory(settings.category(n.id) ?? { id: n.id, name: n.name }),
        total: n.total,
        ratio: n.parentRatio,
        depth,
        hasKids,
        open,
      })
      if (!open) continue
      walk(n.children, depth + 1)
      // 大類自己身上也有金額時，補一列「未細分」在最後，數字才對得起來
      if (n.own > 0) {
        out.push({
          id: n.id + '__own',
          name: '未細分',
          color: n.color,
          icon: '',
          total: n.own,
          ratio: n.own / (n.total || 1),
          depth: depth + 1,
          hasKids: false,
          open: false,
          pseudo: true,
        })
      }
    }
  }
  walk(donutItems.value, 0)
  return out
})

const dailyPoints = computed(() => st.daily.value)
const dailyTitle = computed(() => (st.granularity.value === 'month' ? '每月收支' : '每日收支'))

const mom = computed(() => st.momChange.value)

/* ── 摘要卡詳情（0.1.22）───────────────────────────────────
 * 三張摘要卡都可以點開一張小卡看關鍵數字。
 * 使用者要求「有動畫、顯示資訊、不要太多資訊」→ 每張最多 4 列數字 + 收入那張多一個前 3 名排行。
 */
type SumKey = 'expense' | 'income' | 'balance'
const sumOpen = ref<SumKey | null>(null)

/** 支出：跟前期比、本期日均、筆數。前期不存在（沒資料）時就只放本期數字 */
const expenseRows = computed<DetailRow[]>(() => {
  const out: DetailRow[] = []
  if (mom.value !== null) {
    out.push({
      label: `前期（${prevLabel.value}）`,
      value: fmtMoney(st.prevExpense.value, base.value),
    })
    const diff = st.expense.value - st.prevExpense.value
    out.push({
      label: diff >= 0 ? '比前期多' : '比前期少',
      value: (diff >= 0 ? '+' : '−') + fmtMoney(Math.abs(diff), base.value),
      tone: diff >= 0 ? 'up' : 'down',
    })
  }
  const days = Math.max(1, st.spanDays.value)
  out.push({ label: '本期日均', value: fmtMoney(st.expense.value / days, base.value) })
  out.push({ label: '支出筆數', value: `${st.rows.value.filter((r) => r.type === 'expense').length} 筆` })
  return out
})

const expenseCaption = computed(() =>
  mom.value === null
    ? '前期沒有記錄，無從比較'
    : `較前期 ${mom.value > 0 ? '+' : ''}${(mom.value * 100).toFixed(0)}%`,
)

/** 收入：來源前 3 名（帶比例長條） */
const incomeRanks = computed<DetailRank[]>(() => {
  const list = st.incomeByCat.value
  const top = list.slice(0, 3)
  const grand = top[0]?.total || 1
  return top.map((c) => ({
    name: c.name,
    value: fmtMoney(c.total, base.value),
    ratio: c.total / grand,
    color: c.color,
  }))
})

const incomeRows = computed<DetailRow[]>(() => {
  const rows = st.rows.value.filter((r) => r.type === 'income')
  const avg = rows.length ? st.income.value / rows.length : 0
  return [
    { label: '來源數', value: `${st.incomeByCat.value.length} 個` },
    { label: '收入筆數', value: `${rows.length} 筆` },
    { label: '平均每筆', value: fmtMoney(avg, base.value) },
  ]
})

/** 結餘：兩邊筆數與日均 */
const balanceRows = computed<DetailRow[]>(() => {
  const days = Math.max(1, st.spanDays.value)
  const inc = st.rows.value.filter((r) => r.type === 'income').length
  const exp = st.rows.value.filter((r) => r.type === 'expense').length
  return [
    { label: '收入合計', value: fmtMoney(st.income.value, base.value), tone: 'down' },
    { label: '支出合計', value: fmtMoney(st.expense.value, base.value), tone: 'up' },
    { label: '記錄筆數', value: `${st.rows.value.length} 筆（收 ${inc}／支 ${exp}）` },
    { label: '平均每日結餘', value: fmtMoney(st.balance.value / days, base.value) },
  ]
})

/** 目前打開的是哪一張卡（用來決定小卡要顯示什麼） */
const sumDetail = computed(() => {
  const k = sumOpen.value
  if (k === 'expense') {
    return {
      title: '支出明細',
      amount: fmtMoney(st.expense.value, base.value),
      tone: 'up' as const,
      caption: expenseCaption.value,
      rows: expenseRows.value,
      ranks: [] as DetailRank[],
      rankTitle: '',
    }
  }
  if (k === 'income') {
    return {
      title: '收入明細',
      amount: fmtMoney(st.income.value, base.value),
      tone: 'down' as const,
      caption: `${st.incomeByCat.value.length} 個來源 · ${st.rows.value.filter((r) => r.type === 'income').length} 筆`,
      rows: incomeRows.value,
      ranks: incomeRanks.value,
      rankTitle: '來源前 3 名',
    }
  }
  return {
    title: '結餘明細',
    amount: fmtMoney(st.balance.value, base.value),
    tone: (st.balance.value < 0 ? 'up' : 'down') as 'up' | 'down',
    caption: rangeLabel.value,
    rows: balanceRows.value,
    ranks: [] as DetailRank[],
    rankTitle: '',
  }
})
</script>

<template>
  <div class="page stats">
    <div class="page-head">
      <div>
        <h1 class="page-title">統計</h1>
        <p class="page-sub">
          共 {{ st.allTime.value.count }} 筆記錄 · 累計結餘
          {{ fmtMoney(st.allTime.value.income - st.allTime.value.expense, base) }}
        </p>
      </div>
      <!-- 整頁金額都是這個幣別，只在標題右邊標一次，摘要卡就不重複帶符號 -->
      <span class="page-cur">{{ base }}</span>
    </div>

    <!-- 區間選擇 -->
    <div class="card rangebar">
      <div class="seg2 rangebar__mode">
        <button :class="{ 'is-on': mode === 'day' }" @click="mode = 'day'">日</button>
        <button :class="{ 'is-on': mode === 'month' }" @click="mode = 'month'">月份</button>
        <button :class="{ 'is-on': mode === 'year' }" @click="mode = 'year'">年份</button>
        <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂</button>
      </div>

      <div v-if="mode === 'day'" class="monthbar">
        <button class="btn btn--ghost btn--sm" @click="shiftDay(-1)">‹</button>
        <DateField v-model="day" class="monthbar__sel" />
        <button class="btn btn--ghost btn--sm" @click="shiftDay(1)">›</button>
        <button class="btn btn--ghost btn--sm monthbar__now" @click="goDay">今天</button>
      </div>

      <div v-else-if="mode === 'month'" class="monthbar">
        <button class="btn btn--ghost btn--sm" :disabled="monthIndex >= months.length - 1" @click="shift(-1)">
          ‹
        </button>
        <select v-model="month" class="field monthbar__sel">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="monthIndex <= 0"
          @click="shift(1)"
        >
          ›
        </button>
        <button class="btn btn--ghost btn--sm monthbar__now" @click="goMonth">本月</button>
      </div>

      <div v-else-if="mode === 'year'" class="monthbar">
        <button
          class="btn btn--ghost btn--sm"
          :disabled="years.indexOf(year) >= years.length - 1"
          @click="shiftYear(-1)"
        >
          ‹
        </button>
        <select v-model="year" class="field monthbar__sel">
          <option v-for="y in years" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="years.indexOf(year) <= 0"
          @click="shiftYear(1)"
        >
          ›
        </button>
        <button class="btn btn--ghost btn--sm monthbar__now" @click="goYear">今年</button>
      </div>

      <div v-else class="custom">
        <div class="custom__dates">
          <label class="custom__date">
            <span class="tiny muted">從</span>
            <DateField v-model="start" />
          </label>
          <label class="custom__date">
            <span class="tiny muted">到</span>
            <DateField v-model="end" />
          </label>
        </div>
        <div class="presets">
          <button
            v-for="p in PRESETS"
            :key="p.key"
            class="chip"
            :class="{ 'is-on': isPreset(p.key) }"
            @click="applyPreset(p.key)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <p class="tiny muted rangebar__sum">
        {{ rangeLabel }} · 共 {{ st.spanDays.value }} 天 · {{ st.rows.value.length }} 筆記錄
      </p>
    </div>

    <!-- 摘要（三張都可以點開看明細，0.1.22） -->
    <div class="sums">
      <button class="card sum" type="button" @click="sumOpen = 'expense'">
        <span class="tiny muted">支出</span>
        <strong class="num sum__exp">{{ fmtNum(st.expense.value) }}</strong>
        <span
          v-if="mom !== null"
          class="tiny"
          :class="mom > 0 ? 'up' : 'down'"
          :title="`前期 ${prevLabel}：${fmtMoney(st.prevExpense.value, base)}`"
        >
          較前期 {{ mom > 0 ? '+' : '' }}{{ (mom * 100).toFixed(0) }}%
        </span>
        <span v-else class="tiny muted">尚無前期可比較</span>
        <span class="sum__more" aria-hidden="true">明細 ›</span>
      </button>
      <button class="card sum" type="button" @click="sumOpen = 'income'">
        <span class="tiny muted">收入</span>
        <strong class="num sum__inc">{{ fmtNum(st.income.value) }}</strong>
        <span class="tiny muted">{{ st.incomeByCat.value.length }} 個來源</span>
        <span class="sum__more" aria-hidden="true">明細 ›</span>
      </button>
      <button class="card sum" type="button" @click="sumOpen = 'balance'">
        <span class="tiny muted">結餘</span>
        <strong class="num" :class="st.balance.value < 0 ? 'sum__exp' : 'sum__inc'">
          {{ fmtNum(st.balance.value) }}
        </strong>
        <span class="tiny muted">{{ st.rows.value.length }} 筆</span>
        <span class="sum__more" aria-hidden="true">明細 ›</span>
      </button>
    </div>

    <SumDetailSheet
      :open="sumOpen !== null"
      :title="sumDetail.title"
      :amount="sumDetail.amount"
      :tone="sumDetail.tone"
      :caption="sumDetail.caption"
      :rows="sumDetail.rows"
      :ranks="sumDetail.ranks"
      :rank-title="sumDetail.rankTitle"
      @close="sumOpen = null"
    />

    <div v-if="!st.rows.value.length" class="empty card">
      <p class="muted">{{ rangeLabel }} 沒有記錄</p>
      <p class="tiny muted">換個範圍，或先到主頁記一筆</p>
    </div>

    <template v-else>
      <!-- 分類佔比 -->
      <section class="card block">
        <header class="block__hd">
          <h2>分類佔比</h2>
          <div class="seg2">
            <button :class="{ 'is-on': donutType === 'expense' }" @click="donutType = 'expense'">
              支出
            </button>
            <button :class="{ 'is-on': donutType === 'income' }" @click="donutType = 'income'">
              收入
            </button>
          </div>
        </header>

        <div class="donutwrap">
          <div class="donut">
            <DonutChart :items="donutItems" :currency="base" />
            <div class="donut__center">
              <span class="tiny muted">{{ donutType === 'expense' ? '總支出' : '總收入' }}</span>
              <strong class="num">{{ fmtMoney(donutTotal, base) }}</strong>
            </div>
          </div>

          <ul class="cats">
            <li
              v-for="r in donutRows"
              :key="r.id"
              class="cat"
              :class="{ 'is-sub': r.depth > 0, 'is-pseudo': r.pseudo }"
              :style="{ paddingLeft: r.depth * 14 + 'px' }"
            >
              <!-- 有子分類才給展開鈕；沒有就用等寬的空白維持對齊 -->
              <button
                v-if="r.hasKids"
                type="button"
                class="cat__tw"
                :aria-expanded="r.open"
                :aria-label="`${r.open ? '收合' : '展開'}${r.name}的子分類`"
                @click="toggleCat(r.id)"
              >
                <svg class="cat__chev" :class="{ 'is-open': r.open }" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <span v-else class="cat__tw cat__tw--empty" aria-hidden="true" />

              <span
                class="cat__ic"
                :class="{ 'cat__ic--pseudo': r.pseudo }"
                :style="{ '--c': r.color, '--bg': withAlpha(r.color, 0.14) }"
              >
                <CategoryIcon v-if="!r.pseudo" :name="r.icon" :size="14" :stroke="1.9" />
              </span>

              <span class="cat__name">{{ r.name }}</span>
              <span class="cat__bar">
                <span
                  class="cat__fill"
                  :style="{ width: `${Math.max(2, r.ratio * 100)}%`, background: r.color }"
                />
              </span>
              <span class="cat__val num">{{ fmtMoney(r.total, base) }}</span>
              <span class="cat__pct num tiny muted">{{ (r.ratio * 100).toFixed(0) }}%</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- 每日 -->
      <section class="card block">
        <header class="block__hd"><h2>{{ dailyTitle }}</h2></header>
        <div class="chartbox chartbox--tall">
          <DailyChart :points="dailyPoints" :currency="base" />
        </div>
      </section>

      <!-- 趨勢 -->
      <section class="card block">
        <header class="block__hd"><h2>近六個月趨勢</h2></header>
        <div class="chartbox">
          <TrendChart :points="st.trend.value" :currency="base" />
        </div>
      </section>

      <!-- 前幾大支出 -->
      <section class="card block">
        <header class="block__hd"><h2>區間最大支出</h2></header>
        <ul class="tops">
          <li v-for="(r, i) in st.topRecords.value" :key="r.id" class="top">
            <span class="top__rank num">{{ i + 1 }}</span>
            <span class="top__cat">{{ settings.category(r.categoryId)?.name ?? '未分類' }}</span>
            <span class="top__note tiny muted">{{ r.note }}</span>
            <span class="top__amt num">{{ fmtMoney(r.baseAmount, r.baseCurrency) }}</span>
          </li>
        </ul>
        <p v-if="!st.topRecords.value.length" class="muted tiny">沒有支出記錄</p>
      </section>

      <!-- 區間記錄：每一筆都可點開看明細 -->
      <section class="card block">
        <header class="block__hd">
          <h2>區間記錄</h2>
          <span class="tiny muted">{{ st.rows.value.length }} 筆</span>
        </header>
        <RecordList
          :records="st.rows.value"
          :collapse-after="10"
          empty-text="這個範圍沒有記錄"
          @edit="openRecord"
          @remove="removeRecord"
        />
      </section>
    </template>

    <RecordSheet
      :open="!!editing"
      :record="editing"
      @close="editingId = null"
      @save="saveEdit"
      @remove="removeRecord"
    />
  </div>
</template>

<style scoped>
/* 標題右邊的幣別膠囊；.page-head 本身已是 space-between 的 flex */
.page-cur {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.03em;
}

.rangebar {
  padding: 12px 14px 13px;
  margin-bottom: 14px;
}
.rangebar__mode {
  align-self: flex-start;
}
.monthbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 11px;
}
.custom {
  margin-top: 11px;
}
.custom__dates {
  display: grid;
  /* 兩欄各佔一半 → 整列填滿：「從」貼左、「到」貼右，中間只留 10px 間隔。
     ⚠ 不要用 `max-content` + `space-between`（舊寫法）：那樣每欄寬度取決於
     **瀏覽器給原生日期框的內建寬度**，而 Chrome 與 iOS Safari 的日期格式不同
     （`10/07/2026` vs `2026/10/07`）→ 內建寬度不同 → 間隙忽大忽小，
     在 iPhone PWA 上看起來就是「走位」。固定 1fr 1fr 後兩欄寬度只跟容器有關，
     跨瀏覽器完全一致，也不會隨視窗寬度漂移。
     ⚠ 每欄至少要放得下原生日期框（13px ＋ 左右各 8px 內距 ≈ 141px）：
     375px 時每欄 150px 剛好夠（360px 只剩 142px，餘裕只有 1px 太冒險）；
     再窄就撐不住 → 交給下面的 media query 改成上下堆疊。
     `minmax(0, …)` 是保險：真的放不下時可以再縮，不會把卡片撐爆。 */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.custom__date {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
/* 兩欄的字級與內距收小一點，才塞得進手機的半寬。
   `.df` 是 DateField 的根（純文字框＋日曆鈕），`min-width: 0` 讓它可以被壓窄；
   ⚠ 用 :deep()：裡面的 input 是子元件的內容，不會帶到這一頁的 scope id。 */
.custom__date :deep(.df) {
  min-width: 0;
}
.custom__date :deep(.field) {
  min-width: 0;
  max-width: 100%;
  padding-left: 8px;
  /* ⚠ 右側留白一定要留給日曆鈕：DateField 的 `.df__in` 自帶 38px，
     這條是 `.custom__date .field[data-v]`（權重比子元件自己的 `.df__in` 高），
     寫 8px 會把那段留白蓋掉 → 日期文字跑到日曆鈕底下。 */
  padding-right: 38px;
  /* 13px：沿用 0.1.11「縮少一點」的決定（那時是為了塞進半欄）。
     改成純文字框之後沒有原生日期框的內建最小寬度了，13px 的 `2026/10/07`
     約 71px ＋ 左右 46px ＝ 117px，375px 時每欄 150px 綽綽有餘。 */
  font-size: 13px;
}
/* 超窄螢幕改成上下堆疊。
   門檻抓 375px（不是 360）：兩欄各佔一半時，每欄寬度 = (視窗 - 頁面左右 36 - 卡片左右 28 - 10) / 2，
   375px 剛好每欄 150px；再窄就逼近原生日期框的 141px 下限（360px 時只剩 1px 餘裕）→
   乾脆疊起來，每次都有滿版寬度可用。 */
@media (max-width: 374px) {
  .custom__dates {
    grid-template-columns: minmax(0, 1fr);
  }
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.chip.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.rangebar__sum {
  margin: 9px 0 0;
}
/* 日期選擇器（DateField）在這一列裡是可伸縮的那一格：
   它自己是 div，沒有 input 的內建寬度，要明說「可以長、也可以被壓」 */
.monthbar__sel.df {
  flex: 1 1 auto;
  min-width: 0;
}
.monthbar__sel {
  height: 38px;
  max-width: 180px;
}
/* 字級／粗細在裡面的 input 上（DateField 的子元件內容，要 :deep 才選得到） */
.monthbar__sel :deep(.field) {
  height: 38px;
  font-weight: 600;
}
/* 捷徑鈕（今天／本月／今年）：維持自然寬度，不要被窄版的 select 擠到變形 */
.monthbar__now {
  flex: none;
}

.sums {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 18px;
}
.sum {
  padding: 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  /* 現在是 <button>：把瀏覽器預設的外觀歸零，外觀完全由 .card 決定 */
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  position: relative;
  transition:
    transform 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}
/* 可按的提示：邊框微亮 + 輕微抬起 */
.sum:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.sum:active {
  transform: scale(0.985);
}
.sum:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* 右下角的「明細 ›」：不做成獨立鈕，只當可按的視覺提示 */
.sum__more {
  margin-top: 3px;
  font-size: 10.5px;
  font-weight: 650;
  color: var(--accent);
  opacity: 0.85;
}
.sum strong {
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sum .tiny {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sum__exp {
  color: var(--expense);
}
.sum__inc {
  color: var(--income);
}
.up {
  color: var(--expense);
}
.down {
  color: var(--income);
}

.block {
  padding: 16px;
  margin-bottom: 14px;
}
.block__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.block__hd h2 {
  font-size: 15.5px;
}
.seg2 {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface-3);
  border-radius: 10px;
}
.seg2 button {
  height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}
.seg2 button.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}

.donutwrap {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.donut {
  position: relative;
  width: 190px;
  height: 190px;
  margin: 0 auto;
}
.donut__center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  pointer-events: none;
}
.donut__center strong {
  font-size: 16px;
}

.cats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.cat {
  display: grid;
  grid-template-columns: 16px 22px 78px 1fr auto 34px;
  align-items: center;
  gap: 9px;
}
/* 展開／收合子分類的小箭頭；沒有子分類時用等寬空白維持對齊 */
.cat__tw {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
}
.cat__tw:hover {
  background: var(--surface-3);
  color: var(--accent);
}
.cat__tw--empty {
  pointer-events: none;
}
.cat__chev {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s;
}
.cat__chev.is-open {
  transform: rotate(90deg);
}
.cat.is-pseudo .cat__name {
  color: var(--text-3);
  font-weight: 500;
}
.cat__ic--pseudo {
  background: var(--surface-3);
}
.cat__ic {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  color: var(--c);
  background: var(--bg);
}
.cat__name {
  font-size: 13.5px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat__bar {
  height: 7px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.cat__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
}
.cat__val {
  font-size: 13.5px;
}
.cat__pct {
  text-align: right;
}

.chartbox {
  position: relative;
  height: 210px;
}
.chartbox--tall {
  height: 240px;
}

.tops {
  list-style: none;
  margin: 0;
  padding: 0;
}
.top {
  display: grid;
  grid-template-columns: 22px 74px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.top:last-child {
  border-bottom: 0;
}
.top__rank {
  color: var(--text-3);
  font-size: 12.5px;
}
.top__cat {
  font-weight: 550;
  font-size: 14px;
}
.top__note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top__amt {
  font-size: 14px;
}
.empty {
  padding: 32px;
  text-align: center;
}

@media (min-width: 420px) {
  .sum {
    padding: 13px 14px;
  }
  .sum strong {
    font-size: 18px;
  }
  .sums {
    gap: 12px;
  }
}
@media (min-width: 768px) {
  .donutwrap {
    flex-direction: row;
    align-items: center;
    gap: 28px;
  }
  .donut {
    width: 210px;
    height: 210px;
    flex: none;
  }
  .cats {
    flex: 1;
  }
  /* 第一欄要跟 .cat__ic 的尺寸一致（22px）；寫 9px 的話 22px 的圖示會溢出，
     右緣壓到分類名稱上 4px（同一行佈局才有的問題，窄版走上方的 22px 規則）
     最前面 16px 是子分類的展開箭頭 */
  .cat {
    grid-template-columns: 16px 22px 92px 1fr auto 40px;
  }
  .sums {
    gap: 14px;
  }
  .sum strong {
    font-size: 22px;
  }
  .top {
    grid-template-columns: 22px 92px 1fr auto;
  }
}
@media (min-width: 1024px) {
  .stats__two {
    display: grid;
  }
  .chartbox {
    height: 250px;
  }
}
</style>
