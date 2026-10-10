<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { confirmDialog, notify } from '@/lib/alerts'
import { fmtMoney } from '@/lib/currency'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import DateField from './DateField.vue'
import CategoryIcon from './CategoryIcon.vue'
import { TRIP_COLORS, DEFAULT_TRIP_COLOR, isHexColor, withAlpha } from '@/lib/color'

/**
 * 「旅行模式」的子頁面（0.1.35）。
 *
 * 使用者原話：「幣別與匯率區塊中，增加旅行模式的按鈕，用戶打開旅行模式時，打開子頁面
 * （子頁面的設定要和設定頁的一樣，子頁面滑動時背景不能動，向下拉關閉子頁面等等，
 * 和之前的子頁面一樣，**不要重新再弄一個全新未知的子頁面**）」。
 *
 * 所以骨架整份照 `QuickAmountSheet`（＝照 `CategoryManageModal`）抄：
 * `bsheet-mask`／`bsheet`／`bsheet__grab`／`bsheet__body`（全域共用幾何）＋
 * `useScrollLock`（背景不動）＋ `usePullToClose`（向下拉**真的關閉**——
 * 0.1.34 的教訓：onClose 一定要 emit('close')）＋ 右上角關閉鈕。
 *
 * 內容（全部是使用者拍板的設計）：
 * - 旅行名稱／出發日／回程日（日期純顯示）／旅行貨幣（旅行期間記帳幣別自動切、可手改）
 * - 模式一（記錄歸入旅行）與模式二（備注補後綴）兩個**獨立開關**，可同時開
 * - 「結束旅行」先彈確認（附筆數＋總支出）；0.1.36 起結束**不解除標記**——
 *   記錄的旅行標籤保留、旅行本體移進 tripHistory（下面的「過去的旅行」列表）
 * - 0.1.39：旅行**顏色色板**——記錄的「旅」標籤與本頁強調色跟著它；
 *   顏色存在旅行本體上（每趟各自一個，互不影響），結束後頁面自然回到琥珀
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const records = useRecordsStore()
const router = useRouter()

/* ── 背景鎖 + 下拉關閉（跟其他子頁面同一套）────────────── */
const sheetEl = ref<HTMLElement | null>(null)
const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
  // ⚠ 0.1.34 的教訓：下拉一定要真的關掉整個子頁面（emit('close')），
  //   不能只切內部狀態，否則暗幕留著＋背景鎖著＝整個畫面卡死。
} = usePullToClose({ panel: sheetEl, scroller: boxEl, onClose: () => emit('close') })

/* ── 草稿（進行中時的修改即時生效；還沒開始時按「開始旅行」才落地）── */
const draft = ref({
  name: '',
  startDate: '',
  endDate: '',
  currency: '',
  mode1: true,
  mode2: false,
  /** 0.1.39：旅行顏色（色板必選一個，預設琥珀） */
  color: DEFAULT_TRIP_COLOR as string,
})

const trip = computed(() => settings.activeTrip)

/** 0.1.41：自訂色標記——⚠ 必須宣告在 syncFromTrip 之前（watch immediate 會跑它） */
const customColor = ref(false)

function syncFromTrip() {
  const t = settings.activeTrip
  if (t) {
    draft.value = {
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      currency: t.currency,
      mode1: t.mode1,
      mode2: t.mode2,
      color: isHexColor(t.color) ? t.color : DEFAULT_TRIP_COLOR,
    }
  } else {
    draft.value = {
      name: '',
      startDate: '',
      endDate: '',
      currency: '',
      mode1: true,
      mode2: false,
      color: DEFAULT_TRIP_COLOR,
    }
  }
  // 0.1.41：自訂色標記＝目前顏色不在 8 個預設色裡（跟分類管理同一套判法）
  customColor.value = !(TRIP_COLORS as readonly string[]).includes(draft.value.color)
}

watch(
  () => props.open,
  (v) => {
    // 每次打開都照「當下有沒有旅行」重整草稿
    if (v) syncFromTrip()
  },
  { immediate: true },
)

