<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { displayExpr } from '@/lib/calc'
import { formatFull, relativeTime } from '@/lib/date'
import { iconForCategory } from '@/lib/icons'
import { withAlpha, DEFAULT_TRIP_COLOR } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'
import HighlightText from './HighlightText.vue'

const props = withDefaults(
  defineProps<{
    record: TxRecord
    showTime?: boolean
    /** 搜尋關鍵字（已 trim 並轉小寫）：命中處在分類名與備註上以黃底標示 */
    highlight?: string
    /**
     * 「最近」檢視（依新增時間查詢／分組）時傳 true（0.1.29）。
     *
     * 那時這一顆標籤代表**交易時間**（分組標題才是新增時間），原先用「交易」二字前綴
     * 來區別；使用者要求拿掉那兩個字，改成**換一顆 icon（沙漏）＋淺綠色**來識別。
     * ⚠ 只影響記錄頁開「最近」的時候；統計頁沒有這個開關，維持原樣。
     */
    timeRecent?: boolean
  }>(),
  { showTime: false, highlight: '', timeRecent: false },
)
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>()
const settings = useSettingsStore()

const cat = computed(() => settings.category(props.record.categoryId))
const catColor = computed(() => cat.value?.color ?? '#8a857c')
const catIcon = computed(() =>
  cat.value ? iconForCategory(cat.value) : iconForCategory({ id: '', name: '' }),
)
/** 子分類顯示成「餐飲 › 早餐」，才看得出它是掛在哪個大類底下 */
const catName = computed(() =>
  cat.value ? settings.fullNameOf(props.record.categoryId) : '未分類',
)
const isExpense = computed(() => props.record.type === 'expense')
/**
 * 0.1.28：金額一律用「目前的主幣別」顯示，即時用匯率換算。
 * 0.1.36：改成「目前的**顯示幣別**」——旅行進行中＝旅行貨幣
 * （使用者：「打開旅行模式時，記帳頁面和統計頁面以旅行中的貨幣顯示」）。
 *
 * 使用者原話（0.1.28）：「當主幣別設定做其他的貨幣時，記錄頁和統計頁中的記錄也要更改做
 * 用戶指定的貨幣…（即使原記錄是用 MOP 記錄的就用匯率算出數字）」。
 *
 * ⚠ 以前用 `record.baseAmount`／`record.baseCurrency`——那是記帳當下凍結的值，
 *   主幣別後來改了它也不會變，這正是使用者看到的問題。
 * ⚠ 只換顯示；存的資料（amount／rate／baseAmount）完全不動。
 */
const shownAmount = computed(() => settings.toDisplay(props.record.amount, props.record.currency))

/**
 * 時間標籤的文字。
 * 「最近」檢視刻意**不加**「交易」二字（0.1.29）——改用沙漏 icon ＋ 淺綠底識別。
 */
const timeText = computed(() => relativeTime(props.record.occurredAt))

/** 記錄的幣別跟「現在的顯示幣別」不同才要顯示換算說明（0.1.36：旅行中＝跟旅行貨幣比） */
const converted = computed(() => props.record.currency !== settings.displayCurrency)
/** 換算說明的乘數＝這筆換成顯示幣別實際用的倍率（平時＝兌主幣的匯率；旅行中再除以旅行貨幣匯率） */
const shownRate = computed(() => {
  const r = settings.rate(props.record.currency)
  const dc = settings.displayCurrency
  return dc === settings.baseCurrency ? r : r / settings.rate(dc)
})
/**
 * 換算說明的匯率只顯示到兩位小數（0.1.37）。
 * 使用者原話：「在記錄的頁面和統計的頁面的記錄中，匯率只顯示兩位數，
 * 例: HKD 1.030004 --> 1.03，但在記錄明細的頁面就要保持完整位數」。
 * `Number(toFixed(2))` 順便去尾零：20 → "20"、1.030004 → "1.03"。
 * ⚠ `RecordSheet` 的「詳細資訊」（`1 X = record.rate Y`）維持**完整位數**——那是記帳當下的歷史事實。
 */
const displayRate = computed(() => Number(shownRate.value.toFixed(2)))
/** 舊資料可能沒有 images 欄位 */
const imgCount = computed(() => props.record.images?.length ?? 0)

