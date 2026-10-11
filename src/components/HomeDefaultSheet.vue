<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { ImageRef, TxType } from '@/types'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { compressImage, makeThumb } from '@/lib/imaging'
import { deleteImage, putImage } from '@/lib/imageDb'
import { uid } from '@/lib/id'
import { notify } from '@/lib/alerts'
import { IMG_MIME } from '@/lib/clipboard'
import CategoryPicker from './CategoryPicker.vue'
import MiniSelect from './MiniSelect.vue'

/**
 * 「記帳頁排版 → 預設值」子頁面（0.1.46）。
 *
 * 在這裡設的值＝**排版裡沒排進去的區塊**提交記錄時要用的預設內容：
 *   1=支出/收入、2=金額、3=分類、4=備註、5=日期時間（相對現在）、6=收據圖片；
 *   7（清空＋記錄）沒有東西可設。
 * 每個欄位都可以不設——全部留空＝跟原本的行為完全一樣。
 *
 * ⚠ 即改即存（跟快速備註／自訂貨幣同一套習慣），沒有「儲存」鈕。
 *   圖片的 blob 在上傳當下就寫進 IndexedDB、移除當下就刪，
 *   所以不存在「關掉子頁面留孤兒」的問題。
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
} = usePullToClose({ panel: sheetEl, scroller: boxEl, onClose: () => emit('close') })

/* ── 本地草稿（開啟時從設定同步；每一個改動即時寫回）────── */
const dType = ref<TxType | ''>('')
const dAmount = ref('')
/** 0.1.50：預設幣別（空＝沿用記帳頁上選的）；整行、跟金額同一組 */
const dCurrency = ref('')
const dCategoryId = ref('')
const dNote = ref('')
/**
 * 0.1.49：日期時間＝「輸入框（數字**或完整時間**）＋單位下拉＋方向下拉」。
 * 單位：時/分/日/月/年/現在/無；方向：現在/前/後/無。
 * 存值規則（優先序）：
 *   1. 輸入框是完整時間（可解析）→ `at:YYYY-MM-DDTHH:mm`（絕對日期，單位/方向停用）
 *   2. 單位或方向＝無 → `''`（不設定）
 *   3. 單位或方向＝現在 → `'now'`
 *   4. 輸入框是純數字 → `before|after:N:單位`
 *   5. 其他（沒數字）→ `''`
 */
const dDateN = ref('')
const dDateUnit = ref<'h' | 'm' | 'd' | 'mo' | 'y' | 'now' | 'none'>('none')
const dDateDir = ref<'now' | 'before' | 'after' | 'none'>('none')
const dImages = ref<ImageRef[]>([])

/** 輸入框是否為「完整時間」（含 - 或 : 且可解析成日期） */
function parseDateTimeInput(v: string): string | null {
  const t = v.trim()
  if (!t || /^\d+$/.test(t)) return null
  const d = new Date(t)
  if (isNaN(d.getTime())) return null
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const isDatetimeInput = computed(() => parseDateTimeInput(dDateN.value) !== null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const d = settings.state.homeDefaults
    dType.value = d.type
    dAmount.value = d.amount
    dCurrency.value = d.currency
    dCategoryId.value = d.categoryId
    dNote.value = d.note
    // 解析 `before:5:m`／`at:…`／`now`／'' 回三個控制項
    const rel = /^(before|after):(\d+):(m|h|d|mo|y)$/.exec(d.dateOffset)
    if (rel) {
      dDateN.value = rel[2]
      dDateUnit.value = rel[3] as 'h' | 'm' | 'd' | 'mo' | 'y'
      dDateDir.value = rel[1] as 'before' | 'after'
    } else if (d.dateOffset.startsWith('at:')) {
      dDateN.value = d.dateOffset.slice(3)
      dDateUnit.value = 'none'
      dDateDir.value = 'none'
    } else if (d.dateOffset === 'now') {
      dDateN.value = ''
      dDateUnit.value = 'now'
      dDateDir.value = 'none'
    } else {
      dDateN.value = ''
      dDateUnit.value = 'none'
      dDateDir.value = 'none'
    }
    dImages.value = [...d.images]
  },
)

/** 分類選單要跟著預設收支過濾；沒設收支時用支出（純給選單用，不影響存值） */
const pickerType = ref<TxType>('expense')
watch(dType, (t) => {
  if (t) pickerType.value = t
})

