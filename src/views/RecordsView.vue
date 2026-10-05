<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import type { DateRange } from '@/composables/useStats'
import type { TxRecord } from '@/types'
import RecordList from '@/components/RecordList.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import ClearableInput from '@/components/ClearableInput.vue'
import { fmtMoney } from '@/lib/currency'
import {
  addDays,
  dayKey,
  formatRange,
  monthKey,
  monthRange,
  todayKey,
  todayUnit,
  unitLabel,
  unitRange,
  type RangeUnit,
} from '@/lib/date'

const records = useRecordsStore()
const settings = useSettingsStore()
const toast = useToast()

const mode = ref<'unit' | 'custom'>('unit')
const unit = ref<RangeUnit>('day')
const key = ref(todayUnit('day'))
const start = ref(todayKey())
const end = ref(todayKey())

/** 收支篩選 */
const typeFilter = ref<'all' | 'expense' | 'income'>('all')

/** 關鍵字搜尋：只比對「備註」與「分類名稱」 */
const q = ref('')
/** trim + 轉小寫後的關鍵字（空字串代表沒在搜尋） */
const kw = computed(() => q.value.trim().toLowerCase())

/** 記錄所屬分類的顯示名稱（未分類也要能被搜尋到，所以用同一個 fallback） */
function catNameOf(categoryId: string) {
  return settings.category(categoryId)?.name ?? '未分類'
}

watch(unit, (u) => {
  key.value = todayUnit(u)
})

const units: { key: RangeUnit; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
]

/**
 * 依單位算出的區間一律只有「目前選定的那一個單位」：
 * 日 = 使用者選的那一天、月 = 那一個月、年 = 那一年。
 */
const range = computed<DateRange>(() => {
  if (mode.value === 'custom') {
    return start.value <= end.value
      ? { start: start.value, end: end.value }
      : { start: end.value, end: start.value }
  }
  return unitRange(unit.value, key.value)
})

const rangeText = computed(() =>
  range.value.start === range.value.end
    ? range.value.start.replace(/-/g, '/')
    : formatRange(range.value.start, range.value.end),
)

/** 區間與筆數兩顆小標籤（依單位模式靠「日／月／年」右側，自訂範圍模式靠日期列下方） */
const rangeTags = computed(() => [rangeText.value, `${rows.value.length} 筆`])

const rows = computed(() =>
  records.records
    .filter((r) => {
      const k = dayKey(r.occurredAt)
      if (k < range.value.start || k > range.value.end) return false
      if (typeFilter.value !== 'all' && r.type !== typeFilter.value) return false
      if (!kw.value) return true
      const note = r.note ?? ''
      return (
        note.toLowerCase().includes(kw.value) || catNameOf(r.categoryId).toLowerCase().includes(kw.value)
      )
    })
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
)

/** 有在搜尋時，空列表的文案要帶出關鍵字，否則看不出是「找不到」還是「這個範圍本來就沒有」 */
const emptyText = computed(() =>
  kw.value ? `找不到符合「${q.value.trim()}」的記錄` : '這個範圍沒有記錄',
)

const expense = computed(() =>
  rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
)
const income = computed(() =>
  rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
)
const net = computed(() => income.value - expense.value)

function shiftUnit(delta: number) {
  if (unit.value === 'day') key.value = addDays(key.value, delta)
  else if (unit.value === 'month') key.value = shiftMonthKey(key.value, delta)
  else key.value = String(Number(key.value) + delta)
}

