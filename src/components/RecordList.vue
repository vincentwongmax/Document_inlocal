<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { dayKey, dayParts, monthKey } from '@/lib/date'
import RecordRow from './RecordRow.vue'

const props = withDefaults(
  defineProps<{
    records: TxRecord[]
    /** 顯示時間（同一天內多筆時有用） */
    showTime?: boolean
    /** 一開始只顯示前 N 筆，其餘用「顯示全部」展開（0 = 全部） */
    collapseAfter?: number
    emptyText?: string
    /** 搜尋關鍵字（已 trim 並轉小寫），往下傳給 RecordRow 做黃底高亮 */
    highlight?: string
    /**
     * 日期分組要用哪個時間：
     * - `occurred`（預設）＝交易發生時間，也就是使用者填的時間
     * - `created`＝記錄被新增的時間（記錄頁的「最近」檢視用）
     */
    dateBasis?: 'occurred' | 'created'
    /**
     * 分組方式（0.1.27）：
     * - `day`（預設）＝日曆小卡 ＋ 今天／昨天／週X
     * - `month`＝月標題（`2026年9月`）＋ 該月筆數。統計頁的**年**檢視用。
     */
    groupBy?: 'day' | 'month'
    /**
     * 分組標題上的「+收入／−支出」要用哪一份資料算（0.1.27）。
     *
     * ⚠ 預設跟 `records` 一樣（原本的行為）。但統計頁的「區間記錄」會傳**精選過的**
     *   子集合（例如每個月只留前 2 筆）——那時一定要把**完整清單**從這裡傳進來，
     *   否則標題上的金額只會加那 2 筆，看起來像「這個月只花了這樣」。
     */
    totalsFrom?: TxRecord[]
  }>(),
  {
    showTime: true,
    collapseAfter: 0,
    emptyText: '這個範圍沒有記錄',
    highlight: '',
    dateBasis: 'occurred',
    groupBy: 'day',
    totalsFrom: undefined,
  },
)
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>()

const settings = useSettingsStore()
const showAll = ref(false)

/** 這一筆要用哪個時間戳（分組、排序、日期標籤都用同一個來源，才不會互相打架） */
function timeOf(r: TxRecord): string {
  return props.dateBasis === 'created' ? r.createdAt : r.occurredAt
}

/** 這一筆屬於哪一組（依 groupBy 決定用「日」還是「月」當鍵） */
function keyOf(r: TxRecord): string {
  return props.groupBy === 'month' ? monthKey(timeOf(r)) : dayKey(timeOf(r))
}

/**
 * 每一組的「真實」加總與筆數。
 * ⚠ 用 `totalsFrom`（完整清單）算，不是用 `records`（可能被精選過）——
 *   這樣「每個月只顯示 2 筆」時，標題上的金額仍然是那個月的全額。
 * ⚠ 0.1.28：金額一律即時換算成「目前的主幣別」（`settings.toBase`），
 *   不是用記帳當下凍結的 `baseAmount` —— 主幣別改了，標題也要跟著變。
 * ⚠ 0.1.36：改成「顯示幣別」（旅行中＝旅行貨幣）；分組標題的小計與幣別符號都跟著。
 */
const totalsOf = computed(() => {
  const src = props.totalsFrom ?? props.records
  const m = new Map<string, { exp: number; inc: number; count: number }>()
  for (const r of src) {
    const k = keyOf(r)
    const cur = m.get(k) ?? { exp: 0, inc: 0, count: 0 }
    const v = settings.toDisplay(r.amount, r.currency)
    if (r.type === 'expense') cur.exp += v
    else cur.inc += v
    cur.count += 1
    m.set(k, cur)
  }
  return m
})

const groups = computed(() => {
  const m = new Map<string, TxRecord[]>()
  for (const r of props.records) {
    const k = keyOf(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  const thisMonth = monthKey(new Date().toISOString())
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => (timeOf(a) < timeOf(b) ? 1 : -1))
      const tot = totalsOf.value.get(key) ?? { exp: 0, inc: 0, count: list.length }
      return {
        key,
        parts: dayParts(timeOf(list[0])),
        /** 月檢視的標題：「2026年9月」拆成 { y: '2026', m: 9 } */
        month: props.groupBy === 'month' ? monthHeading(key) : null,
        /** 月檢視的「本月」標記 */
        isThisMonth: key === thisMonth,
        exp: tot.exp,
        inc: tot.inc,
        count: tot.count,
        list: sorted,
      }
    })
})

