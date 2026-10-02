<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import Keypad from '@/components/Keypad.vue'
import CategoryPicker from '@/components/CategoryPicker.vue'
import ClearableInput from '@/components/ClearableInput.vue'
import DateTimeField from '@/components/DateTimeField.vue'
import ReviewSheet from '@/components/ReviewSheet.vue'
import { useUpload } from '@/composables/useUpload'
import { displayMain, displaySub, calcValue, initCalc, input, equals, type CalcState } from '@/lib/calc'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { fromLocalInput, nowLocalInput } from '@/lib/date'
import type { TxType } from '@/types'
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
const expr = computed(() => displaySub(calc.value))
const display = computed(() => displayMain(calc.value))
/** 公式較長時縮小字級 */
const displayLong = computed(() => display.value.length > 11)
/** 還沒按 = 之前不顯示換算預覽，答案要按了等於才出現 */
const converted = computed(() => calc.value.done && curCode.value !== settings.baseCurrency)

/** 記帳幣別選單：設定頁可挑選要顯示哪幾個（沒選 = 全部），目前選用的幣別一律保留 */
const currencyOptions = computed(() => {
  const vis = settings.visibleCurrencies
  if (!vis.length) return CURRENCIES
  const list = CURRENCIES.filter((c) => vis.includes(c.code))
  if (list.length && !list.some((c) => c.code === curCode.value)) {
    const cur = CURRENCIES.find((c) => c.code === curCode.value)
    if (cur) return [cur, ...list]
  }
  return list
})
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

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  const map: Record<string, string> = { '*': '×', '/': '÷', x: '×', X: '×' }
  if (e.key === '(' || e.key === ')') {
    press(e.key)
    e.preventDefault()
    return
  }
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
      <!-- 記帳表單 -->
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
              <option v-for="c in currencyOptions" :key="c.code" :value="c.code">
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
          <div class="amount__expr num">{{ expr || '\u00a0' }}</div>
          <div class="amount__main">
            <span class="amount__sym">{{ currency(curCode).symbol }}</span>
            <span class="amount__num num" :class="{ 'is-long': displayLong }">{{ display }}</span>
          </div>
          <div v-if="converted && amount > 0" class="amount__conv num tiny">
            ≈ {{ fmtMoney(convertedAmount, settings.baseCurrency) }}
          </div>
        </div>

        <Keypad class="pad__keypad" @press="press" />

        <div class="pad__meta">
          <div class="catbox">
            <span class="catbox__label">分類</span>
            <CategoryPicker v-model="categoryId" :type="type" collapsed />
          </div>
          <ClearableInput v-model="note" placeholder="備註（可留空）" :maxlength="80" />
          <div class="pad__row">
            <DateTimeField v-model="occurredAt" />
            <button class="btn btn--primary btn--save" @click="submit">記錄</button>
          </div>
        </div>
      </section>
    </div>

    <ReviewSheet />
  </div>
</template>

<style scoped>
.home__grid {
  display: grid;
  gap: 18px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
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
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.amount__num.is-long {
  font-size: 24px;
  letter-spacing: -0.01em;
  white-space: nowrap;
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
/* 分類：把整組選框框成一個明顯的區塊，方便一眼看到 */
.catbox {
  padding: 10px 11px 11px;
  /* 淡墨綠底（--accent-soft）＋ 取自 --accent #2c6e5b 的淡色描邊 */
  border: 1px solid rgba(44, 110, 91, 0.16);
  border-radius: var(--r-md);
  background: var(--accent-soft);
}
.catbox__label {
  display: block;
  margin: 0 0 8px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
  opacity: 0.75;
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
  /* 日期時間欄位現在包在 .dt 裡，這條要同時涵蓋外層容器，否則欄位會被擠成半寬 */
  .pad__row .dt,
  .pad__row .field {
    grid-column: 1 / -1;
  }
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

@media (min-width: 1024px) {
  .home__grid {
    gap: 24px;
  }
}
</style>
