<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import type { ImageRef, TodoItem, TxRecord, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { confirmDialog, notify } from '@/lib/alerts'
import { getImage, putImage, deleteImage } from '@/lib/imageDb'
import { compressImage, makeThumb } from '@/lib/imaging'
import { md5OfFile } from '@/lib/md5'
import { uid } from '@/lib/id'
import { dupNotice } from '@/lib/receiptDup'
import { currency, fmtMoney } from '@/lib/currency'
import { displayExpr } from '@/lib/calc'
import { formatFull, fromLocalInput, toLocalInput } from '@/lib/date'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'
import CategoryPicker from './CategoryPicker.vue'
import ClearableInput from './ClearableInput.vue'
import QuickNotePicker from './QuickNotePicker.vue'
import DateTimeField from './DateTimeField.vue'
import ImageLightbox from './ImageLightbox.vue'
import TodoSheet from './TodoSheet.vue'
import { usePasteImages } from '@/composables/usePasteImages'

const props = defineProps<{
  open: boolean
  record: TxRecord | null
  /**
   * 0.1.57：可導覽的記錄 id 清單（**依目前記錄頁的順序**：已套用日期／收支／搜索等篩選）。
   * 有給 → 放大檢視裡多「上一筆／下一筆記錄」兩顆鈕；沒給（例如統計頁開的明細）就只有
   * 「上一張／下一張圖片」，不會出現永遠按不到的空殼。
   */
  navIds?: string[] | null
}>()
const emit = defineEmits<{
  close: []
  save: [patch: Partial<TxRecord>]
  remove: [id: string]
  /** 0.1.44：點摘要區塊 → 跳到記錄搜索頁搜尋這筆的分類 */
  'search-cat': [name: string]
  /** 0.1.57：在放大檢視裡按了「上一筆／下一筆記錄」→ 請父層把明細換成那一筆 */
  'goto-record': [id: string]
}>()

/**
 * 0.1.61：刪除前先跳確認對話框（使用者原話：「用戶按刪除的時候，要彈出alert 頁面確定」）。
 * 按「刪除」不等於立刻刪——先用 confirmDialog 擋一道，只有按確認才 emit('remove')；
 * 取消則什麼都不做、明細留著。真正移除與「復原」吐司由父層 `removeEditing` 負責。
 */
async function onDelete() {
  if (!props.record) return
  const r = await confirmDialog({
    title: '刪除這筆記錄？',
    message: '刪除後可以使用「復原」鈕救回，確認要刪除嗎？',
    confirmText: '刪除',
    danger: true,
  })
  if (r !== 'confirm') return
  emit('remove', props.record.id)
}

const settings = useSettingsStore()
const records = useRecordsStore()

/** 明細內容是彈窗裡可捲的地方，其餘（含背景）都要鎖住 */
const bodyEl = ref<HTMLElement | null>(null)
/** 整個面板（下拉關閉時跟著手指移動的就是它） */
const sheetEl = ref<HTMLElement | null>(null)
/**
 * 圖片放大檢視（`ImageLightbox`）的實例。
 *
 * ⚠ 它的捲動區一定要列進可捲區：鎖背景的 touchmove preventDefault 是掛在 document 上的，
 *   沒放行的話手指在放大後的圖片上滑動會被整段擋掉 → 滑不動（這正是「放大後不能拖」的元凶之一）。
 *   檢視區是整面 fixed 覆蓋層，開著的時候背後本來就不該捲，所以直接取代 bodyEl。
 *   （檢視區在子元件裡，所以要透過 expose 拿；沒開圖時它是 null → 落回 bodyEl。）
 */
const lbEl = ref<InstanceType<typeof ImageLightbox> | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => lbEl.value?.stageEl ?? bodyEl.value })

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
/** 旅行模式（0.1.35）：這筆記錄屬於哪個旅行（空字串＝不屬於任何旅行） */
const tripId = ref('')
/** 記帳當下用計算機算出來的算式（唯讀顯示；沒有就是單純輸入一個數字） */
const expr = ref('')
/** 載入時的金額：用來判斷使用者有沒有在明細裡改過金額 */
const loadedAmount = ref(0)

/**
 * 0.1.58：待辦事項。
 * 明細裡只顯示摘要（`todoSummary`／`todoPreview`），完整編輯在 `TodoSheet` 子頁面；
 * ⚠ 變更**即時**寫進記錄（見 `onTodosChange`）——勾選是勾選型操作，
 *   要求使用者記得回來按一次「儲存」太容易漏（0.1.58 使用者原話的場景）。
 */
