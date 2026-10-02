<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ImageRef, TxRecord, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { useToast } from '@/composables/useToast'
import { getImage, putImage, deleteImage } from '@/lib/imageDb'
import { compressImage, makeThumb } from '@/lib/imaging'
import { md5OfFile } from '@/lib/md5'
import { uid } from '@/lib/id'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { formatFull, fromLocalInput, toLocalInput } from '@/lib/date'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'
import CategoryPicker from './CategoryPicker.vue'
import ClearableInput from './ClearableInput.vue'
import DateTimeField from './DateTimeField.vue'

const props = defineProps<{ open: boolean; record: TxRecord | null }>()
const emit = defineEmits<{
  close: []
  save: [patch: Partial<TxRecord>]
  remove: [id: string]
}>()

const settings = useSettingsStore()
const records = useRecordsStore()
const toast = useToast()

const converted = computed(() => props.record?.currency !== props.record?.baseCurrency)
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
const cat = computed(() => settings.category(categoryId.value))
const catName = computed(() => cat.value?.name ?? '未分類')
const catColor = computed(() => cat.value?.color ?? '#8a857c')
const catIcon = computed(() =>
  cat.value ? iconForCategory(cat.value) : iconForCategory({ id: '', name: '' }),
)
const isExpense = computed(() => type.value === 'expense')
const typeLabel = computed(() => (isExpense.value ? '支出' : '收入'))

/* ── 圖片 ───────────────────────────────────────────────── */
const urls = ref<Record<string, string>>({})
const lightbox = ref<string | null>(null)

/** 明細中可編輯的圖片（含本次新上傳、尚未儲存的） */
const images = ref<ImageRef[]>([])
/** 載入時的原始圖片，儲存時用來清掉被移除者 */
let originalImages: ImageRef[] = []
/** 本次新加入、尚未儲存的圖片 id（關閉未存則清除，避免殘留孤兒） */
const addedIds = new Set<string>()
const busyImg = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

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

function pickImages() {
  fileInput.value?.click()
}

/** 上傳多張：MD5 去重 → 壓縮 480p（同主頁流程）→ 存 IndexedDB → 產生縮圖 */
async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'))
  input.value = ''
  if (!files.length) return
  busyImg.value = true
  try {
    const known = new Set(records.knownMd5)
    const batch = new Set<string>()
    let skipped = 0
    for (const file of files) {
      const md5 = await md5OfFile(file)
      if (known.has(md5) || batch.has(md5) || images.value.some((im) => im.md5 === md5)) {
        skipped++
        continue
      }
      batch.add(md5)
      const id = uid('img')
      const comp = await compressImage(file)
      await putImage(id, comp.blob)
      const thumb = await makeThumb(comp.blob)
      images.value.push({
        id,
        md5,
        shotAt: null,
        name: file.name,
        thumb,
        w: comp.width || undefined,
        h: comp.height || undefined,
        bytes: comp.bytes,
        originalBytes: comp.originalBytes || file.size,
      })
      addedIds.add(id)
    }
    if (skipped) toast.push(`已略過 ${skipped} 張重複圖片`, 'warn')
  } finally {
    busyImg.value = false
  }
}

/** 從明細移除圖片（實際刪除在儲存 / 關閉時處理） */
function removeImage(im: ImageRef) {
  images.value = images.value.filter((x) => x.id !== im.id)
  if (urls.value[im.id]) {
    URL.revokeObjectURL(urls.value[im.id])
    delete urls.value[im.id]
  }
}

/** 丟棄尚未儲存的新圖片，避免 IndexedDB 殘留孤兒 */
function discardPending() {
  for (const id of addedIds) void deleteImage(id)
  addedIds.clear()
}

function close() {
  discardPending()
  emit('close')
}

onBeforeUnmount(() => {
  releaseUrls()
  discardPending()
})

