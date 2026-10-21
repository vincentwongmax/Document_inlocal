<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { calcValue, displayMain, displaySub, isLongDisplay, type CalcState } from '@/lib/calc'
import { fmtMoney } from '@/lib/currency'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
import Keypad from '@/components/Keypad.vue'

/**
 * 輸入金額用的計算機子頁面（置中卡片彈窗）。
 * 金額狀態仍由記帳頁持有，這裡只負責顯示與轉發按鍵，
 * 所以關掉再開、或點背景關掉，輸入過的內容都不會不見。
 */
const props = defineProps<{
  open: boolean
  calc: CalcState
  /** 金額前綴的幣別符號 */
  symbol: string
  /** 目前記帳幣別（換算預覽用） */
  curCode: string
}>()

const emit = defineEmits<{ press: [key: string]; close: [] }>()

const settings = useSettingsStore()

const amount = computed(() => Number(calcValue(props.calc).toFixed(2)))
const expr = computed(() => displaySub(props.calc))
const display = computed(() => displayMain(props.calc))
/** 只有長公式／很大的結果才縮小字級（單一數字最多 11 位，永遠不會觸發） */
const displayLong = computed(() => isLongDisplay(display.value))
/**
 * 0.1.75：數量模式 —— 沒有幣別，所以「輸入金額」改「輸入數量」、
 * 幣別符號與換算預覽整組消失。
 */
const qty = computed(() => settings.quantityMode)
/** 還沒按 = 之前不顯示換算預覽，答案要按了等於才出現（數量模式沒有匯率） */
const converted = computed(() => props.calc.done && !qty.value && props.curCode !== settings.baseCurrency)
const convertedAmount = computed(() => Number((amount.value * settings.rate(props.curCode)).toFixed(2)))

/**
 * 0.1.72（使用者原話）：「小數點的點縮小一點，不要太大，最好佔半個字符
 * （因為用戶很容易看不清整體）」。
 * 等寬數字裡 `.` 跟數字一樣寬，整串數字會被它撐開、點本身又太顯眼 →
 * 把小數點拆出來單獨渲染成一顆細一點、寬度約半個字符的 span（見 `.dotp`）。
 */
const exprSegs = computed(() => expr.value.split('.'))
const displaySegs = computed(() => display.value.split('.'))

/**
 * 0.1.74（需求 3·使用者原話「在PWA (iPhone)的模式下會爆出畫面來」）：
 * 長算式（例如 `55555555555×6666666666`）會把計算機的顯示列撐寬、撐破彈窗。
 *
 * ⚠ 為什麼會撐破：`.calcdisp__num` 是 `.calcdisp__main`（display:flex）的 **flex item**，
 *   flex item 的 `min-width` 預設值是 `auto` ＝「不小於內容的最小寬度」，
 *   所以它**不肯被壓縮**，長字串就會把整列撐寬 → 溢出畫面。
 *   （桌機常常沒事，是因為桌機字體較窄 + 視窗較寬，剛好還沒超。）
 *
 * 解法（兩層都要，缺一不可）：
 *   ① CSS：`.calcdisp__fit` 給 `min-width: 0` ＋ `overflow: hidden` → 允許被壓縮
 *   ② JS：`fitScale()` 量「自然寬度 ÷ 可用寬度」，把字級**等比縮到剛好放得下**
 *      → 不論是 iPhone 掉到 Menlo、或使用者按出超長結果，都不會溢出，
 *         而且是「縮字」不是「截斷／出現…」。
 *
 * ⚠ 縮放**只在需要時**發生（scale ≤ 1 才是縮小），正常長度維持原字級
 *   （v82 的硬性約束「11 位數字 ＋ 小數點 ＝ 12 字元維持 38px 不縮小」仍然成立）。
 */
const fitEl = ref<HTMLElement | null>(null)
const numEl = ref<HTMLElement | null>(null)
/** 縮放倍率（1＝原尺寸；0.5＝半尺寸） */
const fitScale = ref(1)

/** 目前這級字級（is-long 24px／一般 38px） */
const baseFontSize = computed(() => (displayLong.value ? 24 : 38))

