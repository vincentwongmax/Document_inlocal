<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

/**
 * 0.1.49：文字版迷你下拉（格局照 `CategorySelect` 的自訂彈屬——fixed 定位、
 * 空間不足自動上翻、Esc／點外關閉），給「預設值」子頁面的
 * 單位（時/分/日/月/年/現在/無）與方向（現在/前/後/無）用。
 * 原生 <select> 在 iPhone 上展開樣式不可控，這顆才能做到「要美觀」。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    options: { v: string; label: string }[]
    ariaLabel?: string
    disabled?: boolean
  }>(),
  { ariaLabel: '', disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

// 多根元件（button＋Teleport）→ class 不會自動 fallthrough，手動綁到觸發鈕上
defineOptions({ inheritAttrs: false })

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

const current = computed(() => props.options.find((o) => o.v === props.modelValue))

/** 對齊觸發鈕左緣（空間不夠內縮、不夠高往上翻）——跟 CategorySelect 同一套數學 */
function place() {
  const t = triggerEl.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const gap = 6
  const width = Math.max(r.width, 132)
  const below = window.innerHeight - r.bottom - gap
  const above = r.top - gap
  const up = below < 200 && above > below
  const avail = up ? above : below
  const style: Record<string, string> = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(96, Math.min(avail, 264))}px`,
  }
  if (up) style.bottom = `${window.innerHeight - r.top + gap}px`
  else style.top = `${r.bottom + gap}px`
  popStyle.value = style
}

function onDocDown(e: Event) {
  const t = e.target as Node
  if (triggerEl.value?.contains(t) || popEl.value?.contains(t)) return
  close()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

function toggle() {
  if (props.disabled) return
  if (open.value) close()
  else {
    open.value = true
    void nextTick(() => place())
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', onDocDown, true)
    document.addEventListener('keydown', onDocKey, true)
  }
}
function close() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey, true)
}
function pick(v: string) {
  emit('update:modelValue', v)
  close()
}

onBeforeUnmount(close)
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="ms__trigger"
    :class="$attrs.class"
    :disabled="disabled"
    :aria-label="ariaLabel"
    aria-haspopup="listbox"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="ms__label">{{ current?.label ?? '—' }}</span>
    <svg class="ms__chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="mspop">
      <div v-if="open" ref="popEl" class="ms__pop" :style="popStyle" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="o in options"
          :key="o.v"
          type="button"
          class="ms__item"
          :class="{ 'is-on': o.v === modelValue }"
          role="option"
          :aria-selected="o.v === modelValue"
          :data-v="o.v"
          @click="pick(o.v)"
        >
          <span class="ms__name">{{ o.label }}</span>
          <svg v-if="o.v === modelValue" class="ms__tick" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13.2 9.2 17.4 19 7.6" />
          </svg>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ms__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  height: 38px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.ms__trigger:disabled {
  opacity: 0.45;
}
.ms__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.ms__chev {
  flex: none;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ms__pop {
  position: fixed;
  z-index: 120;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-3);
}
.ms__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  text-align: left;
}
.ms__item.is-active {
  background: var(--surface-3);
}
.ms__item.is-on {
  background: var(--pick-soft);
  color: var(--pick);
  font-weight: 700;
}
.ms__name {
  flex: 1;
  min-width: 0;
}
.ms__tick {
  flex: none;
  width: 15px;
  height: 15px;
  fill: none;
  stroke: var(--pick);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mspop-enter-active,
.mspop-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.mspop-enter-from,
.mspop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
