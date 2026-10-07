<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

const emit = defineEmits<{ press: [key: string] }>()

type Kind = 'num' | 'op' | 'fn' | 'eq'
/** 運算符號一律用描邊圖示（各字型對 ÷ × − 的畫法差很多，用 SVG 才一致） */
type IconName = 'back' | 'div' | 'mul' | 'sub' | 'add'

interface PadKey {
  /** 按下時送出的鍵值（見 src/lib/calc.ts） */
  k: string
  kind: Kind
  /** 圖示鍵：顯示圖示而不是文字 */
  icon?: IconName
  /** 圖示鍵的讀屏名稱（圖示沒有文字可讀） */
  name?: string
}

/**
 * 固定 5 列 × 4 欄：
 *   ⌫  (  )  ÷
 *   7  8  9  ×
 *   4  5  6  −
 *   1  2  3  ＋
 *   C  0  .  ＝
 *
 * 運算鍵全部直接顯示，不必再靠左下角的鍵展開（原本那個切換鈕已移除）。
 */
const rows: PadKey[][] = [
  [
    { k: '⌫', kind: 'fn', icon: 'back', name: '刪除' },
    { k: '(', kind: 'fn' },
    { k: ')', kind: 'fn' },
    { k: '÷', kind: 'op', icon: 'div', name: '除' },
  ],
  [
    { k: '7', kind: 'num' },
    { k: '8', kind: 'num' },
    { k: '9', kind: 'num' },
    { k: '×', kind: 'op', icon: 'mul', name: '乘' },
  ],
  [
    { k: '4', kind: 'num' },
    { k: '5', kind: 'num' },
    { k: '6', kind: 'num' },
    { k: '-', kind: 'op', icon: 'sub', name: '減' },
  ],
  [
    { k: '1', kind: 'num' },
    { k: '2', kind: 'num' },
    { k: '3', kind: 'num' },
    { k: '+', kind: 'op', icon: 'add', name: '加' },
  ],
  [
    { k: 'C', kind: 'fn' },
    { k: '0', kind: 'num' },
    { k: '.', kind: 'num' },
    { k: '=', kind: 'eq' },
  ],
]

/** 20 顆鍵沒有跨欄跨列，直接依序排進 4 欄格線就好 */
const keys = rows.flat()

/* ── 按鍵：用 pointerdown 觸發，不要等 click ───────────────────────────
 *
 * `click` 是瀏覽器「合成」出來的：手指碰下去之後，要等手勢辨識器認定
 * 「這是一下 tap」才會送出來。快速連點時中間任何一步被打斷，事件就整個
 * 靜默消失（沒有錯誤、沒有事件，就是沒反應）：
 *   - 兩隻手指的觸碰重疊（快按時手指本來就會疊到）→ 判成多指手勢 → 兩下都不算 tap
 *   - 手指在兩下之間有位移 → 被當成滑動
 *   - 彈窗為了擋背景滑動，整棵子樹的 effective touch-action 是 none
 * 實測（.smoke/v86.mjs，用 CDP 送真實觸控事件）兩指重疊那一下：
 *   按鈕收到 2 個 pointerdown、0 個 click，畫面完全不動——就是「按了沒反應」。
 *
 * pointerdown 是「手指一碰到就送」的原始事件，不經過手勢判定，也就不會被上面任何一項吃掉。
 * 手指滑走不算取消（跟實體計算機一樣：按下去就算），所以 pointercancel 不用回退。
 *
 * 代價是 pointerdown 之後瀏覽器還是可能補一個 click，同一顆鍵會被算兩次，
 * 因此用 pressedFromPointer 這個旗標把補上的 click 吃掉（見 onClick）。
 */
const CLICK_GUARD_MS = 600

/** 這一下是不是已經由 pointerdown 送出去了（用來吃掉隨後補上的 click） */
let pressedFromPointer = false
/** 旗標的自動過期計時器：pointerdown 之後若沒有 click 跟上（正好就是上面那些失敗情境），
 *  旗標不能永遠卡著，否則下一次鍵盤 Enter 會被吃掉 */
let guardTimer = 0

function onDown(e: PointerEvent, k: string) {
  // button 0 ＝ 滑鼠左鍵／觸控接觸點；右鍵、中鍵不處理
  if (e.button !== 0) return

  // 按下樣式自己做，不靠 CSS 的 :active（見下面 .key.is-tap 的註解）
  ;(e.currentTarget as HTMLElement | null)?.classList.add('is-tap')

  pressedFromPointer = true
  window.clearTimeout(guardTimer)
  guardTimer = window.setTimeout(() => {
    pressedFromPointer = false
  }, CLICK_GUARD_MS)

  emit('press', k)
}

