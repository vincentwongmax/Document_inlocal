<script setup lang="ts">
/**
 * 0.1.67：把「快速記錄表格」併進匯入彈窗的「快速記錄」分頁
 * （0.1.66 是獨立的子頁面 QuickRecordSheet，現在使用者要求搬過來合一）。
 *
 * 使用者原話（0.1.66/0.1.67 系列）：
 *   - 「在設定頁中，匯入頁面中的快速記錄的選項，移除這個頁面的所有內容，
 *      把快速記錄的頁面的東西搬到這裡。」
 *   - 右上角新增關閉按鈕；標題中的日期時間要與文本對齊、小一點、灰色。
 *   - 關閉或下拉關閉後，再次打開應保留數據（不應清空，防誤關）。
 *   - 點擊空白時不自動對焦輸入框；按複製/貼上按鈕後自動關閉目前編輯頁面（即代替確定）。
 *
 * 設計（由我自行決策，詳見 CHANGELOG 0.1.67）：
 * - **三個分頁合一**：JSON（沿用 hidden file input）、貼上資料（解析後「送出到快速記錄」
 *   直接把草稿載入表格並切到該分頁）、快速記錄（原本獨立子頁面的表格、編輯器、新增列、提交）。
 * - **關閉後保留資料**：用模組級 `savedRows` 快取（跨開關、甚至離開設定頁都還在），
 *   取消／下拉關閉時寫回，再次打開還原；提交成功才清空，避免重複匯入。
 * - **右上角關閉 ✕** 蓋在整張卡片上；標題旁顯示當下日期時間（tiny、灰色、與標題基線對齊）。
 * - **編輯器不自動對焦**（手機不會一開就彈鍵盤）；**複製/貼上＝套用並關閉**（代替「確定」）。
 * - 幾何沿用 ExportModal（bsheet、下拉關閉、Escape 關閉）；頁腳放在 `.bsheet__body` 外面（0.1.65 教訓）。
 */
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { notify } from '@/lib/alerts'
import {
  blankDraft,
  parseAmountText,
  parseCategoryText,
  parseCurrencyText,
  parseQuickLines,
  parseTypeText,
  recheckDraft,
  type QuickDraft,
  type QuickParseCtx,
} from '@/lib/quickParse'
import { formatFull, fromLocalInput, parseLooseDateTime, toLocalInput } from '@/lib/date'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  /** JSON 分頁：請父層開 hidden file input（原本的匯入流程） */
  'pick-json': []
}>()

const settings = useSettingsStore()
const records = useRecordsStore()

/* ── 幾何：捲動鎖＋下拉關閉（同 ExportModal） ───────────────── */
const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })

const sheetEl = ref<HTMLElement | null>(null)
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({
  panel: sheetEl,
  scroller: boxEl,
  onClose: () => closeAll(),
})

/* ── 解析上下文（與貼上/表格同一份規則） ─────────────────────── */
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

/* ── 分頁 ─────────────────────────────────────────────────── */
type Tab = 'json' | 'paste' | 'quick'
const TABS: { key: Tab; label: string }[] = [
  { key: 'json', label: '匯入 JSON' },
  { key: 'paste', label: '貼上資料' },
  { key: 'quick', label: '快速記錄' },
]
const tab = ref<Tab>('json')
const text = ref('')
/** 標題旁的「現在」日期時間（開啟時定格一次，不會一直跳） */
const nowText = ref('')

/**
 * 跨開關保留草稿（防誤關後資料消失）。
 * 放在模組級：即使 ImportModal 隨 SettingsView 卸載再掛載，資料仍在。
 * null ＝ 還沒編輯過，開啟時從一列空白開始。
 */
let savedRows: QuickDraft[] | null = null

const rows = ref<QuickDraft[]>([])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // 有上次保留的資料 → 直接回到快速記錄分頁讓使用者看到；否則從 JSON 分頁開始
    tab.value = savedRows ? 'quick' : 'json'
    text.value = ''
    rows.value = savedRows
      ? (JSON.parse(JSON.stringify(savedRows)) as QuickDraft[])
      : [blankDraft(ctx.value)]
    editing.value = null
    nowText.value = formatFull(new Date().toISOString())
  },
  { immediate: true },
)

