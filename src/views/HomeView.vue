<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import Keypad from '@/components/Keypad.vue'
import QuickAdd from '@/components/QuickAdd.vue'
import CategoryPicker from '@/components/CategoryPicker.vue'
import RecordRow from '@/components/RecordRow.vue'
import EditSheet from '@/components/EditSheet.vue'
import ReviewSheet from '@/components/ReviewSheet.vue'
import { useUpload } from '@/composables/useUpload'
import { calcText, calcValue, currentNumber, initCalc, input, equals, type CalcState } from '@/lib/calc'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { fromLocalInput, nowLocalInput, dayKey, formatDay } from '@/lib/date'
import type { TxRecord, TxType } from '@/types'
import { readJSON, writeJSON } from '@/lib/storage'

const records = useRecordsStore()
const settings = useSettingsStore()
const toast = useToast()
const up = useUpload()

/* ── 表單狀態 ───────────────────────────────────────────── */
const calc = ref<CalcState>(initCalc())
const type = ref<TxType>('expense')
const note = ref('')
const occurredAt = ref(nowLocalInput())

const saved = readJSON<{ type: TxType; categoryId: string }>('mop-ledger.draft.v1')
const categoryId = ref<string>(saved?.categoryId ?? '')
const curCode = ref<string>(settings.inputCurrency)

const amount = computed(() => Number(calcValue(calc.value).toFixed(2)))
const expr = computed(() => calcText(calc.value))
const display = computed(() => currentNumber(calc.value))
const converted = computed(() => curCode.value !== settings.baseCurrency)
const convertedAmount = computed(() => Number((amount.value * settings.rate(curCode.value)).toFixed(2)))

