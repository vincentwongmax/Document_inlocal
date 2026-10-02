<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{ press: [key: string] }>()

/** 運算鍵（＋ − × ÷ 與括號 C）由左下角的「計算機」圖示切換，預設收起 */
const adv = ref(false)

type Kind = 'num' | 'op' | 'fn' | 'eq' | 'tool'

interface PadKey {
  /** 按下時送出的鍵值（tool 鍵不送出） */
  k: string
  kind: Kind
  /** 顯示文字，預設同 k */
  label?: string
  /** 圖示鍵 */
  icon?: 'back' | 'calc'
  /** 橫跨欄數（預設 1） */
  w?: number
  /** 縱跨列數（預設 1） */
  h?: number
}

/** 運算模式開啟時，數字區「上方」多出的兩列 */
const advRows: PadKey[][] = [
  // 最上排：括號與清除
  [{ k: '(', kind: 'fn' }, { k: ')', kind: 'fn' }, { k: 'C', kind: 'fn', label: 'C', w: 2 }],
  // 緊鄰數字：四則運算，方便連續輸入
  [
    { k: '÷', kind: 'op' },
    { k: '×', kind: 'op' },
    { k: '-', kind: 'op', label: '−' },
    { k: '+', kind: 'op' },
  ],
]

/**
 * 數字區固定 4 欄 × 4 列：
 *   7  8  9  ⌫
 *   4  5  6  =
 *   1  2  3  =      ← = 佔第 4 欄、跨第 2~4 列（一整顆長按鈕）
 *   🧮 0  .  =
 */
const baseRows: PadKey[][] = [
  [
    { k: '7', kind: 'num' },
    { k: '8', kind: 'num' },
    { k: '9', kind: 'num' },
    { k: '⌫', kind: 'fn', icon: 'back' },
  ],
  [
    { k: '4', kind: 'num' },
    { k: '5', kind: 'num' },
    { k: '6', kind: 'num' },
    { k: '=', kind: 'eq', h: 3 },
  ],
  [{ k: '1', kind: 'num' }, { k: '2', kind: 'num' }, { k: '3', kind: 'num' }],
  [
    { k: 'calc', kind: 'tool', icon: 'calc' },
    { k: '0', kind: 'num' },
    { k: '.', kind: 'num' },
  ],
]

interface PlacedKey extends PadKey {
  /** 第幾欄（1 起算） */
  c: number
  /** 第幾列（1 起算） */
  r: number
}

/**
 * 攤平成帶座標的清單交給 CSS Grid 定位。
 * 這樣「運算模式多兩列」時只要把起始列往後推，所有鍵都會自動跟著位移，不會錯位。
 */
const placed = computed<PlacedKey[]>(() => {
  const rows = adv.value ? [...advRows, ...baseRows] : baseRows
  const out: PlacedKey[] = []
  rows.forEach((row, i) => {
    let c = 1
    for (const key of row) {
      out.push({ ...key, c, r: i + 1 })
      c += key.w ?? 1
    }
  })
  return out
})

function onKey(key: PlacedKey) {
  if (key.kind === 'tool') {
    adv.value = !adv.value
    return
  }
  emit('press', key.k)
}
</script>

<template>
  <div class="keypad">
    <button
      v-for="key in placed"
      :key="`${key.r}-${key.c}-${key.k}`"
      type="button"
      class="key"
      :class="[
        `key--${key.kind}`,
        { 'key--tall': (key.h ?? 1) > 1, 'key--wide': (key.w ?? 1) > 1, 'is-on': key.kind === 'tool' && adv },
      ]"
      :style="{ gridColumn: `${key.c} / span ${key.w ?? 1}`, gridRow: `${key.r} / span ${key.h ?? 1}` }"
      :title="key.kind === 'tool' ? '切換運算鍵：＋ − × ÷ 與括號' : undefined"
      :aria-label="key.kind === 'tool' ? '切換運算鍵' : key.icon === 'back' ? '回退' : undefined"
      :aria-pressed="key.kind === 'tool' ? adv : undefined"
      @click="onKey(key)"
    >
      <svg v-if="key.icon === 'back'" class="kic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9.2 6h9.4a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H9.2L3.3 12z" />
        <path d="M13.1 10.1l3.8 3.8M16.9 10.1l-3.8 3.8" />
      </svg>
      <svg v-else-if="key.icon === 'calc'" class="kic kic--calc" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.7" y="2.7" width="14.6" height="18.6" rx="2.8" />
        <path d="M8.2 7h7.6" />
        <path d="M8.6 11.4h.01M12 11.4h.01M15.4 11.4h.01" />
        <path d="M8.6 14.6h.01M12 14.6h.01M15.4 14.6h.01" />
        <path d="M8.6 17.8h3.6" />
      </svg>
      <template v-else>{{ key.label ?? key.k }}</template>
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
  font-size: 22px;
}
.key--fn {
  color: var(--text-2);
  font-size: 17px;
}
.key--eq {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-size: 22px;
}
.key--eq:hover {
  background: var(--accent-hover);
}
.key--tool {
  color: var(--text-2);
}
.key--tool.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
/* 跨列（= 長按鈕）由 Grid 撐滿，不能寫死高度 */
.key.key--tall {
  height: auto;
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
.kic--calc {
  stroke-width: 1.8;
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
