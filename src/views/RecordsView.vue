<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import type { DateRange } from '@/composables/useStats'
import type { TxRecord } from '@/types'
import RecordList from '@/components/RecordList.vue'
import RecordRow from '@/components/RecordRow.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import ClearableInput from '@/components/ClearableInput.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import HighlightText from '@/components/HighlightText.vue'
import { fmtMoney } from '@/lib/currency'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
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
/** 子分類顯示成「餐飲 › 早餐」，搜尋時打大類或子類都找得到 */
function catNameOf(categoryId: string) {
  return settings.category(categoryId) ? settings.fullNameOf(categoryId) : '未分類'
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

/* ── 檢視方式：逐筆 / 依分類 ────────────────────────────── */
const byCat = ref(false)
/** 切成分類檢視後，把日期分組收掉，避免兩種分組互相打架 */
const byCatOpen = ref<Set<string>>(new Set())

interface CatGroup {
  id: string
  name: string
  color: string
  icon: string
  exp: number
  inc: number
  list: TxRecord[]
}

/** 同一個分類的記錄集中在同一塊，依金額（支出＋收入）由多到少排 */
const catGroups = computed<CatGroup[]>(() =>
  [...rows.value.reduce((m, r) => {
    const list = m.get(r.categoryId)
    if (list) list.push(r)
    else m.set(r.categoryId, [r])
    return m
  }, new Map<string, TxRecord[]>())]
    .map(([id, list]) => {
      const c = settings.category(id)
      const sorted = [...list].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      const sum = (t: TxRecord['type']) =>
        sorted.reduce((s, r) => s + (r.type === t ? r.baseAmount : 0), 0)
      return {
        id,
        name: catNameOf(id),
        color: c?.color ?? '#8a857c',
        icon: c ? iconForCategory(c) : iconForCategory({ id: '', name: '' }),
        exp: sum('expense'),
        inc: sum('income'),
        list: sorted,
      }
    })
    .sort((a, b) => b.exp + b.inc - (a.exp + a.inc)),
)

/** 每組預設只露前 3 筆，想看全部再展開（同一個分類可能幾十筆） */
const CAT_PREVIEW = 3
function catOpen(id: string): boolean {
  return byCatOpen.value.has(id)
}
function toggleCatGroup(id: string) {
  if (byCatOpen.value.has(id)) byCatOpen.value.delete(id)
  else byCatOpen.value.add(id)
}
function visibleCat(row: CatGroup): TxRecord[] {
  return catOpen(row.id) ? row.list : row.list.slice(0, CAT_PREVIEW)
}

// 換範圍／篩選／關鍵字時把展開狀態清掉，免得殘留不相關的分類
watch([range, typeFilter, kw], () => {
  byCatOpen.value.clear()
})

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
      <!-- 標題與副標包成一塊垂直排列，搜尋框才推得到最右邊（副標才不會卡在中間） -->
      <div class="page-head__txt">
        <h1 class="page-title">記錄</h1>
        <p class="page-sub">收支帳目一覽</p>
      </div>

      <!-- 關鍵字搜尋：只比對備註與分類名稱，命中文字會在下方列表以黃底標示 -->
      <div class="search">
        <svg class="search__ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="6.4" />
          <path d="M15.6 15.6 20 20" />
        </svg>
        <ClearableInput v-model="q" placeholder="搜尋備註或分類" :maxlength="40" />
      </div>
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
          <!-- .grp 是直向排列，所以按鈕與段控要自己包一列才排得成橫的 -->
          <div class="grp__row">
          <!-- 依分類檢視的切換鈕：擺在「依單位／自訂範圍」左邊，跟範圍設定分開（兩者互不影響） -->
          <button
            type="button"
            class="bycat"
            :class="{ 'is-on': byCat }"
            :aria-pressed="byCat"
            :title="byCat ? '改為逐筆列出' : '改為依分類分組'"
            @click="byCat = !byCat"
          >
            <svg class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
              <path d="m3 12.4 9 4.5 9-4.5" />
              <path d="m3 16.9 9 4.5 9-4.5" />
            </svg>
            分類
          </button>
          <div class="seg2 rangebar__mode">
            <button :class="{ 'is-on': mode === 'unit' }" @click="mode = 'unit'">依單位</button>
            <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
          </div>
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

    <!-- 逐筆（依日期分組） -->
    <RecordList
      v-if="!byCat"
      :records="rows"
      :show-time="true"
      :empty-text="emptyText"
      :highlight="kw"
      @edit="editingId = $event"
      @remove="removeEditing($event)"
    />

    <!-- 依分類分組：每組顯示筆數與收支小計，預設只露前幾筆 -->
    <template v-else>
      <div v-if="!catGroups.length" class="empty card">
        <p class="muted">{{ emptyText }}</p>
      </div>

      <div v-for="g in catGroups" :key="g.id" class="catgrp">
        <div class="catgrp__head">
          <span class="catgrp__ic" :style="{ '--c': g.color, '--bg': withAlpha(g.color, 0.14) }">
            <CategoryIcon :name="g.icon" :size="15" :stroke="1.9" />
          </span>
          <span class="catgrp__name">
            <HighlightText :text="g.name" :query="kw" />
          </span>
          <span class="catgrp__n tiny muted">{{ g.list.length }} 筆</span>
          <span class="catgrp__rule"></span>
          <span class="catgrp__amt">
            <span v-if="g.inc > 0" class="catgrp__chip is-inc num">
              +{{ fmtMoney(g.inc, settings.baseCurrency) }}
            </span>
            <span v-if="g.exp > 0" class="catgrp__chip is-exp num">
              −{{ fmtMoney(g.exp, settings.baseCurrency) }}
            </span>
          </span>
        </div>

        <div class="card catgrp__card">
          <template v-for="(r, i) in visibleCat(g)" :key="r.id">
            <hr v-if="i > 0" class="divider" />
            <RecordRow
              :record="r"
              :show-time="true"
              :highlight="kw"
              @edit="editingId = $event"
              @remove="removeEditing($event)"
            />
          </template>
        </div>

        <button
          v-if="g.list.length > CAT_PREVIEW"
          class="btn btn--ghost btn--sm catgrp__more"
          @click="toggleCatGroup(g.id)"
        >
          {{ catOpen(g.id) ? '收合' : `顯示全部 ${g.list.length} 筆` }}
        </button>
      </div>
    </template>

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
/* 檢視那一組：切換鈕與「依單位／自訂範圍」橫向並排 */
.grp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.grp__row .rangebar__mode {
  align-self: auto;
}
.rangebar__mode {
  align-self: flex-start;
}
/* 「分類」切換鈕：外觀對齊 .seg2 的外框（3px 內距 → 高 34px），
   開啟時用墨綠淡底，一眼看得出目前是分類檢視 */
.bycat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.bycat:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.bycat.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.bycat__ic {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── 依分類分組 ────────────────────────────────────────── */
.catgrp {
  margin-bottom: 16px;
}
.catgrp__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 8px;
}
.catgrp__ic {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 8px;
  color: var(--c);
  background: var(--bg);
}
.catgrp__name {
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catgrp__n {
  flex: none;
}
.catgrp__rule {
  flex: 1;
  min-width: 10px;
  height: 1px;
  background: var(--line);
}
.catgrp__amt {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
}
.catgrp__chip {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}
.catgrp__chip.is-exp {
  color: var(--expense);
}
.catgrp__chip.is-inc {
  color: var(--income);
}
.catgrp__card {
  overflow: hidden;
}
.catgrp__more {
  display: flex;
  width: 100%;
  margin: 8px auto 0;
}
/* 與 RecordList 的 .empty 一致（那份是 scoped，這裡要自己一份） */
.empty {
  padding: 30px 18px;
  text-align: center;
}
.rangebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
/* 搜尋框移到標題列：靠右、與左邊的標題塊垂直居中 */
.page-head {
  align-items: center;
}
.page-head__txt {
  min-width: 0;
}
/* <p> 的 UA 預設下邊距會讓標題塊底部多 13px，置中的搜尋框看起來會偏低；
   只消掉最後一個元素的 margin-bottom，標題與副標之間的間距維持原樣 */
.page-head__txt > :last-child {
  margin-bottom: 0;
}
.search {
  position: relative;
  flex: 1;
  max-width: 280px;
  min-width: 0;
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