const todos = ref<TodoItem[]>([])
/** 待辦事項子頁面開著嗎 */
const todoOpen = ref(false)
/**
 * 0.1.63：這筆資料「不計入統計」（使用者原話：「在記錄明細頁面中，
 * 增加該筆資料不計入統計按鈕」）。
 * ⚠ 跟待辦事項的勾選一樣是**即時存檔**的——切換型操作要求使用者記得回來按
 *   「儲存」太容易漏（0.1.58 的同一套理由）。舊資料沒有這個欄位。
 */
const excl = ref(false)
/** 這筆所屬的分類（含上層）是否被標記不計入統計——是的話這筆也不會計入，給個提示 */
const catExcluded = computed(() => settings.categoryExcluded(categoryId.value))
const todoTotal = computed(() => todos.value.length)
const todoDone = computed(() => todos.value.filter((t) => t.done).length)
const todoLeft = computed(() => todoTotal.value - todoDone.value)
const todoSummary = computed(() => {
  if (!todoTotal.value) return '新增待辦事項'
  return todoLeft.value > 0 ? `${todoLeft.value} 項未完成` : '全部完成'
})
/**
 * 0.1.59：明細裡的「簡單顯示」改成**每一項各自一個可點的空位**。
 * 使用者原話：「每一筆要留一個tap的空位，1.xxx 2.xxx 3.xxx，已完成的時候也要顯示雙劃線」。
 * 最多列前三項（空間要小的原則不變），超出補「…還有 N 項」；完整內容到子頁面看。
 */
const todoShown = computed(() => todos.value.slice(0, 3))
/** 0.1.59：開子頁面時要高亮哪一項（在明細裡點某個事項進來的）；null＝沒有特定目標 */
const todoFocusIdx = ref<number | null>(null)

/**
 * 開代辦子頁面。
 * ⚠ 0.1.59 使用者原話：「待辦事項欄位，用戶點擊時，不應該彈出鍵盤輸入框」
 *   → TodoSheet 開啟時**不主動 focus 任何輸入框**（只有按「新增事項」才 focus 新的那一項）。
 */
function openTodo(idx: number | null) {
  todoFocusIdx.value = idx
  todoOpen.value = true
}

/** 待辦事項子頁面回來的變更：本地狀態 ＋ 即時寫檔 */
function onTodosChange(next: TodoItem[]) {
  todos.value = next
  const r = props.record
  if (!r) return
  // 清空時存 undefined（JSON 序列化會整個丢掉這個鍵），不要留一個空陣列佔空間
  records.update(r.id, { todos: next.length ? next : undefined })
}

/**
 * 0.1.63：切換「不計入統計」——即時寫檔（理由同 todos 的勾選）。
 * 統計頁的所有數字、側欄總結餘都會立刻排除／恢復這筆；記錄本身不受影響。
 */
function toggleExcl() {
  const r = props.record
  if (!r) return
  excl.value = !excl.value
  records.update(r.id, { excludeFromStats: excl.value })
}

const numeric = computed(() => {
  const n = Number(amount.value)
  return isFinite(n) ? n : 0
})
const showRate = computed(() => currencyCode.value !== settings.baseCurrency)
/**
 * 0.1.53：匯率輸入框的**正規化數值**。
 * `v-model` 綁的是字串（inputmode=decimal 的手機鍵盤），過去 `rate` 會是 "2" 這種字串，
 * 一路存進 localStorage（明細改匯率 → 列表不更新的 bug 的一半就在這裡）。
 * 現在所有讀取（預覽、儲存）都走這個 computed；無效值（空白／0／NaN）回退成
 * 目前匯率表裡那個幣別的匯率。
 */
const rateNum = computed(() => {
  const n = Number(rate.value)
  return isFinite(n) && n > 0 ? n : settings.rate(currencyCode.value)
})
/** 算式只在金額沒被改過時才成立；改了就自動隱藏，儲存時也一併清掉 */
const exprValid = computed(
  () => !!expr.value && Number(numeric.value.toFixed(2)) === Number(loadedAmount.value.toFixed(2)),
)
const preview = computed(() => fmtMoney(numeric.value * rateNum.value, settings.baseCurrency))
const cat = computed(() => settings.category(categoryId.value))
const catName = computed(() => cat.value?.name ?? '未分類')

/**
 * 0.1.44：明細裡顯示圖片大小（壓縮後存進系統的大小，不是原圖）。
 * 把所有圖片的 `bytes`（ImageRef 裡壓縮後的實際佔用）加總。
 */
