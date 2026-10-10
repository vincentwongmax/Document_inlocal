<script setup lang="ts">
import { ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { HomeDefaults, ImageRef, TxType } from '@/types'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import { compressImage, makeThumb } from '@/lib/imaging'
import { deleteImage, putImage } from '@/lib/imageDb'
import { uid } from '@/lib/id'
import { notify } from '@/lib/alerts'
import { IMG_MIME } from '@/lib/clipboard'
import CategoryPicker from './CategoryPicker.vue'

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
const dCategoryId = ref('')
const dNote = ref('')
const dDate = ref<HomeDefaults['dateOffset']>('')
const dImages = ref<ImageRef[]>([])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const d = settings.state.homeDefaults
    dType.value = d.type
    dAmount.value = d.amount
    dCategoryId.value = d.categoryId
    dNote.value = d.note
    dDate.value = d.dateOffset
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
function saveDate(v: HomeDefaults['dateOffset']) {
  dDate.value = v
  settings.setHomeDefaults({ dateOffset: v })
}

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
const dateOptions: { v: HomeDefaults['dateOffset']; label: string }[] = [
  { v: '', label: '不設定（照原本＝現在）' },
  { v: 'now', label: '現在' },
  { v: 'yesterday', label: '昨天' },
  { v: 'tomorrow', label: '明天' },
  { v: 'm5', label: '5 分鐘前' },
  { v: 'm30', label: '30 分鐘前' },
  { v: 'h2', label: '2 小時前' },
]
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
          <header class="hd">
            <h3>記帳頁預設值</h3>
            <button class="closebtn" type="button" title="關閉" aria-label="關閉" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" />
              </svg>
            </button>
          </header>

          <p class="tiny muted hint">
            只有用在「記帳頁排版」裡<b>沒排進去</b>的區塊——提交記錄時改用這裡的值。
            每個欄位都可以不設（留空＝照原本的行為走）。設定即改即存。
          </p>

          <!-- 1＝支出/收入 -->
          <div class="frow">
            <span class="frow__lb">支出／收入</span>
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

          <!-- 2＝金額 -->
          <label class="frow">
            <span class="frow__lb">金額</span>
            <input
              v-model="dAmount"
              class="field frow__in num"
              inputmode="decimal"
              placeholder="不設定"
              @change="saveAmount"
              @blur="saveAmount"
            />
          </label>

          <!-- 3＝分類 -->
          <div class="frow">
            <span class="frow__lb">分類</span>
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

          <!-- 4＝備註 -->
          <label class="frow">
            <span class="frow__lb">備註</span>
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

          <!-- 5＝日期時間 -->
          <label class="frow">
            <span class="frow__lb">日期時間</span>
            <select class="field frow__sel" :value="dDate" @change="saveDate(($event.target as HTMLSelectElement).value as HomeDefaults['dateOffset'])">
              <option v-for="o in dateOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
            </select>
          </label>

          <!-- 6＝收據圖片 -->
          <div class="frow frow--imgs">
            <span class="frow__lb">收據圖片</span>
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

          <p class="tiny muted hint">
            7＝清空＋記錄：沒有東西可以設（那排按鈕本來就是空的）。
          </p>
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
  padding: 6px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.hd h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.closebtn {
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
.hint {
  margin: 0;
  line-height: 1.5;
}

/* 每一列：左標籤、右控制項 */
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
.frow__lb {
  flex: none;
  width: 74px;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.frow__in,
.frow__sel {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  font-size: 16px;
}

/* 支出/收入：三段小膠囊 */
.seg3 {
  flex: 1;
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface-3);
  border-radius: 10px;
}
.seg3__b {
  flex: 1;
  height: 30px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
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
  border-radius: 9px;
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
  gap: 2px;
  width: 56px;
  height: 56px;
  border-radius: 9px;
  border: 1px dashed var(--line-strong);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10px;
}
.imgs__add svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.imgs__add:disabled {
  opacity: 0.5;
}
</style>
