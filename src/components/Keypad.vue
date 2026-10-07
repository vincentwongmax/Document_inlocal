<script setup lang="ts">
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
      @click="emit('press', key.k)"
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