function selectTab(k: Tab) {
  tab.value = k
  // 切分頁時收掉格子編輯器，避免懸浮在別的分頁上
  editing.value = null
}

/* ── 貼上資料：即時解析預覽 ────────────────────────────────── */
const drafts = computed<QuickDraft[]>(() =>
  text.value.trim() ? parseQuickLines(text.value, ctx.value) : [],
)
const badCount = computed(() => drafts.value.filter((d) => d.issues.length > 0).length)

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

const validCount = computed(() => rows.value.filter((r) => r.issues.length === 0).length)

function addRow() {
  rows.value.push(blankDraft(ctx.value))
}

function removeRow(i: number) {
  rows.value.splice(i, 1)
}

/** 0.1.68：標題行的「刪除」＝清空整張快速記錄表（與每列 ✕ 同一套「不確認」行為；皆是未存檔的草稿） */
function clearAll() {
  rows.value = []
}

/* ── 格子編輯器 ───────────────────────────────────────────── */
const editing = ref<{ row: number; col: ColKey } | null>(null)
const editText = ref('')
const editErr = ref('')
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
  // ⚠ 需求3：不自動對焦（手機不會一開就彈鍵盤，使用者要打字再自己點輸入框）
}

/** 複製：把輸入框現在的文字複製出去（系統剪貼簿＋內部備份）後套用並關閉（代替確定） */
async function copyCell() {
  const t = editText.value
  clip.value = t
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    /* 沒權限就只留內部剪貼簿 */
  }
  notify('已複製', 'ok')
  applyEdit()
}

/** 貼上：先試系統剪貼簿，失敗落內部備份；貼上後套用並關閉（代替確定） */
async function pasteCell() {
  let t: string | null = null
  try {
    const c = await navigator.clipboard.readText()
    if (c) t = c.trim()
  } catch {
    /* 沒權限就落內部剪貼簿 */
  }
  if (!t && clip.value) t = clip.value
  if (!t) {
    notify('還沒有可貼上的內容', 'warn')
    return
  }
  editText.value = t
  applyEdit()
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
  // 提交成功 → 清空暫存，避免下次重複匯入
  savedRows = null
  rows.value = []
  emit('close')
}

/* ── 頁腳主要動作（每個分頁不同） ─────────────────────────── */
const primaryLabel = computed(() => {
  if (tab.value === 'json') return '選擇 JSON 檔案'
  if (tab.value === 'paste') return '送出到快速記錄'
  return `提交（${validCount.value}）`
})
const primaryOff = computed(() => {
  if (tab.value === 'paste') return drafts.value.length === 0
  if (tab.value === 'quick') return validCount.value === 0
  return false
})

function runPrimary() {
  if (primaryOff.value) return
  if (tab.value === 'json') {
    emit('pick-json')
    return
  }
  if (tab.value === 'paste') {
    // 把解析到的草稿直接載入表格並切到快速記錄分頁（合一後不再開獨立子頁面）
    rows.value = drafts.value.length
      ? (JSON.parse(JSON.stringify(drafts.value)) as QuickDraft[])
      : [blankDraft(ctx.value)]
    tab.value = 'quick'
    return
  }
  submit()
}

/* ── 關閉（取消／下拉／✕ 共用）：先保留資料再關 ─────────────── */
function closeAll() {
  savedRows = JSON.parse(JSON.stringify(rows.value))
  editing.value = null
  emit('close')
}