function saveType(v: TxType | '') {
  dType.value = v
  settings.setHomeDefaults({ type: v })
}
function saveAmount() {
  settings.setHomeDefaults({ amount: dAmount.value.trim() })
}
/** 0.1.50：幣別下拉（區塊 1 隱藏時才會套用；留空＝沿用記帳頁上的選擇） */
function saveCurrency(v: string) {
  dCurrency.value = v
  settings.setHomeDefaults({ currency: v })
}
/** 下拉的選項＝內建＋自訂貨幣（0.1.49 起自訂貨幣也能選） */
const currencyOptions = computed(() => settings.allCurrencies)
/** 分類即改即存（CategoryPicker v-model → watch） */
watch(dCategoryId, (id) => {
  settings.setHomeDefaults({ categoryId: id })
})
function clearCategory() {
  dCategoryId.value = ''
  settings.setHomeDefaults({ categoryId: '' })
}
function saveNote() {
  settings.setHomeDefaults({ note: dNote.value })
}
/**
 * 日期時間：三個控制項任一改動就重組字串存回（0.1.49 優先序見上方註解）。
 */
function saveDate() {
  const abs = parseDateTimeInput(dDateN.value)
  if (abs) {
    settings.setHomeDefaults({ dateOffset: `at:${abs}` })
    return
  }
  if (dDateUnit.value === 'none' || dDateDir.value === 'none') {
    settings.setHomeDefaults({ dateOffset: '' })
    return
  }
  if (dDateUnit.value === 'now' || dDateDir.value === 'now') {
    settings.setHomeDefaults({ dateOffset: 'now' })
    return
  }
  const n = dDateN.value.trim()
  const spec = /^\d+$/.test(n) && Number(n) > 0 ? `${dDateDir.value}:${Number(n)}:${dDateUnit.value}` : ''
  settings.setHomeDefaults({ dateOffset: spec })
}

/** 單位與方向的選項（0.1.49：加回「時」＋「現在」＋「無」） */
const unitOptions: { v: 'h' | 'm' | 'd' | 'mo' | 'y' | 'now' | 'none'; label: string }[] = [
  { v: 'h', label: '時' },
  { v: 'm', label: '分' },
  { v: 'd', label: '日' },
  { v: 'mo', label: '月' },
  { v: 'y', label: '年' },
  { v: 'now', label: '現在' },
  { v: 'none', label: '無' },
]
const dirOptions: { v: 'now' | 'before' | 'after' | 'none'; label: string }[] = [
  { v: 'now', label: '現在' },
  { v: 'before', label: '前' },
  { v: 'after', label: '後' },
  { v: 'none', label: '無' },
]

/* ── 預設圖片：上傳即存、移除即刪 ─────────────────────────── */
const busyImg = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
function pick() {
  fileInput.value?.click()
}
async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((f) => IMG_MIME.test(f.type))
  input.value = ''
  if (!files.length) return
  busyImg.value = true
  try {
    const next = [...dImages.value]
    for (const file of files) {
      const id = uid('hd')
      const comp = await compressImage(file)
      await putImage(id, comp.blob)
      const thumb = await makeThumb(comp.blob)
      next.push({
        id,
        md5: '',
        shotAt: null,
        name: file.name,
        thumb,
        w: comp.width || undefined,
        h: comp.height || undefined,
        bytes: comp.bytes,
        originalBytes: comp.originalBytes || file.size,
      })
    }
    dImages.value = next
    settings.setHomeDefaults({ images: next })
    notify('已設為預設圖片', 'ok')
  } finally {
    busyImg.value = false
  }
}
function removeImage(im: ImageRef) {
  const next = dImages.value.filter((x) => x.id !== im.id)
  dImages.value = next
  settings.setHomeDefaults({ images: next })
  void deleteImage(im.id)
}

