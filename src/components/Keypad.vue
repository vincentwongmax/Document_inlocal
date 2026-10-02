<script setup lang="ts">
import { ref } from 'vue'

defineEmits<{ press: [key: string] }>()

/** 進階運算鍵（＋−×÷ 括號 C）預設收起，拉開才顯示 */
const adv = ref(false)

const fullRows = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['0', '.', '⌫', '+'],
]

const basicRows = [
  ['7', '8', '9', '⌫'],
  ['4', '5', '6', '.'],
  ['1', '2', '3', '0'],
]

function kindOf(k: string): string {
  if (k === '⌫' || k === '(' || k === ')') return 'fn'
  if (['÷', '×', '-', '+'].includes(k)) return 'op'
  return 'num'
}
</script>

<template>
  <div class="keypad">
    <div class="keypad__hd">
      <button class="keypad__toggle" type="button" @click="adv = !adv">
        <svg class="caret" :class="{ 'is-up': adv }" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
        {{ adv ? '收起運算' : '＋ − × ÷ 括號' }}
      </button>
    </div>

    <!-- 展開：完整鍵盤 -->
    <template v-if="adv">
      <div v-for="(row, i) in fullRows" :key="'f' + i" class="keypad__row">
        <button
          v-for="k in row"
          :key="k"
          class="key"
          :class="`key--${kindOf(k)}`"
          type="button"
          @click="$emit('press', k)"
        >
          {{ k }}
        </button>
      </div>
      <div class="keypad__row keypad__row--last">
        <button class="key key--fn" type="button" @click="$emit('press', '(')">(</button>
        <button class="key key--fn" type="button" @click="$emit('press', ')')">)</button>
        <button class="key key--fn" type="button" @click="$emit('press', 'C')">C</button>
        <button class="key key--eq" type="button" @click="$emit('press', '=')">=</button>
      </div>
    </template>

    <!-- 收起：純數字 -->
    <template v-else>
      <div v-for="(row, i) in basicRows" :key="'b' + i" class="keypad__row">
        <button
          v-for="k in row"
          :key="k"
          class="key"
          :class="`key--${kindOf(k)}`"
          type="button"
          @click="$emit('press', k)"
        >
          {{ k }}
        </button>
      </div>
      <div class="keypad__row keypad__row--wide">
        <button class="key key--eq" type="button" @click="$emit('press', '=')">=</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.keypad {
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
}
.keypad__hd {
  display: flex;
  justify-content: flex-end;
}
.keypad__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px dashed var(--line-strong);
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  transition:
    color 0.12s,
    border-color 0.12s;
}
.keypad__toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.caret {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s;
}
.caret.is-up {
  transform: rotate(180deg);
}
.keypad__row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.keypad__row--wide {
  grid-template-columns: 1fr;
}
.key {
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
.keypad__row--last .key--eq,
.keypad__row--wide .key--eq {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-size: 22px;
}
.key--eq:hover {
  background: var(--accent-hover);
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
