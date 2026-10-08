<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { notify } from '@/lib/alerts'
import type { DateRange } from '@/composables/useStats'
import type { TxRecord } from '@/types'
import RecordList from '@/components/RecordList.vue'
import RecordRow from '@/components/RecordRow.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import DateField from '@/components/DateField.vue'
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

const mode = ref<'unit' | 'custom'>('unit')
const unit = ref<RangeUnit>('day')
const key = ref(todayUnit('day'))
const start = ref(todayKey())
const end = ref(todayKey())

/** 收支篩選 */
const typeFilter = ref<'all' | 'expense' | 'income'>('all')

/**
 * 「最近」檢視：改用**記錄被新增的時間**（createdAt）查詢，而不是使用者填的交易時間。
 * 用途：今天才補登前幾天（甚至上個月）的發票時，用交易時間是找不到的，
 * 切成新增時間才看得到「我最近才輸入的那些」。
 */
const recent = ref(false)

/** 這個範圍／排序要用哪個時間戳；整頁（含列表分組）都靠它，才不會互相打架 */
function timeOf(r: TxRecord): string {
  return recent.value ? r.createdAt : r.occurredAt
}

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

/** 區間與筆數兩顆小標籤（依單位模式靠「日／月／年」右側，自訂範圍模式靠日期列下方）。
 *  開著「最近」時多一顆提示，否則光看區間看不出來是用哪個時間在查。 */
const rangeTags = computed(() => [
  ...(recent.value ? ['依新增時間'] : []),
  rangeText.value,
  `${rows.value.length} 筆`,
])

const rows = computed(() =>
  records.records
    .filter((r) => {
      const k = dayKey(timeOf(r))
      if (k < range.value.start || k > range.value.end) return false
      if (typeFilter.value !== 'all' && r.type !== typeFilter.value) return false
      if (!kw.value) return true
      const note = r.note ?? ''
      return (
        note.toLowerCase().includes(kw.value) || catNameOf(r.categoryId).toLowerCase().includes(kw.value)
      )
    })
    .sort((a, b) => (timeOf(a) < timeOf(b) ? 1 : -1)),
)

/** 有在搜尋時，空列表的文案要帶出關鍵字，否則看不出是「找不到」還是「這個範圍本來就沒有」 */
const emptyText = computed(() => {
  if (kw.value) return `找不到符合「${q.value.trim()}」的記錄`
  return recent.value ? '這段時間沒有新增的記錄' : '這個範圍沒有記錄'
})

/* ── 檢視方式：逐筆 / 依分類 ────────────────────────────── */
const byCat = ref(false)
/** 切成分類檢視後，把日期分組收掉，避免兩種分組互相打架 */
const byCatOpen = ref<Set<string>>(new Set())

/** 某個分類底下掛著的金額（用來做子分類小計） */
interface SubTotal {
  id: string
  name: string
  exp: number
  inc: number
}

interface CatGroup {
  /** 大類（根分類）的 id */
  id: string
  name: string
  color: string
  icon: string
  exp: number
  inc: number
  list: TxRecord[]
  /** 子分類小計；大類自己身上的金額以「未細分」放在最後 */
  subs: SubTotal[]
}

/**
 * 依「大類」分組：子分類的記錄一律歸到它最上層的大類去，
 * 所以「交通」與「交通 › 巴士」會在同一組，不會被拆開。
 */