/** 日期偏移的選項（使用者原話的例子全收進來） */
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
        role="dialog"
        aria-modal="true"
        aria-label="記帳頁預設值"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <div class="bsheet__grab" aria-hidden="true"></div>

        <div ref="boxEl" class="box bsheet__body">
          <!--
            0.1.52 美化（使用者原話：「美化一下這個介面，可自由發揮」）：
            標題列＝圖示磚＋標題＋一句說明；說明整合原本兩段 hint 的重點
            （「7＝清空＋記錄…」那段已按需求移除）。
          -->
          <header class="hd">
            <span class="hd__ic" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 7.5h9M17.5 7.5H19M5 12h2M10.5 12H19M5 16.5h6M14.5 16.5H19" />
                <circle cx="15.6" cy="7.5" r="1.9" />
                <circle cx="8.6" cy="12" r="1.9" />
                <circle cx="12.6" cy="16.5" r="1.9" />
              </svg>
            </span>
            <div class="hd__txt">
              <h3>記帳頁預設值</h3>
              <p class="hd__sub">
                只用在排版裡<b>沒排進去</b>的區塊；留空＝照原本的行為走，設定即改即存。
              </p>
            </div>
            <button class="closebtn" type="button" title="關閉" aria-label="關閉" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" />
              </svg>
            </button>
          </header>

          <!-- 1＝支出/收入 -->
          <div class="frow">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.6 8.4h12.2l-3.2-3.2M19.4 15.6H7.2l3.2 3.2" />
              </svg>
              支出／收入
            </span>
            <div class="seg3">
              <button
                type="button"
                class="seg3__b"
                :class="{ 'is-on': dType === '' }"
                @click="saveType('')"
              >
                不設定
              </button>
              <button
                type="button"
                class="seg3__b"
                :class="{ 'is-on': dType === 'expense' }"
                @click="saveType('expense')"
              >
                支出
              </button>
              <button
                type="button"
                class="seg3__b"
                :class="{ 'is-on': dType === 'income' }"
                @click="saveType('income')"
              >
                收入
              </button>
            </div>
          </div>

          <!--
            2＝金額（0.1.50：下方再加一列「幣別」下拉，整行、所有貨幣都能選）
            ⚠ 幣別選單屬於區塊 1，所以只有區塊 1 沒排進記帳頁時才會用這裡的值；
              區塊 1 有排進去就以記帳頁上的選擇為準。
          -->
          <label class="frow frow--nosep">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.4v15.2M15.4 8.2H10.6a2.5 2.5 0 0 0 0 5h2.8a2.5 2.5 0 0 1 0 5h-4.8" />
              </svg>
              金額
            </span>
            <input
              v-model="dAmount"
              class="field frow__in num"
              inputmode="decimal"
              placeholder="不設定"
              @change="saveAmount"
              @blur="saveAmount"
            />
          </label>
          <label class="frow">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="7.6" />
                <path d="M4.4 9.6h15.2M4.4 14.4h15.2" />
              </svg>
              幣別
            </span>
            <select
              class="field frow__in"
              :value="dCurrency"
              aria-label="預設幣別"
              @change="saveCurrency(($event.target as HTMLSelectElement).value)"
            >
              <option value="">不設定（沿用記帳頁）</option>
              <option v-for="c in currencyOptions" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
          </label>

          <!-- 3＝分類 -->
          <div class="frow">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.4 6.6A2.2 2.2 0 0 1 6.6 4.4h2.7l1.9 2.2h6.2a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.6a2.2 2.2 0 0 1-2.2-2.2Z" />
              </svg>
              分類
            </span>
            <div class="frow__cat">
              <CategoryPicker v-model="dCategoryId" :type="pickerType" variant="select" />
              <button
                v-if="dCategoryId"
                class="cat-x"
                type="button"
                title="不設定分類"
                aria-label="不設定分類"
                @click="clearCategory"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- 4＝備註（0.1.50：下方多一條明顯的分割線，跟「日期時間」分開） -->
          <label class="frow frow--nosep">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6.6 4.4h10.8a1.6 1.6 0 0 1 1.6 1.6v12a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 18V6a1.6 1.6 0 0 1 1.6-1.6Z" />
                <path d="M8.6 9.2h6.8M8.6 12.6h6.8M8.6 16h4" />
              </svg>
              備註
            </span>
            <input
              v-model="dNote"
              class="field frow__in"
              type="text"
              :maxlength="80"
              placeholder="不設定（例如 GOGOGO）"
              @change="saveNote"
              @blur="saveNote"
            />
          </label>
          <div class="frow-sep" role="separator" aria-hidden="true"></div>

          <!-- 5＝日期時間（0.1.49：輸入框可輸入數字或完整時間；單位/方向下拉照分類下拉的格局）。
               PWA：輸入框獨立一行、兩個下拉在下一行；電腦版（≥768px）三個同一行。 -->
          <div class="frow frow--date">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5.6 6.2h12.8a1.6 1.6 0 0 1 1.6 1.6v10.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.2V7.8a1.6 1.6 0 0 1 1.6-1.6Z" />
                <path d="M4 10.4h16M8.4 4.2v3.6M15.6 4.2v3.6" />
              </svg>
              日期時間
            </span>
            <div class="daterow">
              <input
                v-model="dDateN"
                class="field daterow__n"
                type="text"
                inputmode="text"
                placeholder="數字，或 2026-10-12 09:30"
                aria-label="預設日期（數字或完整時間）"
                @input="saveDate"
                @change="saveDate"
              />
              <!-- ⚠ MiniSelect 是多根元件（scoped class 不會 fallthrough）→ 用 span 當 flex 子元素 -->
              <span class="daterow__sel">
                <MiniSelect
                  v-model="dDateUnit"
                  :options="unitOptions"
                  :disabled="isDatetimeInput"
                  aria-label="預設日期的單位"
                  @update:model-value="saveDate"
                />
              </span>
              <span class="daterow__sel">
                <MiniSelect
                  v-model="dDateDir"
                  :options="dirOptions"
                  :disabled="isDatetimeInput"
                  aria-label="預設日期的方向"
                  @update:model-value="saveDate"
                />
              </span>
            </div>
          </div>

          <!-- 6＝收據圖片 -->
          <div class="frow frow--imgs">
            <span class="frow__lb">
              <svg class="frow__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5.6 4.8h12.8a1.6 1.6 0 0 1 1.6 1.6v11.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.6V6.4a1.6 1.6 0 0 1 1.6-1.6Z" />
                <path d="m4.6 16.6 4.4-4.4 3.2 3.2 2.6-2.6 4.6 4.6" />
                <circle cx="9.2" cy="9.4" r="1.3" />
              </svg>
              收據圖片
            </span>
            <div class="imgs">
              <div v-for="im in dImages" :key="im.id" class="imgs__cell">
                <img v-if="im.thumb" :src="im.thumb" alt="" />
                <button class="imgs__x" type="button" title="移除預設圖片" @click="removeImage(im)">✕</button>
              </div>
              <button class="imgs__add" type="button" :disabled="busyImg" @click="pick">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{{ busyImg ? '處理中…' : '上傳' }}</span>
              </button>
              <input ref="fileInput" class="hidden" type="file" accept="image/*" multiple @change="onFiles" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * 0.1.47（使用者原話：「整體要向上一點點，左右要留有空間（可以參考旅行模式的頁面格局）」）：
 * `.box` 是各子頁面自己 scoped 的（TravelSheet 同款）——之前忘了定義，
 * 內容才會貼邊又貼底。照 TravelSheet 的格局：左右 18px、底部 18px＋bsheet 的 safe-area，
 * 列間距 14px。
 */
