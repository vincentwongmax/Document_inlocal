<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { LevelKey } from '@/types'
import { IMG_LEVELS } from '@/lib/imgLevels'
import { formatBytes } from '@/lib/imaging'

/**
 * 導覽狀態（0.1.57）。
 * 只有「看得到上下張／上下筆」的情境才需要給（記錄頁的記錄明細會給）；
 * 不給就是原本單純的放大檢視（記帳頁、查看頁都還是舊行為）。
 */
export interface LightboxNav {
  /** 這一筆記錄**沒有圖片**（導覽到沒圖的記錄時會走到）→ 顯示「無圖」佔位 */
  empty?: boolean
  hasPrevImg: boolean
  hasNextImg: boolean
  hasPrevRec: boolean
  hasNextRec: boolean
  /** 要不要顯示「上一筆／下一筆記錄」那一組（沒有清單就不要顯示空殼） */
  rec?: boolean
  /** 「2 / 3」這一筆裡的第幾張（只有一張就不用顯示） */
  pos?: string
  /** 「3 / 12」在整份清單裡的第幾筆（沒有清單就不用顯示） */
  recPos?: string
}

/**
 * 圖片放大檢視（點黑色背景關閉、可縮放、放大後可拖曳）。
 *
 * 給定 `src`（object URL）就開啟；關閉時 emit `close`，由呼叫端把 src 設回 null。
 * 縮放／拖曳的細節見下面 `measureFit()` 的註解。
 *
 * 0.1.57：多了導覽（`nav`）與「點圖片本身也關閉」：
 *   - `nav` 有給 → 底部多一列 ICON（上一張／下一張圖片、上一筆／下一筆記錄）
 *   - 點圖片＝關閉（跟右上角 ✕ 同一招；但拖曳不算，見 `onImgClick`）
 */
/**
 * @param src      圖片的 object URL（null＝關閉）
 * @param nav      導覽狀態（0.1.57）
 * @param level    0.1.72：這張圖目前的壓縮等級。**給了才會顯示等級列**
 *                 （記錄明細／記帳頁會給；純檢視舊圖時不給）
 * @param levelLocked 已記錄／已儲存 → 等級列鎖住不能改
 * @param levelBytes  目前這個等級的體積（顯示在等級列右邊）
 */
const props = defineProps<{
  src: string | null
  nav?: LightboxNav | null
  level?: LevelKey | null
  levelLocked?: boolean
  levelBytes?: number
}>()
const emit = defineEmits<{
  close: []
  'prev-image': []
  'next-image': []
  'prev-record': []
  'next-record': []
  /** 0.1.72：在圖片頁裡改壓縮等級；父層換完 blob 會把新的 object URL 回傳給 `src` */
  'set-level': [LevelKey]
}>()

/** 有顯示等級列嗎（父層有給 level 就顯示） */
const showLevels = computed(() => !!props.level)

/**
 * 0.1.72：切等級時**不要**關掉燈箱，也不要重置縮放 ——
 * 使用者要的就是「按了馬上看到這一級長什麼樣」，
 * 所以父層換 src 的當下圖片會自己重載（<img :src> 變了就換圖）。
 */
function pickLevel(k: LevelKey) {
  if (props.levelLocked || k === props.level) return
  emit('set-level', k)
}

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

