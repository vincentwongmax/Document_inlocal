<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import type { ImageRef, TxRecord, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { notify } from '@/lib/alerts'
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
import QuickNotePicker from './QuickNotePicker.vue'
import DateTimeField from './DateTimeField.vue'

const props = defineProps<{ open: boolean; record: TxRecord | null }>()
const emit = defineEmits<{
  close: []
  save: [patch: Partial<TxRecord>]
  remove: [id: string]
}>()

const settings = useSettingsStore()
const records = useRecordsStore()

/** 明細內容是彈窗裡可捲的地方，其餘（含背景）都要鎖住 */
const bodyEl = ref<HTMLElement | null>(null)
/** 整個面板（下拉關閉時跟著手指移動的就是它） */
const sheetEl = ref<HTMLElement | null>(null)
/**
 * 圖片放大檢視的捲動區（見下方）
 *
 * ⚠ 它一定要列進可捲區：鎖背景的 touchmove preventDefault 是掛在 document 上的，
 *   沒放行的話手指在放大後的圖片上滑動會被整段擋掉 → 滑不動（這正是「放大後不能拖」的元凶之一）。
 *   檢視區是整面 fixed 覆蓋層，開著的時候背後本來就不該捲，所以直接取代 bodyEl。
 */
const stageEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => stageEl.value ?? bodyEl.value })

/**
 * 向下拉即可關掉明細（底部面板的習慣操作）。
 * 內容捲到頂之後繼續往下拉才是拖面板，所以不會跟「捲動內容」打架。
 */
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({ panel: sheetEl, scroller: bodyEl, onClose: () => close() })

const converted = computed(() => props.record?.currency !== props.record?.baseCurrency)
const type = ref<TxType>('expense')
const amount = ref('')
const currencyCode = ref('MOP')
const categoryId = ref('')
const occurredAt = ref('')
const note = ref('')
const rate = ref(1)
/** 記帳當下用計算機算出來的算式（唯讀顯示；沒有就是單純輸入一個數字） */
const expr = ref('')
/** 載入時的金額：用來判斷使用者有沒有在明細裡改過金額 */
const loadedAmount = ref(0)

const numeric = computed(() => {
  const n = Number(amount.value)
  return isFinite(n) ? n : 0
})
const showRate = computed(() => currencyCode.value !== settings.baseCurrency)
/** 算式只在金額沒被改過時才成立；改了就自動隱藏，儲存時也一併清掉 */
const exprValid = computed(
  () => !!expr.value && Number(numeric.value.toFixed(2)) === Number(loadedAmount.value.toFixed(2)),
)
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

/* ── 圖片檢視的縮放 ─────────────────────────────────────── */
/** 1 = 原始大小（已等比縮進畫面），往上每階 ×1.4 */
const zoom = ref(1)
const ZOOM_MIN = 1
const ZOOM_MAX = 5
const ZOOM_STEP = 1.4
const zoomIn = computed(() => zoom.value < ZOOM_MAX)
const zoomOut = computed(() => zoom.value > ZOOM_MIN)
/** 倍率一律落在 [ZOOM_MIN, ZOOM_MAX] 內：連乘時最後一階會跨過上限（1.4^4=3.84 → 5.376），不夾住的話
 *  最大倍率會變成奇怪的 538%，倍率鈕也因此永遠停在啟用狀態 */
const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
const roundZoom = (v: number) => Math.round(v * 100) / 100

/** 圖片本體（量基準尺寸用） */
const zoomImg = ref<HTMLImageElement | null>(null)
/** 100% 時圖片的實際版面尺寸；0 = 還沒量到（此時交給 CSS 的 max-* 撐住版面） */
const fitW = ref(0)
const fitH = ref(0)

/**
 * 量出「100% 時這張圖該佔多大」。
 *
 * ⚠ 放大**不能**只靠 `transform: scale()`：transform 不影響 layout，
 *   外層 `overflow: auto` 的檢視區就永遠沒有可捲動的內容 → 放大後四處都滑不動
 *   （桌機、iPhone 都一樣）。所以改成量好基準尺寸後讓 width/height 隨倍率實際長大，
 *   捲動交給瀏覽器原生處理 —— iOS 上才有熟悉的慣性滑動，而且四個角落都到得了。
 */
