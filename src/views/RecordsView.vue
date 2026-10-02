<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import type { DateRange } from '@/composables/useStats'
import type { TxRecord } from '@/types'
import RecordList from '@/components/RecordList.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import { fmtMoney } from '@/lib/currency'
import {
  addDays,
  dayKey,
  formatRange,
  monthKey,
  monthRange,
  todayKey,
  todayUnit,
  unitKeys,
  unitLabel,
  unitRange,
  unitShort,
  type RangeUnit,
} from '@/lib/date'

const records = useRecordsStore()
const settings = useSettingsStore()
const toast = useToast()

const mode = ref<'unit' | 'custom'>('unit')
const unit = ref<RangeUnit>('day')
const span = ref<1 | 3>(1)
const key = ref(todayUnit('day'))
const start = ref(todayKey())
const end = ref(todayKey())

watch(unit, (u) => {
  key.value = todayUnit(u)
})

const units: { key: RangeUnit; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
]

const unitKeyList = computed(() => unitKeys(unit.value, key.value, span.value))

const range = computed<DateRange>(() => {
  if (mode.value === 'custom') {
    return start.value <= end.value
      ? { start: start.value, end: end.value }
      : { start: end.value, end: start.value }
  }
  const ks = unitKeyList.value
  return { start: unitRange(unit.value, ks[0]).start, end: unitRange(unit.value, ks[ks.length - 1]).end }
})

const rows = computed(() =>
  records.records
    .filter((r) => {
      const k = dayKey(r.occurredAt)
      return k >= range.value.start && k <= range.value.end
    })
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
)

const expense = computed(() =>
  rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
)
const income = computed(() =>
  rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
)

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

function setSpan(s: 1 | 3) {
  span.value = s
}

function goKey(k: string) {
  key.value = k
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
      <div>
        <h1 class="page-title">記錄</h1>
        <p class="page-sub">
          {{ formatRange(range.start, range.end) }} · {{ rows.length }} 筆 · 支出
          {{ fmtMoney(expense, settings.baseCurrency) }} / 收入
          {{ fmtMoney(income, settings.baseCurrency) }}
        </p>
      </div>
    </div>

    <div class="card rangebar">
      <div class="seg2 rangebar__mode">
        <button :class="{ 'is-on': mode === 'unit' }" @click="mode = 'unit'">依單位</button>
        <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
      </div>

      <template v-if="mode === 'unit'">
        <div class="ctl">
          <div class="seg2">
            <button v-for="u in units" :key="u.key" :class="{ 'is-on': unit === u.key }" @click="unit = u.key">
              {{ u.label }}
            </button>
          </div>
          <div class="seg2">
            <button :class="{ 'is-on': span === 1 }" @click="setSpan(1)">單一</button>
            <button :class="{ 'is-on': span === 3 }" @click="setSpan(3)">3 個</button>
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

        <div v-if="span === 3" class="keys">
          <button
            v-for="k in unitKeyList"
            :key="k"
            class="chip"
            :class="{ 'is-on': k === key }"
            @click="goKey(k)"
          >
            {{ unitShort(unit, k) }}
          </button>
        </div>
      </template>

      <template v-else>
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
          <button v-for="p in presets" :key="p.label" class="chip" @click="p.run()">
            {{ p.label }}
          </button>
        </div>
      </template>
    </div>

    <RecordList
      :records="rows"
      :show-time="true"
      empty-text="這個範圍沒有記錄"
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
.rangebar {
  padding: 12px 14px 13px;
  margin-bottom: 14px;
}
.rangebar__mode {
  align-self: flex-start;
}
.ctl {
  display: flex;
  gap: 8px;
  margin-top: 11px;
  flex-wrap: wrap;
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
.keys {
  display: flex;
  gap: 6px;
  margin-top: 10px;
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
</style>