function shiftMonthKey(k: string, delta: number): string {
  const [y, m] = k.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function goToday() {
  key.value = todayUnit(unit.value)
  mode.value = 'unit'
}

/* ── 自訂範圍快捷 ───────────────────────────────────────── */
function applyCustom(s: string, e: string) {
  start.value = s
  end.value = e
  mode.value = 'custom'
}
const today = computed(() => todayKey())
const y = computed(() => today.value.slice(0, 4))

const presets = computed(() => [
  { label: '近 7 天', run: () => applyCustom(addDays(today.value, -6), today.value) },
  { label: '近 30 天', run: () => applyCustom(addDays(today.value, -29), today.value) },
  {
    label: '本月',
    run: () => {
      const r = monthRange(monthKey(new Date().toISOString()))
      applyCustom(r.start, r.end)
    },
  },
  { label: '今年', run: () => applyCustom(`${y.value}-01-01`, `${y.value}-12-31`) },
  {
    label: '全部',
    run: () => {
      const first = records.records.reduce<string | null>((min, r) => {
        const k = dayKey(r.occurredAt)
        return !min || k < min ? k : min
      }, null)
      applyCustom(first ?? `${y.value}-01-01`, today.value)
    },
  },
])

/* ── 單筆明細 ───────────────────────────────────────────── */
const editingId = ref<string | null>(null)
const editing = computed(() => records.records.find((r) => r.id === editingId.value) ?? null)

function saveEdit(patch: Partial<TxRecord>) {
  if (editingId.value) records.update(editingId.value, patch)
  editingId.value = null
  toast.push('已更新', 'ok')
}

function removeEditing(id: string) {
  const r = records.records.find((x) => x.id === id)
  records.remove(id)
  editingId.value = null
  toast.push('已刪除', 'info', {
    label: '復原',
    run: () => {
      if (r) records.restore(r)
    },
  })
}
</script>

<template>
  <div class="page records">
    <div class="page-head">
      <h1 class="page-title">記錄</h1>
      <p class="page-sub">收支帳目一覽</p>
    </div>

    <!-- 區間總覽 -->
    <div class="card sum">
      <div class="sum__grid">
        <div class="sum__col">
          <span class="sum__label"><i class="sum__dot sum__dot--exp"></i>支出</span>
          <span class="sum__val num is-exp">{{ fmtMoney(expense, settings.baseCurrency) }}</span>
        </div>
        <div class="sum__col">
          <span class="sum__label"><i class="sum__dot sum__dot--inc"></i>收入</span>
          <span class="sum__val num is-inc">{{ fmtMoney(income, settings.baseCurrency) }}</span>
        </div>
        <div class="sum__col">
          <span class="sum__label">結餘</span>
          <span class="sum__val num" :class="net >= 0 ? 'is-inc' : 'is-exp'">
            {{ fmtMoney(net, settings.baseCurrency) }}
          </span>
        </div>
      </div>
    </div>

    <div class="card rangebar">
      <div class="rangebar__top">
        <div class="grp">
          <span class="grp__label">檢視</span>
          <div class="seg2 rangebar__mode">
            <button :class="{ 'is-on': mode === 'unit' }" @click="mode = 'unit'">依單位</button>
            <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
          </div>
        </div>

        <div class="grp">
          <span class="grp__label">篩選</span>
          <div class="seg2">
            <button :class="{ 'is-on': typeFilter === 'all' }" @click="typeFilter = 'all'">全部</button>
            <button
              :class="{ 'is-on': typeFilter === 'expense' }"
              class="seg2--exp"
              @click="typeFilter = 'expense'"
            >
              支出
            </button>
            <button
              :class="{ 'is-on': typeFilter === 'income' }"
              class="seg2--inc"
              @click="typeFilter = 'income'"
            >
              收入
            </button>
          </div>
        </div>
      </div>

      <!-- 關鍵字搜尋：只比對備註與分類名稱，命中文字會在下方列表以黃底標示 -->
      <div class="search">
        <svg class="search__ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="6.4" />
          <path d="M15.6 15.6 20 20" />
        </svg>
        <ClearableInput v-model="q" placeholder="搜尋備註或分類" :maxlength="40" />
      </div>

      <template v-if="mode === 'unit'">
        <div class="ctl">
          <div class="grp">
            <span class="grp__label">週期</span>
            <div class="seg2">
              <button v-for="u in units" :key="u.key" :class="{ 'is-on': unit === u.key }" @click="unit = u.key">
                {{ u.label }}
              </button>
            </div>
          </div>
          <!-- 區間與筆數：擺在日／月／年這一列的最右邊 -->
          <div class="rangeinfo">
            <span v-for="t in rangeTags" :key="t" class="rangetag">{{ t }}</span>
          </div>
        </div>

        <div class="nav">
          <button class="btn btn--ghost btn--sm" @click="shiftUnit(-1)">‹</button>
          <span class="nav__label">{{ unitLabel(unit, key) }}</span>
          <button class="btn btn--ghost btn--sm" @click="shiftUnit(1)">›</button>
          <button class="btn btn--ghost btn--sm nav__today" @click="goToday">
            {{ unit === 'day' ? '今天' : unit === 'month' ? '本月' : '今年' }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="custom__dates">
          <label class="custom__date">
            <span class="grp__label">從</span>
            <input v-model="start" class="field" type="date" />
          </label>
          <label class="custom__date">
            <span class="grp__label">到</span>
            <input v-model="end" class="field" type="date" />
          </label>
          <!-- 自訂範圍沒有「日／月／年」那一列，標籤改放在日期列下方靠右 -->
          <div class="rangeinfo rangeinfo--end">
            <span v-for="t in rangeTags" :key="t" class="rangetag">{{ t }}</span>
          </div>
        </div>
        <div class="presets">
          <button v-for="p in presets" :key="p.label" class="chip" @click="p.run()">
            {{ p.label }}
          </button>
        </div>
      </template>
    </div>

    <RecordList
      :records="rows"
      :show-time="true"
      :empty-text="emptyText"
      :highlight="kw"
      @edit="editingId = $event"
      @remove="removeEditing($event)"
    />

    <RecordSheet
      :open="!!editing"
      :record="editing"
      @close="editingId = null"
      @save="saveEdit"
      @remove="removeEditing"
    />
  </div>
</template>

<style scoped>
.sum {
  position: relative;
  overflow: hidden;
  padding: 16px;
  margin-bottom: 14px;
}
.sum::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--expense));
}
.sum__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sum__col {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.sum__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.sum__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.sum__dot--exp {
  background: var(--expense);
}
.sum__dot--inc {
  background: var(--income);
}
.sum__val {
  font-size: 17px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sum__val.is-exp {
  color: var(--expense);
}
.sum__val.is-inc {
  color: var(--income);
}
@media (max-width: 519px) {
  .sum__val {
    font-size: 15px;
  }
}

.grp {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.grp__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}

.rangebar {
  padding: 12px 14px 13px;
  margin-bottom: 14px;
}
.rangebar__mode {
  align-self: flex-start;
}
.rangebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.search {
  position: relative;
  margin-top: 11px;
}
.search__ic {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 17px;
  height: 17px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.7;
  stroke-linecap: round;
  pointer-events: none;
}
/* 左側讓開放大鏡；右側 ClearableInput 已自留 40px 給清空鈕 */
.search :deep(.cf__in) {
  padding-left: 36px;
}
.ctl {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 11px;
  flex-wrap: wrap;
}
/* 區間／筆數標籤：推到「日／月／年」這一列的最右邊。
   下緣留 3px 是因為 .seg2 有 3px 內距，實際按鈕是內縮的；
   不補的話標籤會比左側按鈕低 3px，看起來不在同一列。 */
.ctl .rangeinfo {
  margin-left: auto;
  margin-bottom: 3px;
}
.rangeinfo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* 自訂範圍模式：標籤單獨一列、靠右對齊 */
.rangeinfo--end {
  grid-column: 1 / -1;
  justify-content: flex-end;
}
/* 與左邊的日／月／年按鈕完全同級：13px／600／28px／左右 14px、沿用內文字體
   （刻意不加 .num 的等寬數字字體，那會讓右側看起來與左邊不是同一套字） */
.rangetag {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: normal;
  color: var(--text-2);
  background: var(--surface-3);
  border-radius: 999px;
  white-space: nowrap;
}
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.nav__label {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 14.5px;
  font-weight: 650;
}
.nav__today {
  flex: none;
}
.chip {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
  white-space: nowrap;
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
.custom__dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 11px;
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
.presets .chip {
  flex: none;
  padding: 0 12px;
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
  padding: 0 14px;
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
.seg2 .seg2--exp.is-on {
  color: var(--expense);
}
.seg2 .seg2--inc.is-on {
  color: var(--income);
}
</style>
