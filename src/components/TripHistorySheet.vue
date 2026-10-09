<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { confirmDialog, notify } from '@/lib/alerts'
import { CURRENCIES, fmtMoney } from '@/lib/currency'
import { formatFull } from '@/lib/date'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import type { TravelTrip } from '@/types'
import DateField from './DateField.vue'
import CategoryIcon from './CategoryIcon.vue'

/**
 * 「過去的旅行」子頁面（0.1.37）→ 0.1.38 加「詳細」視圖。
 *
 * 0.1.36 時這份清單掛在 TravelSheet 底部（只能看）；使用者拍板（0.1.37）：
 * 「過去的旅行按鈕（新增子頁面, 可修改，可刪除）」→ 搬出來變成獨立子頁面。
 * 0.1.38（使用者原話）：「過去的旅行的頁面中，新增詳細的按鈕，把改的按鈕和刪的
 * 按鈕的功能都放到這個頁面，詳細的按鈕打開成一個新的頁面，用文字顯示出來
 * （可以參考記錄明細頁面中的新增時間, 主幣金額等等的格式）（點擊可修改）」→
 *
 * - **列表視圖**：每一列只剩一顆「詳細」（原本的「改／刪」兩顆搬進詳情裡）。
 * - **詳情視圖**（同一張 sheet 切換，不是新路由）：照 `RecordSheet`「詳細資訊」的
 *   `meta__row` 格式，一列「標籤在左、值在右」：
 *     旅行名稱／出發日／回程日／旅行貨幣 —— 點該列就展開編輯表單（點擊可修改）
 *     建立旅行／結束旅行 —— formatFull 的完整時間（記帳當下的歷史事實，不可改）
 *     總使用金額／旅行收入 —— 即時換算成目前的顯示幣別
 *     旅行期間記錄 N 筆 —— 點了跳到記錄頁 `?trip=<id>`（用 tripId **精確**過濾，
 *       不是文字搜索，所以同名旅行也不會搜到不相關的記錄）
 *   刪除旅行在詳情底部（先確認、附筆數；刪完回列表）。
 *
 * 骨架照 `TravelSheet`（＝`QuickAmountSheet` 一脈）：全域 `.bsheet*` 幾何＋
 * `useScrollLock`（背景不動）＋ `usePullToClose`（向下拉真的關閉）＋ 右上角關閉鈕。
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
} = usePullToClose({ panel: sheetEl, scroller: boxEl, onClose: () => emit('close') })

/* ── 清單（新的在上；附即時摘要）──────────────────────── */
const history = computed(() =>
  [...settings.tripHistory].reverse().map((t) => {
    const s = records.tripSummary(t.id)
    return { ...t, count: s.count, expense: s.expense, income: s.income }
  }),
)

/** 每一列的時間說明：建立日 ～ 結束日（缺的就留問號） */
function histRange(h: TravelTrip): string {
  const f = (iso?: string) => (iso ? iso.slice(0, 10).replace(/-/g, '/') : '?')
  return `${f(h.createdAt)} ～ ${f(h.endedAt)}`
}

/* ── 詳情視圖（0.1.38）：列表 ↔ 詳情在同一張 sheet 裡切換 ── */
const detailId = ref<string | null>(null)
/** 正在看的旅行；旅行被刪掉時變 undefined（模板會退回列表） */
const detail = computed(() => settings.tripHistory.find((t) => t.id === detailId.value))
/** 詳情裡的即時摘要（總金額、筆數） */
const detailSum = computed(() =>
  detail.value ? records.tripSummary(detail.value.id) : { count: 0, expense: 0, income: 0 },
)

function openDetail(t: TravelTrip) {
  detailId.value = t.id
  editing.value = false
}

/** 詳情 → 回列表（列表→詳情→返回 的那一顆 ‹） */
function backToList() {
  detailId.value = null
  editing.value = false
}

/** 日期欄位顯示：YYYY-MM-DD → YYYY/MM/DD；沒填就是 — */
function d2(iso?: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '/') : '—'
}