// 分類預設：上次使用 → 該類型第一個
watch(
  [type, () => settings.categories.length],
  () => {
    const list = settings.categoriesByType(type.value)
    if (!list.some((c) => c.id === categoryId.value)) {
      categoryId.value = list[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch([type, categoryId], () => {
  writeJSON('mop-ledger.draft.v1', { type: type.value, categoryId: categoryId.value })
})

watch(
  () => settings.inputCurrency,
  (v) => {
    curCode.value = v
  },
)

/** 快速記帳需要的目前表單狀態 */
const formContext = computed(() => ({
  type: type.value,
  amount: amount.value,
  categoryId: categoryId.value,
  currency: curCode.value,
  note: note.value,
}))

/* ── 鍵盤 ───────────────────────────────────────────────── */
function press(k: string) {
  calc.value = k === '=' ? equals(calc.value) : input(calc.value, k)
}

/** 常用金額（歷史出現次數最多的幾個整數） */
const quickAmounts = computed(() => {
  const m = new Map<number, number>()
  for (const r of records.records) {
    if (r.type !== type.value) continue
    const v = Math.round(r.amount)
    if (v > 0) m.set(v, (m.get(v) ?? 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .slice(0, 4)
    .map(([v]) => v)
})

function setAmount(v: number) {
  calc.value = { tokens: [{ t: 'num', v: String(v) }], done: true }
}

/** 一鍵帶入上一筆的金額與分類 */
const lastRecord = computed(() => records.byNewest[0])
function repeatLast() {
  const r = lastRecord.value
  if (!r) return
  setAmount(r.amount)
  type.value = r.type
  categoryId.value = r.categoryId
  curCode.value = r.currency
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  const map: Record<string, string> = { '*': '×', '/': '÷', x: '×', X: '×' }
  if (/^[0-9.]$/.test(e.key)) {
    press(e.key)
    e.preventDefault()
    return
  }
  if (['+', '-', '*', '/'].includes(e.key)) {
    press(map[e.key] ?? e.key)
    e.preventDefault()
    return
  }
  if (e.key === 'Enter') {
    submit()
    e.preventDefault()
    return
  }
  if (e.key === 'Backspace') {
    press('⌫')
    e.preventDefault()
    return
  }
  if (e.key === 'Escape') {
    calc.value = initCalc()
    e.preventDefault()
  }
}

/* ── 送出 ───────────────────────────────────────────────── */
function submit() {
  if (!(amount.value > 0)) {
    toast.push('請先輸入金額', 'warn')
    return
  }
  if (!categoryId.value) {
    toast.push('請選擇分類', 'warn')
    return
  }
  const rec = records.add({
    type: type.value,
    categoryId: categoryId.value,
    amount: amount.value,
    currency: curCode.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: note.value.trim(),
    source: 'manual',
  })
  const label = `${fmtMoney(rec.baseAmount, rec.baseCurrency)} · ${settings.category(rec.categoryId)?.name ?? ''}`
  toast.push(`已記錄 ${label}`, 'ok', { label: '復原', run: () => records.remove(rec.id) })

  calc.value = initCalc()
  note.value = ''
  occurredAt.value = nowLocalInput()
}

/* ── 最近記錄 ───────────────────────────────────────────── */
const recent = computed(() => records.byOccurred.slice(0, 40))
const groups = computed(() => {
  const m = new Map<string, typeof recent.value>()
  for (const r of recent.value) {
    const k = dayKey(r.occurredAt)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return [...m.entries()].map(([k, list]) => ({
    key: k,
    label: formatDay(list[0].occurredAt),
    total: list.reduce((s, r) => s + (r.type === 'expense' ? r.baseAmount : -r.baseAmount), 0),
    list,
  }))
})

const monthExpense = computed(() => {
  const now = new Date()
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return records.records
    .filter((r) => r.type === 'expense' && r.occurredAt.slice(0, 7) === key)
    .reduce((s, r) => s + r.baseAmount, 0)
})

/* ── 單筆編輯 ───────────────────────────────────────────── */
const editingId = ref<string | null>(null)
const editing = computed(() => records.records.find((r) => r.id === editingId.value) ?? null)

function openRecord(id: string) {
  editingId.value = id
}
function saveEdit(patch: Partial<TxRecord>) {
  if (editingId.value) records.update(editingId.value, patch)
  editingId.value = null
  toast.push('已更新', 'ok')
}
function removeEditing(id: string) {
  records.remove(id)
  editingId.value = null
  toast.push('已刪除', 'info')
}

/* ── 圖片上傳（可多張、可拖曳） ─────────────────────────── */
const dragOver = ref(false)

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}
function onDragLeave() {
  dragOver.value = false
}
async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) await up.addFiles(files)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="page home"
    :class="{ 'is-drag': dragOver }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="dragOver" class="dropzone">放開即可上傳收據</div>
    <div class="home__grid">
      <!-- 左欄：快速記帳 + 記帳表單 -->
      <div class="home__left">
        <QuickAdd :context="formContext" />

      <!-- 輸入區 -->
      <section class="card pad">
        <div class="seg">
          <button class="seg__btn" :class="{ 'is-on': type === 'expense' }" @click="type = 'expense'">
            支出
          </button>
          <button class="seg__btn" :class="{ 'is-on': type === 'income' }" @click="type = 'income'">
            收入
          </button>
          <div class="seg__cur">
            <select v-model="curCode" class="sel" :title="'目前以 ' + curCode + ' 記錄'">
              <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                {{ c.code }}
              </option>
            </select>
          </div>
        </div>

        <button class="upload" type="button" @click="up.pick()">
          <svg class="uic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V5m0 0 4 4m-4-4L8 9" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          <span>上傳收據圖片</span>
          <em class="tiny muted">可一次選多張</em>
        </button>

        <div v-if="quickAmounts.length" class="quick">
          <button
            v-for="v in quickAmounts"
            :key="v"
            class="quick__btn num"
            @click="setAmount(v)"
          >
            {{ v }}
          </button>
        </div>

        <div class="amount">
          <div class="amount__expr num">{{ expr || '0' }}</div>
          <div class="amount__main">
            <span class="amount__sym">{{ currency(curCode).symbol }}</span>
            <span class="amount__num num">{{ display }}</span>
          </div>
          <div v-if="converted && amount > 0" class="amount__conv num tiny">
            ≈ {{ fmtMoney(convertedAmount, settings.baseCurrency) }}
          </div>
        </div>

        <Keypad class="pad__keypad" @press="press" />

        <div class="pad__meta">
          <CategoryPicker v-model="categoryId" :type="type" collapsed />
          <input v-model="note" class="field" placeholder="備註（可留空）" maxlength="80" />
          <div class="pad__row">
            <input v-model="occurredAt" class="field" type="datetime-local" />
            <button
              v-if="lastRecord"
              class="btn btn--sm btn--repeat"
              title="帶入上一筆金額與分類"
              @click="repeatLast"
            >
              同上筆
            </button>
            <button class="btn btn--primary btn--save" @click="submit">記錄</button>
          </div>
          <p class="tiny muted hint">支援 + − × ÷ 連續運算；Enter 送出、Esc 清空</p>
        </div>
      </section>
      </div>

      <!-- 最近記錄 -->
      <section class="recent">
        <div class="page-head recent__head">
          <div>
            <h2 class="page-title">最近記錄</h2>
            <p class="page-sub">本月支出 {{ fmtMoney(monthExpense, settings.baseCurrency) }}</p>
          </div>
          <RouterLink to="/stats" class="btn btn--sm">查看統計</RouterLink>
        </div>

        <div v-if="!groups.length" class="empty card">
          <svg class="empty__art" viewBox="0 0 120 76" aria-hidden="true">
            <rect x="26" y="8" width="68" height="60" rx="5" fill="#f1efe9" />
            <rect x="38" y="22" width="44" height="3" rx="1.5" fill="#dcd8cf" />
            <rect x="38" y="32" width="32" height="3" rx="1.5" fill="#dcd8cf" />
            <rect x="38" y="42" width="24" height="3" rx="1.5" fill="#dcd8cf" />
            <rect x="38" y="52" width="44" height="5" rx="2.5" fill="#cfded8" />
          </svg>
          <p class="muted">還沒有任何記錄</p>
          <p class="tiny muted">輸入金額、選分類，三秒完成一筆</p>
        </div>

        <div v-for="g in groups" :key="g.key" class="day">
          <div class="day__head">
            <span class="day__label">{{ g.label }}</span>
            <span class="day__total num">{{ fmtMoney(g.total, settings.baseCurrency) }}</span>
          </div>
          <div class="card day__card">
            <template v-for="(r, i) in g.list" :key="r.id">
              <hr v-if="i > 0" class="divider" />
              <RecordRow :record="r" :show-time="true" @edit="openRecord" @remove="records.remove($event)" />
            </template>
          </div>
        </div>
      </section>
    </div>

    <EditSheet
      :open="!!editing"
      :record="editing"
      @close="editingId = null"
      @save="saveEdit"
      @remove="removeEditing"
    />
    <ReviewSheet />
  </div>
</template>

<style scoped>
.home__grid {
  display: grid;
  gap: 18px;
}
.home__left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.pad {
  padding: 16px;
}
.upload {
  width: 100%;
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 13px;
  border-radius: 12px;
  border: 1px dashed var(--line-strong);
  background: var(--surface-2);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.upload:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.upload em {
  margin-left: auto;
  font-style: normal;
  font-weight: 500;
}
.uic {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
}
.dropzone {
  position: fixed;
  inset: 12px;
  z-index: 60;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  border-radius: var(--r-xl);
  background: rgba(231, 240, 236, 0.9);
  color: var(--accent);
  font-weight: 650;
  pointer-events: none;
}
.seg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 34px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.seg__cur {
  padding-right: 2px;
}
.sel {
  height: 34px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.amount {
  margin: 16px 0 14px;
  text-align: right;
}
.amount__expr {
  min-height: 18px;
  font-size: 12.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amount__main {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
.amount__sym {
  font-size: 17px;
  color: var(--text-2);
}
.amount__num {
  font-size: 40px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
}
.amount__conv {
  color: var(--accent);
  margin-top: 2px;
}

.pad__keypad {
  margin-bottom: 14px;
}
.pad__meta {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.pad__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 9px;
}
.pad__row .field {
  min-width: 0;
}
/* 窄螢幕：時間獨佔一行，按鈕並排 */
@media (max-width: 639px) {
  .pad__row {
    grid-template-columns: 1fr 1fr;
  }
  .pad__row .field {
    grid-column: 1 / -1;
  }
}
.btn--repeat {
  align-self: stretch;
}
.quick {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.quick__btn {
  flex: none;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
}
.quick__btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.btn--save {
  min-width: 96px;
  height: 42px;
}
.hint {
  margin: 0;
}

.day {
  margin-bottom: 12px;
}
.day__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 6px;
}
.day__label {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.day__total {
  font-size: 12.5px;
  color: var(--text-3);
}
.day__card {
  overflow: hidden;
}
.empty {
  padding: 30px 18px;
  text-align: center;
}
.empty__art {
  width: 118px;
  height: 75px;
  margin-bottom: 8px;
  opacity: 0.9;
}
.empty p {
  margin: 2px 0;
}
.recent__head {
  margin-bottom: 12px;
}

@media (min-width: 620px) and (max-width: 1023px) {
  .home__grid {
    max-width: 580px;
    margin: 0 auto;
  }
}
@media (min-width: 1024px) {
  .home__grid {
    grid-template-columns: minmax(380px, 440px) 1fr;
    gap: 24px;
    align-items: start;
  }
  .recent__head {
    margin-top: 2px;
  }
}
</style>