/**
 * 量一次、必要時縮到剛好放得下。
 *
 * ⚠⚠ 量「自然寬度」**不能用 `scrollWidth` 也不能用 `getBoundingClientRect()`**：
 *   `.calcdisp__num` 有 `max-width: 100%` ＋ `overflow: hidden`，
 *   所以 `scrollWidth` 會被夾在「容器寬度」內（量到的永遠是剛好放得下的寬度，
 *   於是 `natural / avail` ≈ 1 → 永遠不縮小）；`getBoundingClientRect()` 更糟，
 *   它量到的是**已經被壓縮後**的寬度。
 *   唯一正確的量法＝ `Range.selectNodeContents()` 量文字的**實際排版寬度**
 *   （不受 max-width 影響），而且要先在 scale=1 的狀態下量。
 */
function fitScaleNow() {
  const fit = fitEl.value
  const num = numEl.value
  if (!fit || !num) return
  const avail = fit.clientWidth
  if (avail <= 0) return
  /**
   * ⚠⚠⚠ 量之前**一定要先把字級還原成 base**，否則會「自我消除」：
   *   第二次量測時字級已經是縮過的（例如 23.43px）→ 量到的 natural 也是縮後寬度
   *   → `natural / avail` ≈ 0.98 < 1 → 判定「放得下」→ 把字級還原回 24px
   *   → 下一次量測又重新溢出、永遠在 24px 與縮排之間跳動，最後看起來就是沒生效。
   *   還原之後立刻讀 Range 的 rect，讀取本身會強制排版，所以量到的就是 base 字級下的自然寬度。
   */
  num.style.fontSize = `${baseFontSize.value}px`
  const range = document.createRange()
  range.selectNodeContents(num)
  const natural = range.getBoundingClientRect().width
  range.detach?.()
  if (!natural) return
  const s = natural / avail
  // 只縮小、不放大；留 2% 餘量避免 letter-spacing 尾端／浮點誤差造成剛好溢出
  fitScale.value = s > 1.001 ? Number((1 / s * 0.98).toFixed(4)) : 1
  /**
   * ⚠⚠ 字級**直接寫在 DOM 上**，不要用 template 的 `:style` 綁定。
   *   實測（0.1.74）：production build 下 `:style="fitStyle"` 綁定**沒有被 Vue 寫進 DOM**
   *   （`num.style.fontSize` 一直是空、style 屬性從未出現），
   *   等距縮排等於完全沒作用。因為這裡本來就沒有任何 Vue 樣式綁定會碰 font-size，
   *   直接寫 `style.fontSize` 不會被後續 patch 蓋掉，是最穩的做法。
   */
  num.style.fontSize = `${baseFontSize.value * fitScale.value}px`
  if (import.meta.env.DEV || (globalThis as Record<string, unknown>).__FITDEBUG) {
    console.log('[fit]', JSON.stringify({ avail, natural: Math.round(natural * 10) / 10, s, scale: fitScale.value }))
  }
}

/**
 * 排程一次量測。
 *
 * ⚠ 為什麼不能只靠 `watch` + `nextTick`：`nextTick` 只等 Vue 把 DOM patch 完，
 *   **不等瀏覽器完成排版／字體 fallback**；`.calcdisp__fit` 的 `clientWidth`
 *   在彈窗剛開、動畫還在跑的那一帧常常還不是最終值 → 量到偏大的可用寬度 → 判定「放得下」。
 *   保險做法＝再多等兩帧（rAF ×2）後才量。
 */
let fitRaf = 0
function scheduleFit() {
  if (fitRaf) cancelAnimationFrame(fitRaf)
  const step = () => {
    fitScaleNow()
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0
      fitScaleNow()
    })
  }
  fitRaf = requestAnimationFrame(step)
}

/** 顯示內容變了 → 重新量（等 DOM 更新完 + 兩帧後再量） */
watch(
  () => [display.value, displayLong.value, props.symbol],
  async () => {
    fitScale.value = 1
    await nextTick()
    scheduleFit()
  },
)
/** 視窗大小變了（旋轉／PWA 視窗大小變化）→ 先還原成 1 再重新量 */
async function onViewportResize() {
  fitScale.value = 1
  await nextTick()
  scheduleFit()
}
onMounted(() => {
  window.addEventListener('resize', onViewportResize)
  window.addEventListener('orientationchange', onViewportResize)
  scheduleFit()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
  window.removeEventListener('orientationchange', onViewportResize)
  if (fitRaf) cancelAnimationFrame(fitRaf)
})

