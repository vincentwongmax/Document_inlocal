<script setup lang="ts">
/**
 * 0.1.66：快速記錄表格頁（設定頁 → 匯入 → 模式 2／3 送出的落點）。
 *
 * 使用者原話：「快速記錄模式按鈕 --> 彈出子頁面(參考記錄明細的頁面，一定要美觀,
 * 用類表格的形式) --> 支出/收入 貨幣 金額 分類 備註 日期時間 提交…這個頁面有，
 * 新增按鈕(按一下新增一行空白行)(空白行的資料 --)和提交按鈕, 在表格裡，用戶點擊,
 * 彈出頁面(輸入框，複製,貼上,清空 ,確定)按鈕，(都要一行過…超過左右的頁面用戶可以左右滑動」
 *
 * 設計（由我自行決策，詳見 CHANGELOG 0.1.66）：
 * - **一列一筆**的類表格（div grid，不是 <table>：格子要能放按鈕、要能橫滑），
 *   欄寬用 minmax 設地板 → 窄屏時整張表可以左右滑動，不會擠成亂碼。
 * - **點格子**開編輯器（z-index 96，蓋在這個頁面 92 之上）：一個輸入框＋
 *   「複製／貼上／清空／確定」四顆一排（使用者要求「都要一行過」）。
 *   解析沿用 quickParse 的單欄 helper（parseTypeText…），所以規則與貼上時完全一致。
 * - **新增一列**＝一列全空白的草稿（格子顯示 --）；**每列右邊 ✕** 直接刪
 *   （草稿列刪掉不可復原，但還沒寫入任何資料，我判斷不必多一道確認——使用者沒指定）。
 * - **提交**只寫入「完整」的列（amount>0 且分類解得開）；不完整的列標紅但不寫入，
 *   吐司說明幾筆寫入、幾筆略過，讓使用者當場知道。
 * - 寫入走 `records.add()`（自動算 rate/baseAmount、發 uid）；旅行模式一開著時
 *   跟主頁記帳一樣帶上 tripId（0.1.35 的行為）。
 */
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { notify } from '@/lib/alerts'
import {
  blankDraft,
  parseAmountText,
  parseCategoryText,
  parseCurrencyText,
  parseTypeText,
  recheckDraft,
  type QuickDraft,
  type QuickParseCtx,
} from '@/lib/quickParse'
import { formatFull, fromLocalInput, parseLooseDateTime, toLocalInput } from '@/lib/date'

const props = defineProps<{
  open: boolean
  /** 貼上資料送來的草稿；空陣列＝從一列空白開始（模式 3） */
  drafts: QuickDraft[]
}>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const records = useRecordsStore()

/* ── 幾何：捲動鎖＋下拉關閉（同記錄明細） ───────────────────── */
const bodyEl = ref<HTMLElement | null>(null)
const sheetEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => bodyEl.value })

const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({ panel: sheetEl, scroller: bodyEl, onClose: () => close() })

function close() {
  editing.value = null
  emit('close')
}

/* ── 解析上下文（與 ImportModal 同一份規則） ─────────────────── */
const ctx = computed<QuickParseCtx>(() => ({
  categories: settings.categories,
  currencyCodes: new Set([
    ...settings.allCurrencies.map((c) => c.code.toUpperCase()),
    ...Object.keys(settings.state.rates),
  ]),
  defaultCurrency: settings.inputCurrency,
}))

/** id → 分類（格子顯示分類名用） */
const catMap = computed(() => new Map(ctx.value.categories.map((c) => [c.id, c])))

/* ── 列資料 ───────────────────────────────────────────────── */
const rows = ref<QuickDraft[]>([])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // 深拷貝：父層的 drafts 可能是 computed 的解析結果，不能直接改
    rows.value = props.drafts.length
      ? (JSON.parse(JSON.stringify(props.drafts)) as QuickDraft[])
      : [blankDraft(ctx.value)]
    editing.value = null
  },
  { immediate: true },
)

function addRow() {
  rows.value.push(blankDraft(ctx.value))
}

function removeRow(i: number) {
  rows.value.splice(i, 1)
}

const validCount = computed(() => rows.value.filter((r) => r.issues.length === 0).length)

