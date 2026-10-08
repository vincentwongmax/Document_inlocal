<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { confirmDialog, notify } from '@/lib/alerts'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import type { QuickPreset, TxType } from '@/types'

/**
 * 「快速金額」的詳細子頁面（0.1.30）。
 *
 * 使用者原話：「把快速金額頁面中的，新增一個詳細按鈕，修改的內容放到一個子頁面裡，
 * 用戶要新增或修改，就到這個頁面，頁面的格局可參成管理分類的頁面，
 * 子頁面滑動時背景不能動，向下拉關閉子頁面等等，和之前的子頁面一樣，
 * **不要重新再弄一個全新未知的子頁面**」。
 *
 * 所以這裡整個骨架照 `CategoryManageModal` 抄：
 * `bsheet-mask`／`bsheet`／`bsheet__grab`／`bsheet__body`（全域共用幾何）＋
 * `useScrollLock`（背景不動）＋ `usePullToClose`（向下拉關閉）＋
 * 清單 ↔ 編輯畫面用同一套 `reveal` 轉場。
 * 差別只在內容：這裡編的是快速金額（金額／類型／分類／備註），不是分類。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

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
} = usePullToClose({ panel: sheetEl, scroller: boxEl, onClose: () => backToList() })

/* ── 編輯狀態 ─────────────────────────────────────────── */
/** 正在編輯的 preset（null＝清單態） */
const editing = ref<QuickPreset | null>(null)
/** 編輯中的草稿（沒按儲存就不會寫進 store） */
const draft = ref({ amount: '', type: 'expense' as TxType, categoryId: '', note: '' })

function edit(p: QuickPreset) {
  editing.value = p
  draft.value = {
    amount: p.amount > 0 ? String(p.amount) : '',
    type: p.type,
    categoryId: p.categoryId,
    note: p.note,
  }
}

/** 新增：先不寫進 store，按「儲存」才真的生一顆出來（跟管理分類同一個哲學） */
function startNew() {
  editing.value = { id: '', amount: 0, type: 'expense', categoryId: '', note: '' }
  draft.value = { amount: '', type: 'expense', categoryId: '', note: '' }
}

/** 回清單（沒儲存的草稿直接丟掉） */
function backToList() {
  editing.value = null
}

watch(
  () => props.open,
  (v) => {
    // 每次打開都回到清單態（上次編到一半沒儲存的草稿不該跟著出現）
    if (v) editing.value = null
  },
)

const isEdit = computed(() => !!editing.value && !!editing.value.id)
const title = computed(() => (editing.value ? (isEdit.value ? '修改快速金額' : '新增快速金額') : '快速金額'))

/** 分類選單：只列**這個草稿的收支類型**底下的分類（＋空＝維持目前） */
const catOptions = computed(() => settings.categoriesByType(draft.value.type))

/**
 * ⚠ 草稿存的分類可能不是這個類型（先選了交通再切成收入），
 *   select 會直接跳回第一項——看起來像設定自己跑掉。
 *   這裡把它補進清單，至少看得到、也選得回來（跟設定頁原本的做法同一招）。
 */
const catList = computed(() => {
  const list = catOptions.value
  const id = draft.value.categoryId
  if (id && !list.some((c) => c.id === id)) {
    const own = settings.category(id)
    if (own) return [own, ...list]
  }
  return list
})

/* ── 清單的顯示資料 ───────────────────────────────────── */
const rows = computed(() =>
  settings.quickPresets.map((p, i) => {
    const cat = p.categoryId ? settings.category(p.categoryId) ?? null : null
    const bits: string[] = []
    if (p.amount > 0) bits.push(`金額 ${p.amount}`)
    if (cat) bits.push(settings.fullNameOf(cat.id))
    if (p.note.trim()) bits.push(p.note.trim())
    return { idx: i + 1, preset: p, label: p.amount > 0 ? String(p.amount) : '—', summary: bits.join(' · ') || '還沒設定內容' }
  }),
)

/* ── 儲存／刪除 ────────────────────────────────────────── */
function submit() {
  // ⚠ v-model 綁在 type="number" 的 input 上會回傳**數字**不是字串 → 一定要先 String()
  const raw = String(draft.value.amount ?? '').trim()
  const n = Number(raw)
  const amount = raw === '' ? 0 : Number.isFinite(n) && n >= 0 ? n : 0
  if (amount <= 0) {
    notify('金額要是大於 0 的數字', 'warn')
    return
  }
  const patch = {
    amount,
    type: draft.value.type,
    categoryId: draft.value.categoryId,
    note: draft.value.note,
  }
  if (isEdit.value && editing.value) {
    settings.updateQuickPreset(editing.value.id, patch)
  } else {
    // addQuickPreset 生的是空殼（金額 0）→ 先生一顆再馬上把它填成草稿的內容
    settings.addQuickPreset()
    const p = settings.quickPresets[settings.quickPresets.length - 1]
    if (p) settings.updateQuickPreset(p.id, patch)
  }
  notify(isEdit.value ? '已更新快速金額' : '已新增快速金額', 'ok')
  backToList()
}