function measureFit() {
  const im = zoomImg.value
  const stage = stageEl.value
  if (!im || !stage || !im.naturalWidth || !im.naturalHeight) return
  const cs = getComputedStyle(stage)
  const px = (v: string) => parseFloat(v) || 0
  const availW = stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
  const availH = stage.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)
  if (availW <= 0 || availH <= 0) return
  // 只縮不放：小圖按 100% 就是原尺寸（與原本 max-width/max-height 的行為一致）
  const k = Math.min(1, availW / im.naturalWidth, availH / im.naturalHeight)
  fitW.value = Math.max(1, Math.round(im.naturalWidth * k))
  fitH.value = Math.max(1, Math.round(im.naturalHeight * k))
}

const zoomStyle = computed(() => {
  if (!fitW.value || !fitH.value) return {}
  return {
    width: `${Math.round(fitW.value * zoom.value)}px`,
    height: `${Math.round(fitH.value * zoom.value)}px`,
    // 量到之後必須把 CSS 的 max-width/max-height 放掉，否則放大會被壓回畫面內
    maxWidth: 'none',
    maxHeight: 'none',
  }
})

/** 檢視區是 fixed inset:0，尺寸只跟著視窗（轉向、縮放瀏覽器）變，所以聽 resize 就夠 */
function onViewportResize() {
  if (lightbox.value) measureFit()
}
watch(lightbox, async (open) => {
  if (open) {
    window.addEventListener('resize', onViewportResize)
    window.addEventListener('orientationchange', onViewportResize)
    // 保險：快取命中時 load 可能早於這裡，等 DOM 就緒後再量一次
    await nextTick()
    measureFit()
  } else {
    fitW.value = 0
    fitH.value = 0
    window.removeEventListener('resize', onViewportResize)
    window.removeEventListener('orientationchange', onViewportResize)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
  window.removeEventListener('orientationchange', onViewportResize)
})

function zoomInStep() {
  if (zoomIn.value) zoom.value = clampZoom(roundZoom(zoom.value * ZOOM_STEP))
}
function zoomOutStep() {
  if (zoomOut.value) zoom.value = clampZoom(roundZoom(zoom.value / ZOOM_STEP))
}
/** 回到原始大小（倍率文字本身就是這顆鈕，避免連點好幾次才能縮回去） */
function zoomReset() {
  zoom.value = 1
}

/**
 * 點黑色背景關閉。
 * ⚠ 放大後使用者會在畫面上拖曳查看，放開時瀏覽器可能仍補一個 click；
 *   用位移量判斷「這是拖曳不是點一下」，否則滑到一半就把檢視關掉了。
 */
const bgFrom = { x: 0, y: 0 }
function onBgDown(e: PointerEvent) {
  bgFrom.x = e.clientX
  bgFrom.y = e.clientY
}
function onBgClick(e: MouseEvent) {
  if (Math.hypot(e.clientX - bgFrom.x, e.clientY - bgFrom.y) > 8) return
  closeLightbox()
}

/** 關閉圖片：關掉時要把倍率歸位，下次開才不會維持上次的放大 */
function closeLightbox() {
  lightbox.value = null
  zoom.value = 1
}

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
  closeLightbox()
}

async function openImage(im: ImageRef) {
  if (urls.value[im.id]) {
    // 每次開圖都回到原始大小，不會被上一張的縮放狀態影響
    zoom.value = 1
    lightbox.value = urls.value[im.id]
    return
  }
  const blob = await getImage(im.id)
  if (!blob) {
    notify('圖片已不存在（可能已被清除）', 'warn')
    return
  }
  const url = URL.createObjectURL(blob)
  urls.value[im.id] = url
  zoom.value = 1
  lightbox.value = url
}

function pickImages() {
  fileInput.value?.click()
}