/**
 * 背景不滑動：
 * 1. 捲動容器是 documentElement，彈窗期間直接在它上面關掉 overflow（useScrollLock）
 * 2. iOS Safari 只靠 overflow 擋不住手指滑動，useScrollLock 會另外 preventDefault touchmove
 * 3. 卡片本身也不滑動（max-height + overflow hidden），手指在卡片上滑也不會傳給背景
 *
 * 計算機整頁都不需要捲，所以不傳 scrollable —— 任何手指滑動一律擋掉。
 */
useScrollLock(toRef(props, 'open'))

/**
 * 向下拉就關閉（0.1.26）。
 * 使用者要求「之前的子頁面風格全跟記錄明細的頁面」——計算機也是子頁面。
 *
 * ⚠ 計算機**沒有可捲動區**（超過高度是讓數字鍵縮小，不是長捲軸），
 *   所以 `scroller` 傳一個永遠是 null 的 ref：
 *   這樣 `usePullToClose` 會把「往下滑」一律判成「拖面板」，
 *   不會有「這一下是捲內容還是關面板」的歧義。
 * ⚠ 外框仍然留著 `touch-action: none`（見 CSS）：這一頁本來就不該有原生捲動，
 *   而 touch 事件照樣會進來，拖曳關閉不受影響。
 */
const sheetEl = ref<HTMLElement | null>(null)
const noScroller = ref<HTMLElement | null>(null)
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({ panel: sheetEl, scroller: noScroller, onClose: () => emit('close') })
</script>

<template>
  <Transition name="calcfade">
    <div v-if="open" class="calcwrap bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="calccard card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="qty ? '輸入數量' : '輸入金額'"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <!-- 抓把：往下拉即可關閉（跟記錄明細同一套） -->
        <div class="bsheet__grab" aria-hidden="true"></div>

        <header class="calccard__hd">
          <span class="calccard__title">{{ qty ? '輸入數量' : '輸入金額' }}</span>
          <button type="button" class="btn btn--primary calccard__done" @click="emit('close')">
            完成
          </button>
        </header>

        <div class="calcdisp">
          <div class="calcdisp__expr num"
            ><template v-for="(seg, i) in exprSegs" :key="i"
              ><span v-if="i > 0" class="dotp">.</span>{{ seg }}</template
            ></div>
          <div class="calcdisp__main">
            <!-- 0.1.75：數量模式不顯示貨幣符號（MOP／$ 之類） -->
            <span v-if="!qty" class="calcdisp__sym">{{ symbol }}</span>
            <!--
              0.1.74（需求 3）：長算式在 iPhone PWA 會「爆出畫面」。
              ⚠ 根因＝`.calcdisp__num` 是 `.calcdisp__main` 的 **flex item**，
                flex item 的 `min-width` 預設是 `auto` ＝「不小于內容寬度」，
                所以一串長數字（`55555555555×6666666666`）會把整個顯示列撐寬、
                再撐破彈窗 → 畫面橫向溢出。
              解法兩層：
                ① `.calcdisp__fit` 給 `min-width: 0` ＋ `overflow: hidden`（容許收縮）
                ② `fitScale()` 量出「自然寬度 ÷ 可用寬度」，把字級等比縮到剛好放得下
                   （連字體 fallback 到 Menlo 的 iPhone 也對）
            -->
            <span ref="fitEl" class="calcdisp__fit">
              <!-- ⚠ font-size 由 fitScaleNow() 直接寫在 DOM 上（不要加 :style 綁定，見該函式註解） -->
              <span
                ref="numEl"
                class="calcdisp__num num"
                :class="{ 'is-long': displayLong }"
                ><template v-for="(seg, i) in displaySegs" :key="i"
                  ><span v-if="i > 0" class="dotp">.</span>{{ seg }}</template
                ></span
              >
            </span>
          </div>
          <div v-if="converted && amount > 0" class="calcdisp__conv num tiny">
            ≈ {{ fmtMoney(convertedAmount, settings.baseCurrency) }}
          </div>
        </div>

        <Keypad class="calccard__pad" @press="(k: string) => emit('press', k)" />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * 0.1.26：外框幾何來自 style.css 的 `.bsheet-mask` / `.bsheet` / `.bsheet__grab`
 * （＝記錄明細那套）。這裡只留計算機自己的東西。
 * ⚠ `touch-action: none` 要留著：計算機整頁都不該有原生捲動。
 *   touch 事件照樣會進來，所以下拉關閉不受影響。
 */