/* ── 表格 ─────────────────────────────────────────────────── */
type ColKey = 'type' | 'currency' | 'amount' | 'categoryId' | 'note' | 'occurredAt'
const COLS: { key: ColKey; label: string }[] = [
  { key: 'type', label: '收支' },
  { key: 'currency', label: '貨幣' },
  { key: 'amount', label: '金額' },
  { key: 'categoryId', label: '分類' },
  { key: 'note', label: '備註' },
  { key: 'occurredAt', label: '日期時間' },
]

function cellText(row: QuickDraft, col: ColKey): string {
  if (col === 'type') return row.type === 'expense' ? '支出' : '收入'
  if (col === 'currency') return row.currency
  if (col === 'amount') return row.amount > 0 ? String(row.amount) : '--'
  if (col === 'categoryId') return catMap.value.get(row.categoryId)?.name ?? '--'
  if (col === 'note') return row.note || '--'
  return formatFull(row.occurredAt)
}

/** 這一格有沒有「不完整」的問題（標紅用） */
function badCell(row: QuickDraft, col: ColKey): boolean {
  const has = (s: string) => row.issues.some((x) => x.includes(s))
  if (col === 'amount') return has('金額')
  if (col === 'categoryId') return has('分類')
  return false
}

/* ── 格子編輯器 ───────────────────────────────────────────── */
const editing = ref<{ row: number; col: ColKey } | null>(null)
const editText = ref('')
const editErr = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
/** 內部剪貼簿：navigator.clipboard 沒權限時的落點（同一支 App 內一定可用） */
const clip = ref('')

const editColLabel = computed(() => COLS.find((c) => c.key === editing.value?.col)?.label ?? '')
const editHint = computed(() => {
  switch (editing.value?.col) {
    case 'type':
      return 'A／支出＝支出，B／收入＝收入'
    case 'currency':
      return '例：MOP、HKD；空白＝記帳幣別'
    case 'amount':
      return '例：12.5（要大於 0）'
    case 'categoryId':
      return '例：1（編號，見設定頁分類區）或 餐飲 › 午餐（全名）'
    case 'occurredAt':
      return '例：2026/10/17 23:13；空白＝現在'
    default:
      return ''
  }
})

function openEditor(i: number, col: ColKey) {
  editing.value = { row: i, col }
  const row = rows.value[i]
  // 編輯框帶的是「顯示文字」，日期時間用 YYYY/MM/DD HH:mm 人類格式
  editText.value = col === 'occurredAt' ? formatFull(row.occurredAt) : cellText(row, col)
  if (editText.value === '--') editText.value = ''
  editErr.value = ''
  nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
}

/** 複製：把輸入框現在的文字複製出去（系統剪貼簿＋內部備份） */
async function copyCell() {
  clip.value = editText.value
  try {
    await navigator.clipboard.writeText(editText.value)
  } catch {
    /* 沒權限就只留內部剪貼簿 */
  }
  notify('已複製', 'ok')
}

/** 貼上：先試系統剪貼簿，失敗落內部備份 */
async function pasteCell() {
  try {
    const t = await navigator.clipboard.readText()
    if (t) {
      editText.value = t.trim()
      return
    }
  } catch {
    /* 沒權限就落內部剪貼簿 */
  }
  if (clip.value) {
    editText.value = clip.value
    return
  }
  notify('還沒有可貼上的內容', 'warn')
}

function applyEdit() {
  const ed = editing.value
  if (!ed) return
  const row = rows.value[ed.row]
  const t = editText.value
  const fail = (msg: string) => (editErr.value = msg)

  if (ed.col === 'type') {
    const v = parseTypeText(t)
    if (!v) return fail('請填 A／B／支出／收入')
    row.type = v
  } else if (ed.col === 'currency') {
    const v = parseCurrencyText(t, ctx.value)
    if (!v) return fail(`「${t.trim()}」不是可用的貨幣代碼`)
    row.currency = v
  } else if (ed.col === 'amount') {
    const v = parseAmountText(t)
    if (!v) return fail('金額請填大於 0 的數字')
    row.amount = v
  } else if (ed.col === 'categoryId') {
    const v = parseCategoryText(t, row.type, ctx.value)
    if (!v) return fail('找不到這個分類（可填編號或全名）')
    row.categoryId = v
  } else if (ed.col === 'note') {
    row.note = t.trim()
  } else {
    if (!t.trim()) row.occurredAt = new Date().toISOString()
    else {
      const v = parseLooseDateTime(t, toLocalInput(row.occurredAt))
      if (!v) return fail('日期格式看不懂，例：2026/10/17 23:13')
      row.occurredAt = fromLocalInput(v)
    }
  }

  recheckDraft(row)
  // 分類的收支別要跟這一列相同（換了收支之後舊分類會不合身）
  const cat = catMap.value.get(row.categoryId)
  if (cat && cat.type !== row.type) row.issues.push('分類與收支不符')
  editing.value = null
}

