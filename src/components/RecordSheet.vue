<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ImageRef, TxRecord, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { getImage } from '@/lib/imageDb'
import { CURRENCIES, fmtMoney } from '@/lib/currency'
import { formatFull, fromLocalInput, toLocalInput } from '@/lib/date'
import CategoryPicker from './CategoryPicker.vue'

const props = defineProps<{ open: boolean; record: TxRecord | null }>()
const emit = defineEmits<{
  close: []
  save: [patch: Partial<TxRecord>]
  remove: [id: string]
}>()

const settings = useSettingsStore()
const toast = useToast()

const type = ref<TxType>('expense')
const amount = ref('')
const currencyCode = ref('MOP')
const categoryId = ref('')
const occurredAt = ref('')
const note = ref('')
const rate = ref(1)

const numeric = computed(() => {
  const n = Number(amount.value)
  return isFinite(n) ? n : 0
})
const showRate = computed(() => currencyCode.value !== settings.baseCurrency)
const preview = computed(() => fmtMoney(numeric.value * rate.value, settings.baseCurrency))

/* ── 圖片 ───────────────────────────────────────────────── */
const urls = ref<Record<string, string>>({})
const lightbox = ref<string | null>(null)

function releaseUrls() {
  for (const u of Object.values(urls.value)) URL.revokeObjectURL(u)
  urls.value = {}
  lightbox.value = null
}

async function openImage(im: ImageRef) {
  if (urls.value[im.id]) {
    lightbox.value = urls.value[im.id]
    return
  }
  const blob = await getImage(im.id)
  if (!blob) {
    toast.push('圖片已不存在（可能已被清除）', 'warn')
    return
  }
  const url = URL.createObjectURL(blob)
  urls.value[im.id] = url
  lightbox.value = url
}

onBeforeUnmount(releaseUrls)

watch(
  () => props.record,
  (r) => {
    releaseUrls()
    if (!r) return
    type.value = r.type
    amount.value = String(r.amount)
    currencyCode.value = r.currency
    categoryId.value = r.categoryId
    occurredAt.value = toLocalInput(r.occurredAt)
    note.value = r.note ?? ''
    rate.value = r.rate
  },
  { immediate: true },
)

watch(currencyCode, (c) => {
  rate.value = settings.rate(c)
})

function save() {
  if (!(numeric.value > 0)) {
    toast.push('金額必須大於 0', 'warn')
    return
  }
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
          <h3>記錄明細</h3>
          <button class="btn btn--ghost btn--sm" @click="emit('close')">關閉</button>
        </header>

        <div class="sheet__body">
          <!-- 圖片 -->
          <div v-if="record.images.length" class="imgs">
            <button
              v-for="im in record.images"
              :key="im.id"
              class="imgs__item"
              :title="im.name || '收據圖片'"
              @click="openImage(im)"
            >
              <img v-if="im.thumb" :src="im.thumb" alt="" />
            </button>
          </div>
          <p v-if="record.images.length" class="tiny muted imgs__hint">
            點圖片可放大檢視（原圖已壓縮為 480p）
          </p>

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
            <CategoryPicker v-model="categoryId" :type="type" variant="select" />
          </label>

          <label class="lb">
            <span>日期時間</span>
            <input v-model="occurredAt" class="field" type="datetime-local" />
          </label>

          <label class="lb">
            <span>備註</span>
            <input v-model="note" class="field" maxlength="80" placeholder="可留空" />
          </label>

          <div class="meta">
            <div class="meta__row">
              <span class="tiny muted">來源</span>
              <span class="tiny">{{ record.source === 'image' ? '收據辨識' : '手動記帳' }}</span>
            </div>
            <div class="meta__row">
              <span class="tiny muted">新增時間</span>
              <span class="tiny num">{{ formatFull(record.createdAt) }}</span>
            </div>
            <div class="meta__row">
              <span class="tiny muted">主幣金額</span>
              <span class="tiny num">{{ fmtMoney(record.baseAmount, record.baseCurrency) }}</span>
            </div>
          </div>

          <details v-if="record.ocr?.text" class="raw">
            <summary class="tiny muted">
              收據辨識原始文字（信心度 {{ Math.round(record.ocr.confidence) }}%）
            </summary>
            <pre>{{ record.ocr.text }}</pre>
          </details>
        </div>

        <footer class="sheet__foot">
          <button class="btn btn--danger" @click="emit('remove', record.id)">刪除</button>
          <button class="btn btn--primary" :disabled="!(numeric > 0)" @click="save">儲存</button>
        </footer>
      </div>
    </div>
  </Transition>

  <!-- 圖片放大 -->
  <Transition name="fade">
    <div v-if="lightbox" class="lightbox" @click="lightbox = null">
      <img :src="lightbox" alt="" />
      <button class="lightbox__x" @click="lightbox = null">✕</button>
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

.imgs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.imgs__item {
  width: 76px;
  height: 76px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface-3);
}
.imgs__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.imgs__hint {
  margin: -8px 0 0;
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
  grid-template-columns: 1fr 96px;
  gap: 8px;
  align-items: center;
}
.sel2 {
  padding: 0 10px;
}
.conv {
  grid-column: 1 / -1;
  font-size: 13px;
  color: var(--accent);
}

.meta {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line);
  padding-top: 4px;
}
.meta__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.meta__row:last-child {
  border-bottom: 0;
}
.raw pre {
  margin: 8px 0 0;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(20, 19, 17, 0.9);
  display: grid;
  place-items: center;
  padding: 20px;
}
.lightbox img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
}
.lightbox__x {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 15px;
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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