/**
 * 0.1.39：旅行標籤「旅」的顏色＝**這筆記錄所屬那趟旅行**的 color。
 * - 每趟旅行各自存一個顏色 → 之後的旅行選了別的顏色，**不會**改到以前旅行的標籤
 *   （使用者：「用戶每次旅行的顏色都是不一樣的」）。
 * - 顏色來源走 `settings.tripById()`（先進行中、再歷史）——跟組名同一個查法。
 * - 舊資料／沒設顏色 → 回 `DEFAULT_TRIP_COLOR`（琥珀）＝升級前後畫面一致。
 */
const tripTagStyle = computed(() => {
  if (!props.record.tripId) return undefined
  const c = settings.tripById(props.record.tripId)?.color ?? DEFAULT_TRIP_COLOR
  return { color: c, borderColor: withAlpha(c, 0.35), background: withAlpha(c, 0.12) }
})

/* ── 0.1.38：標籤過多、分類文字被擠壓時 → 所有標籤移到分類上方一行 ──
 *
 * 使用者原話：「如果出現不夠位置，例如標籤過多至分類的文字被壓縮，就把這行的
 * 所有標籤放到上方的一行即平時的分類文字…的上方，注意是所有標籤」。
 *
 * 判定方式（量測，不是猜）：
 * - `.row__cat` 加了 `white-space: nowrap`（見樣式）：分類名不再自行斷行成兩行，
 *   空間不夠時 `.row__top` 一定會**橫向溢出**（scrollWidth > clientWidth）——
 *   這是一個確定的訊號；以前沒有 nowrap，文字會在 span 內悄悄斷行，量不出來。
 * - 「is-stacked」是**黏性的**：一旦堆疊，不再自動解開（標籤挪走之後量測當然會
 *   通過，若自動解開會來回抖動）；只有容器寬度改變（轉屏／視窗縮放）或標籤內容
 *   改變時才重置重測。
 */
const rowEl = ref<HTMLElement | null>(null)
const topEl = ref<HTMLElement | null>(null)
/** true ＝ 標籤一行在上、分類一行在下 */
const stacked = ref(false)
/** ResizeObserver 上次看到的寬度；寬度沒變就不重測（高度變化＝堆疊本身，忽略） */
let lastW = -1
let ro: ResizeObserver | null = null

/** 重置 → 等下一次排版 → 量測；溢出才堆疊 */
async function recheck() {
  if (!topEl.value) return
  stacked.value = false
  await nextTick()
  const el = topEl.value
  if (!el) return
  if (el.scrollWidth > el.clientWidth + 1) stacked.value = true
}

onMounted(() => {
  void recheck()
  if (typeof ResizeObserver !== 'undefined' && rowEl.value) {
    ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width
        if (Math.abs(w - lastW) > 0.5) {
          lastW = w
          void recheck()
        }
      }
    })
    ro.observe(rowEl.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})
/** 影響「這一行有哪些標籤／標籤文字」的東西變了 → 重測 */
watch(
  () => [
    props.record.tripId,
    props.record.images?.length,
    props.record.source,
    props.showTime,
    props.timeRecent,
    props.highlight,
  ],
  () => void recheck(),
)
</script>

