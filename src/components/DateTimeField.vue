<script setup lang="ts">
import { nowLocalInput } from '@/lib/date'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

/** 一鍵帶入「當前」的日期時間 */
function setNow() {
  emit('update:modelValue', nowLocalInput())
}
</script>

<template>
  <div class="dt">
    <input class="field dt__in" type="datetime-local" :value="modelValue" @input="onInput" />
    <button class="dt__now" type="button" title="設為現在" aria-label="設為現在的日期時間" @click="setNow">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7.3v5.1l3.2 1.9" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.dt {
  position: relative;
  min-width: 0;
}
/* 右側留白同時讓開「現在」鈕與 Chromium 原生的日曆選擇器 */
.dt__in {
  min-width: 0;
  padding-right: 40px;
}
.dt__now {
  position: absolute;
  top: 50%;
  right: 5px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  transform: translateY(-50%);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  transition:
    background 0.12s,
    color 0.12s,
    transform 0.06s;
}
.dt__now:hover {
  background: var(--accent);
  color: #fff;
}
.dt__now:active {
  transform: translateY(-50%) scale(0.94);
}
.dt__now svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