/* ── 顯示用資料 ───────────────────────────────────────── */
/** 旅行貨幣的匯率說明（沒設貨幣／就是主幣別時不顯示） */
const rateLine = computed(() => {
  const code = draft.value.currency
  if (!code || code === settings.baseCurrency) return ''
  return `1 ${code} ≈ ${fmtMoney(settings.rate(code), settings.baseCurrency)}（記帳頁會自動用 ${code} 記錄）`
})

/** 進行中的即時小計（筆數／支出／收入；與記錄頁同一套即時換算——旅行中＝旅行貨幣） */
const summary = computed(() =>
  settings.activeTrip ? records.tripSummary(settings.activeTrip.id) : null,
)

const title = computed(() => (settings.activeTrip ? '旅行模式 · 進行中' : '旅行模式'))

/**
 * 0.1.41：「查看旅行記錄」從 0.1.40 的跳轉式升級成**持久模式開關**
 * （使用者原話：「打開後，用戶無論如何切換頁面，再回到記錄的頁面時，也要是
 * （只查看當前旅行的資料的模式），直到用戶關閉這個模式或完成旅行，而不影響
 * 任何的狀態」）。
 * - 開＝`settings.setTripViewFilter(trip.id)`＋關掉本頁＋跳記錄頁（不帶 query——
 *   過濾走 store，切頁也保持）；關＝`setTripViewFilter(null)`（留在原地不跳）。
 * - 「不影響任何的狀態」＝純檢視過濾，不動記錄／設定／旅行本體；
 *   結束旅行時 `finishTrip()` 會自動關閉（store 裡做）。
 * - 0 筆記錄時**不能開**（過濾了只會看到空列表），但已開著就永遠可以關
 *   （否則按鈕 disabled 會把人鎖在模式裡）。
 */
const viewOn = computed(() => !!trip.value && settings.tripViewFilter === trip.value.id)

function toggleViewFilter() {
  const t = settings.activeTrip
  if (!t) return
  if (viewOn.value) {
    settings.setTripViewFilter(null)
    return
  }
  if (!records.tripSummary(t.id).count) return
  settings.setTripViewFilter(t.id)
  emit('close')
  router.push({ path: '/records' })
}

/* ── 0.1.39：旅行顏色 ─────────────────────────────────── */
/**
 * 這個子頁面的強調色（狀態卡／模式開關的琥珀全部跟著換）。
 * - 進行中＝那趟旅行的 color；還沒開始＝色板目前選的（預覽）。
 * - 「結束時恢復」：顏色存在旅行本體上，activeTrip 清掉後這裡自然回到
 *   色板預設（琥珀），不需要任何還原程式碼。
 */
const accentStyle = computed(() => {
  const c = (trip.value && isHexColor(trip.value.color) ? trip.value.color : '') ||
    (isHexColor(draft.value.color) ? draft.value.color : DEFAULT_TRIP_COLOR)
  return {
    '--trip-c': c,
    '--trip-c-soft': withAlpha(c, 0.12),
    '--trip-c-line': withAlpha(c, 0.35),
  }
})

/** 點色板：還沒開始＝改草稿（開始時一起存）；進行中＝即時寫回 store */
function pickColor(c: string) {
  draft.value.color = c
  customColor.value = false
  if (settings.activeTrip) settings.updateActiveTrip({ color: c })
}

/**
 * 0.1.41：自訂顏色（使用者原話：「旅行模式頁面中的旅行顏色，給用戶增加自訂的
 * 顏色（像修改分類的頁面，的自訂調色盤一樣）」）——做法照 `CategoryManageModal`：
 * 彩虹底的「＋」票包一顆原生 `<input type="color">`（0.1.39 不用原生面板的拍板
 * 被 0.1.41 的新指示覆蓋：使用者點名要跟分類頁一樣）。
 * 選中自訂色時那顆票直接顯示該色；存檔前仍過 `isHexColor` 防線（store 端）。
 * （customColor 的 ref 宣告在 syncFromTrip 之前——watch immediate 會跑它。）
 */
function onPalette(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (!isHexColor(v)) return
  draft.value.color = v
  customColor.value = true
  if (settings.activeTrip) settings.updateActiveTrip({ color: v })
}

