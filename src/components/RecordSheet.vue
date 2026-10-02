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
          <h3>記錄明細</h3>
          <button class="btn btn--ghost btn--sm" @click="close">關閉</button>
        </header>

        <div class="sheet__body">
          <!-- 圖片（可上傳多張） -->
          <div class="imgs">
            <div v-for="im in images" :key="im.id" class="imgs__cell">
              <button
                class="imgs__item"
                :title="im.name || '收據圖片'"
                @click="openImage(im)"
              >
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