.box {
  padding: 4px 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/*
 * 0.1.51（使用者原話）：「參考記帳明細頁面…不會顯示下方的導覽欄」
 * 這頁的 `.mask` 之前沒給 z-index（＝auto），底部導覽欄（.tabbar, z-index:40）
 * 就蓋在遮罩上面——彈層看起來像「露出下半截」。這裡補上跟其他設定子頁面
 * 同一層的 90（TravelSheet／QuickAmountSheet 同值），遮罩才是整片蓋滿。
 */
.mask {
  z-index: 90;
}
/*
 * 0.1.51（使用者原話）：「隱藏文件選擇器的按鈕（用戶按 ICON 就可以上傳圖片）」
 * 上傳用的 `<input type="file">` 靠 `.hidden` 藏起來——其他子頁面（ReceiptImages／
 * RecordSheet／設定頁匯入）都在自己的 scoped CSS 定義了 `.hidden`，這一頁漏了，
 * 原生「Choose Files」才會露出來。補上（不動上傳功能：按「上傳」磚仍是 fileInput.click()）。
 */
.hidden {
  display: none;
}
/*
 * 0.1.52 美化：標題列＝圖示磚（漸層底）＋標題＋一句說明。
 * `.hd__txt` 是 flex 子項要吃剩餘寬度，說明才不會把標題擠歪。
 */
.hd {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding-bottom: 2px;
}
.hd__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: linear-gradient(150deg, var(--accent-soft) 0%, var(--surface-3) 100%);
  color: var(--accent);
}
.hd__ic svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.hd__txt {
  flex: 1;
  min-width: 0;
}
.hd__txt h3 {
  margin: 1px 0 0;
  font-size: 16.5px;
  font-weight: 750;
  letter-spacing: 0.2px;
}
.hd__sub {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-3);
}
.hd__sub b {
  font-weight: 650;
  color: var(--text-2);
}
.closebtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: var(--text-3);
}
.closebtn:hover {
  background: var(--surface-3);
  color: var(--text);
}
.closebtn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
/*
 * 0.1.52 美化：每一列＝左邊「圖示＋標籤」、右邊控制項。
 * ⚠ 列結構刻意維持「只有兩個子元素」（標籤＋控制項）——v125 有量測斷言
 *   （幣別列整行＝列內只有標籤與下拉、下拉佔滿剩餘寬度），圖示因此放在標籤內。
 */