/**
 * 真正把檔案收進來：MD5 去重 → 壓縮（同主頁流程）→ 存 IndexedDB → 產生縮圖。
 * 上傳（檔案選擇器）與貼上（剪貼簿）都走這裡，兩邊行為才會一致。
 */
async function addFiles(files: File[]) {
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
    if (skipped) notify(`已略過 ${skipped} 張重複圖片`, 'warn')
  } finally {
    busyImg.value = false
  }
}

/** 上傳多張（檔案選擇器） */
async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'))
  input.value = ''
  await addFiles(files)
}

/* ── 貼上圖片（剪貼簿）──────────────────────────────────────
 * 情境：從 WeChat／相簿／Messenger 複製一張圖，回到這裡貼上。
 *
 * 兩條路都要有，因為兩邊的支援度剛好互補：
 *
 * 1. `paste` 事件（**保證可用**）：iOS 的 WebKit 只在「可編輯元素」取得焦點時才發
 *    paste 事件，所以在「貼上圖片」磚上鋪一層看不見的 contenteditable 當接收面
 *    （點磚＝把焦點放上去，接著長按選「貼上」）。桌機／Android 直接 Ctrl+V 即可，
 *    所以監聽掛在 document 上——焦點在明細裡任何地方（連備註欄都算）都收得到。
 * 2. `navigator.clipboard.read()`（**加分項**）：支援的瀏覽器點一下就完成、不必長按。
 *    但 Safari 對它的支援反覆，失敗是常態 → 一律 try/catch，失敗就默默退回第 1 條。
 *    所以不能只做這一條。
 */

/** 「貼上圖片」磚上那層接收焦點的隱形可編輯面 */
const pasteEl = ref<HTMLElement | null>(null)
/** 按過「貼上圖片」之後才顯示「長按 → 貼上」的提示（平常不用嚇使用者） */
const pasteMode = ref(false)

const IMG_MIME = /^image\//i

function extOf(mime: string) {
  const m = mime.toLowerCase()
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/heic') return 'heic'
  if (m === 'image/heif') return 'heif'
  return 'png'
}

