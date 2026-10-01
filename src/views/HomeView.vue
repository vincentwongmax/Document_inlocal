<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import Keypad from '@/components/Keypad.vue'
import CategoryPicker from '@/components/CategoryPicker.vue'
import RecordRow from '@/components/RecordRow.vue'
import EditSheet from '@/components/EditSheet.vue'
import { calcText, calcValue, currentNumber, initCalc, input, equals, type CalcState } from '@/lib/calc'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { fromLocalInput, nowLocalInput, dayKey, formatDay } from '@/lib/date'
import type { TxRecord, TxType } from '@/types'
import { readJSON, writeJSON } from '@/lib/storage'

const records = useRecordsStore()
const settings = useSettingsStore()
const toast = useToast()

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

/* ── 鍵盤 ───────────────────────────────────────────────── */
function press(k: string) {
  calc.value = k === '=' ? equals(calc.value) : input(calc.value, k)
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

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="page home">
    <div class="home__grid">
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
          <CategoryPicker v-model="categoryId" :type="type" />
          <input v-model="note" class="field" placeholder="備註（可留空）" maxlength="80" />
          <div class="pad__row">
            <input v-model="occurredAt" class="field" type="datetime-local" />
            <button class="btn btn--primary btn--save" @click="submit">記錄</button>
          </div>
          <p class="tiny muted hint">支援 + − × ÷ 連續運算；Enter 送出、Esc 清空</p>
        </div>
      </section>

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
  </div>
</template>

<style scoped>
.home__grid {
  display: grid;
  gap: 18px;
}
.pad {
  padding: 16px;
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
  grid-template-columns: 1fr auto;
  gap: 9px;
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
  padding: 28px 18px;
  text-align: center;
}
.empty p {
  margin: 2px 0;
}
.recent__head {
  margin-bottom: 12px;
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