/** 刪除前先問一次（SweetAlert2，跟管理分類同一套） */
async function askRemove() {
  const target = editing.value
  if (!target?.id) return
  const answer = await confirmDialog({
    title: `刪除「${target.amount > 0 ? target.amount : '—'}」這一顆？`,
    message: '刪除後記帳頁金額框裡就少這一顆按鈕（不會動到任何記錄）。',
    confirmText: '刪除',
    danger: true,
  })
  if (answer !== 'confirm' || editing.value?.id !== target.id) return
  settings.removeQuickPreset(target.id)
  backToList()
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask bsheet-mask" @click.self="backToList()">
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
          <!--
            0.1.31：右上角加一顆「關閉」（使用者要求）。
            跟計算機子頁面右上角的「完成」同一個位置同一個語意——
            按 it 直接關掉整個子頁面（編到一半的草稿照慣例不落地）。
          -->
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

          <!-- ══ 清單態：列出每一顆，點一下進去改 ══ -->
          <template v-if="!editing">
            <p class="tiny muted hint">
              點任何一顆進去修改；排在前面的會排在記帳頁金額框的左邊。
              按鈕上只顯示金額，分類與備註會在點下去的時候一起帶入。
            </p>

            <p v-if="!rows.length" class="tiny muted none">還沒有任何快速金額，按下面的「新增」加第一顆。</p>
            <div v-else class="list">
              <button
                v-for="r in rows"
                :key="r.preset.id"
                type="button"
                class="rowbtn"
                @click="edit(r.preset)"
              >
                <span class="rowbtn__idx num">{{ r.idx }}</span>
                <span class="rowbtn__n num">{{ r.label }}</span>
                <span class="rowbtn__s">{{ r.summary }}</span>
                <svg class="rowbtn__go" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>

            <button class="btn btn--ghost addbtn" type="button" @click="startNew">＋ 新增一顆</button>
          </template>

          <!-- ══ 編輯態（跟管理分類同一個 reveal 轉場）══ -->
          <Transition name="reveal">
            <div v-if="editing" class="reveal">
              <label class="lb">
                <span>金額 <em class="lb__hint">必填；按鈕上顯示的也是這個數字</em></span>
                <input
                  v-model="draft.amount"
                  class="field num"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="any"
                  placeholder="例如 25"
                  @keyup.enter="submit"
                />
              </label>

              <div class="lb">
                <span>類型</span>
                <select v-model="draft.type" class="field">
                  <option value="expense">支出</option>
                  <option value="income">收入</option>
                </select>
              </div>

              <label class="lb">
                <span>分類 <em class="lb__hint">留「維持目前」＝點下去不改記帳頁的分類</em></span>
                <select v-model="draft.categoryId" class="field">
                  <option value="">（維持目前的分類）</option>
                  <option v-for="c in catList" :key="c.id" :value="c.id">
                    {{ settings.fullNameOf(c.id) }}
                  </option>
                </select>
              </label>

              <label class="lb">
                <span>備註 <em class="lb__hint">留空＝點下去不改記帳頁的備註</em></span>
                <input
                  v-model="draft.note"
                  class="field"
                  type="text"
                  :maxlength="80"
                  placeholder="例如 公司3餸飯"
                  @keyup.enter="submit"
                />
              </label>

              <div class="acts">
                <button
                  v-if="isEdit"
                  class="btn btn--ghost acts__del"
                  type="button"
                  @click="askRemove"
                >
                  刪除
                </button>
                <span class="acts__spring"></span>
                <button class="btn btn--ghost" type="button" @click="backToList">返回</button>
                <button class="btn btn--primary" type="button" @click="submit">儲存</button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * ⚠ 外框幾何**只寫在 style.css 的 `.bsheet-mask`／`.bsheet`／`.bsheet__grab`／
 *   `.bsheet__body`**（跟其他七個子頁面共用），這裡只留 z-index 與自己的內容排版，
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
/* 標題列：標題在左、「關閉」在最右（0.1.31） */
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
.none {
  margin: 0;
}
/* 清單 */
.list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.rowbtn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
  text-align: left;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.rowbtn:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.rowbtn__idx {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11px;
  font-weight: 700;
}
.rowbtn__n {
  flex: none;
  min-width: 34px;
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
}
.rowbtn__s {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rowbtn__go {
  flex: none;
  width: 15px;
  height: 15px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.addbtn {
  align-self: flex-start;
}

/* 編輯畫面（`.reveal` 的 flex+gap 一定要自己寫：包了一層 wrapper 之後
   `.box` 的 gap 幫不到裡面的欄位 —— 0.1.27 在管理分類踩過同一個雷） */
.reveal {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.reveal-enter-active {
  transition:
    opacity 0.2s ease-out,
    transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.reveal-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
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
.acts {
  display: flex;
  align-items: center;
  gap: 9px;
}
.acts__spring {
  flex: 1;
}
.acts__del {
  color: var(--expense);
  border-color: var(--expense);
}
.acts__del:hover {
  background: var(--expense-soft);
}
</style>