/* ── Escape ───────────────────────────────────────────────── */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (editing.value) editing.value = null
  else closeAll()
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
  <div v-if="open" class="mask bsheet-mask" @click.self="closeAll">
    <div
      ref="sheetEl"
      class="card bsheet"
      :class="{ 'is-dragging': pulling }"
      :style="pullStyle"
      role="dialog"
      aria-modal="true"
      aria-label="匯入資料"
      @touchstart="onSheetTouchStart"
      @touchmove="onSheetTouchMove"
      @touchend="onSheetTouchEnd"
      @touchcancel="onSheetTouchEnd"
      @mousedown="onSheetMouseDown"
    >
      <!-- 抓把：往下拉即可關閉 -->
      <div class="bsheet__grab" aria-hidden="true"></div>
      <!-- 需求1：右上角關閉 ✕ -->
      <button type="button" class="qr__close" aria-label="關閉" @click="closeAll">✕</button>

      <div ref="boxEl" class="box bsheet__body">
        <h3>匯入資料</h3>

        <!-- 三個分頁 -->
        <div class="seg" role="tablist">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="seg__btn"
            :class="{ 'is-on': tab === t.key }"
            role="tab"
            :aria-selected="tab === t.key"
            @click="selectTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- ① 匯入 JSON：系統原有的模式（開檔案選擇器） -->
        <template v-if="tab === 'json'">
          <div class="pane">
            <p class="pane__lead">
              選擇 App 之前匯出的 <b>.json</b> 備份檔。記錄會<b>合併去重</b>（依 id 與圖片 MD5），
              不會覆蓋已有的資料；可以選擇只匯入記錄，或連錢包與設定（分類、匯率、幣別）一起還原。
            </p>
            <button class="dropzone" type="button" @click="emit('pick-json')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15V5m0 0 4 4m-4-4-4 4" />
                <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
              </svg>
              <span class="dropzone__t">選擇 JSON 檔案</span>
              <span class="dropzone__d tiny">副檔名 .json（含記錄、設定與圖片的完整備份）</span>
            </button>
          </div>
        </template>

        <!-- ② 貼上資料：輸入框＋即時解析 -->
        <template v-else-if="tab === 'paste'">
          <div class="pane">
            <div class="pane__hd">
              <span class="tiny muted">每列一筆，欄位順序不拘，空白或 Tab 分隔都可以</span>
              <button v-if="text" class="linkbtn" type="button" @click="text = ''">清空</button>
            </div>
            <textarea
              v-model="text"
              class="ta"
              rows="6"
              spellcheck="false"
              placeholder="A MOP 10 1 test 2026/10/17 23:13&#10;100 1 test1 2026/10/17 23:13"
            ></textarea>
            <div class="help">
              <p class="help__t tiny">格式說明</p>
              <ul class="help__list tiny">
                <li><b>收支</b>：A／支出＝支出，B／收入＝收入（沒填＝支出）</li>
                <li><b>貨幣</b>：MOP、HKD…（沒填＝記帳幣別）</li>
                <li><b>金額</b>：第一個數字（必填）</li>
                <li><b>分類</b>：編號或全名；編號請對照「設定 → 分類」區每顆分類前面的號碼（同收支別、由 1 起）</li>
                <li><b>備註</b>：看不懂的文字都會留在這裡</li>
                <li><b>日期時間</b>：2026/10/17、2026/10/17 23:13（沒填＝現在）</li>
                <li>從 Excel 複製貼上也可以：<code>11 → 1 → test → 2026/10/17 23:13</code></li>
              </ul>
            </div>
            <div v-if="drafts.length" class="sum">
              <div class="sum__line">
                <span class="tiny muted">解析到</span>
                <strong class="num">{{ drafts.length }}</strong>
                <span class="tiny muted">筆</span>
                <template v-if="badCount">
                  <span class="sum__dot">·</span>
                  <strong class="num sum__bad">{{ badCount }}</strong>
                  <span class="tiny muted">筆資料不完整</span>
                </template>
              </div>
              <p class="tiny muted sum__hint">
                <template v-if="badCount">
                  不完整的列會照樣帶到表格（標紅），補齊後再送出；也可以只送出完整的列
                </template>
                <template v-else>全部完整，按下「送出到快速記錄」逐格確認</template>
              </p>
            </div>
          </div>
        </template>

        <!-- ③ 快速記錄：類表格（原本獨立子頁面的內容搬過來） -->
        <template v-else>
          <div class="pane">
            <div class="qrhead">
              <h4 class="qrhead__t">快速記錄</h4>
              <span class="qrhead__dt tiny muted">{{ nowText }}</span>
              <button type="button" class="qrhead__del" @click="clearAll">刪除</button>
            </div>
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
                <div v-if="!rows.length" class="tbl__empty tiny muted">
                  還沒有任何一列，按下方按鈕新增
                </div>
              </div>
            </div>

            <button type="button" class="addrow" @click="addRow">＋ 新增一列</button>
          </div>
        </template>
      </div>

      <!-- 頁腳固定（在可捲區之外，0.1.65 的做法） -->
      <div class="foot">
        <button class="btn" type="button" @click="closeAll">取消</button>
        <button class="btn btn--primary" type="button" :disabled="primaryOff" @click="runPrimary">
          {{ primaryLabel }}
        </button>
      </div>
    </div>

    <!-- 格子編輯器：蓋在匯入彈窗之上（z-index 96） -->
    <div v-if="editing" class="mask edmask" @click.self="editing = null">
      <div class="ed" role="dialog" aria-modal="true" :aria-label="editColLabel + '編輯'">
        <div class="ed__hd">
          <span class="ed__t">編輯「{{ editColLabel }}」</span>
          <button type="button" class="ed__x" @click="editing = null">✕</button>
        </div>
        <input
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
        <!-- 四顆一排（使用者要求「都要一行過」）；複製/貼上＝套用並關閉（代替確定） -->
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
  z-index: 90;
}
/* 需求1：右上角關閉 ✕（蓋在整張卡片上，任何分頁都看得到） */
.qr__close {
  position: absolute;
  top: 7px;
  right: 9px;
  z-index: 3;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: none;
  font-size: 15px;
  line-height: 1;
  color: var(--text-3);
}
.qr__close:hover {
  background: var(--surface-3);
  color: var(--text);
}
.box {
  padding: 4px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.box h3 {
  font-size: 16px;
}
/* ⚠ .seg 是各彈窗 scoped 的（ExportModal 裡那一份不會帶過來），要自己有一份 */
.seg {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 32px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pane__lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-2);
}
.pane__lead b {
  color: var(--text);
}
.pane__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 20px;
}
.linkbtn {
  padding: 0;
  border: 0;
  background: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}