const catGroups = computed<CatGroup[]>(() => {
  const m = new Map<string, TxRecord[]>()
  for (const r of rows.value) {
    // 沒有上層就是自己；資料異常查不到時退回自己的 id，至少不會消失
    const root = settings.pathOf(r.categoryId)[0]?.id ?? r.categoryId
    const list = m.get(root)
    if (list) list.push(r)
    else m.set(root, [r])
  }

  return [...m.entries()]
    .map(([rootId, list]) => {
      const c = settings.category(rootId)
      const sorted = [...list].sort((a, b) => (timeOf(a) < timeOf(b) ? 1 : -1))

      // 先把每一筆按它自己的分類累加，才知道各子分類佔多少
      const per = new Map<string, { exp: number; inc: number }>()
      for (const r of sorted) {
        const cur = per.get(r.categoryId) ?? { exp: 0, inc: 0 }
        // 0.1.28：即時換算成目前的主幣別（不用記帳當下凍結的 baseAmount）
        const v = settings.toBase(r.amount, r.currency)
        if (r.type === 'expense') cur.exp += v
        else cur.inc += v
        per.set(r.categoryId, cur)
      }
      const sumOf = (pick: (v: { exp: number; inc: number }) => number) =>
        [...per.values()].reduce((s, v) => s + pick(v), 0)

      const subs: SubTotal[] = [...per.entries()]
        .filter(([id]) => id !== rootId)
        .map(([id, v]) => ({ id, name: settings.category(id)?.name ?? '未分類', ...v }))
        .sort((a, b) => b.exp + b.inc - (a.exp + a.inc))

      // 直接記在大類上的金額：有子分類時補一列「未細分」放最後，數字才對得起來
      const own = per.get(rootId)
      if (own && subs.length) subs.push({ id: rootId + '__own', name: '未細分', ...own })

      return {
        id: rootId,
        name: c?.name ?? '未分類',
        color: c?.color ?? '#8a857c',
        icon: c ? iconForCategory(c) : iconForCategory({ id: '', name: '' }),
        exp: sumOf((v) => v.exp),
        inc: sumOf((v) => v.inc),
        list: sorted,
        subs,
      }
    })
    .sort((a, b) => b.exp + b.inc - (a.exp + a.inc))
})

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

// 換範圍／篩選／關鍵字／時間基準時把展開狀態清掉，免得殘留不相關的分類
watch([range, typeFilter, kw, recent], () => {
  byCatOpen.value.clear()
})

// 0.1.28：即時換算成目前的主幣別（使用者：主幣別改了，記錄也要跟著變）
const expense = computed(() =>
  rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + settings.toBase(r.amount, r.currency), 0),
)
const income = computed(() =>
  rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + settings.toBase(r.amount, r.currency), 0),
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
  notify('已更新', 'ok')
}

