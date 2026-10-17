<script setup lang="ts">
/**
 * 0.1.66：匯入彈窗——設定頁「匯入」鈕現在開的是這個三分頁子頁面，
 * 而不是直接彈檔案選擇器（原本的行為搬到「匯入 JSON」分頁裡）。
 *
 * 使用者原話：「在設定的頁面中，在匯入的按鈕中，改成彈出分頁…有3個匯入模式
 *  1. 匯入JSON --> 系統原有的模式
 *  2. 貼上資料(輸入框)(增量匯入)…用戶按提交後，弾出快速記錄模式的頁面(模式3)
 *  3. 快速記錄模式按鈕 --> 彈出子頁面…用類表格的形式」
 *
 * 設計（由我自行決策，詳見 CHANGELOG 0.1.66）：
 * - **JSON 分頁只負責開檔案選擇器**：按下「選擇 JSON 檔案」後 emit('pick-json')，
 *   由 SettingsView 保留的 hidden file input 接手，後續的「連設定一起還原／只匯入
 *   記錄」確認與合併去重完全是 0.1.66 之前的原本流程（v99 的測試也不受影響）。
 * - **貼上資料分頁**：textarea 即時解析（純函式 parseQuickLines），下方顯示
 *   「解析到 N 筆、M 筆不完整」摘要；送出時 emit('quick', drafts)，
 *   交給 QuickRecordSheet（z-index 92）讓使用者增加或修正後才真正寫入。
 * - **快速記錄分頁**：emit('quick', [])——QuickRecordSheet 會自開一列空白列。
 * - 幾何沿用 ExportModal（bsheet、下拉關閉、Escape 關閉）；
 *   頁腳放在 `.bsheet__body` **外面**（0.1.65 的教訓：foot 要固定，不能跟著捲）。
 */
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { parseQuickLines, type QuickDraft, type QuickParseCtx } from '@/lib/quickParse'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  /** JSON 分頁：請父層開 hidden file input（原本的匯入流程） */
  'pick-json': []
  /** 貼上資料／快速記錄：把草稿交給快速記錄表格頁（空陣列＝從一列空白開始） */
  quick: [drafts: QuickDraft[]]
}>()

const settings = useSettingsStore()

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
  onClose: () => emit('close'),
})

/* ── 分頁 ─────────────────────────────────────────────────── */
type Tab = 'json' | 'paste' | 'quick'
const TABS: { key: Tab; label: string }[] = [
  { key: 'json', label: '匯入 JSON' },
  { key: 'paste', label: '貼上資料' },
  { key: 'quick', label: '快速記錄' },
]
const tab = ref<Tab>('json')

/** 每次開啟都回到第一頁，貼上框也清空（不留上次的殘影） */
const text = ref('')
watch(
  () => props.open,
  (open) => {
    if (!open) return
    tab.value = 'json'
    text.value = ''
  },
  { immediate: true },
)

/* ── 解析上下文：分類、認得的幣別、預設貨幣 ─────────────────── */
const ctx = computed<QuickParseCtx>(() => ({
  categories: settings.categories,
  currencyCodes: new Set([
    ...settings.allCurrencies.map((c) => c.code.toUpperCase()),
    ...Object.keys(settings.state.rates),
  ]),
  defaultCurrency: settings.inputCurrency,
}))

/* ── 貼上資料：即時解析預覽 ────────────────────────────────── */
const drafts = computed<QuickDraft[]>(() =>
  text.value.trim() ? parseQuickLines(text.value, ctx.value) : [],
)
const badCount = computed(() => drafts.value.filter((d) => d.issues.length > 0).length)

/** 頁腳主要動作（每個分頁不同） */
const primaryLabel = computed(() => {
  if (tab.value === 'json') return '選擇 JSON 檔案'
  if (tab.value === 'paste') return '送出到快速記錄'
  return '開啟空白表格'
})
const primaryOff = computed(() => tab.value === 'paste' && drafts.value.length === 0)

function runPrimary() {
  if (primaryOff.value) return
  if (tab.value === 'json') {
    emit('pick-json')
    return
  }
  if (tab.value === 'paste') {
    emit('quick', drafts.value)
    return
  }
  emit('quick', [])
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
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
  <div v-if="open" class="mask bsheet-mask" @click.self="emit('close')">
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
            @click="tab = t.key"
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
                不完整的列會照樣帶到快速記錄頁（標紅），補齊後再送出；也可以只送出完整的列
                </template>
                <template v-else>全部完整，按下「送出到快速記錄」逐筆確認</template>
              </p>
            </div>
          </div>
        </template>

        <!-- ③ 快速記錄：開一列空白表格 -->
        <template v-else>
          <div class="pane">
            <p class="pane__lead">
              開啟類表格的快速記錄頁：一列一筆，可以直接在格子裡輸入，也可以從 Excel
              整塊複製貼上後再逐列修改。支援<b>新增列</b>、逐格編輯，確認後一次全部寫入。
            </p>
            <div class="preview" aria-hidden="true">
              <div class="preview__row preview__row--hd">
                <span>收支</span><span>貨幣</span><span>金額</span><span>分類</span><span>備註</span><span>日期時間</span>
              </div>
              <div class="preview__row">
                <span class="preview__ph">--</span><span class="preview__ph">--</span
                ><span class="preview__ph">--</span><span class="preview__ph">--</span
                ><span class="preview__ph">--</span><span class="preview__ph">--</span>
              </div>
              <div class="preview__row preview__row--add">
                <span>＋ 新增一列</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 頁腳固定（在可捲區之外，0.1.65 的做法） -->
      <div class="foot">
        <button class="btn" type="button" @click="emit('close')">取消</button>
        <button class="btn btn--primary" type="button" :disabled="primaryOff" @click="runPrimary">
          {{ primaryLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  z-index: 90;
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

/* ── 快速記錄分頁的示意表 ─────────────────────────────────── */
.preview {
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  font-size: 12px;
}
.preview__row {
  display: grid;
  grid-template-columns: 44px 44px 1fr 1fr 1fr 1.4fr;
  gap: 1px;
}
.preview__row > span {
  padding: 7px 6px;
  background: var(--surface);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview__row--hd > span {
  background: var(--surface-3);
  font-weight: 700;
  color: var(--text-3);
}
.preview__ph {
  color: var(--text-3) !important;
}
.preview__row--add > span {
  grid-column: 1 / -1;
  background: var(--surface);
  color: var(--accent);
  font-weight: 600;
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