.calcwrap {
  z-index: 80;
  touch-action: none;
}

.calccard {
  /* ⚠ 0.1.28：**不要寫 padding-bottom**。
     面板底部的 safe-area 抬升由 style.css 的 `.bsheet.bsheet.bsheet` 統一處理，
     這裡寫了會蓋掉它（特異度 (0,2,0) > (0,1,0)），
     0.1.27 就是這樣讓「計算機還是弄到 iPhone 底部工作條」的。 */
  padding: 0 12px;
}

.calccard__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--line);
}
.calccard__title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.calccard__done {
  height: 34px;
  min-width: 70px;
  padding: 0 14px;
  font-size: 13px;
}

.calcdisp {
  padding: 12px 4px 14px;
  text-align: right;
  min-height: 0;
}
.calcdisp__expr {
  min-height: 18px;
  font-size: 12.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calcdisp__main {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
.calcdisp__sym {
  font-size: 17px;
  color: var(--text-2);
}
.calcdisp__fit {
  flex: 1 1 auto;
  /* ⚠ 關鍵：flex item 預設 min-width:auto 不肯被壓縮，長算式就會撐破卡片（iPhone PWA 爆畫面） */
  min-width: 0;
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
}
.calcdisp__num {
  font-size: 38px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.calcdisp__num.is-long {
  font-size: 24px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
/*
 * 0.1.72：小數點單獨渲染，讓它視覺上小一點（使用者：「小數點的點縮小一點，不要太大，
 * 最好佔半個字符」）。
 *
 * ⚠ 兩條限制同時成立：
 *   1. 需求 7：點要小到「半個字符以內」（0.5ch ≈ 11px）
 *   2. v82（0.1.27 使用者指定）：「11 位數字＋小數點＝12 個字元」也不能溢出顯示區，
 *      數字維持 38px 不縮小
 * 桌機等寬字體的 `.` 本來就只佔 ≈0.12em，所以要讓包起來的小點**比原始的還窄**，
 * 唯一穩定的做法就是把字級壓到 ≈0.2em（實測：0.42em 時仍會溢出 3～5px）。
 * 順手把自身的 letter-spacing 歸零，避免尾巴又多吃 1.14px。
 * ⚠ 試過但沒用：負 margin（對 scrollWidth 不可靠）、`width:0 + overflow:visible`
 *   （可見內容會被算進 scrollable overflow，反而更糟）。
 */
.dotp {
  display: inline-block;
  /* 0.1.73（需求 7·使用者回饋「太小請大一點點」）：0.2em → 0.3em。
     ⚠ 仍受v82 的硬性約束：11 位數字 ＋ 小數點 ＝ 12 字元不能溢出顯示框。 */
  font-size: 0.3em;
  letter-spacing: 0;
}
.calcdisp__conv {
  margin-top: 2px;
  color: var(--accent);
}

.calccard__pad {
  margin-top: auto;
}
/* 畫面高度不夠時讓按鍵縮小，維持「卡片不滑動」。
   鍵盤固定 5 列（見 Keypad.vue），橫向小螢幕也要塞得下，所以下限給得比較小 */
.calccard :deep(.key) {
  height: clamp(34px, 6.6vh, 54px);
}

/* ── 進出場 ─────────────────────────────────────────────── */
.calcfade-enter-active,
.calcfade-leave-active {
  transition: opacity 0.18s ease;
}
.calcfade-enter-from,
.calcfade-leave-to {
  opacity: 0;
}
.calcfade-enter-active .calccard,
.calcfade-leave-active .calccard {
  transition: transform 0.18s ease;
}
.calcfade-enter-from .calccard,
.calcfade-leave-to .calccard {
  transform: scale(0.96);
}
</style>