watch(
  () => props.record,
  (r) => {
    releaseUrls()
    discardPending()
    if (!r) return
    type.value = r.type
    amount.value = String(r.amount)
    currencyCode.value = r.currency
    categoryId.value = r.categoryId
    occurredAt.value = toLocalInput(r.occurredAt)
    note.value = r.note ?? ''
    rate.value = r.rate
    images.value = [...(r.images ?? [])]
    originalImages = [...(r.images ?? [])]
    busyImg.value = false
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
  // 清掉在明細中被移除的既有圖片
  const keep = new Set(images.value.map((i) => i.id))
  for (const im of originalImages) if (!keep.has(im.id)) void deleteImage(im.id)
  // 本批新圖將隨記錄一起儲存，清掉 pending 標記
  addedIds.clear()
  emit('save', {
    type: type.value,
    amount: numeric.value,
    currency: currencyCode.value,
    rate: showRate.value ? rate.value : 1,
    categoryId: categoryId.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: note.value.trim(),
    images: images.value,
  })
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open && record" class="mask" @click.self="close">
      <div class="sheet card" role="dialog" aria-modal="true">
        <header class="sheet__head">
          <div class="sheet__hd">
            <span
              class="sheet__avatar"
              :style="{ background: withAlpha(catColor, 0.15), color: catColor }"
              aria-hidden="true"
            >
              <CategoryIcon :name="catIcon" :size="20" :stroke="1.8" />
            </span>
            <div class="sheet__hd-t">
              <h3 class="sheet__title">記錄明細</h3>
              <span class="sheet__src">{{ record.source === 'image' ? '收據辨識' : '手動記帳' }}</span>
            </div>
          </div>
          <button class="sheet__close" type="button" @click="close">關閉</button>
        </header>

        <div class="sheet__body">
          <!-- 即時摘要 -->
          <div class="hero" :class="isExpense ? 'is-exp' : 'is-inc'">
            <div class="hero__l">
              <span class="hero__cat">{{ catName }}</span>
              <span class="hero__sub">{{ typeLabel }} · {{ fmtMoney(numeric || 0, currencyCode) }}</span>
            </div>
            <span class="hero__amt num">{{ isExpense ? '−' : '+' }}{{ preview }}</span>
          </div>

          <!-- 類型 -->
          <div class="flat">
            <span class="flat__label">類型</span>
            <div class="seg">
              <button class="seg__btn" :class="{ 'is-on': isExpense }" @click="type = 'expense'">支出</button>
              <button class="seg__btn" :class="{ 'is-on': !isExpense }" @click="type = 'income'">收入</button>
            </div>
          </div>

          <!-- 金額 -->
          <label class="flat">
            <span class="flat__label">金額</span>
            <div class="amt">
              <input
                v-model="amount"
                class="field amt__input num"
                inputmode="decimal"
                :placeholder="`${currency(currencyCode).symbol} 0`"
              />
              <select v-model="currencyCode" class="field sel2">
                <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.code }}</option>
              </select>
            </div>
          </label>

          <!-- 匯率 -->
          <label v-if="showRate" class="flat">
            <span class="flat__label">匯率（1 {{ currencyCode }} = ? {{ settings.baseCurrency }}）</span>
            <div class="amt">
              <input v-model="rate" class="field num" inputmode="decimal" />
              <span class="conv num">≈ {{ preview }}</span>
            </div>
          </label>

          <!-- 分類 -->
          <div class="flat">
            <span class="flat__label">分類</span>
            <CategoryPicker v-model="categoryId" :type="type" variant="select" />
          </div>

          <!-- 日期時間 -->
          <label class="flat">
            <span class="flat__label">日期時間</span>
            <DateTimeField v-model="occurredAt" />
          </label>

          <!-- 備註 -->
          <label class="flat">
            <span class="flat__label">備註</span>
            <ClearableInput v-model="note" placeholder="可留空" :maxlength="80" />
          </label>

          <!-- 收據圖片 -->
          <div class="flat">
            <span class="flat__label">收據圖片</span>
            <div class="imgs">
              <div v-for="im in images" :key="im.id" class="imgs__cell">
                <button class="imgs__item" :title="im.name || '收據圖片'" @click="openImage(im)">
                  <img v-if="im.thumb" :src="im.thumb" alt="" />
                </button>
                <button class="imgs__x" type="button" title="移除圖片" @click="removeImage(im)">✕</button>
              </div>
              <button class="imgs__add" type="button" :disabled="busyImg" @click="pickImages">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{{ busyImg ? '處理中…' : '上傳圖片' }}</span>
              </button>
              <input ref="fileInput" class="hidden" type="file" accept="image/*" multiple @change="onFiles" />
            </div>
            <p class="tiny muted imgs__hint">
              {{ images.length ? '可上傳多張；點圖片放大檢視' : '可上傳多張圖片（自動壓縮為 480p）' }}
            </p>
          </div>

          <!-- 詳細資訊 -->
          <section class="meta">
            <div class="meta__row">
              <span class="tiny muted">新增時間</span>
              <span class="tiny num">{{ formatFull(record.createdAt) }}</span>
            </div>
            <div class="meta__row">
              <span class="tiny muted">主幣金額</span>
              <span class="tiny num">{{ fmtMoney(record.baseAmount, record.baseCurrency) }}</span>
            </div>
            <template v-if="converted">
              <div class="meta__row">
                <span class="tiny muted">原幣金額</span>
                <span class="tiny num">{{ fmtMoney(record.amount, record.currency) }}</span>
              </div>
              <div class="meta__row">
                <span class="tiny muted">記錄匯率</span>
                <span class="tiny num">1 {{ record.currency }} = {{ record.rate }} {{ record.baseCurrency }}</span>
              </div>
            </template>
          </section>

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
  gap: 10px;
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--line);
}
.sheet__hd {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.sheet__avatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-1);
}
.sheet__avatar svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}
.sheet__hd-t {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sheet__title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.sheet__src {
  font-size: 11.5px;
  color: var(--text-3);
}
.sheet__close {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  transition:
    background 0.15s,
    color 0.15s;
}
.sheet__close:hover {
  background: var(--surface-3);
  color: var(--text);
}
.sheet__body {
  padding: 14px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
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
.imgs__cell {
  position: relative;
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
.imgs__x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--text);
  color: var(--surface);
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.imgs__x:hover {
  background: var(--expense);
  color: #fff;
}
.imgs__add {
  width: 76px;
  height: 76px;
  border-radius: 12px;
  border: 1px dashed var(--line-strong);
  background: var(--surface-2);
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}
.imgs__add:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.imgs__add:disabled {
  opacity: 0.6;
}
.imgs__add svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}
.imgs__hint {
  margin: -8px 0 0;
}
.hidden {
  display: none;
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
.flat {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.flat__label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  border-radius: var(--r-lg);
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.hero.is-exp {
  background: var(--expense-soft);
  border-color: #f0d8cf;
}
.hero.is-inc {
  background: var(--accent-soft);
  border-color: #cfe3da;
}
.hero__l {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hero__cat {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hero__sub {
  font-size: 12px;
  color: var(--text-2);
}
.hero__amt {
  font-size: 19px;
  font-weight: 700;
  white-space: nowrap;
}
.hero.is-exp .hero__amt {
  color: var(--expense);
}
.hero.is-inc .hero__amt {
  color: var(--income);
}
.amt {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: 8px;
  align-items: center;
}
/* 幣別符號只在「尚未輸入」時透過 placeholder 提示，輸入後不留痕跡 */
.amt__input {
  font-weight: 600;
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
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  padding: 2px 12px;
}
.meta__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
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