const imgBytes = computed(() => images.value.reduce((s, im) => s + (im.bytes || 0), 0))
/** 位元組 → 人看得懂的字串（<1KB 用 B，否則 KB，>1MB 用 MB） */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n / 1024 >= 100 ? 0 : 1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
const catColor = computed(() => cat.value?.color ?? '#8a857c')
const catIcon = computed(() =>
  cat.value ? iconForCategory(cat.value) : iconForCategory({ id: '', name: '' }),
)
const isExpense = computed(() => type.value === 'expense')
const typeLabel = computed(() => (isExpense.value ? '支出' : '收入'))

/* ── 圖片 ───────────────────────────────────────────────── */
const urls = ref<Record<string, string>>({})
const lightbox = ref<string | null>(null)

/**
 * 0.1.57：放大檢視的導覽位置＝「正在看哪一筆的第幾張」。
 * null＝沒在看圖；有值時放大檢視底部會多一列導覽鈕。
 */
const lbNav = ref<{ id: string; idx: number } | null>(null)
/** 目前導覽到的這一筆**沒有圖片**（要顯示「無圖」佔位） */
const navEmpty = ref(false)

/** 使用者主動關圖（✕／點圖／點背景）→ 導覽結束 */
function closeLightbox() {
  lightbox.value = null
  lbNav.value = null
  navEmpty.value = false
}

/** 放大檢視底部那一列的狀態（給 ImageLightbox 的 `nav`） */
const lbNavInfo = computed(() => {
  const nav = lbNav.value
  if (!nav) return null
  const ids = props.navIds ?? []
  const at = ids.indexOf(nav.id)
  const n = images.value.length
  const hasImg = !navEmpty.value && n > 0
  return {
    empty: !hasImg,
    hasPrevImg: hasImg && nav.idx > 0,
    hasNextImg: hasImg && nav.idx < n - 1,
    hasPrevRec: at > 0,
    hasNextRec: at >= 0 && at < ids.length - 1,
    rec: ids.length > 0,
    pos: hasImg && n > 1 ? `${nav.idx + 1} / ${n}` : '',
    recPos: at >= 0 ? `${at + 1} / ${ids.length}` : '',
  }
})

/**
 * 顯示「目前這一筆的第 idx 張」。
 * 開圖、上下張、上下筆切換後重新載入，全部都走這裡，行為才會一致。
 * ⚠ 沒圖／讀不到 blob 時**不要直接關掉**：要留著「無圖」佔位，
 *   使用者才能繼續按「下一筆記錄」（0.1.57 使用者原話）。
 */
async function showNavImage(idx: number) {
  const r = props.record
  if (!r) return
  const list = images.value
  const at = Math.min(Math.max(idx, 0), Math.max(list.length - 1, 0))
  lbNav.value = { id: r.id, idx: at }
  if (!list.length) {
    navEmpty.value = true
    lightbox.value = null
    return
  }
  const im = list[at]
  if (!urls.value[im.id]) {
    const blob = await getImage(im.id)
    if (!blob) {
      notify('圖片已不存在（可能已被清除）', 'warn')
      navEmpty.value = true
      lightbox.value = null
      return
    }
    urls.value[im.id] = URL.createObjectURL(blob)
  }
  navEmpty.value = false
  lightbox.value = urls.value[im.id]
}

/** 點縮圖開圖（順便記住這是第幾張，導覽才有起點） */
async function openImage(im: ImageRef) {
  await showNavImage(Math.max(0, images.value.findIndex((x) => x.id === im.id)))
}

/** 同一筆裡往前／往後一張 */
function lbPrevImage() {
  if (lbNav.value) void showNavImage(lbNav.value.idx - 1)
}
function lbNextImage() {
  if (lbNav.value) void showNavImage(lbNav.value.idx + 1)
}

/**
 * 跳到清單裡上／下一筆記錄（delta = -1 或 +1）。
 * ⚠ 這裡**不自己換記錄**：明細的記錄是父層給的（`props.record`），
 *   所以 emit 出去請父層把 `editingId` 換掉；props 一變下面的 watch 會接手把圖開回來。
 *   這樣關掉圖片時停在的就是「最後看圖的那一筆」（0.1.57 使用者原話）。
 */
function lbGotoRecord(delta: number) {
  const ids = props.navIds
  const nav = lbNav.value
  if (!ids?.length || !nav) return
  const at = ids.indexOf(nav.id)
  if (at < 0) return
  const to = at + delta
  if (to < 0 || to >= ids.length) return
  lbNav.value = { id: ids[to], idx: 0 }
  navEmpty.value = false
  emit('goto-record', ids[to])
}

