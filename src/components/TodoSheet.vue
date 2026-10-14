<script setup lang="ts">
/**
 * 代辦事項子頁面（0.1.58）。
 *
 * 使用者原話：「用戶再按下這個欄位後，再彈出一個子頁面，這個子頁面的設計方式和記錄明細的
 * 頁面一樣，請跟據我之前跟你說做子頁面的所有動作和功能（下拉關閉、右上角關閉 icon、美觀等等）。
 * 用戶在這個頁面中，可以增加多個輸入框，用戶可以完成就勾選完成，會劃線，和其他功能可自由發揮」。
 *
 * 幾何與手勢全部沿用 style.css 的 `.bsheet-mask` / `.bsheet`（＝記錄明細那套底部彈層）：
 *   - 往下拉關閉（`usePullToClose`）、點遮罩關閉、右上角 ✕
 *   - 背景鎖滾動（`useScrollLock`）
 *
 * ⚠ 變更一律**即時** emit `change`：RecordSheet 那邊會立刻寫進記錄
 *   （代辦是勾選型操作，不要求使用者再按一次「儲存」）。
 * ⚠ 0.1.59：開啟時**不主動 focus 輸入框**（不彈鍵盤）——只有按「新增事項」才 focus
 *   新的那一項；從明細點某個事項進來時改用高亮（見 `focusIdx`／`focusId`）。
 */
import { computed, nextTick, ref, toRef, watch } from 'vue'
import type { TodoItem } from '@/types'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { confirmDialog } from '@/lib/alerts'
import { uid } from '@/lib/id'

const props = defineProps<{
  open: boolean
  todos: TodoItem[]
  /**
   * 0.1.59：開啟時要高亮哪一項（在明細裡點了某個事項進來的）。
   * null／沒有＝沒有特定目標。
   * ⚠ 只做**高亮**（捲到那項＋框線提示），不 focus 輸入框——
   *   使用者原話：「代辦事項欄位，用戶點擊時，不應該彈出鍵盤輸入框」。
   */
  focusIdx?: number | null
}>()
const emit = defineEmits<{ close: []; change: [todos: TodoItem[]] }>()

/** 可捲的內容區（鎖背景與下拉手勢都用得到） */
const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })

/** 面板（下拉關閉時跟著手指移動的就是它） */
const sheetEl = ref<HTMLElement | null>(null)
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({ panel: sheetEl, scroller: boxEl, onClose: () => emit('close') })

/** 最近一次用到的輸入框（新增時要 focus 它） */
const lastInput = ref<HTMLInputElement | null>(null)
/** 0.1.59：目前被高亮的項目 id（在明細裡點了某一項進來的） */
const focusId = ref<string | null>(null)

/** 本地清單（每次開啟都從 props 重拿，避免關掉再開看到殘影） */
const list = ref<TodoItem[]>([])
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      focusId.value = null
      return
    }
    list.value = (props.todos ?? []).map((t) => ({ ...t }))
    // ⚠ 0.1.59：開啟時**不 focus 任何輸入框**（不彈鍵盤）；只把「點進來的那一項」
    //   捲到畫面中間並高亮，讓使用者知道剛按的是哪一個。
    const at = props.focusIdx
    focusId.value = at != null && at >= 0 && at < list.value.length ? list.value[at].id : null
    if (focusId.value) {
      await nextTick()
      document.querySelector('.tdolist__row.is-focus')?.scrollIntoView({ block: 'center' })
    }
  },
)

const total = computed(() => list.value.length)
const doneCount = computed(() => list.value.filter((t) => t.done).length)
const leftCount = computed(() => total.value - doneCount.value)

function commit() {
  emit('change', list.value.map((t) => ({ ...t })))
}

function addItem() {
  const it: TodoItem = { id: uid('todo'), text: '', done: false }
  list.value.push(it)
  commit()
  void nextTick(() => lastInput.value?.focus())
}

