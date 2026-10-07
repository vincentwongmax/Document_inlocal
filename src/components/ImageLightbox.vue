<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 圖片放大檢視（點黑色背景關閉、可縮放、放大後可拖曳）。
 *
 * 給定 `src`（object URL）就開啟；關閉時 emit `close`，由呼叫端把 src 設回 null。
 * 縮放／拖曳的細節見下面 `measureFit()` 的註解。
 */
const props = defineProps<{ src: string | null }>()
const emit = defineEmits<{ close: [] }>()

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
function onBgClick(e: MouseEvent) {
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
  <!-- 圖片放大：點黑色背景關閉；圖片本身不關閉，才能安心放大慢慢看。
       放大後可上下左右拖曳查看（原生捲動），所以點背景要判斷是拖曳還是點一下 -->
  <Transition name="fade">
    <div v-if="src" class="lightbox" @pointerdown="onBgDown" @click="onBgClick">
      <div ref="stageEl" class="lightbox__stage">
        <img ref="zoomImg" :src="src" alt="" :style="zoomStyle" @load="measureFit" @click.stop />
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
