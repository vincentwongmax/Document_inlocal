<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { useStats, type DateRange } from '@/composables/useStats'
import { fmtMoney } from '@/lib/currency'
import { addDays, dayKey, formatRange, monthKey, monthLabel, monthRange, todayKey } from '@/lib/date'
import DonutChart from '@/components/charts/DonutChart.vue'
import TrendChart from '@/components/charts/TrendChart.vue'
import DailyChart from '@/components/charts/DailyChart.vue'

const settings = useSettingsStore()
const records = useRecordsStore()

/* ── 區間選擇 ───────────────────────────────────────────── */
const mode = ref<'month' | 'custom'>('month')
const month = ref(monthKey(new Date().toISOString()))
const start = ref(monthRange(month.value).start)
const end = ref(monthRange(month.value).end)

const range = computed<DateRange>(() => {
  if (mode.value === 'month') return monthRange(month.value)
  return start.value <= end.value
    ? { start: start.value, end: end.value }
    : { start: end.value, end: start.value }
})

const st = useStats(range)
const base = computed(() => settings.baseCurrency)

const months = computed(() => st.monthList(24))
const monthIndex = computed(() => months.value.indexOf(month.value))
function shift(delta: number) {
  const i = monthIndex.value
  if (i < 0) return
  const next = months.value[i + delta]
  if (next) month.value = next
}

/** 月份下拉與自訂日期互相同步，切換模式不會跳掉 */
watch(
  month,
  (m) => {
    const r = monthRange(m)
    start.value = r.start
    end.value = r.end
  },
  { immediate: true },
)

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

const donutType = ref<'expense' | 'income'>('expense')
const donutItems = computed(() =>
  donutType.value === 'expense' ? st.expenseByCat.value : st.incomeByCat.value,
)
const donutTotal = computed(() => donutItems.value.reduce((s, i) => s + i.total, 0))

const dailyPoints = computed(() => st.daily.value)
const dailyTitle = computed(() => (st.granularity.value === 'month' ? '每月收支' : '每日收支'))

const mom = computed(() => st.momChange.value)
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
    </div>

    <!-- 區間選擇 -->
    <div class="card rangebar">
      <div class="seg2 rangebar__mode">
        <button :class="{ 'is-on': mode === 'month' }" @click="mode = 'month'">月份</button>
        <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
      </div>

      <div v-if="mode === 'month'" class="monthbar">
        <button class="btn btn--ghost btn--sm" :disabled="monthIndex <= 0" @click="shift(-1)">
          ‹
        </button>
        <select v-model="month" class="field monthbar__sel">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="monthIndex >= months.length - 1"
          @click="shift(1)"
        >
          ›
        </button>
      </div>

      <div v-else class="custom">
        <div class="custom__dates">
          <label class="custom__date">
            <span class="tiny muted">從</span>
            <input v-model="start" class="field" type="date" />
          </label>
          <label class="custom__date">
            <span class="tiny muted">到</span>
            <input v-model="end" class="field" type="date" />
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

    <!-- 摘要 -->
    <div class="sums">
      <div class="card sum">
        <span class="tiny muted">支出</span>
        <strong class="num sum__exp">{{ fmtMoney(st.expense.value, base) }}</strong>
        <span
          v-if="mom !== null"
          class="tiny"
          :class="mom > 0 ? 'up' : 'down'"
          :title="`前期 ${prevLabel}：${fmtMoney(st.prevExpense.value, base)}`"
        >
          較前期 {{ mom > 0 ? '+' : '' }}{{ (mom * 100).toFixed(0) }}%
        </span>
      </div>
      <div class="card sum">
        <span class="tiny muted">收入</span>
        <strong class="num sum__inc">{{ fmtMoney(st.income.value, base) }}</strong>
        <span class="tiny muted">{{ st.incomeByCat.value.length }} 個來源</span>
      </div>
      <div class="card sum">
        <span class="tiny muted">結餘</span>
        <strong class="num" :class="st.balance.value < 0 ? 'sum__exp' : 'sum__inc'">
          {{ fmtMoney(st.balance.value, base) }}
        </strong>
        <span class="tiny muted">{{ st.rows.value.length }} 筆</span>
      </div>
    </div>

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
            <li v-for="c in donutItems" :key="c.id" class="cat">
              <span class="cat__dot" :style="{ background: c.color }" />
              <span class="cat__name">{{ c.name }}</span>
              <span class="cat__bar">
                <span class="cat__fill" :style="{ width: `${Math.max(2, c.ratio * 100)}%`, background: c.color }" />
              </span>
              <span class="cat__val num">{{ fmtMoney(c.total, base) }}</span>
              <span class="cat__pct num tiny muted">{{ (c.ratio * 100).toFixed(0) }}%</span>
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
    </template>
  </div>
</template>

<style scoped>
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
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.custom__date {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.custom__date .field {
  min-width: 0;
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
.monthbar__sel {
  height: 38px;
  max-width: 180px;
  font-weight: 600;
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
  grid-template-columns: 9px 84px 1fr auto 34px;
  align-items: center;
  gap: 9px;
}
.cat__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
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
  .cat {
    grid-template-columns: 9px 100px 1fr auto 40px;
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