/* ── 提交 ─────────────────────────────────────────────────── */
function submit() {
  const good = rows.value.filter((r) => r.issues.length === 0)
  if (!good.length) return
  const trip = settings.activeTrip
  for (const d of good) {
    records.add({
      type: d.type,
      categoryId: d.categoryId,
      amount: d.amount,
      currency: d.currency,
      occurredAt: d.occurredAt,
      note: d.note,
      source: 'manual',
      ...(trip?.mode1 ? { tripId: trip.id } : {}),
    })
  }
  const bad = rows.value.length - good.length
  notify(
    bad ? `已新增 ${good.length} 筆，${bad} 筆資料不完整未匯入` : `已新增 ${good.length} 筆記錄`,
    bad ? 'warn' : 'ok',
  )
  close()
}

/* ── Escape ───────────────────────────────────────────────── */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (editing.value) editing.value = null
  else close()
}
watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="mask bsheet-mask" @click.self="close">
    <div
      ref="sheetEl"
      class="card bsheet"
      :class="{ 'is-dragging': pulling }"
      :style="pullStyle"
      role="dialog"
      aria-modal="true"
      aria-label="快速記錄"
      @touchstart="onSheetTouchStart"
      @touchmove="onSheetTouchMove"
      @touchend="onSheetTouchEnd"
      @touchcancel="onSheetTouchEnd"
      @mousedown="onSheetMouseDown"
    >
      <div class="bsheet__grab" aria-hidden="true"></div>

      <div ref="bodyEl" class="box bsheet__body">
        <h3>快速記錄</h3>
        <p class="tiny muted lead">
          一列一筆，點格子就能編輯；不完整的列會標紅，提交時只會寫入完整的列。
        </p>

        <div class="statline">
          <span>共 <b class="num">{{ rows.length }}</b> 列</span>
          <span class="statline__dot">·</span>
          <span>可提交 <b class="num">{{ validCount }}</b> 筆</span>
          <span class="tiny muted statline__hint">表格可左右滑動</span>
        </div>

        <!-- 類表格：標頭列＋資料列，整個包在可橫滑的容器裡 -->
        <div class="tblwrap">
          <div class="tbl">
            <div class="tbl__hd">
              <span v-for="c in COLS" :key="c.key" class="th">{{ c.label }}</span>
              <span class="th th--x"></span>
            </div>
            <div v-for="(row, i) in rows" :key="i" class="tr">
              <button
                v-for="c in COLS"
                :key="c.key"
                type="button"
                class="td"
                :class="{
                  'is-bad': badCell(row, c.key),
                  'td--type': c.key === 'type',
                  'is-income': c.key === 'type' && row.type === 'income',
                }"
                @click="openEditor(i, c.key)"
              >
                <span class="td__v">{{ cellText(row, c.key) }}</span>
              </button>
              <button type="button" class="td td--x" @click="removeRow(i)">✕</button>
            </div>
            <div v-if="!rows.length" class="tbl__empty tiny muted">還沒有任何一列，按下方按鈕新增</div>
          </div>
        </div>

        <button type="button" class="addrow" @click="addRow">＋ 新增一列</button>
      </div>

      <!-- 頁腳固定（在可捲區之外，0.1.65 的做法） -->
      <div class="foot">
        <button class="btn" type="button" @click="close">取消</button>
        <button class="btn btn--primary" type="button" :disabled="!validCount" @click="submit">
          提交（{{ validCount }}）
        </button>
      </div>
    </div>

    <!-- 格子編輯器：蓋在快速記錄頁之上 -->
    <div v-if="editing" class="mask edmask" @click.self="editing = null">
      <div class="ed" role="dialog" aria-modal="true" :aria-label="editColLabel + '編輯'">
        <div class="ed__hd">
          <span class="ed__t">編輯「{{ editColLabel }}」</span>
          <button type="button" class="ed__x" @click="editing = null">✕</button>
        </div>
        <input
          ref="inputEl"
          v-model="editText"
          class="ed__in"
          type="text"
          spellcheck="false"
          :inputmode="editing?.col === 'amount' ? 'decimal' : 'text'"
          placeholder="輸入後按「確定」"
          @keydown.enter="applyEdit"
        />
        <p v-if="editHint" class="tiny muted ed__hint">{{ editHint }}</p>
        <p v-if="editErr" class="tiny ed__err">{{ editErr }}</p>
        <!-- 四顆一排（使用者要求「都要一行過」） -->
        <div class="ed__btns">
          <button type="button" class="ed__btn" @click="copyCell">複製</button>
          <button type="button" class="ed__btn" @click="pasteCell">貼上</button>
          <button type="button" class="ed__btn" @click="editText = ''">清空</button>
          <button type="button" class="ed__btn ed__btn--ok" @click="applyEdit">確定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  z-index: 92;
}
/* 格子編輯器要**自己**是整面 fixed 覆蓋層——它跟 .card.bsheet 同層，
   若不是 fixed 就會變成 .bsheet-mask（flex）的第二個子元素，把彈層擠成窄條 */
