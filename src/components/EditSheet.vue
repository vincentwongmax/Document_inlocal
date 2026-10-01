<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TxRecord, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { CURRENCIES, fmtMoney } from '@/lib/currency'
import { fromLocalInput, toLocalInput } from '@/lib/date'
import CategoryPicker from './CategoryPicker.vue'

const props = defineProps<{ open: boolean; record: TxRecord | null }>()
const emit = defineEmits<{
  close: []
  save: [patch: Partial<TxRecord>]
  remove: [id: string]
}>()

const settings = useSettingsStore()
const type = ref<TxType>('expense')
const amount = ref('')
const currencyCode = ref('MOP')
const categoryId = ref('')
const occurredAt = ref('')
const note = ref('')
const rate = ref(1)

watch(
  () => props.record,
  (r) => {
    if (!r) return
    type.value = r.type
    amount.value = String(r.amount)
    currencyCode.value = r.currency
    categoryId.value = r.categoryId
    occurredAt.value = toLocalInput(r.occurredAt)
    note.value = r.note
    rate.value = r.rate
  },
  { immediate: true },
)

const numeric = computed(() => {
  const n = Number(amount.value)
  return isFinite(n) ? n : 0
})
const showRate = computed(() => currencyCode.value !== settings.baseCurrency)
const preview = computed(() => fmtMoney(numeric.value * rate.value, settings.baseCurrency))

watch(currencyCode, (c) => {
  rate.value = settings.rate(c)
})

function save() {
  if (!(numeric.value > 0)) return
  emit('save', {
    type: type.value,
    amount: numeric.value,
    currency: currencyCode.value,
    rate: showRate.value ? rate.value : 1,
    categoryId: categoryId.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: note.value.trim(),
  })
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open && record" class="mask" @click.self="emit('close')">
      <div class="sheet card" role="dialog" aria-modal="true">
        <header class="sheet__head">
          <h3>編輯記錄</h3>
          <button class="btn btn--ghost btn--sm" @click="emit('close')">關閉</button>
        </header>

        <div class="sheet__body">
          <div class="seg">
            <button class="seg__btn" :class="{ 'is-on': type === 'expense' }" @click="type = 'expense'">
              支出
            </button>
            <button class="seg__btn" :class="{ 'is-on': type === 'income' }" @click="type = 'income'">
              收入
            </button>
          </div>

          <label class="lb">
            <span>金額</span>
            <div class="amt">
              <input v-model="amount" class="field num" inputmode="decimal" />
              <select v-model="currencyCode" class="field sel2">
                <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.code }}</option>
              </select>
            </div>
          </label>

          <label v-if="showRate" class="lb">
            <span>匯率（1 {{ currencyCode }} = ? {{ settings.baseCurrency }}）</span>
            <div class="amt">
              <input v-model="rate" class="field num" inputmode="decimal" />
              <span class="conv num">≈ {{ preview }}</span>
            </div>
          </label>

          <label class="lb">
            <span>分類</span>
            <CategoryPicker v-model="categoryId" :type="type" />
          </label>

          <label class="lb">
            <span>時間</span>
            <input v-model="occurredAt" class="field" type="datetime-local" />
          </label>

          <label class="lb">
            <span>備註</span>
            <input v-model="note" class="field" maxlength="80" placeholder="可留空" />
          </label>
        </div>

        <footer class="sheet__foot">
          <button class="btn btn--danger" @click="emit('remove', record.id)">刪除</button>
          <button class="btn btn--primary" :disabled="!(numeric > 0)" @click="save">儲存</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(27, 26, 24, 0.32);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.sheet__head h3 {
  font-size: 16px;
}
.sheet__body {
  padding: 4px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sheet__foot {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  padding: 12px 16px calc(16px + var(--safe-b));
  border-top: 1px solid var(--line);
}
.seg {
  display: flex;
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
.lb {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lb > span {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.amt {
  display: grid;
  grid-template-columns: 1fr 96px auto;
  gap: 8px;
  align-items: center;
}
.sel2 {
  padding: 0 10px;
}
.conv {
  font-size: 13px;
  color: var(--accent);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(14px);
}

@media (min-width: 768px) {
  .mask {
    align-items: center;
    padding: 24px;
  }
  .sheet {
    width: 480px;
    border-radius: var(--r-xl);
  }
  .sheet__foot {
    padding-bottom: 16px;
  }
}
</style>
