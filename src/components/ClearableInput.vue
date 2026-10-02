<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    maxlength?: number
  }>(),
  { placeholder: '', maxlength: undefined },
)
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

/** 沒有內容時「清空」鈕變灰不可按，避免看起來像壞掉 */
const hasText = computed(() => props.modelValue.length > 0)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function clear() {
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="cf">
    <input
      class="field cf__in"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      @input="onInput"
    />
    <button
      class="cf__x"
      type="button"
      :disabled="!hasText"
      :title="hasText ? '清空' : '沒有內容可清空'"
      aria-label="清空"
      @click="clear"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.cf {
  position: relative;
  min-width: 0;
}
/* 右側留白給清空鈕，文字不會壓上去 */
.cf__in {
  min-width: 0;
  padding-right: 40px;
}
.cf__x {
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
.cf__x:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}
.cf__x:active:not(:disabled) {
  transform: translateY(-50%) scale(0.94);
}
.cf__x:disabled {
  background: var(--surface-3);
  color: var(--text-3);
  cursor: default;
}
.cf__x svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