/* ── 開始／修改／結束 ─────────────────────────────────── */
function startTrip() {
  const t = settings.startTrip({
    name: draft.value.name,
    startDate: draft.value.startDate,
    endDate: draft.value.endDate,
    currency: draft.value.currency,
    mode1: draft.value.mode1,
    mode2: draft.value.mode2,
    color: draft.value.color,
  })
  syncFromTrip()
  notify(`已開始旅行「${t.name}」`, 'ok')
}

/** 進行中改名稱（blur／Enter 才套用，打字過程不一直寫回 store） */
function applyName() {
  if (!settings.activeTrip) return
  settings.updateActiveTrip({ name: draft.value.name })
  // 名稱是模式二後綴與歸組組名的來源，套用後把草稿正規化一次（trim／回退空值）
  draft.value.name = settings.activeTrip.name
}

/**
 * 0.1.41：出發／回程日的先後驗證（使用者原話：「回程日小過出發日，回程日不能
 * 大過出發日，但是兩者都可以接受空白」——前後半句互相矛盾，依旅行常理拍板：
 * **回程日不能早於出發日**（回程在出發之後），兩者皆可各自空白）。
 * - 擋下時 toast 提示並**回退該欄位**到 store 裡的現值（打字過程不會誤存）。
 * - ⚠ 回退要 bump `dateKey`（DateField 的 :key）——v-model 先寫了草稿、這裡又
 *   回退，同一個 tick 內 prop 最終值沒變，DateField 的 watch 不會觸發、
 *   輸入框會留著使用者打的錯誤日期；換 key 強制重掛載才會照 modelValue 重畫。
 * - 只有一方有值（或都空）＝合法，照常套用。
 * - 日期一律是 YYYY-MM-DD 字串（DateField 的格式）→ 字串比較即先後。
 */
const dateKey = ref(0)

function applyDate(which: 'startDate' | 'endDate') {
  if (!settings.activeTrip) return
  const s = draft.value.startDate
  const e = draft.value.endDate
  if (s && e && e < s) {
    notify(which === 'endDate' ? '回程日不能早於出發日' : '出發日不能晚於回程日', 'warn')
    draft.value[which] = settings.activeTrip[which]
    dateKey.value++
    return
  }
  settings.updateActiveTrip({ [which]: draft.value[which] })
}

function applyCurrency() {
  if (!settings.activeTrip) return
  settings.updateActiveTrip({ currency: draft.value.currency })
}

function toggleMode(which: 'mode1' | 'mode2') {
  draft.value[which] = !draft.value[which]
  if (!settings.activeTrip) return
  settings.updateActiveTrip({ [which]: draft.value[which] })
}

/**
 * 結束前先確認（附筆數與總支出——使用者拍板：要確認＋花費摘要）。
 * 0.1.36：結束**不解除標記**——記錄照樣歸在這個旅行名下（使用者：
 * 「結束後也要保留旅行時的標籤，不要回歸一般記錄，因為這樣沒有意義」）；
 * 旅行本體移進 tripHistory（「過去的旅行」），幣別恢復。
 */