.frow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.frow:last-of-type {
  border-bottom: 0;
}
/* 0.1.50：某些列自己不要底線（改由 .frow-sep 畫一條更明顯的分割線），
   例如「金額→幣別」要黏成一組、「備註」下面要留間距再畫線。 */
.frow--nosep {
  border-bottom: 0;
  padding-bottom: 0;
}
.frow-sep {
  height: 1px;
  margin: 2px 0;
  background: var(--line-strong);
}
.frow__lb {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 96px;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
/* 圖示＝小圓角色塊（美化用；純裝飾，不影響任何斷言與點擊） */
.frow__ic {
  flex: none;
  box-sizing: content-box;
  width: 15px;
  height: 15px;
  padding: 4px;
  border-radius: 9px;
  background: var(--surface-3);
  color: var(--text-3);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.frow__in {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 11px;
  font-size: 16px;
  border-radius: 11px;
}
.frow__in:focus,
.frow__in:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/*
 * 0.1.49：日期時間＝「輸入框（數字或完整時間）＋單位下拉＋方向下拉」。
 * PWA（<768px）：輸入框**獨立一行**、兩個下拉同行在其**下方**；
 * 電腦版（≥768px）：三個同一行。都不走位（min-width:0 可壓縮）。
 */
.daterow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  /* 0.1.51（使用者原話）：「日期時間中的兩個下拉選單框，往上一點點，
     跟最底部留有一點點的距離」→ 這一列自己多留 3px 底部內距，
     兩個下拉框再各自往上收 3px（不貼齊列的底線）。 */
  padding-bottom: 3px;
}
.daterow__n {
  flex: 1 1 100%;
  min-width: 0;
  height: 40px;
  padding: 0 11px;
  font-size: 16px;
  border-radius: 11px;
}
.daterow__sel {
  flex: 1 1 0;
  min-width: 0;
  display: block;
  margin-bottom: 3px;
}
@media (min-width: 768px) {
  .daterow__n {
    flex: 1 1 0;
  }
}

/* 支出/收入：三段小膠囊 */
.seg3 {
  flex: 1;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 13px;
}
.seg3__b {
  flex: 1;
  height: 32px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  transition: background 0.15s ease, color 0.15s ease;
}
.seg3__b.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}

/* 分類：picker＋清除鈕 */
.frow__cat {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.frow__cat > :first-child {
  flex: 1;
  min-width: 0;
}
.cat-x {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 12px;
}
.cat-x:hover {
  background: var(--expense-soft);
  color: var(--expense);
}

/* 預設圖片 */
.frow--imgs {
  align-items: flex-start;
}
.frow--imgs .frow__lb {
  padding-top: 6px;
}
.imgs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.imgs__cell {
  position: relative;
  width: 56px;
  height: 56px;
}
.imgs__cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid var(--line);
}
.imgs__x {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--expense);
  color: #fff;
  font-size: 10px;
  box-shadow: var(--shadow-1);
}
.imgs__add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 60px;
  height: 60px;
  border-radius: 12px;
  border: 1px dashed var(--line-strong);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.imgs__add:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.imgs__add svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.imgs__add:disabled {
  opacity: 0.5;
}
</style>
