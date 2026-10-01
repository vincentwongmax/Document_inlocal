<script setup lang="ts">
defineEmits<{ press: [key: string] }>()

const rows = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['0', '.', '⌫', '+'],
]

function kindOf(k: string): string {
  if (k === '⌫') return 'fn'
  if (['÷', '×', '-', '+'].includes(k)) return 'op'
  return 'num'
}
</script>

<template>
  <div class="keypad">
    <div v-for="(row, i) in rows" :key="i" class="keypad__row">
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
    <div class="keypad__row">
      <button class="key key--fn" type="button" @click="$emit('press', 'C')">C</button>
      <button class="key key--eq" type="button" @click="$emit('press', '=')">=</button>
    </div>
  </div>
</template>

<style scoped>
.keypad {
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
}
.keypad__row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
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
.key--eq {
  grid-column: span 3;
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