async function askEnd() {
  const t = settings.activeTrip
  if (!t) return
  const s = records.tripSummary(t.id)
  const answer = await confirmDialog({
    title: `結束「${t.name}」？`,
    message: `這趟共 ${s.count} 筆記錄、支出 ${fmtMoney(s.expense, settings.displayCurrency)}${
      s.income > 0 ? `、收入 ${fmtMoney(s.income, settings.displayCurrency)}` : ''
    }。結束後記錄會保留「${t.name}」的旅行標記（不回歸一般記錄），幣別恢復原本的設定；之後可以在「過去的旅行」查看這一趟。`,
    confirmText: '結束旅行',
    danger: true,
  })
  if (answer !== 'confirm' || settings.activeTrip?.id !== t.id) return
  settings.finishTrip()
  syncFromTrip()
  notify(`已結束旅行「${t.name}」，記錄標記保留`, 'ok')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="[pullStyle, accentStyle]"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <!-- 抓把：往下拉即可關閉（跟其他子頁面同一套） -->
        <div class="bsheet__grab" aria-hidden="true"></div>

        <div ref="boxEl" class="box bsheet__body">
          <header class="hd">
            <h3>{{ title }}</h3>
            <button
              class="closebtn"
              type="button"
              title="關閉"
              aria-label="關閉"
              @click="emit('close')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" />
              </svg>
            </button>
          </header>

          <!-- 進行中：狀態卡（行李箱 icon ＋ 旅行名 ＋ 即時小計） -->
          <div v-if="trip" class="status">
            <span class="status__ic" aria-hidden="true">
              <CategoryIcon name="luggage" :size="18" :stroke="1.9" />
            </span>
            <span class="status__txt">
              <b>{{ trip.name }}</b>
              <em v-if="summary">
                {{ summary.count }} 筆 · 支出 {{ fmtMoney(summary.expense, settings.displayCurrency) }}
              </em>
            </span>
            <span class="status__tag">旅行中</span>
          </div>

          <!-- 0.1.41：查看旅行記錄＝持久模式開關（開了以後切頁也保持，直到關閉或結束旅行） -->
          <button
            v-if="trip"
            class="viewrec"
            :class="{ 'is-on': viewOn }"
            type="button"
            :disabled="!viewOn && (!summary || summary.count === 0)"
            :title="viewOn
              ? '模式中：記錄頁目前只顯示這趟的記錄，按一下關閉'
              : summary && summary.count
                ? `打開後記錄頁只顯示這趟的 ${summary.count} 筆記錄（切換頁面也保持）`
                : '這趟還沒有記錄'"
            @click="toggleViewFilter"
          >
            <span class="viewrec__ic" aria-hidden="true">
              <CategoryIcon name="book" :size="16" :stroke="1.9" />
            </span>
            <span class="viewrec__txt">
              <b>查看旅行記錄</b>
              <em v-if="viewOn">模式中：記錄頁只顯示這趟的記錄（切頁也保持）</em>
              <em v-else>打開後記錄頁只顯示這趟的 {{ summary ? summary.count : 0 }} 筆記錄</em>
            </span>
            <span class="viewrec__sw" aria-hidden="true">{{ viewOn ? '開' : '關' }}</span>
          </button>
          <p v-else class="tiny muted hint">
            設定這趟旅行的名稱、貨幣與模式，按「開始旅行」後生效。期間的記錄會照你選的模式歸進這個旅行。
          </p>

          <!-- 名稱 -->
          <label class="lb">
            <span>旅行名稱 <em class="lb__hint">也是記錄頁的組名與備注後綴</em></span>
            <input
              v-model="draft.name"
              class="field"
              type="text"
              :maxlength="20"
              placeholder="例如 日本旅行"
              enterkeyhint="done"
              @blur="applyName"
              @keydown.enter="applyName"
            />
          </label>

          <!-- 日期（純顯示，不影響記錄歸屬——使用者拍板）；
               :key＝擋下回退時強制重掛載重同步（見 applyDate 的註解） -->
          <div class="grid2">
            <label class="lb">
              <span>出發日</span>
              <DateField :key="'s' + dateKey" v-model="draft.startDate" @update:model-value="applyDate('startDate')" />
            </label>
            <label class="lb">
              <span>回程日</span>
              <DateField :key="'e' + dateKey" v-model="draft.endDate" @update:model-value="applyDate('endDate')" />
            </label>
          </div>

          <!-- 旅行貨幣：旅行期間記帳頁自動用它（每一筆仍可手動改） -->
          <label class="lb">
            <span>旅行貨幣 <em class="lb__hint">留「不自動切換」＝記帳頁幣別不動</em></span>
            <select v-model="draft.currency" class="field" @change="applyCurrency">
              <option value="">不自動切換</option>
              <option v-for="c in settings.allCurrencies" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
            <span v-if="rateLine" class="tiny muted rateline num">{{ rateLine }}</span>
          </label>

          <!-- 旅行顏色（0.1.39；0.1.41 加自訂調色盤）：記錄的「旅」標籤與這個頁面的強調色都跟著它 -->
          <div class="lb">
            <span>
              旅行顏色
              <em class="lb__hint">記錄的「旅」標籤會用這個顏色；每一趟各自獨立</em>
            </span>
            <div class="swatches" role="radiogroup" aria-label="旅行顏色">
              <button
                v-for="c in TRIP_COLORS"
                :key="c"
                type="button"
                class="swatch"
                :class="{ 'is-on': !customColor && draft.color === c }"
                :style="{ background: c }"
                :title="c"
                :aria-pressed="!customColor && draft.color === c"
                :aria-label="'旅行顏色 ' + c"
                @click="pickColor(c)"
              ></button>
              <!-- 自訂調色盤（0.1.41）：照 CategoryManageModal 的「＋」彩虹票 -->
              <label
                class="swatch swatch--palette"
                :class="{ 'is-on': customColor }"
                :style="customColor ? { background: draft.color } : undefined"
                title="自訂顏色"
              >
                <input type="color" :value="draft.color" class="swatch__input" @input="onPalette" />
                <span v-if="!customColor" class="swatch__plus">＋</span>
              </label>
            </div>
          </div>

          <!-- 模式一／模式二：兩個獨立開關（可同時開） -->
          <div class="modes">
            <button
              type="button"
              class="mode"
              :class="{ 'is-on': draft.mode1 }"
              :aria-pressed="draft.mode1"
              @click="toggleMode('mode1')"
            >
              <span class="mode__txt">
                <b>模式一 · 記錄歸入旅行</b>
                <em>記錄頁／統計頁把這段期間的記錄歸到「{{ draft.name.trim() || '旅行' }}」名下（記帳頁分類照舊）</em>
              </span>
              <span class="mode__sw" aria-hidden="true">{{ draft.mode1 ? '開' : '關' }}</span>
            </button>
            <button
              type="button"
              class="mode"
              :class="{ 'is-on': draft.mode2 }"
              :aria-pressed="draft.mode2"
              @click="toggleMode('mode2')"
            >
              <span class="mode__txt">
                <b>模式二 · 備注自動補旅行名</b>
                <em>提交後備注變成「買了一個包包_{{ draft.name.trim() || '日本旅行' }}」</em>
              </span>
              <span class="mode__sw" aria-hidden="true">{{ draft.mode2 ? '開' : '關' }}</span>
            </button>
          </div>

          <!-- 過去的旅行（0.1.37 起）搬到獨立子頁面 TripHistorySheet——設定頁主 cell 右側的時鐘小鈕 -->

          <div class="acts">
            <template v-if="trip">
              <button class="btn btn--ghost acts__end" type="button" @click="askEnd">結束旅行</button>
              <span class="acts__spring"></span>
              <button class="btn btn--primary" type="button" @click="emit('close')">完成</button>
            </template>
            <template v-else>
              <span class="acts__spring"></span>
              <button class="btn btn--primary" type="button" @click="startTrip">開始旅行</button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * ⚠ 外框幾何**只寫在 style.css 的 `.bsheet-mask`／`.bsheet`／`.bsheet__grab`／
 *   `.bsheet__body`**（跟其他子頁面共用），這裡只留 z-index 與自己的內容排版，
 *   不要重寫那些幾何屬性（scoped 特異度更高，會蓋掉共用值）。
 */
.mask {
  z-index: 90;
}
.box {
  padding: 6px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.box h3 {
  font-size: 16px;
}
/* 標題列：標題在左、「關閉」在最右（跟其他子頁面同一套） */
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hd h3 {
  flex: 1;
  min-width: 0;
}
.closebtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-3);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.closebtn:hover {
  border-color: var(--expense);
  background: var(--expense-soft);
  color: var(--expense);
}
.closebtn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.hint {
  margin: 0;
}

/* 進行中狀態卡：行李箱 ＋ 名稱 ＋ 即時小計 ＋「旅行中」標籤
   0.1.39：琥珀全部換成 --trip-c 系變數（根元素 inline 掛，跟著旅行顏色走；
   沒有旅行／舊資料時 fallback 回原本的琥珀，畫面不變） */
.status {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border-radius: var(--r-md);
  background: var(--trip-c-soft, var(--amber-soft));
  border: 1px solid var(--trip-c-line, var(--amber-line));
}
.status__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--trip-c, var(--amber));
  border: 1px solid var(--trip-c-line, var(--amber-line));
}
.status__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.status__txt b {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status__txt em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-2);
}
.status__tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--trip-c, var(--amber));
  color: var(--trip-c, var(--amber));
  font-size: 11.5px;
  font-weight: 700;
}