/** 檢視區與圖片本體（量基準尺寸用） */
const stageEl = ref<HTMLElement | null>(null)
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
  if (props.src) measureFit()
}
watch(
  () => props.src,
  async (open) => {
    if (open) {
      zoom.value = 1
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
  },
)
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
/** 有導覽列時，燈箱也可能處於「這一筆沒圖」的狀態 → 判斷要不要顯示 */
const opened = computed(() => !!props.src || !!props.nav)

function onBgClick(e: MouseEvent) {
  if (Math.hypot(e.clientX - bgFrom.x, e.clientY - bgFrom.y) > 8) return
  close()
}
/**
 * 點圖片本身也關閉（0.1.57 使用者原話：「用戶可以點擊圖片一下，關閉圖片」）。
 * ⚠ 一樣要判斷位移：放大後使用者是在圖片上拖著看細節，放開時瀏覽器可能補一個 click，
 *   不擋的話「滑兩下」就把檢視關掉了（跟點背景同一個保護）。
 */
function onImgClick(e: MouseEvent) {
  if (Math.hypot(e.clientX - bgFrom.x, e.clientY - bgFrom.y) > 8) return
  close()
}
function close() {
  zoom.value = 1
  emit('close')
}

/**
 * 把可捲動的檢視區交出去。
 * 呼叫端（例如明細彈窗）要把它列進「鎖背景捲動」的放行清單，
 * 否則手指在放大後的圖片上滑動會被 document 的 touchmove preventDefault 擋掉 → 拖不動。
 */
defineExpose({ stageEl })
</script>

<template>
  <!-- 圖片放大：點黑色背景**或點圖片本身**都關閉（0.1.57）；放大後可上下左右拖曳查看
       （原生捲動），所以關閉前要判斷是拖曳還是點一下。
       ⚠ 開場條件是 `opened`（src 或 nav 任一個有）：導覽到「這一筆沒圖」時 src 是 null，
          靠 nav 撐住，使用者才看得見「無圖」而且還能繼續按下一筆。 -->
  <Transition name="fade">
    <div v-if="opened" class="lightbox" @pointerdown="onBgDown" @click="onBgClick">
      <div ref="stageEl" class="lightbox__stage">
        <div v-if="nav?.empty" class="lightbox__empty">無圖</div>
        <img
          v-else
          ref="zoomImg"
          :src="src ?? ''"
          alt=""
          :style="zoomStyle"
          @load="measureFit"
          @click.stop="onImgClick"
        />
      </div>

      <!--
        導覽列（0.1.57 使用者原話：「加入按鈕可以支持查看上一張圖片和下一張圖片，
        另外再加按鈕可以查看上一筆記錄的圖片和下一筆記錄的圖片按鈕」）。
        刻意放在**獨立一列**、不放進 `.lightbox__bar`：那一列是「縮小／倍率／放大」三顆，
        既有操作與測試都認那個數量，混在一起會互相干擾。
      -->
      <div v-if="nav" class="lightbox__nav" @click.stop>
        <div class="lbnav__grp">
          <button
            class="lbbtn lbbtn--nav"
            type="button"
            title="上一張圖片"
            aria-label="上一張圖片"
            :disabled="!nav.hasPrevImg"
            @click="emit('prev-image')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14.4 5.6 8 12l6.4 6.4" />
            </svg>
          </button>
          <span v-if="nav.pos" class="lbnav__pos num">{{ nav.pos }}</span>
          <button
            class="lbbtn lbbtn--nav"
            type="button"
            title="下一張圖片"
            aria-label="下一張圖片"
            :disabled="!nav.hasNextImg"
            @click="emit('next-image')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9.6 5.6 16 12l-6.4 6.4" />
            </svg>
          </button>
        </div>

        <!-- 記錄組：只有真的有清單（記錄頁）才出現 -->
        <div v-if="nav.rec" class="lbnav__grp">
          <button
            class="lbbtn lbbtn--nav"
            type="button"
            title="上一筆記錄"
            aria-label="上一筆記錄"
            :disabled="!nav.hasPrevRec"
            @click="emit('prev-record')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12.6 5.6 6.2 12l6.4 6.4" />
              <path d="M18.4 5.6 12 12l6.4 6.4" />
            </svg>
          </button>
          <span v-if="nav.recPos" class="lbnav__pos num">{{ nav.recPos }}</span>
          <button
            class="lbbtn lbbtn--nav"
            type="button"
            title="下一筆記錄"
            aria-label="下一筆記錄"
            :disabled="!nav.hasNextRec"
            @click="emit('next-record')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11.4 5.6 17.8 12l-6.4 6.4" />
              <path d="M5.6 5.6 12 12l-6.4 6.4" />
            </svg>
          </button>
        </div>
      </div>

      <!--
        0.1.72（需求 3）：壓縮等級搬到**圖片頁面裡**（使用者原話：「把原,A,B,C,D 的按鈕
        放在圖片頁面內(即用戶點擊圖片後)」）。按了會即時換圖，使用者可以直接比對。
      -->
      <div v-if="showLevels" class="lightbox__lv" @click.stop>
        <span class="lightbox__lvlb tiny muted">壓縮</span>
        <button
          v-for="l in IMG_LEVELS"
          :key="l.key"
          type="button"
          class="lvb"
          :class="{ 'is-on': l.key === level }"
          :disabled="levelLocked"
          :title="levelLocked ? `${l.title}（記錄後就不能更改壓縮程度了）` : l.title"
          :aria-pressed="l.key === level"
          @click="pickLevel(l.key)"
        >
          {{ l.label }}
        </button>
        <span v-if="levelBytes" class="lightbox__lvsz tiny num">{{ formatBytes(levelBytes) }}</span>
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
        <button class="lbzoom num" type="button" title="回到原始大小" :disabled="zoom === 1" @click="zoomReset">
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

      <button class="lightbox__x" type="button" title="關閉" aria-label="關閉" @click="close">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
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
/* ── 導覽列（0.1.57）：上一張／下一張圖片 ‧ 上一筆／下一筆記錄 ──
   獨立一列放在縮放工具列上方；兩群中間留較大的間隔，看得出「圖片」與「記錄」是兩組 */
.lightbox__nav {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 0 12px 8px;
}
.lbnav__grp {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lbnav__pos {
  min-width: 46px;
  text-align: center;
  font-size: 12px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.9);
}
.lbbtn--nav {
  width: 38px;
  height: 38px;
}
.lbbtn--nav svg {
  width: 20px;
  height: 20px;
  stroke-width: 2;
}
/* 這一筆沒有圖片（導覽到沒圖的記錄）：給一個看得見的佔位，
   而不是讓畫面全黑 —— 全黑會讓使用者以為圖片壞了或 App 卡住 */
.lightbox__empty {
  margin: auto;
  padding: 24px 32px;
  border: 1px dashed rgba(255, 255, 255, 0.32);
  border-radius: 14px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.1em;
}
/* 工具列固定在底部，不隨圖片捲動 */
/* 0.1.72：圖片頁裡的壓縮等級列（原/A/B/C/D ＋ 體積） */
.lightbox__lv {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 16px 2px;
}
.lightbox__lvlb {
  flex: none;
}
.lightbox__lv .lvb {
  min-width: 34px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
}
.lightbox__lv .lvb.is-on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.lightbox__lv .lvb:disabled {
  opacity: 0.45;
}
.lightbox__lvsz {
  flex: none;
  min-width: 52px;
  text-align: right;
}
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