/** 明細中可編輯的圖片（含本次新上傳、尚未儲存的） */
const images = ref<ImageRef[]>([])
/** 載入時的原始圖片，儲存時用來清掉被移除者 */
let originalImages: ImageRef[] = []
/** 本次新加入、尚未儲存的圖片 id（關閉未存則清除，避免殘留孤兒） */
const addedIds = new Set<string>()
const busyImg = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/**
 * 收掉所有 object URL。
 * ⚠ 0.1.57：這裡**不清導覽狀態**（`lbNav`）—— 換記錄時 watch 會先呼叫這裡，
 *   導覽位置還要用來把新記錄的那一張圖重新開回來；
 *   「使用者主動關圖」才走 `closeLightbox()`（那邊才清）。
 */
function releaseUrls() {
  for (const u of Object.values(urls.value)) URL.revokeObjectURL(u)
  urls.value = {}
  lightbox.value = null
}

function pickImages() {
  fileInput.value?.click()
}

/**
 * 真正把檔案收進來：MD5 去重 → 壓縮（同主頁流程）→ 存 IndexedDB → 產生縮圖。
 * 上傳（檔案選擇器）與貼上（剪貼簿）都走這裡，兩邊行為才會一致。
 *
 * ⚠⚠ 去重是「兩級」的（0.1.22 使用者指定，跟主頁 ReceiptImages 同一套規則）：
 *   - **這一筆裡面**已有同一張 → 靜默略過
 *   - **其他記錄**已有同一張   → 照收，但提醒使用者可能重複記帳
 *     （排除自己：編輯既有記錄時，它身上的圖當然算「自己的」）
 */