<template>
  <div ref="rowEl" class="row">
    <span class="row__ic" :style="{ '--c': catColor, '--bg': withAlpha(catColor, 0.14) }">
      <CategoryIcon :name="catIcon" :size="17" :stroke="1.9" />
    </span>
    <button class="row__main" type="button" @click="emit('edit', record.id)">
      <!-- is-stacked（0.1.38）：空間不夠時標籤整排挪到分類上方（見 script 的 recheck） -->
      <span ref="topEl" class="row__top" :class="{ 'is-stacked': stacked }">
        <span class="row__cat">
          <HighlightText :text="catName" :query="highlight" />
        </span>
        <!--
          旅行標籤「旅」（0.1.37 加；0.1.39 兩改）：
          ① 位置：從分類**左邊**搬到**右邊**（使用者：「更改放到分類文字的右手邊」）。
             is-stacked 模式不受影響——.row__cat 是 order:10，照樣獨佔下一行。
          ② 顏色：跟這筆所屬**那趟旅行**的 color（0.1.39）；沒設（舊資料）＝琥珀回退。
             inline style 只在查得到顏色時掛，蓋過 .ttrip 的琥珀預設。
        -->
        <span
          v-if="record.tripId"
          class="ttrip"
          title="旅行記錄"
          :style="tripTagStyle"
        >旅</span>
        <span
          v-if="showTime"
          class="ttag"
          :class="{ 'ttag--recent': timeRecent }"
          :title="formatFull(record.occurredAt)"
        >
          <!-- 「最近」檢視（0.1.29）：換成沙漏（跟一般的時鐘做區別） -->
          <svg v-if="timeRecent" class="ttag__ic" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.9 3.1h6.2" />
            <path d="M4.9 12.9h6.2" />
            <path d="M5.6 3.1 8 7.9l2.4-4.8" />
            <path d="M10.4 12.9 8 8.1l-2.4 4.8" />
          </svg>
          <svg v-else class="ttag__ic" viewBox="0 0 16 16" aria-hidden="true">
            <circle class="ttag__face" cx="8" cy="8" r="6.3" />
            <path d="M8 4.55v3.75l2.3 1.4" />
          </svg>
          <span>{{ timeText }}</span>
        </span>
        <span v-if="imgCount" class="imtag">
          <svg class="imtag__ic" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2.4" />
            <circle cx="6.1" cy="6.9" r="1.15" />
            <path d="M3.6 11.9 6.6 9l2.1 1.9 2-1.8 2.2 2.5" />
          </svg>
          <span>圖</span>
          <span v-if="imgCount > 1" class="imtag__n">· {{ imgCount }}</span>
        </span>
        <span v-else-if="record.source === 'image'" class="imtag imtag--plain">收據</span>
      </span>
      <span v-if="record.note" class="row__note tiny muted">
        <HighlightText :text="record.note" :query="highlight" />
      </span>
      <!-- 記帳時是用計算機算出來的，就把算式留下來（單純輸入一個數字不會有） -->
      <span v-if="record.expr" class="row__expr tiny">
        <span class="row__expr-t num">{{ displayExpr(record.expr) }}</span>
        <span class="row__expr-eq">=</span>
      </span>
    </button>
    <!--
      金額也是一顆按鈕（0.1.26）。
      ⚠ 原本這裡是 <div>：點數字既不開明細、又會被瀏覽器當成文字選取
      （使用者：「用戶點擊金錢的數字不要選取，要進入到記錄明細的頁面中」）。
      改成 <button> 之後：
        ① 點它就跟點左邊的主按鈕一樣開明細
        ② `user-select: none` 由 style.css 的全站 button 規則自動帶上，不會再選到字
        ③ v102 那種「找空白處」的探測本來就會跳過 button，行為一致
    -->
    <button class="row__amt" type="button" @click="emit('edit', record.id)">
      <strong class="num" :class="isExpense ? 'is-exp' : 'is-inc'">
        {{ isExpense ? '−' : '+' }}{{ fmtMoney(shownAmount, settings.displayCurrency) }}
      </strong>
      <span v-if="converted" class="tiny muted num">
        {{ fmtMoney(record.amount, record.currency) }} × {{ displayRate }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  transition: background 0.15s ease;
  /**
   * ⚠ 整列都不給選字（0.1.26）。
   * 一列就是一個「點開明細」的目標，選到字只會讓人以為點失敗；
   * 使用者原話：「用戶點擊金錢的數字不要選取，要進入到記錄明細的頁面中」。
   * 兩顆按鈕（.row__main／.row__amt）本來就繼承 button 的 user-select: none，
   * 這裡寫在列上是一道保險，連非按鈕的縫隙也一起蓋掉。
   */
  user-select: none;
  -webkit-user-select: none;
}
.row:hover {
  background: var(--surface-3);
}
.row__ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  color: var(--c);
  background: var(--bg);
  flex: none;
}
.row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}
.row__top {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}
.row__cat {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.01em;
  /**
   * 0.1.38：分類名不自行斷行。
   * 以前空間不夠時文字會在這個 span 內悄悄折成兩行（看起來就是「被壓縮」），
   * 而且 .row__top 的 scrollWidth 不會溢出，程式量測不到。
   * 改成 nowrap 之後：裝得下＝一行原樣；裝不下＝一定橫向溢出 →
   * script 的 recheck() 量到 scrollWidth > clientWidth 就把標籤整排挪到上面。
   * （堆疊後若分類名還是太長，由 is-stacked 的規則收成刪節號。）
   */
  white-space: nowrap;
}
/*
 * 0.1.38：標籤過多、分類文字被擠壓時 → **所有標籤**移到分類上方一行
 * （使用者原話見 script 註解；仍在記錄方框內，只是換行）。
 * - flex-wrap: wrap 讓 .row__top 可以折行；
 * - .row__cat 排到 order: 10（所有標籤都在它前面）＋ flex-basis: 100%
 *   ＝它獨佔一整行 → 標籤自然排在上一行；
 * - row-gap 收緊成 4px（水平間距維持 8px）。
 * ⚠ is-stacked 是黏性的（不會自己解開），避免「挪走→量測通過→挪回」的抖動。
 */