/** 放開（或手勢被取消／手指滑出按鍵）就把按下樣式拿掉 */
function onUp(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement | null)?.classList.remove('is-tap')
}

/**
 * 沒有指標事件來源的啟動方式（實體鍵盤 Enter／Space、讀屏、舊環境）只會送 click，
 * 這裡要接住；由 pointerdown 觸發的那一個 click 則忽略，避免同一顆鍵算兩次。
 */
function onClick(k: string) {
  if (pressedFromPointer) {
    pressedFromPointer = false
    window.clearTimeout(guardTimer)
    return
  }
  emit('press', k)
}

onBeforeUnmount(() => window.clearTimeout(guardTimer))
</script>

<template>
  <div class="keypad">
    <button
      v-for="key in keys"
      :key="key.k"
      type="button"
      class="key"
      :class="`key--${key.kind}`"
      :data-key="key.k"
      :aria-label="key.name"
      @pointerdown="onDown($event, key.k)"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onUp"
      @click="onClick(key.k)"
    >
      <svg v-if="key.icon === 'back'" class="kic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9.2 6h9.4a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H9.2L3.3 12z" />
        <path d="M13.1 10.1l3.8 3.8M16.9 10.1l-3.8 3.8" />
      </svg>
      <svg v-else-if="key.icon === 'div'" class="kic kic--op" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.4 12h9.2" />
        <circle class="kic__dot" cx="12" cy="7.7" r="1.5" />
        <circle class="kic__dot" cx="12" cy="16.3" r="1.5" />
      </svg>
      <svg v-else-if="key.icon === 'mul'" class="kic kic--op" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.9 7.9l8.2 8.2M16.1 7.9l-8.2 8.2" />
      </svg>
      <svg v-else-if="key.icon === 'sub'" class="kic kic--op" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.4 12h9.2" />
      </svg>
      <svg v-else-if="key.icon === 'add'" class="kic kic--op" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7.4v9.2M7.4 12h9.2" />
      </svg>
      <template v-else>{{ key.k }}</template>
    </button>
  </div>
</template>

<style scoped>
.keypad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  user-select: none;
}
.key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 54px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 20px;
  font-weight: 550;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  transition:
    background 0.1s,
    transform 0.06s;
}
.key:hover {
  background: var(--surface-3);
}
.key:active {
  transform: scale(0.97);
  background: var(--surface-3);
}
/**
 * 「按下去」的樣式由 JS 控制（見 script 的 onDown）。
 *
 * 不能只靠 :active：實測（.smoke/v86.mjs，CDP 送真實觸控、按住 120ms 後量測）
 * 按住期間連 `el.matches(':active')` 都是 false，按鍵要等手指放開之後才變色，
 * 快按時使用者只會看到「按了沒反應」。自己加 class 才能保證一碰就亮。
 * 選擇器權重與 .key:active 相同、排在其後，兩者外觀一致（桌面滑鼠走哪個都行）。
 */
.key.is-tap {
  transform: scale(0.97);
  background: var(--surface-3);
}
.key--op {
  color: var(--accent);
}
.key--fn {
  color: var(--text-2);
  font-size: 18px;
}
.key--eq {
  background: var(--accent-light);
  border-color: var(--accent-light);
  color: var(--accent);
  font-size: 22px;
  font-weight: 700;
}
.key--eq:hover {
  background: var(--accent-light-hover);
  border-color: var(--accent-light-hover);
}
/* 等號鍵按下去要維持深綠，不能被上面 .key:active／.key.is-tap 的灰底蓋掉 */
.key--eq:active,
.key--eq.is-tap {
  background: var(--accent-light-hover);
  border-color: var(--accent-light-hover);
}
.kic {
  display: block;
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 運算鍵的線要跟數字同一個視覺重量，比回退鍵再粗一點 */
.kic--op {
  stroke-width: 2.1;
}
/* ÷ 的兩點用實心（CSS 的 fill: none 會蓋掉 fill 屬性，所以一定要用 class） */
.kic__dot {
  fill: currentColor;
  stroke: none;
}

@media (min-width: 768px) {
  .key {
    height: 58px;
    font-size: 21px;
  }
}
@media (max-width: 360px) {
  .key {
    height: 48px;
    font-size: 18px;
  }
}
</style>