.linkbtn:hover {
  text-decoration: underline;
}

/* ── JSON 分頁的大按鈕 ────────────────────────────────────── */
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 20px 12px 18px;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  transition:
    border-color 0.15s,
    background 0.15s;
}
.dropzone svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  margin-bottom: 4px;
}
.dropzone__t {
  font-size: 14px;
  font-weight: 650;
}
.dropzone__d {
  color: var(--text-3);
}
.dropzone:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.dropzone:hover svg {
  stroke: var(--accent);
}
.dropzone:hover .dropzone__t {
  color: var(--accent);
}

/* ── 貼上資料的輸入框與說明 ───────────────────────────────── */
.ta {
  width: 100%;
  min-height: 108px;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  resize: vertical;
}
.ta:focus {
  outline: none;
  border-color: var(--accent);
}
.ta::placeholder {
  color: var(--text-3);
}
.help {
  padding: 9px 12px;
  border-radius: var(--r-md);
  background: var(--surface-3);
}
.help__t {
  margin: 0 0 4px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.help__list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.5;
  color: var(--text-2);
}
.help__list b {
  color: var(--text);
}
.help__list code {
  padding: 0 3px;
  border-radius: 4px;
  background: var(--surface);
  font-size: 11.5px;
}

/* ── 摘要（沿用 ExportModal 的 .sum） ─────────────────────── */
.sum {
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sum__line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
}
.sum__line strong {
  font-size: 16px;
  color: var(--text);
}
.sum__bad {
  color: var(--expense);
}
.sum__dot {
  color: var(--text-3);
}
.sum__hint {
  margin: 0;
  line-height: 1.45;
}

/* ── 快速記錄分頁：標題＋日期時間（需求1：小、灰、與標題基線對齊） ── */
.qrhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.qrhead__t {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.qrhead__dt {
  white-space: nowrap;
}
/* 0.1.68：標題行日期時間右方的「刪除」（清空整張表），靜態的灰階標籤樣式，平衡整列 */
.qrhead__del {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-3);
  cursor: pointer;
}
.qrhead__del:hover {
  color: var(--expense, #bf563c);
}
.lead {
  margin: -4px 0 0;
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
  border: 0;
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
/* 自己要是整面 fixed 覆蓋層——跟 .card.bsheet 同層，
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