function toggle(it: TodoItem) {
  it.done = !it.done
  commit()
}

/** 文字改動：只更新本項（輸入中不重排，游標才不會跳） */
function onText(it: TodoItem, e: Event) {
  it.text = (e.target as HTMLInputElement).value
  commit()
}

/**
 * 輸入框失焦：空白項目直接收掉（不然按「新增」卻沒打字會留一排空行）。
 * ⚠ 只在真的沒內容時刪，且不能再触发 focus 迴圈（移除元素不會有 blur 迴圈，
 *   因為元件已經被 Vue 卸載）。
 */
function onBlur(it: TodoItem) {
  if (it.text.trim()) return
  const i = list.value.findIndex((x) => x.id === it.id)
  if (i < 0) return
  list.value.splice(i, 1)
  commit()
}

function removeItem(it: TodoItem) {
  const i = list.value.findIndex((x) => x.id === it.id)
  if (i < 0) return
  list.value.splice(i, 1)
  commit()
}

/**
 * 清除全部已完成。
 * ⚠ 0.1.59 使用者原話：「用戶按清除已完成時，要用戶再次確定」→ 先彈確認對話框；
 *   這是唯一會**一次性丟掉多個項目**的操作，按錯就救不回來（沒有復原鈕）。
 */
async function clearDone() {
  const n = list.value.filter((t) => t.done).length
  if (!n) return
  const r = await confirmDialog({
    title: '清除已完成？',
    message: `會移除 ${n} 個已完成的事項，這個動作無法復原。`,
    confirmText: '清除',
    danger: true,
  })
  if (r !== 'confirm') return
  list.value = list.value.filter((t) => !t.done)
  commit()
}

/** 全部標記完成／全部取消（長串清單一鍵收尾用） */
function toggleAll() {
  const allDone = total.value > 0 && leftCount.value === 0
  for (const t of list.value) t.done = !allDone
  commit()
}
</script>

<template>
  <Transition name="pop">
    <div v-if="open" class="mask bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
        role="dialog"
        aria-modal="true"
        aria-label="代辦事項"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <div class="bsheet__grab" aria-hidden="true"></div>

        <div ref="boxEl" class="box bsheet__body">
          <div class="hd">
            <span class="hd__t">代辦事項</span>
            <button class="hd__x" type="button" aria-label="關閉" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <!-- 進度：幾項完成 + 長條（一眼看完，不用數） -->
          <div class="prog">
            <div class="prog__row">
              <strong class="num prog__n">{{ doneCount }} / {{ total }} 已完成</strong>
              <span v-if="leftCount > 0" class="tiny muted">還有 {{ leftCount }} 項未完成</span>
              <span v-else-if="total > 0" class="tiny ok">全部完成</span>
            </div>
            <div class="prog__bar">
              <i :style="{ width: (total ? (doneCount / total) * 100 : 0) + '%' }" />
            </div>
          </div>

          <!-- 清單 -->
          <ul v-if="list.length" class="tdolist">
            <li
              v-for="(t, i) in list"
              :key="t.id"
              class="tdolist__row"
              :class="{ 'is-done': t.done, 'is-focus': t.id === focusId }"
            >
              <span class="tdolist__i num">{{ i + 1 }}</span>
              <button
                class="tdolist__cb"
                type="button"
                role="checkbox"
                :aria-checked="t.done ? 'true' : 'false'"
                :aria-label="t.done ? '標為未完成' : '標為已完成'"
                @click="toggle(t)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 12.6 4.2 4.2L19 7.2" />
                </svg>
              </button>
              <input
                :ref="
                  (el) => {
                    if (el) lastInput = el as HTMLInputElement
                  }
                "
                class="tdolist__in"
                type="text"
                :value="t.text"
                :placeholder="'第 ' + (i + 1) + ' 項…'"
                maxlength="80"
                enterkeyhint="next"
                @input="onText(t, $event)"
                @blur="onBlur(t)"
                @keydown.enter.prevent="addItem"
              />
              <button class="tdolist__x" type="button" aria-label="刪除此項" @click="removeItem(t)">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          </ul>
          <p v-else class="tiny muted tdolist__empty">還沒有代辦事項，按下面的按鈕新增。</p>

          <!-- 動作列 -->
          <div class="acts">
            <button class="act act--add" type="button" @click="addItem">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>新增事項</span>
            </button>
            <button
              v-if="doneCount > 0"
              class="act"
              type="button"
              title="把已完成的全部移除"
              @click="clearDone"
            >
              清除已完成
            </button>
            <button v-if="total > 0" class="act" type="button" @click="toggleAll">
              {{ leftCount > 0 ? '全部完成' : '全部取消' }}
            </button>
          </div>

          <p class="tip tiny muted">往下拉、或點旁邊空白處都可以關閉；勾選會即時儲存</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 幾何沿用 style.css 的 `.bsheet-mask` / `.bsheet` / `.bsheet__body`（＝記錄明細那套），
   這裡只留 z-index 與內容自己的排版。⚠ 不要把 display / background / padding 寫回 .mask／.box。 */