async function addFiles(files: File[]) {
  if (!files.length) return
  busyImg.value = true
  try {
    const batch = new Set<string>()
    const selfId = props.record?.id
    let skipped = 0
    let dupOther = 0
    for (const file of files) {
      const md5 = await md5OfFile(file)
      if (batch.has(md5) || images.value.some((im) => im.md5 === md5)) {
        skipped++
        continue
      }
      if (records.ownersOfMd5(md5, selfId).length) dupOther++
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
    if (dupOther) notify(dupNotice(dupOther), 'warn')
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
 * 三條路（圖片檔／讓瀏覽器貼進 DOM 再讀／自己解析 text/html）都寫在
 * `composables/usePasteImages.ts`，跟記帳頁的收據圖片區塊共用同一份 ——
 * 兩邊行為一致，修一次兩邊都好。
 */

/** 「貼上圖片」磚上那層接收焦點的隱形可編輯面 */
const pasteEl = ref<HTMLElement | null>(null)
/** 整顆磚（iOS 有時會把貼上改派到磚身上，所以兩個都要找） */
const tileEl = ref<HTMLElement | null>(null)
/** 按過「貼上圖片」之後才顯示「長按 → 貼上」的提示（平常不用嚇使用者） */
const { armed: pasteMode, onPaste, onInput, pasteFromClipboard } = usePasteImages({
  target: () => pasteEl.value,
  tile: () => tileEl.value,
  onFiles: (files) => void addFiles(files),
  onNothing: () => notify('剪貼簿裡沒有圖片', 'info'),
})

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

/**
 * 0.1.63：移除圖片前先跳確認對話框（使用者原話：「圖片刪除要彈出alert，用戶確定」）。
 *
 * ⚠ 確認**只是閘門**，刻意不改變現有的「未儲存」語意（使用者括號裡的要求：
 *   「但依然保持，未儲存明細頁面的修改依然，下次打開，圖片依然在」）：
 *   - 按取消 → 什麼都不做，圖片留在明細裡
 *   - 按移除 → 只從明細的本地清單移除（`removeImage`）；**blob 仍然只在
 *     「儲存」（`save()` 清 originalImages 差集）或「關閉時丟棄新圖」才真正刪
 *   - 所以未儲存就關閉明細 → 下次打開圖片依然在
 */
async function onRemoveImage(im: ImageRef) {
  const ans = await confirmDialog({
    title: '移除這張圖片？',
    message: '確認後從這筆記錄移除（儲存明細後生效）。',
    confirmText: '移除',
    danger: true,
  })
  if (ans !== 'confirm') return
  removeImage(im)
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
    // ⚠ 0.1.57：先記住導覽位置再收 URL —— `releaseUrls()` 會把 lightbox 收掉，
    //   但「正在看哪一筆的第幾張」要留著，下面才能把新記錄的那一張重新開回來。
    const nav = lbNav.value
    releaseUrls()
    discardPending()
    if (!r) {
      lbNav.value = null
      return
    }
    type.value = r.type
    amount.value = String(r.amount)
    currencyCode.value = r.currency
    categoryId.value = r.categoryId
    occurredAt.value = toLocalInput(r.occurredAt)
    note.value = r.note ?? ''
    // 0.1.53：載入**這筆自己凍結的匯率**（舊資料可能是字串 "2"或缺欄位，
    //   一併正規化；真的沒有才回退到目前匯率表）
    rate.value = Number(r.rate) > 0 ? Number(r.rate) : settings.rate(r.currency)
    tripId.value = r.tripId ?? ''
    expr.value = r.expr ?? ''
    loadedAmount.value = r.amount
    // 0.1.58：待辦事項（舊資料沒有這個欄位 → 當沒有）
    todos.value = [...(r.todos ?? [])]
    // 0.1.63：不計入統計（舊資料沒有這個欄位 → 計入）
    excl.value = r.excludeFromStats === true
    images.value = [...(r.images ?? [])]
    originalImages = [...(r.images ?? [])]
    busyImg.value = false
    // 0.1.57：導覽中換到別的記錄 → 立刻把它那一張開回來（這筆沒圖就顯示「無圖」）；
    // 若是使用者自己改看別筆（不是導覽過來的）就結束導覽。
    if (nav && nav.id === r.id) void showNavImage(nav.idx)
    else if (nav) lbNav.value = null
  },
  { immediate: true },
)

/**
 * 0.1.53：只有「使用者真的切了幣別」才把匯率重設成目前表定的值。
 * ⚠ 判斷方式是「跟目前這筆記錄的幣別不同」——**載入記錄時不重置**
 *   （舊 code 是 `watch(currencyCode)` 無條件重設，開啟明細會把記錄凍結的匯率
 *    蓋成表定值，儲存時就悄悄改掉已記錄數據的匯率，正是需求②要防的）。
 */
watch(currencyCode, (c) => {
  if (c === props.record?.currency) return
  rate.value = settings.rate(c)
})

/**
 * 0.1.58：明細本體收掉時，代辦子頁面也要一起收。
 * ⚠ `TodoSheet` 是獨立的模板根節點（不在明細那個 `v-if` 裡），
 *   只把 props.open 關掉並不會卸載它 → 代辦面板會留在畫面上。
 */
watch(
  () => props.open,
  (open) => {
    if (!open) {
      todoOpen.value = false
      todoFocusIdx.value = null
    }
  },
)

/* ── 旅行模式（0.1.35；0.1.36 改成下拉選單）──────────────── */
/**
 * 可選的旅行清單：進行中的在前（標示「進行中」）、已結束的照結束順序在後（新的在上）。
 * 0.1.36 起標記結束後保留，這一欄**一直有意義**——把普通記錄歸進任何一個旅行
 * （使用者：用戶也可以在記錄明細的頁面中，把一個普通的記錄加至這個旅行）。
 */
const tripOptions = computed(() => {
  const out: { id: string; label: string; mode2: boolean }[] = []
  const seen = new Set<string>()
  const t = settings.activeTrip
  if (t) {
    out.push({ id: t.id, label: `${t.name}（進行中）`, mode2: t.mode2 })
    seen.add(t.id)
  }
  for (const h of [...settings.tripHistory].reverse()) {
    if (seen.has(h.id)) continue
    // 0.1.42：已隱藏的旅行不出現在下拉清單（使用者原話：「如果該旅行已被隱藏，
    // 就不要在旅行中的下拉清單顯示（本身屬於這個記錄旅行的除外）」）——
    // 但這筆記錄**已經歸屬**的那趟要保留，否則使用者看不到也改不回現有歸屬。
    if (h.hidden === true && h.id !== tripId.value) continue
    seen.add(h.id)
    out.push({ id: h.id, label: h.name, mode2: h.mode2 })
  }
  return out
})

/** 目前這筆歸屬的旅行（沒有則 null） */
const currentTrip = computed(() => (tripId.value ? (settings.tripById(tripId.value) ?? null) : null))

const tripHint = computed(() => {
  if (currentTrip.value) return `這筆歸在「${currentTrip.value.name}」名下（記錄頁／統計頁會歸到它）`
  return tripOptions.value.length ? '可把這筆歸進某個旅行（進行中或已結束的都可以）' : ''
})

/**
 * 改選旅行（select 的 change）。
 * ⚙ 拍板的規則（0.1.36）：
 * - 從「不屬於任何旅行」選到某旅行，且那個旅行模式二開著、備注非空、還沒有後綴
 *   → 補上「_旅行名」（跟新記的一致）；
 * - 已經有同樣後綴就不重複補；
 * - 旅行之間互換、或改回「不屬於任何旅行」→ **不動備注**（那是使用者資料的一部分，
 *   跟 0.1.35「移出不動備注」同一原則）。
 * - 查不到的 id（異常資料）→ 自動跳回「不屬於任何旅行」。
 */
function onTripChange() {
  if (!tripId.value) return
  const t = settings.tripById(tripId.value)
  if (!t) {
    tripId.value = ''
    return
  }
  if (t.mode2) {
    const suf = `_${t.name}`
    const n = note.value.trim()
    if (n && !n.endsWith(suf)) note.value = n + suf
  }
}

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
    // 0.1.53：送正規化後的數字（過去直接送 v-model 的字串）
    rate: showRate.value ? rateNum.value : 1,
    categoryId: categoryId.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: note.value.trim(),
    images: images.value,
    // 0.1.58：待辦事項。正常情況 `onTodosChange` 已經即時寫過了，
    //   這裡再帶一次是為了「開著明細 → 改代辦 → 按儲存」這條路也不會漏
    //   （例：子頁面改完的當下 props.record 還沒被 watch 重載的極端情況）。
    ...(todoTotal.value ? { todos: todos.value } : {}),
    // 0.1.63：不計入統計。正常情況 `toggleExcl` 已經即時寫過，這裡再帶一次
    //   是雙保險（同 todos 的理由）。
    excludeFromStats: excl.value,
    // 旅行標記：跟著這一欄的狀態走（空＝解除）
    tripId: tripId.value || undefined,
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
          <!-- 即時摘要（0.1.44：點它 → 跳到記錄搜索頁搜尋這筆的分類） -->
          <button class="hero" :class="isExpense ? 'is-exp' : 'is-inc'" type="button" @click="emit('search-cat', catName)">
            <div class="hero__l">
              <span class="hero__cat">{{ catName }}</span>
              <span class="hero__sub">{{ typeLabel }} · {{ fmtMoney(numeric || 0, currencyCode) }}</span>
            </div>
            <span class="hero__amt num">{{ isExpense ? '−' : '+' }}{{ preview }}</span>
          </button>

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
                <option v-for="c in settings.allCurrencies" :key="c.code" :value="c.code">{{ c.code }}</option>
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

          <!-- 旅行（0.1.35 膠囊＋按鈕 → 0.1.36 下拉）：把這筆歸進任何一個旅行（結束過的也行） -->
          <div v-if="tripOptions.length" class="flat">
            <span class="flat__label">旅行</span>
            <select v-model="tripId" class="field tripsel" @change="onTripChange">
              <option value="">不屬於任何旅行</option>
              <option v-for="t in tripOptions" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
            <p v-if="tripHint" class="tiny muted triprow__hint">{{ tripHint }}</p>
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

          <!--
            0.1.58：待辦事項（使用者原話：「在備注輸入框的下方增加，代辨事項的欄位，
            顯示 x未完成 / x已完成 之類的，也用文字的方式顯示代辦的事項，例: 1.xxx 2.yyy 3.zzz
            （但這個部份文字佔的空間要小…）；用戶再按下這個欄位後，再彈出一個子頁面」）。
            0.1.59 兩改（使用者原話）：
            ① 「每一筆要留一個tap的空位，1.xxx 2.xxx 3.xxx，已完成的時候也要顯示雙劃線」
               → 摘要列從「一整串文字」改成**每一項各自一個按鈕**（點哪項就開子頁面並高亮哪項）；
                 已完成＝雙劃線（text-decoration-style: double）。
            ② 「待辦事項欄位，用戶點擊時，不應該彈出鍵盤輸入框」
               → 開啟子頁面不 focus 任何輸入框（見 openTodo 與 TodoSheet 的 focus-idx）。
          -->
          <div class="todorow">
            <!-- 標題列：整列可點（沒有代辦時右側就是「新增待辦事項」） -->
            <button class="todorow__hd" type="button" @click="openTodo(null)">
              <span class="flat__label">待辦事項</span>
              <span v-if="!todoTotal" class="todorow__add">新增待辦事項</span>
              <span class="todorow__chev" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
              </span>
            </button>

            <template v-if="todoTotal">
              <!-- 摘要：幾項完成 ＋ 未完成數 -->
              <div class="todorow__sum">
                <svg class="todorow__ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m3.6 7.4 2.4 2.4L11 4.8" />
                  <path d="M14.2 9.2h6.2" />
                  <path d="m3.6 16.6 2.4 2.4L11 14" />
                  <path d="M14.2 18.4h6.2" />
                </svg>
                <strong class="todorow__n num">{{ todoDone }}/{{ todoTotal }}</strong>
                <span class="todorow__t" :class="{ 'is-done': todoLeft === 0 }">{{ todoSummary }}</span>
              </div>
              <!-- 0.1.59：每一項一個 tap 空位 -->
              <div class="todorow__items">
                <button
                  v-for="(t, i) in todoShown"
                  :key="t.id"
                  class="todorow__it"
                  :class="{ 'is-done': t.done }"
                  type="button"
                  @click.stop="openTodo(i)"
                >
                  <span class="todorow__i num">{{ i + 1 }}.</span>
                  <span class="todorow__tx">{{ t.text || '…' }}</span>
                </button>
                <p v-if="todoTotal > todoShown.length" class="todorow__more tiny muted">
                  …還有 {{ todoTotal - todoShown.length }} 項
                </p>
              </div>
            </template>
          </div>

          <!--
            0.1.63：這筆要不要計入統計（使用者原話：「在記錄明細頁面中，
            增加該筆資料不計入統計按鈕」）。即時存檔，按「儲存」與否都算。
            排除後統計頁的收支／分類佔比／長條圖都不算它，統計頁也會單獨列出。
          -->
          <div class="flat">
            <span class="flat__label">統計</span>
            <button class="xstat" :class="{ 'is-on': excl }" type="button" @click="toggleExcl">
              <span class="xstat__dot" />
              <span class="xstat__txt">{{ excl ? '不計入統計' : '計入統計' }}</span>
              <span class="xstat__hint">{{ excl ? '再按一下恢復' : '按一下排除' }}</span>
            </button>
            <!-- 分類本身被標記時給個說明：不是這筆的問題，改分類設定才會恢復 -->
            <p v-if="catExcluded" class="tiny muted xstat__cat">
              分類「{{ catName }}」已設定不計入統計，這筆也不會計入
            </p>
          </div>

          <!-- 詳細資訊 -->
          <section class="meta">
            <div class="meta__row">
              <span class="tiny muted">新增時間</span>
              <span class="tiny num">{{ formatFull(record.createdAt) }}</span>
            </div>
            <!-- 記帳當下用計算機算出來的公式（唯讀；改了金額就不再成立，會自己消失） -->
            <div v-if="exprValid" class="meta__row">
              <span class="tiny muted">計算公式</span>
              <span class="tiny num expr__v">{{ displayExpr(expr) }}=</span>
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
            <!-- 0.1.44：壓縮後實際儲存的大小（不是原圖大小）；沒圖就不顯示 -->
            <div v-if="imgBytes > 0" class="meta__row">
              <span class="tiny muted">圖片大小</span>
              <span class="tiny num">{{ fmtBytes(imgBytes) }}（壓縮後）</span>
            </div>
          </section>

          <!-- 0.1.44：收據圖片合併進「收據辨識」（原本是分開的「收據圖片」flat 區塊） -->
          <section class="flat ocrsec">
            <div class="ocrsec__head">
              <span class="flat__label">收據辨識</span>
              <span class="beta">BETA</span>
            </div>
            <div class="imgs">
              <div v-for="im in images" :key="im.id" class="imgs__cell">
                <button class="imgs__item" :title="im.name || '收據圖片'" @click="openImage(im)">
                  <img v-if="im.thumb" :src="im.thumb" alt="" />
                </button>
                <button class="imgs__x" type="button" title="移除圖片" @click="onRemoveImage(im)">✕</button>
              </div>
              <button class="imgs__add" type="button" :disabled="busyImg" @click="pickImages">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{{ busyImg ? '處理中…' : '上傳圖片' }}</span>
              </button>
              <!-- 貼上：磚本身是「接收面」，點它＝把焦點放上去，接著長按選「貼上」 -->
              <div ref="tileEl" class="imgs__add imgs__paste" :class="{ 'is-armed': pasteMode }">
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
                  @input="onInput"
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
            <details v-if="record.ocr?.text" class="raw">
              <summary class="tiny muted">
                收據辨識原始文字（信心度 {{ Math.round(record.ocr.confidence) }}%）
              </summary>
              <pre>{{ record.ocr.text }}</pre>
            </details>
          </section>
        </div>

        <footer class="sheet__foot">
          <button class="btn btn--danger" @click="onDelete">刪除</button>
          <button class="btn btn--primary" :disabled="!(numeric > 0)" @click="save">儲存</button>
        </footer>
      </div>
    </div>
  </Transition>

  <!-- 圖片放大（縮放／拖曳／點背景關閉都在 ImageLightbox 裡，記帳頁與明細共用同一份）。
       0.1.57：明細這邊多給 `nav` → 底部多一列導覽（上下張圖／上下筆記錄）。 -->
  <ImageLightbox
    ref="lbEl"
    :src="lightbox"
    :nav="lbNavInfo"
    @close="closeLightbox"
    @prev-image="lbPrevImage"
    @next-image="lbNextImage"
    @prev-record="lbGotoRecord(-1)"
    @next-record="lbGotoRecord(1)"
  />

  <!-- 0.1.58：待辦事項子頁面（底部彈層，幾何跟記錄明細同一套：下拉關閉／✕／背景鎖）。
       0.1.59：`focus-idx`＝在明細裡點了某個事項 → 子頁面開著時高亮那一項（不 focus 輸入框）。
       ⚠ 它是獨立的模板根節點：明細本體 v-if 收掉時它不會自動消失，
       所以上面用 watch 在 props.open 轉假時把 todoOpen 一起收掉。 -->
  <TodoSheet
    :open="todoOpen"
    :todos="todos"
    :focus-idx="todoFocusIdx"
    @close="todoOpen = false"
    @change="onTodosChange"
  />
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
  /* ⚠ 0.1.27：`var(--safe-b)` 已由共用的 `.bsheet` 統一處理（見 style.css），
     這裡不要再加一次，否則會加到兩份、footer 離底部太遠。 */
  padding: 12px 16px 16px;
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
  /* ⚠ 字級一定要 ≥ 16px：iOS 聚焦到字太小的可編輯元素時會把**整頁放大**。 */
  font-size: 16px;
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
/* 唯讀的計算公式：0.1.22 起改放在「詳細資訊」裡、新增時間的正下方，
   跟同一區的數值一樣右對齊（.meta__row 是 flex + space-between）。 */
.expr__v {
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
  /* 0.1.44：改成 <button>（點它 → 搜尋分類），把按鈕外觀歸零 */
  width: 100%;
  font: inherit;
  text-align: inherit;
  color: inherit;
  cursor: pointer;
}
.hero:active {
  filter: brightness(0.97);
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
/* 旅行欄（0.1.36 改成下拉）：select 用全站的 .field 樣式，這裡只留滿寬與提示的位置 */
.tripsel {
  width: 100%;
}
.triprow__hint {
  margin: -3px 0 0;
}
.conv {
  grid-column: 1 / -1;
  font-size: 13px;
  color: var(--accent);
}

/* ── 0.1.58：待辦事項欄位（按下去開 TodoSheet 子頁面）──────────────
   0.1.59：外框只是容器（div），裡面「標題列」與「每一個事項」各自是獨立的按鈕
   ——使用者原話：「每一筆要留一個tap的空位」。 */
.todorow {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  transition: border-color 0.15s;
}
.todorow:hover {
  border-color: var(--line-strong);
}
.todorow__hd {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 13px 8px;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.todorow__hd:active {
  filter: brightness(0.98);
}
/* 沒有代辦時，右側那格就是「新增待辦事項」的提示（也是這顆按鈕的名字） */
.todorow__add {
  margin-left: auto;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-3);
}
.todorow__chev {
  margin-left: auto;
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.todorow__chev svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.todorow__sum {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 13px;
}
.todorow__ic {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.todorow__n {
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}
.todorow__t {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
/* 全部完成＝墨綠（跟 TodoSheet 的進度長條同一套顏色語彙） */
.todorow__t.is-done {
  color: var(--income);
}
/* 0.1.59：每一項各自一個可點的空位 */
.todorow__items {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px 8px;
}
.todorow__it {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 8px;
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.todorow__it:hover,
.todorow__it:active {
  background: var(--surface-3);
}
.todorow__i {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
}
.todorow__tx {
  min-width: 0;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 0.1.59：已完成＝雙劃線（使用者原話：「已完成的時候也要顯示雙劃線」） */
.todorow__it.is-done .todorow__tx {
  text-decoration-line: line-through;
  text-decoration-style: double;
  color: var(--text-3);
}
.todorow__more {
  margin: 2px 0 0;
  padding: 0 7px;
}

/* ── 0.1.63：不計入統計切換（樣式沿用管理分類的 .dflt：空心圓→打勾）───────── */
.xstat {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 40px;
  padding: 8px 11px;
  border-radius: 11px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  text-align: left;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.xstat:hover {
  border-color: var(--accent);
}
.xstat.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}
.xstat__dot {
  position: relative;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  transition:
    background 0.12s,
    border-color 0.12s;
}
.xstat.is-on .xstat__dot {
  border-color: var(--accent);
  background: var(--accent);
}
.xstat.is-on .xstat__dot::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(43deg);
}
.xstat__txt {
  font-size: 13px;
  font-weight: 650;
}
.xstat__hint {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
}
/* 分類被標記時的說明（不是這筆的問題） */
.xstat__cat {
  margin: -2px 0 0;
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
/* 0.1.44：收據辨識合併區塊的標頭（標籤＋BETA 膠囊） */
.ocrsec__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.beta {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--pick-soft);
  color: var(--pick);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
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