.edmask {
  position: fixed;
  inset: 0;
  z-index: 96;
  background: rgba(27, 26, 24, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
}
.box {
  padding: 4px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.box h3 {
  font-size: 16px;
}
.lead {
  margin: -6px 0 0;
  line-height: 1.5;
}
.statline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}
.statline b {
  font-size: 15px;
  color: var(--text);
}
.statline__dot {
  color: var(--text-3);
}
.statline__hint {
  margin-left: auto;
}

/* ── 表格 ─────────────────────────────────────────────────── */
.tblwrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  -webkit-overflow-scrolling: touch;
}
.tbl {
  min-width: 100%;
}
.tbl__hd,
.tr {
  display: grid;
  /* 地板寬度讓窄屏整張表橫滑，而不是把格子壓成亂碼 */
  grid-template-columns:
    48px 54px 68px
    minmax(84px, 1.1fr) minmax(84px, 1fr) minmax(116px, 1.3fr)
    32px;
}
.tbl__hd {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-3);
  border-bottom: 1px solid var(--line);
}
.th {
  padding: 7px 6px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-3);
  white-space: nowrap;
}
.th--x {
  padding: 0;
}
.tr {
  border-bottom: 1px solid var(--line);
}
.tr:last-child {
  border-bottom: 0;
}
.td {
  min-width: 0;
  padding: 8px 6px;
  text-align: left;
  font-size: 12.5px;
  color: var(--text);
  background: none;
}
.td__v {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.td:hover {
  background: var(--surface-3);
}
/* 不完整的格子標紅（金額／分類） */
.td.is-bad {
  color: var(--expense);
  background: color-mix(in srgb, var(--expense) 10%, transparent);
}
.td--type {
  font-weight: 650;
  color: var(--expense);
}
.td--type.is-income {
  color: var(--accent);
}
.td--x {
  padding: 8px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
.td--x:hover {
  color: var(--expense);
}
.tbl__empty {
  padding: 18px 12px;
  text-align: center;
}

/* ── 新增一列 ─────────────────────────────────────────────── */
.addrow {
  padding: 9px;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
.addrow:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* ── 格子編輯器 ───────────────────────────────────────────── */
.ed {
  width: min(420px, calc(100vw - 36px));
  padding: 14px 16px 16px;
  border-radius: var(--r-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-2, 0 12px 40px rgba(0, 0, 0, 0.22));
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ed__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ed__t {
  font-size: 14.5px;
  font-weight: 700;
}
.ed__x {
  padding: 2px 6px;
  border: 0;
  background: none;
  font-size: 13px;
  color: var(--text-3);
}
.ed__x:hover {
  color: var(--text);
}
.ed__in {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text);
  font-size: 15px;
}
.ed__in:focus {
  outline: none;
  border-color: var(--accent);
}
.ed__hint {
  margin: -4px 0 0;
  line-height: 1.45;
}
.ed__err {
  margin: -4px 0 0;
  color: var(--expense);
}
.ed__btns {
  display: flex;
  gap: 6px;
}
.ed__btn {
  flex: 1;
  height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}
.ed__btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.ed__btn--ok {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.ed__btn--ok:hover {
  filter: brightness(1.06);
  color: #fff;
}

.foot {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--line);
}
.foot .btn {
  flex: 1;
}
</style>