.mask {
  z-index: 96;
}
.box {
  padding: 4px 17px 14px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hd__t {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--text-2);
}
.hd__x {
  margin-left: auto;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  background: var(--surface-3);
}
.hd__x:hover {
  color: var(--text);
}
.hd__x svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

/* ── 進度 ── */
.prog {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.prog__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.prog__n {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.prog__row .ok {
  color: var(--income);
  font-weight: 650;
}
.prog__bar {
  height: 5px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.prog__bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--income);
  transition: width 0.2s ease;
}

/* ── 清單 ── */
.tdolist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tdolist__row {
  display: grid;
  grid-template-columns: 18px 22px 1fr 26px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
/* 0.1.59：從明細裡點了某一項進來的 → 高亮那一項。
   ⚠ 只高亮，不 focus 輸入框——使用者原話：「點擊時不應該彈出鍵盤輸入框」。 */
.tdolist__row.is-focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.tdolist__i {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
  text-align: center;
}
/* 勾選圈：未完成是空圈，完成後填色 + 打勾 */
.tdolist__cb {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1.6px solid var(--line-strong);
  background: var(--surface);
  display: grid;
  place-items: center;
  color: transparent;
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;
}
.tdolist__cb svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tdolist__cb:hover {
  border-color: var(--income);
}
.tdolist__row.is-done .tdolist__cb {
  background: var(--income);
  border-color: var(--income);
  color: #fff;
}
/* ⚠ 輸入框一定要 16px：iOS 聚焦到字級 <16px 的可編輯元素會把整頁放大（全站約定） */
.tdolist__in {
  min-width: 0;
  font-size: 16px;
  font-weight: 550;
  color: var(--text);
  background: transparent;
  border: 0;
  padding: 2px 0;
}
.tdolist__in::placeholder {
  color: var(--text-3);
  font-weight: 500;
}
/* 完成＝劃線＋淡出 */
.tdolist__row.is-done .tdolist__in {
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  color: var(--text-3);
}
.tdolist__x {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  opacity: 0.75;
}
.tdolist__x:hover {
  color: var(--expense);
  background: var(--surface-3);
  opacity: 1;
}
.tdolist__x svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.tdolist__empty {
  margin: 2px 0 0;
}

/* ── 動作列 ── */
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 13px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.act:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.act svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.act--add {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.tip {
  text-align: center;
  margin: 0;
}

/* ── 動畫：淡入遮罩 ＋ 面板浮出（跟統計頁子頁面同一套） ── */
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.18s ease;
}
.pop-enter-active .box,
.pop-leave-active .box {
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}
.pop-enter-from .box,
.pop-leave-to .box {
  opacity: 0;
  transform: translateY(24px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active,
  .pop-enter-active .box,
  .pop-leave-active .box {
    transition: none;
  }
}
</style>
