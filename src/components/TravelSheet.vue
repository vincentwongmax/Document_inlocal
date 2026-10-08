<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { confirmDialog, notify } from '@/lib/alerts'
import { CURRENCIES, fmtMoney } from '@/lib/currency'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import DateField from './DateField.vue'
import CategoryIcon from './CategoryIcon.vue'

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
 * - 「結束旅行」先彈確認（附筆數＋總支出），確認後記錄全部解除標記、幣別恢復
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const records = useRecordsStore()

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
})

const trip = computed(() => settings.activeTrip)

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
    }
  } else {
    draft.value = { name: '', startDate: '', endDate: '', currency: '', mode1: true, mode2: false }
  }
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

/** 進行中的即時小計（筆數／支出／收入；與記錄頁同一套即時換算） */
const summary = computed(() =>
  settings.activeTrip ? records.tripSummary(settings.activeTrip.id) : null,
)

const title = computed(() => (settings.activeTrip ? '旅行模式 · 進行中' : '旅行模式'))

/* ── 開始／修改／結束 ─────────────────────────────────── */
function startTrip() {
  const t = settings.startTrip({
    name: draft.value.name,
    startDate: draft.value.startDate,
    endDate: draft.value.endDate,
    currency: draft.value.currency,
    mode1: draft.value.mode1,
    mode2: draft.value.mode2,
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

function applyDate(which: 'startDate' | 'endDate') {
  if (!settings.activeTrip) return
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

/** 結束前先確認（附筆數與總支出——使用者拍板：要確認＋花費摘要） */
async function askEnd() {
  const t = settings.activeTrip
  if (!t) return
  const s = records.tripSummary(t.id)
  const answer = await confirmDialog({
    title: `結束「${t.name}」？`,
    message: `這趟共 ${s.count} 筆記錄、支出 ${fmtMoney(s.expense, settings.baseCurrency)}${
      s.income > 0 ? `、收入 ${fmtMoney(s.income, settings.baseCurrency)}` : ''
    }。結束後這些記錄會解除旅行標記（回歸一般記錄），備注已加的「_${t.name}」保留不動。`,
    confirmText: '結束旅行',
    danger: true,
  })
  if (answer !== 'confirm' || settings.activeTrip?.id !== t.id) return
  const n = records.untagTrip(t.id)
  settings.finishTrip()
  syncFromTrip()
  notify(`已結束旅行，${n} 筆記錄解除標記`, 'ok')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
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
                {{ summary.count }} 筆 · 支出 {{ fmtMoney(summary.expense, settings.baseCurrency) }}
              </em>
            </span>
            <span class="status__tag">旅行中</span>
          </div>
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

          <!-- 日期（純顯示，不影響記錄歸屬——使用者拍板） -->
          <div class="grid2">
            <label class="lb">
              <span>出發日</span>
              <DateField v-model="draft.startDate" @update:model-value="applyDate('startDate')" />
            </label>
            <label class="lb">
              <span>回程日</span>
              <DateField v-model="draft.endDate" @update:model-value="applyDate('endDate')" />
            </label>
          </div>

          <!-- 旅行貨幣：旅行期間記帳頁自動用它（每一筆仍可手動改） -->
          <label class="lb">
            <span>旅行貨幣 <em class="lb__hint">留「不自動切換」＝記帳頁幣別不動</em></span>
            <select v-model="draft.currency" class="field" @change="applyCurrency">
              <option value="">不自動切換</option>
              <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
            <span v-if="rateLine" class="tiny muted rateline num">{{ rateLine }}</span>
          </label>

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

/* 進行中狀態卡：行李箱 ＋ 名稱 ＋ 即時小計 ＋「旅行中」標籤（琥珀＝旅行主題色） */
.status {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border-radius: var(--r-md);
  background: var(--amber-soft);
  border: 1px solid var(--amber-line);
}
.status__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--amber);
  border: 1px solid var(--amber-line);
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
  border: 1px solid var(--amber);
  color: var(--amber);
  font-size: 11.5px;
  font-weight: 700;
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
  border-color: var(--amber);
  background: var(--amber-soft);
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
  border-color: var(--amber);
  background: var(--surface);
  color: var(--amber);
}

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
