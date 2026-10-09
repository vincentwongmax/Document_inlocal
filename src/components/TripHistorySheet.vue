<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { confirmDialog, notify } from '@/lib/alerts'
import { CURRENCIES, fmtMoney } from '@/lib/currency'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import type { TravelTrip } from '@/types'
import DateField from './DateField.vue'
import CategoryIcon from './CategoryIcon.vue'

/**
 * 「過去的旅行」子頁面（0.1.37）。
 *
 * 0.1.36 時這份清單掛在 TravelSheet 底部（只能看）；使用者拍板（0.1.37）：
 * 「過去的旅行按鈕（新增子頁面, 可修改，可刪除）」→ 搬出來變成獨立子頁面，
 * 每一列多「改／刪」兩顆小鈕：
 * - 改：該列展開編輯態（名稱／出發日／回程日／貨幣）——改名會即時反映到
 *   記錄頁組名、統計節點名與搜索（畫面一律經 `tripById()` 即時查）。
 * - 刪：先確認（附筆數），刪旅行本體**並把該旅行的記錄標記一併清掉**
 *   （記錄回歸一般記錄；備注的後綴是歷史事實，刻意不動）。
 *
 * 骨架照 `TravelSheet`（＝`QuickAmountSheet` 一脈）：全域 `.bsheet*` 幾何＋
 * `useScrollLock`（背景不動）＋ `usePullToClose`（向下拉真的關閉）＋ 右上角關閉鈕。
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

/* ── 修改 ─────────────────────────────────────────────── */
const editId = ref<string | null>(null)
const editDraft = ref({ name: '', startDate: '', endDate: '', currency: '' })

function beginEdit(t: TravelTrip) {
  editId.value = t.id
  editDraft.value = {
    name: t.name,
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    currency: t.currency ?? '',
  }
}

function cancelEdit() {
  editId.value = null
}

function saveEdit() {
  const id = editId.value
  if (!id) return
  const name = editDraft.value.name.trim()
  settings.updateTripHistory(id, {
    name: name || '旅行',
    startDate: editDraft.value.startDate,
    endDate: editDraft.value.endDate,
    currency: editDraft.value.currency,
  })
  editId.value = null
  notify(`已更新旅行「${name || '旅行'}」`, 'ok')
}

/* ── 刪除 ─────────────────────────────────────────────── */
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
  if (editId.value === t.id) editId.value = null
  notify(`已刪除旅行「${removed.name}」，${n} 筆記錄回歸一般記錄`, 'ok')
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
            <h3>過去的旅行</h3>
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

          <p class="tiny muted hint">
            已結束的旅行都在這裡。記錄的旅行標記會一直保留，記錄頁／統計頁照樣歸組；
            改名會即時反映到組名與搜索。
          </p>

          <p v-if="!history.length" class="tiny muted empty">還沒有結束過的旅行。</p>

          <div class="hist">
            <div v-for="h in history" :key="h.id" class="hist__item">
              <!-- 摘要列（編輯中就隱藏，換成下面的表單） -->
              <div v-if="editId !== h.id" class="hist__row">
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
                <span class="hist__ops">
                  <button class="op" type="button" title="修改旅行" @click="beginEdit(h)">改</button>
                  <button class="op op--danger" type="button" title="刪除旅行" @click="askDelete(h)">刪</button>
                </span>
              </div>

              <!-- 編輯態：名稱／出發日／回程日／貨幣 -->
              <div v-else class="edit">
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
            </div>
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
.hint,
.empty {
  margin: 0;
}

/* 清單（0.1.36 的 .hist 搬過來＋每列多「改／刪」兩顆小鈕） */
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
/* 改／刪小鈕（方型圓角，照日期按鈕的家族） */
.hist__ops {
  flex: none;
  display: flex;
  gap: 6px;
}
.op {
  display: grid;
  place-items: center;
  width: 32px;
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
.op:hover {
  border-color: var(--amber);
  color: var(--amber);
  background: var(--amber-soft);
}
.op--danger:hover {
  border-color: var(--expense);
  color: var(--expense);
  background: var(--expense-soft);
}

/* 編輯態（展開在原列的位置） */
.edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--amber-line);
  background: var(--amber-soft);
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