/** `2026-09` → `{ y: '2026', m: 9 }` */
function monthHeading(key: string): { y: string; m: number } {
  const [y, m] = key.split('-')
  return { y, m: Number(m) }
}

const total = computed(() => props.records.length)
const collapsed = computed(
  () => props.collapseAfter > 0 && !showAll.value && total.value > props.collapseAfter,
)

/** 摺疊時只顯示最新的前 N 筆（跨日分組計算） */
const visibleGroups = computed(() => {
  if (!collapsed.value) return groups.value
  let left = props.collapseAfter
  const out: typeof groups.value = []
  for (const g of groups.value) {
    if (left <= 0) break
    const slice = g.list.slice(0, left)
    if (slice.length) out.push({ ...g, list: slice })
    left -= slice.length
  }
  return out
})

watch(
  () => props.records,
  () => {
    showAll.value = false
  },
)
</script>

<template>
  <div class="list">
    <div v-if="!props.records.length" class="empty card">
      <p class="muted">{{ emptyText }}</p>
    </div>

    <template v-else>
      <div v-for="g in visibleGroups" :key="g.key" class="day">
        <div class="day__head">
          <!-- 日檢視：日曆小卡（日數大、月份小） -->
          <span v-if="groupBy === 'day'" class="day__cal">
            <b class="day__num num">{{ g.parts.num }}</b>
            <span class="day__mon">{{ g.parts.mon }}</span>
          </span>
          <!-- 月檢視（統計頁的「年」）：月標題（月大、年小），跟日曆小卡同一個位置與尺寸 -->
          <span v-else class="day__cal day__cal--mon">
            <b class="day__num num">{{ g.month?.m }}月</b>
            <span class="day__mon">{{ g.month?.y }}</span>
          </span>
          <span class="day__tag" :class="{ 'is-today': g.isThisMonth }">
            {{ groupBy === 'month' ? (g.isThisMonth ? '本月' : `${g.count} 筆`) : g.parts.tag }}
          </span>
          <span class="day__rule"></span>
          <span class="day__amt">
            <span v-if="g.inc > 0" class="day__chip is-inc num">
              +{{ fmtMoney(g.inc, settings.displayCurrency) }}
            </span>
            <span v-if="g.exp > 0" class="day__chip is-exp num">
              −{{ fmtMoney(g.exp, settings.displayCurrency) }}
            </span>
            <span v-if="g.inc === 0 && g.exp === 0" class="day__chip num">
              {{ fmtMoney(0, settings.displayCurrency) }}
            </span>
          </span>
        </div>
        <div class="card day__card">
          <template v-for="(r, i) in g.list" :key="r.id">
            <hr v-if="i > 0" class="divider" />
            <RecordRow
              :record="r"
              :show-time="showTime"
              :highlight="highlight"
              :time-recent="dateBasis === 'created'"
              @edit="emit('edit', $event)"
              @remove="emit('remove', $event)"
            />
          </template>
        </div>
      </div>

      <button v-if="collapsed" class="btn btn--ghost more" @click="showAll = true">
        顯示全部 {{ total }} 筆
      </button>
      <button
        v-else-if="collapseAfter > 0 && total > collapseAfter"
        class="btn btn--ghost more"
        @click="showAll = false"
      >
        只顯示最近 {{ collapseAfter }} 筆
      </button>
    </template>
  </div>
</template>

<style scoped>
.day {
  margin-bottom: 16px;
}
.day__head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 2px 8px;
}
.day__cal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-1);
  line-height: 1;
}
.day__num {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}
.day__mon {
  margin-top: 2px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-3);
}
/* 月標題（統計頁「年」檢視）：跟日曆小卡同一個位置與高度，
   但裝的是「9月 / 2026」——「月」字比純數字寬，所以字級略小一階才不會擠 */
.day__cal--mon .day__num {
  font-size: 14.5px;
}
.day__cal--mon .day__mon {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.day__tag {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-2);
  background: var(--surface-3);
}
.day__tag.is-today {
  color: var(--accent);
  background: var(--accent-soft);
}
.day__rule {
  flex: 1;
  min-width: 12px;
  height: 1px;
  background: var(--line);
}
.day__amt {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.day__chip {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.day__chip.is-exp {
  color: var(--expense);
}
.day__chip.is-inc {
  color: var(--income);
}
.day__card {
  overflow: hidden;
}
.empty {
  padding: 30px 18px;
  text-align: center;
}
.more {
  display: flex;
  width: 100%;
  margin: 2px auto 0;
}
</style>