.row__top.is-stacked {
  flex-wrap: wrap;
  row-gap: 4px;
}
.row__top.is-stacked .row__cat {
  order: 10;
  flex-basis: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__note {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 算式：比備註再輕一階，等號單獨一格才不會被省略號吃掉。
   ⚠ gap 一定要是 0：式子與等號之間不留空隙（`1+1=` 而不是 `1+1 =`）。
   要「單獨一格」是 flex 的功勞，跟 gap 無關。 */
.row__expr {
  display: flex;
  align-items: baseline;
  gap: 0;
  max-width: 100%;
  min-width: 0;
  color: var(--text-3);
}
.row__expr-t {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__expr-eq {
  flex: none;
  font-weight: 650;
}
.imtag,
.ttag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 19px;
  padding: 0 7px;
  flex: none;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.imtag__ic,
.ttag__ic {
  width: 12px;
  height: 12px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 時間標籤：暖調軟底膠囊，比圖片標籤輕一階 */
.ttag {
  border-color: transparent;
  background: var(--surface-3);
  color: var(--text-2);
  font-weight: 650;
  padding: 0 9px;
  box-shadow: var(--shadow-1);
  font-variant-numeric: tabular-nums;
}
.ttag__ic {
  stroke: var(--text-3);
  stroke-width: 1.25;
}
.ttag__face {
  fill: currentColor;
  fill-opacity: 0.16;
}
/*
 * 0.1.29：記錄頁開「最近」時的時間標籤 —— **只把外框改成淺黃色**。
 * 使用者原話：「交易 x 分鐘前 → x 分鐘前（移除交易 2 個字）、icon 換一個、改淺黃色外框」，
 *   並在追問時明確選了「**只改外框顏色**」（底色與字色維持原本的灰底深灰字）。
 * ⚠ `.ttag` 原本是 `border-color: transparent`，所以這裡一定要把框色寫回來，
 *   不然這一圈根本不會出現。
 */
.ttag--recent {
  border-color: var(--amber-line);
}
/*
 * 0.1.37：旅行標籤「旅」——這筆記錄歸在某個旅行名下（記錄頁＋統計頁的區間記錄都會出現，
 * 同一個元件）。0.1.39 起顏色跟**那趟旅行**的 color（inline style 蓋過來）；
 * 這裡的琥珀＝回退預設（舊資料沒有 color 欄位時，畫面跟升級前完全一樣）。
 */
.ttrip {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--amber-line);
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.imtag__ic {
  stroke: var(--accent);
}
.imtag__ic circle {
  fill: var(--accent);
  stroke: none;
}
.imtag__n {
  color: var(--text-3);
  font-weight: 700;
}
.imtag--plain {
  border-color: var(--line);
  color: var(--text-3);
  font-weight: 550;
}
/* 金額區塊：點一下開明細（跟左邊的主按鈕同一個動作） */
.row__amt {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex: none;
  cursor: pointer;
  text-align: right;
}
.row__amt strong {
  font-size: 15px;
}
.is-exp {
  color: var(--text);
}
.is-inc {
  color: var(--income);
}
</style>