/* 0.1.41：查看旅行記錄——持久模式開關。關＝白底描邊；開＝旅行色軟底＋「開」膠囊 */
.viewrec {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--trip-c-line, var(--amber-line));
  background: var(--surface);
  text-align: left;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.viewrec.is-on {
  background: var(--trip-c-soft, var(--amber-soft));
}
.viewrec:active {
  background: var(--trip-c-soft, var(--amber-soft));
}
.viewrec:disabled {
  opacity: 0.55;
}
.viewrec__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--trip-c-soft, var(--amber-soft));
  border: 1px solid var(--trip-c-line, var(--amber-line));
  color: var(--trip-c, var(--amber));
}
.viewrec__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.viewrec__txt b {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--trip-c, var(--amber));
}
.viewrec__txt em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 開／關膠囊（照 .mode__sw 的家族：34x26、圓票、開啟時白底旅行色字） */
.viewrec__sw {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
}
.viewrec.is-on .viewrec__sw {
  border-color: var(--trip-c, var(--amber));
  background: var(--surface);
  color: var(--trip-c, var(--amber));
}

/* 旅行顏色色板（0.1.39）：圓形色票一排、選中的加一圈外框 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  padding: 3px 0 1px;
}
.swatch {
  width: 27px;
  height: 27px;
  padding: 0;
  border-radius: 999px;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--line);
  transition: box-shadow 0.12s, transform 0.12s;
}
.swatch.is-on {
  /* 選中：用自己那個色畫一圈外框（box-shadow 不佔版位，320px 也放得下） */
  box-shadow: 0 0 0 2px var(--trip-c, var(--amber));
  transform: scale(1.08);
}

