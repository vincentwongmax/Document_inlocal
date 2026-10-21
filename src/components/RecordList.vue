<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
    /**
     * 0.1.54：開「視窗化」（Facebook 那種貼文牆）。
     *
     * 使用者原話：「如果太多內容也要回收上方的記錄（用戶看不到的畫面），
     * 當用戶往回滑的時候，又再刷新顯示，要做到 Facebook 那種往上往下滑貼文的效果」。
     *
     * 只有**記錄頁的 PWA（窄螢幕）**會開；統計頁／電腦版維持原本的全部渲染
     * （預設 false ＝ 零行為變化）。做法見下面的 `vis`／`heights`。
     */
    virtual?: boolean
    /** 0.1.69：時間標籤改顯示實際時間（'off' | 'time' | 'datetime'），往 RecordRow 傳 */
    absTime?: 'off' | 'time' | 'd' | 'md' | 'full'
  }>(),
  {
    showTime: true,
    collapseAfter: 0,
    emptyText: '這個範圍沒有記錄',
    highlight: '',
    dateBasis: 'occurred',
    groupBy: 'day',
    totalsFrom: undefined,
    virtual: false,
    absTime: 'off',
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
 * ⚠ 0.1.53：改用記錄自己凍結的匯率（`displayOf`）——已記錄數據的匯率是固定的。
 */
const totalsOf = computed(() => {
  const src = props.totalsFrom ?? props.records
  const m = new Map<string, { exp: number; inc: number; count: number }>()
  for (const r of src) {
    const k = keyOf(r)
    const cur = m.get(k) ?? { exp: 0, inc: 0, count: 0 }
    const v = settings.displayOf(r)
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

/* ── 0.1.54：視窗化（只有 `virtual` 為 true 時才動）───────────────────────
 *
 * 以「**一天**」為一個區塊（`.dayblk`）：
 * - 在視窗附近（上下各 `VIRTUAL_SLACK`＝300px）的區塊 → 正常渲染；
 * - 離開的區塊 → 換成一個**等高**的空白 div（高度＝上次量到的真實高度）
 *   → **文件總高不變**，捲動位置不會跳，DOM 節點則被回收（這就是「回收上方記錄」）；
 * - 往回滑時它又進入範圍 → 重新渲染（「又再刷新顯示」）。
 *
 * ⚠ 高度為什麼要用「量過的」而不是估算：
 *   上方區塊的時間一定**已經被渲染過**（使用者是滑過去的）→ 有精確高度 →
 *   換成空白 div 後文件總高完全不變 → 不會抖。
 *   還沒量過的區塊一定在**視窗下方**，用估算高度撐著；它後來被渲染時高度才變準，
 *   而那個變化發生在視窗下方，不會推動使用者正在看的內容。
 * ⚠ 高度的 key 刻意帶上筆數（`日期|N`）：換篩選後同一天可能只剩 3 筆，
 *   沒帶的話會用到 20 筆時量到的高度，上方就會出現一大塊空白。
 */
/** 還沒量過時的估算高度：日期標題 48 ＋ 每列 56 ＋ 區塊間距 16 */
const EST_HEAD = 48
const EST_ROW = 56
const EST_GAP = 16
/**
 * 視窗前後各多算多少 px 才回收（0.1.56 從 1000 縮到 300）。
 *
 * ⚠ 為什麼要縮小（使用者原話）：
 *   「目前是 1-10 --> 向下滑，出現了 11-20，請回收 1-10，
 *     當用戶又重新回到 1-10 時，請回收 11-20」
 *   原本留 1000px（比一整屏還高），等於上下各多留兩三屏，
 *   使用者滑到 11-20 時 1-10 還在保留區裡 → 看起來「完全沒回收」。
 *   現在改成 200px（約 1/4 屏）：滑過去看不到就收、滑回來再長出來。
 *
 * ⚠ 數字是量出來的，不要憑感覺調：區塊高約 410px，留 300 時「滑過一整個區塊」
 *   底部也才 -280 → 還在保留區裡 → 使用者會覺得「完全沒回收」（v131 實測）。
 *   200 才會在滑過一個區塊後真的回收，同時又留得住緩衝，快速滑回來不會看到空白。
 *
 * ⚠ 不能完全歸零：留一點緩衝，滑回來時內容才來得及渲染，
 *   不然快速滑動會一直看到空白（回收後是「等高空白 div」，不會跳，但內容要重新長）。
 */
const VIRTUAL_SLACK = 200
const IO_MARGIN = `${VIRTUAL_SLACK}px 0px`

const vis = ref<Set<string>>(new Set())
const heights = ref<Record<string, number>>({})
const blkEls = new Map<string, HTMLElement>()
let io: IntersectionObserver | null = null
let ro: ResizeObserver | null = null

/**
 * `vis`（「這一區塊現在要不要渲染」）的 key ＝ **只有日期**。
 *
 * ⚠⚠ 不能用「日期|筆數」當 vis 的 key（v85 抓到的實戰 bug）：
 *   `v-for` 的 `:key` 是日期，所以**同一個 DOM 元素會被重複使用**；
 *   切到「最近」檢視時同一天從 1 筆變 2 筆 → vis 的 key 變了 → 程式以為它是「新的、
 *   還沒看過」的區塊 → 換成空白。但 IntersectionObserver 對**已經觀察過、狀態沒變**
 *   的元素不會再回呼一次（它還在視窗裡，`isIntersecting` 一直是 true），
 *   於是一整天就這樣永遠空白。
 *   → vis 只認日期（切換檢視／篩選後同一天照樣認得）；**高度**才用「日期|筆數」
 *     （同一天換了內容，高度當然要分開記）。
 */
function hKeyOf(g: { key: string; list: unknown[] }): string {
  return `${g.key}|${g.list.length}`
}
function estOf(g: { list: unknown[] }): number {
  return EST_HEAD + g.list.length * EST_ROW + EST_GAP
}
/** 沒在視窗附近 → 用「量過的高度」或估算值把區塊撐成空白；在視窗內 → 交給內容自己長 */
function blockStyle(g: { key: string; list: TxRecord[] }) {
  if (!props.virtual) return undefined
  if (vis.value.has(g.key)) return undefined
  return { height: `${heights.value[hKeyOf(g)] ?? estOf(g)}px` }
}
function isVis(g: { key: string }): boolean {
  return !props.virtual || vis.value.has(g.key)
}

/** 把目前看得到的區塊量一次（量完寫回 heights，回收時才撐得出正確高度） */
async function measure() {
  await nextTick()
  if (!props.virtual) return
  const byKey = new Map(visibleGroups.value.map((g) => [g.key, g]))
  for (const k of vis.value) {
    const el = blkEls.get(k)
    const g = byKey.get(k)
    if (!el || !g) continue
    const h = el.offsetHeight
    // 直接改 ref 物件的屬性就會觸發更新（Vue 3 的 ref 物件是深層響應式）
    if (h > 0 && heights.value[hKeyOf(g)] !== h) heights.value[hKeyOf(g)] = h
  }
}

function onIntersect(entries: IntersectionObserverEntry[]) {
  const next = new Set(vis.value)
  let changed = false
  for (const e of entries) {
    const k = (e.target as HTMLElement).dataset.k
    if (!k) continue
    if (e.isIntersecting) {
      if (!next.has(k)) {
        next.add(k)
        changed = true
      }
    } else if (next.delete(k)) changed = true
  }
  if (changed) vis.value = next
}

function bindBlk(k: string, el: unknown) {
  const e = (el as HTMLElement | null) ?? null
  const old = blkEls.get(k)
  if (old && old !== e) {
    io?.unobserve(old)
    ro?.unobserve(old)
    blkEls.delete(k)
  }
  if (e) {
    blkEls.set(k, e)
    io?.observe(e)
    ro?.observe(e)
  }
}

/**
 * 建立觀察器。
 * ⚠⚠ 不能在 `onMounted` 裡用 `props.virtual` 當開關就 return：
 *   **子元件的 onMounted 比父元件早** —— 記錄頁的 `narrow`（決定 virtual）是在
 *   RecordsView 自己的 onMounted 才量出來的，那時這裡看到的 `virtual` 還是 false
 *   → 觀察器永遠沒建立、種子也沒種 → 整份列表一片空白（v129 抓到的）。
 *   改成：觀察器一律建立（virtual 為 false 時它只是空轉），`virtual` 由樣式與
 *   `isVis` 自己判斷；`virtual` 事後翻成 true 時再補種一次。
 */
function ensureObservers() {
  if (io || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(onIntersect, { rootMargin: IO_MARGIN })
  if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(() => void measure())
  for (const el of blkEls.values()) {
    io.observe(el)
    ro?.observe(el)
  }
}
/** 先把最前面幾組直接點亮：IO 的第一次回呼是下一幀才來，沒種的話第一眼是空白 */
function seedVis() {
  const seed = new Set<string>()
  for (const g of visibleGroups.value.slice(0, 3)) seed.add(g.key)
  vis.value = seed
}

onMounted(() => {
  ensureObservers()
  if (props.virtual) {
    seedVis()
    void measure()
  }
})
// 從「沒開視窗化」變成「開」時（例如記錄頁量完螢幕寬度）要補種
watch(
  () => props.virtual,
  (v) => {
    if (!v) return
    ensureObservers()
    seedVis()
    void measure()
  },
)
onBeforeUnmount(() => {
  io?.disconnect()
  ro?.disconnect()
  io = null
  ro = null
  blkEls.clear()
})
// 區塊進出視窗、換資料之後都要重量一次（高度會寫進回收用的 heights）
watch(vis, () => void measure())
watch(() => visibleGroups.value.length, () => void measure())
</script>

<template>
  <div class="list">
    <div v-if="!props.records.length" class="empty card">
      <p class="muted">{{ emptyText }}</p>
    </div>

    <template v-else>
      <!--
        0.1.54：每一天包一層 `.dayblk`。
        視窗化時這一層會被撐成「等高空白」回收掉裡面的 DOM（見 script 的 `blockStyle`）；
        沒開視窗化時它只是單純的包層（`.day` 的 margin-bottom 搬到這一層的 padding-bottom，
        間距完全一樣）。
      -->
      <div
        v-for="g in visibleGroups"
        :key="g.key"
        class="dayblk"
        :data-k="g.key"
        :style="blockStyle(g)"
        :ref="(el) => bindBlk(g.key, el)"
      >
        <div v-if="isVis(g)" class="day">
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
              <!--
                0.1.76：數量模式也有收支 → 恢復「+收入／−支出」兩顆，
                只是沒有幣別符號（`fmtMoney(…, '')`）。
              -->
              <span v-if="g.inc > 0" class="day__chip is-inc num">
                +{{ fmtMoney(g.inc, settings.quantityMode ? '' : settings.displayCurrency) }}
              </span>
              <span v-if="g.exp > 0" class="day__chip is-exp num">
                −{{ fmtMoney(g.exp, settings.quantityMode ? '' : settings.displayCurrency) }}
              </span>
              <span v-if="g.inc === 0 && g.exp === 0" class="day__chip num">
                {{ fmtMoney(0, settings.quantityMode ? '' : settings.displayCurrency) }}
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
                :abs-time="absTime"
                @edit="emit('edit', $event)"
                @remove="emit('remove', $event)"
              />
            </template>
          </div>
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
/*
 * 0.1.54：每一天的包層。
 * - `.day` 原本的 `margin-bottom: 16px` 搬到這裡的 `padding-bottom`
 *   （margin 會跟父層摺疊、量不到，視窗化要靠 `offsetHeight` 量高度，一定要用 padding）。
 * - 視窗化時這一層被 inline style 撐成固定高度、內容清空 → 回收 DOM；
 *   高度用的是「同一個 key 上次量到的真實高度」，所以文件總高不變、捲動不跳。
 */
.dayblk {
  padding-bottom: 16px;
}
.day {
  margin-bottom: 0;
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