/** 剪貼簿來的 blob 不會有檔名，自己取一個（列表上會顯示） */
function pastedFile(blob: Blob, i: number, total: number) {
  const type = blob.type || 'image/png'
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`
  return new File(
    [blob],
    `貼上-${stamp}${total > 1 ? `-${i + 1}` : ''}.${extOf(type)}`,
    { type },
  )
}

/**
 * 從剪貼簿事件撈出圖片。
 * iOS 常常不是給「檔案」，而是給一段內含 `<img>` 的 HTML（src 是 blob: 或 data:），
 * 所以兩條都要試。外部 http(s) 網址刻意不處理——跨域只會拿到不透明回應，讀不出內容。
 */
async function filesFromClipboard(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return []
  const out: File[] = []

  for (const f of Array.from(dt.files ?? [])) if (IMG_MIME.test(f.type)) out.push(f)
  if (out.length) return out
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && IMG_MIME.test(it.type)) {
      const f = it.getAsFile()
      if (f) out.push(f)
    }
  }
  if (out.length) return out

  const srcs: string[] = []
  const html = dt.getData('text/html')
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? ''
      if (/^(blob:|data:)/.test(src)) srcs.push(src)
    }
  }
  // 有些 App 是把 data URL 塞在純文字裡
  const text = dt.getData('text/plain')
  if (text && /^data:image\//.test(text.trim())) srcs.push(text.trim())

  for (const src of srcs) {
    try {
      const blob = await (await fetch(src)).blob()
      if (IMG_MIME.test(blob.type || 'image/png')) out.push(pastedFile(blob, out.length, srcs.length))
    } catch {
      /* 讀不到就跳過，不讓一張壞圖擋掉其他張 */
    }
  }
  return out
}

/**
 * paste 的統一入口（document 的 capture 階段）。
 * ⚠ preventDefault 必須**同步**決定：事件派送完就會執行預設行為，等 await 回來才擋已經太遲。
 * 所以在「接收面」上的貼上一律擋掉（不該有任何東西被塞進 DOM），
 * 其他位置的貼上只有在真的夾帶圖片檔案時才擋（純文字要正常貼進備註欄）。
 */
function onPaste(e: ClipboardEvent) {
  const dt = e.clipboardData
  const onTile = e.target === pasteEl.value
  const hasImageFile =
    !!dt &&
    (Array.from(dt.files ?? []).some((f) => IMG_MIME.test(f.type)) ||
      Array.from(dt.items ?? []).some((it) => it.kind === 'file' && IMG_MIME.test(it.type)))

  if (onTile || hasImageFile) e.preventDefault()
  void (async () => {
    const files = await filesFromClipboard(dt)
    if (!files.length) return
    pasteMode.value = false
    await addFiles(files)
  })()
}

/**
 * 點「貼上圖片」磚。
 * ⚠ 聚焦要**同步**做（不能等 await 之後才做）：iOS 只在使用者手勢的同步階段認焦點，
 * 而且不依賴剪貼簿 API 的成功與否——先站穩「長按可以貼」這條保證路徑，
 * 再去試加分項。
 */
function pasteFromClipboard() {
  pasteMode.value = true
  pasteEl.value?.focus()
  void readClipboardApi()
}

/** 加分項：支援的瀏覽器點一下就貼好，不必長按（Safari 對它的支援反覆，失敗是常態） */
async function readClipboardApi() {
  if (!navigator.clipboard?.read) return
  try {
    const items = await navigator.clipboard.read()
    const files: File[] = []
    for (const it of items) {
      const type = it.types.find((t) => IMG_MIME.test(t))
      if (!type) continue
      files.push(pastedFile(await it.getType(type), files.length, items.length))
    }
    if (!files.length) {
      notify('剪貼簿裡沒有圖片', 'info')
      return
    }
    pasteMode.value = false
    await addFiles(files)
  } catch {
    /* 未授權／不支援 → 就這樣，使用者已經可以長按貼上了 */
  }
}

/** 有人真的在那層隱形面上打字就打掉：它只是接收貼上的靶，不該留任何內容 */
function clearPasteBox(e: Event) {
  const el = e.target as HTMLElement
  if (el.textContent) el.textContent = ''
}

/** 明細開著時才攔文件層級的貼上，其他頁面不受影響 */
watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('paste', onPaste, true)
    else document.removeEventListener('paste', onPaste, true)
  },
  { immediate: true },
)

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
  document.removeEventListener('paste', onPaste, true)
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
    expr.value = r.expr ?? ''
    loadedAmount.value = r.amount
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
    notify('金額必須大於 0', 'warn')
    return
  }
  // 清掉在明細中被移除的既有圖片
  const keep = new Set(images.value.map((i) => i.id))
  for (const im of originalImages) if (!keep.has(im.id)) void deleteImage(im.id)
  // 本批新圖將隨記錄一起儲存，清掉 pending 標記
  addedIds.clear()
  // 金額被改過，原本的算式就不再成立了 → 一併清掉，免得列表上寫的算式對不上金額
  const amountChanged = Number(numeric.value.toFixed(2)) !== Number(loadedAmount.value.toFixed(2))
  emit('save', {
    type: type.value,
    amount: numeric.value,
    currency: currencyCode.value,
    rate: showRate.value ? rate.value : 1,
    categoryId: categoryId.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: note.value.trim(),
    images: images.value,
    ...(amountChanged ? { expr: undefined } : {}),
  })
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open && record" class="mask" @click.self="close">
      <div
        ref="sheetEl"
        class="sheet card"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
        role="dialog"
        aria-modal="true"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <!-- 抓把：明示「這裡可以往下拉」（順便當滑鼠的握把） -->
        <div class="sheet__grab" aria-hidden="true"></div>

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

        <div ref="bodyEl" class="sheet__body">
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
            <!-- 記帳當下用計算機算出來的算式（唯讀；改了金額就會消失） -->
            <span v-if="exprValid" class="expr tiny muted">
              輸入金額時的算式
              <b class="expr__f num">{{ expr }} =</b>
            </span>
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
            <ClearableInput v-model="note" placeholder="可留空" :maxlength="80">
              <template #trailing>
                <QuickNotePicker v-model="note" />
              </template>
            </ClearableInput>
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
              <!-- 貼上：磚本身是「接收面」，點它＝把焦點放上去，接著長按選「貼上」 -->
              <div class="imgs__add imgs__paste" :class="{ 'is-armed': pasteMode }">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="3.2" width="8" height="3.6" rx="1.2" />
                  <path d="M9.4 5H6.8A1.8 1.8 0 0 0 5 6.8v11.4A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V6.8A1.8 1.8 0 0 0 17.2 5h-2.6" />
                  <path d="M8.6 11.6h6.8M8.6 15.2h4.4" />
                </svg>
                <!-- 看得見的字給眼睛看就好（讀屏名稱統一由下面那層 aria-label 提供，免得唸兩次） -->
                <span aria-hidden="true">{{ busyImg ? '處理中…' : '貼上圖片' }}</span>
                <span
                  ref="pasteEl"
                  class="imgs__pasteArea"
                  contenteditable="true"
                  inputmode="none"
                  virtualkeyboardpolicy="manual"
                  role="button"
                  tabindex="0"
                  :aria-label="busyImg ? '正在處理圖片' : '貼上圖片'"
                  :aria-busy="busyImg"
                  @click="pasteFromClipboard"
                  @keydown.enter.prevent="pasteFromClipboard"
                  @keydown.space.prevent="pasteFromClipboard"
                  @input="clearPasteBox"
                ></span>
              </div>
              <input ref="fileInput" class="hidden" type="file" accept="image/*" multiple @change="onFiles" />
            </div>
            <p class="tiny muted imgs__hint">
              {{
                pasteMode
                  ? '長按「貼上圖片」磚 → 選「貼上」（電腦可直接 Ctrl／⌘ + V）'
                  : images.length
                    ? '可上傳或貼上多張；點圖片放大檢視'
                    : '可上傳或貼上多張圖片（自動壓縮，保留文字清晰度）'
              }}
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

  <!-- 圖片放大：點黑色背景關閉；圖片本身不關閉，才能安心放大慢慢看。
       放大後可上下左右拖曳查看（原生捲動），所以點背景要判斷是拖曳還是點一下 -->
  <Transition name="fade">
    <div v-if="lightbox" class="lightbox" @pointerdown="onBgDown" @click="onBgClick">
      <div ref="stageEl" class="lightbox__stage">
        <img
          ref="zoomImg"
          :src="lightbox"
          alt=""
          :style="zoomStyle"
          @load="measureFit"
          @click.stop
        />
      </div>

      <div class="lightbox__bar" @click.stop>
        <button
          class="lbbtn"
          type="button"
          title="縮小"
          aria-label="縮小"
          :disabled="!zoomOut"
          @click="zoomOutStep"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.6" cy="10.6" r="6.3" />
            <path d="M15.3 15.3 20 20" />
            <path d="M8.3 10.6h4.6" />
          </svg>
        </button>
        <button
          class="lbzoom num"
          type="button"
          title="回到原始大小"
          :disabled="zoom === 1"
          @click="zoomReset"
        >
          {{ Math.round(zoom * 100) }}%
        </button>
        <button
          class="lbbtn"
          type="button"
          title="放大"
          aria-label="放大"
          :disabled="!zoomIn"
          @click="zoomInStep"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.6" cy="10.6" r="6.3" />
            <path d="M15.3 15.3 20 20" />
            <path d="M8.3 10.6h4.6M10.6 8.3v4.6" />
          </svg>
        </button>
      </div>

      <button class="lightbox__x" type="button" title="關閉" aria-label="關閉" @click="closeLightbox">
        ✕
      </button>
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
  /* 下拉回彈／送出畫面用；拖曳中會由 .is-dragging 關掉 */
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sheet.is-dragging {
  transition: none;
}
/* 抓把：往下拉的握把（純裝飾，但滑鼠也靠它起拖） */
.sheet__grab {
  flex: none;
  display: grid;
  place-items: center;
  padding: 9px 0 2px;
  cursor: grab;
  /* 這一小塊不參與原生捲動，免得拖曳一開始就被瀏覽器搶走 */
  touch-action: none;
}
.sheet__grab::before {
  content: '';
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: var(--line-strong);
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
  /* 捲到頂／底就停住，不要把捲動連鎖給後面（下拉關閉也是靠它才乾淨） */
  overscroll-behavior: contain;
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

/* ── 貼上圖片磚 ──────────────────────────────────────────── */
.imgs__paste {
  position: relative;
}
/* 按過之後維持強調，提示使用者「現在要長按這裡」 */
.imgs__paste.is-armed {
  background: var(--accent-soft);
  border-color: var(--accent);
  border-style: solid;
  color: var(--accent);
}
/**
 * 接收貼上的隱形面：鋪滿整顆磚，只負責「能被聚焦」。
 *
 * ⚠ 下面那組 `.imgs .imgs__pasteArea` 刻意把全站規則關掉的兩件事打開
 * （style.css 的 `button, [role='button'], a` 有 `-webkit-touch-callout: none`
 * 與 `user-select: none`）：那兩條正是 iOS「長按 → 貼上」選單的開關，關著就永遠貼不了。
 * 看到它們請不要「順手統一」，會直接把功能弄壞。
 * 用兩層選擇器是為了**確定蓋得過**那條全域規則（同權重時只靠載入順序太脆）。
 */
.imgs__pasteArea {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  outline: none;
  cursor: pointer;
  white-space: nowrap;
  /* 不要讓游標閃現：它看起來該是一顆按鈕，不是輸入框 */
  caret-color: transparent;
}
.imgs .imgs__pasteArea {
  -webkit-touch-callout: default;
  user-select: text;
  -webkit-user-select: text;
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
/* 唯讀的算式提示：貼在金額欄下面，比標籤再輕一階 */
.expr {
  margin-top: -3px;
  color: var(--text-3);
}
.expr__f {
  color: var(--text-2);
  font-weight: 600;
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
  display: flex;
  flex-direction: column;
}
/* 可捲動的檢視區：放大超過畫面時能四處拖動看細節。
   置中用 margin:auto 而不是 grid place-items:center ——
   後者在內容超出容器時會把上半／左半裁掉且捲不到（unreachable overflow）。
   ⚠ 圖片放大是靠 width/height 真的長大（見 zoomStyle），不是 transform: scale()；
   transform 不動 layout，這裡就永遠不會有可捲動的內容。 */
.lightbox__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 20px;
}
.lightbox__stage img {
  /* 尺寸由 zoomStyle 給；此處的 max-* 只用在「還沒量到尺寸」的那一瞬間當保險 */
  flex: none; /* ⚠ 不能讓 flex 把放大的圖縮回容器寬，縮回去就沒有 overflow 可捲了 */
  margin: auto;
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
  /* 放大／縮小改的是版面尺寸，過場就跟著放在 width/height 上 */
  transition: width 0.14s ease, height 0.14s ease;
}
/* 工具列固定在底部，不隨圖片捲動 */
.lightbox__bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px calc(14px + var(--safe-b));
}
.lbbtn {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.lbbtn svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lbbtn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.28);
}
.lbbtn:active:not(:disabled) {
  transform: scale(0.94);
}
.lbbtn:disabled {
  opacity: 0.34;
  cursor: default;
}
/* 倍率本身也是顆鈕：點一下回到原始大小 */
.lbzoom {
  min-width: 62px;
  height: 42px;
  padding: 0 12px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 13px;
  font-weight: 650;
}
.lbzoom:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.28);
}
.lbzoom:disabled {
  cursor: default;
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
  /* 放大後圖片會蓋到右上角：抬高層級並加深底，避免白圖上看不見關閉鈕 */
  z-index: 2;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
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