/* 自訂顏色票（0.1.41）：彩虹底「＋」，做法照 CategoryManageModal 的 .sw--palette */
.swatch--palette {
  background: conic-gradient(red, orange, yellow, green, cyan, blue, violet, red);
  display: grid;
  place-items: center;
  overflow: hidden;
  position: relative;
}
.swatch--palette.is-on {
  border-color: var(--text);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--text);
}
.swatch__plus {
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  line-height: 1;
}
.swatch__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
}

/* 欄位 */
.lb {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lb > span {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.lb__hint {
  margin-left: 6px;
  font-style: normal;
  font-weight: 500;
  font-size: 11.5px;
  color: var(--text-3);
}
.rateline {
  margin-top: 2px;
}
/* 出發／回程同一排（320px 也放得下；minmax(0,1fr) 防 select 撐欄——0.1.33 的教訓） */
.grid2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.grid2 .lb {
  min-width: 0;
}

/* 模式開關：整列可按，右側一顆「開／關」膠囊 */
.modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mode {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
  text-align: left;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.mode.is-on {
  border-color: var(--trip-c, var(--amber));
  background: var(--trip-c-soft, var(--amber-soft));
}
.mode__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.mode__txt b {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
}
.mode__txt em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mode__sw {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
}
.mode.is-on .mode__sw {
  border-color: var(--trip-c, var(--amber));
  background: var(--surface);
  color: var(--trip-c, var(--amber));
}

/* 過去的旅行（0.1.37 起）搬到 TripHistorySheet 子頁面，這裡不再有清單 */

/* 底部動作列 */
.acts {
  display: flex;
  align-items: center;
  gap: 9px;
}
.acts__spring {
  flex: 1;
}
.acts__end {
  color: var(--expense);
  border-color: var(--expense);
}
.acts__end:hover {
  background: var(--expense-soft);
}
</style>