function removeEditing(id: string) {
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
      <!-- 兩列：上面「檢視」（分類／最近），下面「篩選」（收支切換在左、範圍切換推到最右） -->
      <div class="rangebar__top">
        <div class="grp">
          <span class="grp__label">檢視</span>
          <!-- .grp 是直向排列，所以按鈕要自己包一列才排得成橫的 -->
          <div class="grp__row">
            <!-- 依分類檢視的切換鈕 -->
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
            <!-- 時間基準：切到「最近」＝用新增時間查詢（補登舊帳時用交易時間找不到）
                 ⚠ 0.1.29：移到這一列的最右邊，並改成醒目的墨綠（使用者指定） -->
            <button
              type="button"
              class="bycat bycat--recent"
              :class="{ 'is-on': recent }"
              :aria-pressed="recent"
              :title="recent ? '改回依交易時間查詢' : '改為依新增時間查詢（不是交易時間）'"
              @click="recent = !recent"
            >
              <svg class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.4" />
                <path d="M12 7.4V12l3.1 1.9" />
              </svg>
              最近
            </button>
          </div>
        </div>

        <div class="grp">
          <span class="grp__label">篩選</span>
          <div class="grp__row grp__row--split">
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
            <!-- 範圍切換：跟收支篩選同一列，但推到最右邊 -->
            <div class="seg2 rangebar__mode">
              <button :class="{ 'is-on': mode === 'unit' }" @click="mode = 'unit'">依單位</button>
              <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
            </div>
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
            <DateField v-model="start" />
          </label>
          <label class="custom__date">
            <span class="grp__label">到</span>
            <DateField v-model="end" />
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
      :date-basis="recent ? 'created' : 'occurred'"
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

        <!-- 子分類明細：一眼看出這個大類的錢花在哪個子分類 -->
        <div v-if="g.subs.length" class="catgrp__subs">
          <span v-for="s in g.subs" :key="s.id" class="subchip">
            <span class="subchip__n"><HighlightText :text="s.name" :query="kw" /></span>
            <span v-if="s.exp > 0" class="subchip__v num is-exp">
              −{{ fmtMoney(s.exp, settings.baseCurrency) }}
            </span>
            <span v-if="s.inc > 0" class="subchip__v num is-inc">
              +{{ fmtMoney(s.inc, settings.baseCurrency) }}
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
              :time-prefix="recent ? '交易' : ''"
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
/* 檢視／篩選各自一列（直向堆疊），手機上不會兩組擠在同一列 */
.grp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* 篩選那一列：收支段控靠左，「依單位／自訂範圍」推到最右邊 */
.grp__row--split .rangebar__mode {
  margin-left: auto;
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
/**
 * 0.1.29：「最近」（＝依新增時間查詢）的按鈕改成醒目的，並移到這一列的最右邊。
 * 使用者原話：「檢視的按鈕中的最近的按鈕，把這個依新增時間的按鈕移動到這一行的最右邊，
 * 按鈕改成醒目的顏色(要和主題合)」。
 *
 * 為什麼要醒目：這顆按鈕會**改變整個清單在查的時間基準**（交易時間 ↔ 新增時間），
 * 按了之後內容會整批換掉，是這一頁最容易被誤觸、又最需要看得見的開關 ——
 * 以前跟旁邊的「分類」長得一模一樣，很容易沒注意到它開著。
 *
 * 顏色的選擇（和主題合）：
 *   - 沒開啟 → 淡綠底＋墨綠字（`--accent-soft`／`--accent`，跟分類佔比、統計頁的綠同一套）
 *   - 開啟   → **實心墨綠＋白字**（跟 `.btn--primary` 完全同一組顏色）
 *     全站只有這顆切換鈕用實心綠，所以「它開著」一眼就看得出來。
 */
.bycat--recent {
  margin-left: auto;
}
.bycat--recent:not(.is-on) {
  background: var(--accent-soft);
  border-color: var(--accent-light);
  color: var(--accent);
}
.bycat--recent.is-on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.bycat--recent.is-on:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: #fff;
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
/* 子分類小計：標題下方一行 chips，超出就換行 */
.catgrp__subs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px 9px;
}
.subchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
}
.subchip__n {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subchip__v {
  font-size: 11.5px;
  font-weight: 700;
}
.subchip__v.is-exp {
  color: var(--expense);
}
.subchip__v.is-inc {
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
  flex-direction: column;
  gap: 10px;
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
  max-width: 200px;
  min-width: 0;
}
.search__ic {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.7;
  stroke-linecap: round;
  pointer-events: none;
  /* ⚠ 一定要有 z-index：ClearableInput 的 `.cf` 是 position:relative 且排在這個 svg 後面，
     兩者 z-index 都是 auto 時「後面的勝」→ 白色輸入框會把放大鏡整個蓋掉（一直以來都看不到，
     左邊卻仍留著 30px 內距，看起來就是文字莫名縮排）。 */
  z-index: 1;
}
/* 搜尋框比一般 .field 小一號（42 → 34px），擺在標題旁邊才不會太笨重。
   ⚠ ClearableInput 自己也有 `.cf__in`／`.cf__x` 的同名樣式，特異度跟
   `.search :deep(.cf__in)` 一樣是 (0,2,0)，**誰贏取決於打包順序**——
   所以這裡刻意多帶一個 class（`.field.cf__in`）或一層（`.cf .cf__x`）把特異度拉高，
   不然 padding-right 與清空鈕的尺寸會被它蓋回去。
   左側讓開放大鏡、右側讓開清空鈕（22px 鈕 + 6px 邊距 + 4px 間隙）。
   ⚠⚠ 字級 16px 是 0.1.25 的全站約定（見 src/style.css）：iOS 對 < 16px 的可編輯元素
   會 focus zoom，而那個縮放 blur 後不保證還原 → 使用者「點過輸入框之後，
   連點空白處頁面就往上滑」。**這裡曾經是 13px，不能再改回去** ——
   搜尋框是「會叫出鍵盤」的輸入框，跟 `<select>` 那種原生滾輪不一樣。
   （`.field.cf__in` 的特異度 (0,2,0) 現在其實輸給 style.css 那條 (0,5,1)，
   這裡明寫 16px 是為了讓「意圖」看得見，不是靠別處的規則默默生效。） */
.search :deep(.field.cf__in) {
  height: 34px;
  min-height: 34px;
  padding-left: 30px;
  padding-right: 32px;
  font-size: 16px;
  border-radius: 10px;
}
.search :deep(.cf .cf__x) {
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 7px;
}
.search :deep(.cf__x svg) {
  width: 13px;
  height: 13px;
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
/* ⚠ 用 :deep()：DateField 是子元件，它裡面的 input 不會帶到這一頁的 scope id，
   直接寫 `.custom__date .field` 會選不到 */
.custom__date :deep(.field) {
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
  padding: 0 10px;
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