/** 「旅行期間記錄 N 筆」點下去：跳到記錄頁並用 tripId 精確過濾（0.1.38）。
 *  ⚠ 這是**帶 id 的過濾**不是文字搜索——同名旅行、備注提到旅行名都不會誤中。
 *  沒有記錄的旅行不用跳（跳過去只會看到空列表）。 */
function goToRecords(t: TravelTrip, count: number) {
  if (count <= 0) return
  emit('close')
  router.push({ path: '/records', query: { trip: t.id } })
}

/* ── 修改（在詳情裡展開表單；點 meta 列也可進來）────────── */
const editing = ref(false)
const editDraft = ref({ name: '', startDate: '', endDate: '', currency: '' })

function beginEdit() {
  const t = detail.value
  if (!t) return
  editDraft.value = {
    name: t.name,
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    currency: t.currency ?? '',
  }
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function saveEdit() {
  const id = detailId.value
  if (!id) return
  const name = editDraft.value.name.trim()
  settings.updateTripHistory(id, {
    name: name || '旅行',
    startDate: editDraft.value.startDate,
    endDate: editDraft.value.endDate,
    currency: editDraft.value.currency,
  })
  editing.value = false
  notify(`已更新旅行「${name || '旅行'}」`, 'ok')
}

/* ── 刪除（原本在列表列上，0.1.38 搬進詳情底部）────────── */
async function askDelete(t: TravelTrip) {
  const s = records.tripSummary(t.id)
  const answer = await confirmDialog({
    title: `刪除「${t.name}」？`,
    message: `這趟的 ${s.count} 筆記錄會回歸一般記錄（旅行標記一併清除；備注的文字不動）。此操作無法復原。`,
    confirmText: '刪除旅行',
    danger: true,
  })
  if (answer !== 'confirm') return
  const removed = settings.deleteTripHistory(t.id)
  if (!removed) return
  const n = records.clearTripTag(t.id)
  if (detailId.value === t.id) {
    detailId.value = null
    editing.value = false
  }
  notify(`已刪除旅行「${removed.name}」，${n} 筆記錄回歸一般記錄`, 'ok')
}

/* 整個子頁面關掉時把詳情／編輯狀態一起收掉，下次打開回到列表 */
watch(
  () => props.open,
  (v) => {
    if (!v) {
      detailId.value = null
      editing.value = false
    }
  },
)
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
        aria-label="過去的旅行"
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
            <!-- 詳情視圖的返回箭頭（0.1.38） -->
            <button v-if="detailId" class="backbtn" type="button" title="返回列表" aria-label="返回列表" @click="backToList">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 5.5 8 12l6.5 6.5" />
              </svg>
            </button>
            <h3>{{ detail ? detail.name : '過去的旅行' }}</h3>
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

          <!-- 列表視圖 -->
          <template v-if="!detailId">
            <p class="tiny muted hint">
              已結束的旅行都在這裡。記錄的旅行標記會一直保留，記錄頁／統計頁照樣歸組；
              按「詳細」可修改、刪除，或查看這趟的所有記錄。
            </p>

            <p v-if="!history.length" class="tiny muted empty">還沒有結束過的旅行。</p>

            <div class="hist">
              <div v-for="h in history" :key="h.id" class="hist__item">
                <div class="hist__row">
                  <span class="hist__ic" aria-hidden="true">
                    <CategoryIcon name="luggage" :size="15" :stroke="1.9" />
                  </span>
                  <span class="hist__txt">
                    <b>{{ h.name }}</b>
                    <em>{{ histRange(h) }} · {{ h.count }} 筆</em>
                  </span>
                  <span v-if="h.expense > 0" class="hist__amt num">
                    −{{ fmtMoney(h.expense, settings.displayCurrency) }}
                  </span>
                  <!-- 0.1.38：列表只剩「詳細」；原本的改／刪搬進詳情頁 -->
                  <span class="hist__ops">
                    <button class="op op--detail" type="button" title="查看詳細" @click="openDetail(h)">詳細</button>
                  </span>
                </div>
              </div>
            </div>
          </template>

          <!-- 詳情視圖（0.1.38）：meta__row 格式照 RecordSheet「詳細資訊」 -->
          <template v-else-if="detail">
            <!-- 編輯態：名稱／出發日／回程日／貨幣（點 meta 列或「修改旅行」都會進來） -->
            <div v-if="editing" class="edit">
              <label class="lb">
                <span>旅行名稱</span>
                <input
                  v-model="editDraft.name"
                  class="field"
                  type="text"
                  :maxlength="20"
                  enterkeyhint="done"
                />
              </label>
              <div class="grid2">
                <label class="lb">
                  <span>出發日</span>
                  <DateField v-model="editDraft.startDate" />
                </label>
                <label class="lb">
                  <span>回程日</span>
                  <DateField v-model="editDraft.endDate" />
                </label>
              </div>
              <label class="lb">
                <span>旅行貨幣 <em class="lb__hint">只影響標示；記錄金額與匯率是歷史事實</em></span>
                <select v-model="editDraft.currency" class="field">
                  <option value="">無設定</option>
                  <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                    {{ c.code }} · {{ c.name }}
                  </option>
                </select>
              </label>
              <div class="edit__acts">
                <button class="btn btn--ghost" type="button" @click="cancelEdit">取消</button>
                <span class="edit__spring"></span>
                <button class="btn btn--primary" type="button" @click="saveEdit">儲存</button>
              </div>
            </div>

            <template v-else>
              <section class="meta">
                <!-- ↓ 這四列可點：點了展開上面的編輯表單（「點擊可修改」） -->
                <button class="meta__row meta__row--link" type="button" title="點擊修改" @click="beginEdit">
                  <span class="tiny muted">旅行名稱</span>
                  <span class="tiny meta__val">{{ detail.name }}<em class="meta__chev">›</em></span>
                </button>
                <button class="meta__row meta__row--link" type="button" title="點擊修改" @click="beginEdit">
                  <span class="tiny muted">出發日</span>
                  <span class="tiny num meta__val">{{ d2(detail.startDate) }}<em class="meta__chev">›</em></span>
                </button>
                <button class="meta__row meta__row--link" type="button" title="點擊修改" @click="beginEdit">
                  <span class="tiny muted">回程日</span>
                  <span class="tiny num meta__val">{{ d2(detail.endDate) }}<em class="meta__chev">›</em></span>
                </button>
                <button class="meta__row meta__row--link" type="button" title="點擊修改" @click="beginEdit">
                  <span class="tiny muted">旅行貨幣</span>
                  <span class="tiny num meta__val">{{ detail.currency || '無設定' }}<em class="meta__chev">›</em></span>
                </button>
                <!-- ↓ 以下是歷史事實／統計，唯讀 -->
                <div class="meta__row">
                  <span class="tiny muted">建立旅行</span>
                  <span class="tiny num">{{ detail.createdAt ? formatFull(detail.createdAt) : '—' }}</span>
                </div>
                <div class="meta__row">
                  <span class="tiny muted">結束旅行</span>
                  <span class="tiny num">{{ detail.endedAt ? formatFull(detail.endedAt) : '—' }}</span>
                </div>
                <div class="meta__row">
                  <span class="tiny muted">總使用金額</span>
                  <span class="tiny num meta__amt">−{{ fmtMoney(detailSum.expense, settings.displayCurrency) }}</span>
                </div>
                <div v-if="detailSum.income > 0" class="meta__row">
                  <span class="tiny muted">旅行收入</span>
                  <span class="tiny num meta__amt meta__amt--inc">+{{ fmtMoney(detailSum.income, settings.displayCurrency) }}</span>
                </div>
                <!-- 有記錄才可點：跳到記錄頁的旅行過濾（tripId 精確比對，不是文字搜索） -->
                <button
                  v-if="detailSum.count > 0"
                  class="meta__row meta__row--link"
                  type="button"
                  :title="`查看這趟的 ${detailSum.count} 筆記錄`"
                  @click="goToRecords(detail, detailSum.count)"
                >
                  <span class="tiny muted">旅行期間記錄</span>
                  <span class="tiny num meta__val meta__val--amber">{{ detailSum.count }} 筆<em class="meta__chev">›</em></span>
                </button>
                <div v-else class="meta__row">
                  <span class="tiny muted">旅行期間記錄</span>
                  <span class="tiny num muted">0 筆</span>
                </div>
              </section>

              <!-- 刪除旅行：原本列表列上的「刪」搬來這裡（一樣先確認） -->
              <button class="delbtn" type="button" @click="askDelete(detail)">刪除旅行</button>
            </template>
          </template>
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
/* 標題列：返回（詳情時）＋標題在左、「關閉」在最右（跟其他子頁面同一套） */
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hd h3 {
  flex: 1;
  min-width: 0;
  /* 詳情視圖的標題＝旅行名，可能很長：收成一行刪節號 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.backbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-2);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.backbtn:hover {
  border-color: var(--amber);
  background: var(--amber-soft);
  color: var(--amber);
}
.backbtn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.hint,
.empty {
  margin: 0;
}

/* 清單（每列多一顆「詳細」；0.1.38 起不再有改／刪） */
.hist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hist__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
}
.hist__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--amber-soft);
  border: 1px solid var(--amber-line);
  color: var(--amber);
}
.hist__txt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.hist__txt b {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist__txt em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.hist__amt {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  color: var(--expense);
}
/* 「詳細」小鈕（方型圓角，照日期按鈕的家族；琥珀 hover 跟旅行主題同一族） */
.hist__ops {
  flex: none;
  display: flex;
  gap: 6px;
}
.op {
  display: grid;
  place-items: center;
  height: 32px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 700;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.op--detail {
  width: auto;
  padding: 0 11px;
}
.op:hover {
  border-color: var(--amber);
  color: var(--amber);
  background: var(--amber-soft);
}

/* 詳情視圖的 meta 盒：格式照 RecordSheet「詳細資訊」（.meta／.meta__row） */
.meta {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  padding: 2px 12px;
}
.meta__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  font: inherit;
  text-align: left;
  width: 100%;
}
.meta__row:last-child {
  border-bottom: none;
}
/* 可點的列：去按鈕預設外觀、hover 淡淡琥珀；值右側帶 › 提示可按 */
.meta__row--link {
  background: none;
  border-left: none;
  border-right: none;
  border-top: none;
  border-bottom: 1px solid var(--line);
  color: inherit;
  cursor: pointer;
  transition: background 0.12s;
}
.meta__row--link:hover {
  background: var(--amber-soft);
}
.meta__row--link:last-child {
  border-bottom: none;
}
.meta__val {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta__chev {
  font-style: normal;
  color: var(--text-3);
  font-weight: 650;
}
.meta__val--amber {
  color: var(--amber);
}
.meta__amt {
  font-weight: 650;
  color: var(--expense);
}
.meta__amt--inc {
  color: var(--income);
}
/* 刪除旅行（詳情底部，全寬） */
.delbtn {
  width: 100%;
  height: 40px;
  border-radius: var(--r-md);
  border: 1px solid var(--expense);
  background: var(--surface);
  color: var(--expense);
  font-size: 13.5px;
  font-weight: 700;
  transition:
    background 0.12s,
    color 0.12s;
}
.delbtn:hover {
  background: var(--expense-soft);
}

/* 編輯態（展開在詳情裡；欄位跟 0.1.37 同一套）
   0.1.40：底色由琥珀軟底改成白色（使用者原話：「詳細模式按鈕中的修改頁面，
   的區塊的底色改成白色」）；琥珀描邊保留（跟旅行主題同一族，只動底色） */
.edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--amber-line);
  background: var(--surface);
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
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
.grid2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.edit__acts {
  display: flex;
  align-items: center;
  gap: 9px;
}
.edit__spring {
  flex: 1;
}
</style>
