<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Category } from '@/types'
import { iconForCategory, DEFAULT_ICON } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'
import PathLabel from './PathLabel.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: Category[]
    /** 還沒選東西時，觸發鈕與清單第一項顯示的文字 */
    placeholder?: string
    /** 清單最前面放一顆「清空／回到佔位」的選項（值為空字串） */
    allowEmpty?: boolean
    /** 那一顆佔位項要顯示的文字（預設跟 placeholder 一樣，但兩者常常需要不同） */
    emptyLabel?: string
  }>(),
  { placeholder: '選擇分類', allowEmpty: false },
)
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

/* ── 彈層狀態 ─────────────────────────────────────────── */
/** 原生 <select> 的展開清單無法渲染 SVG，改用自訂彈層才能讓每一項都帶分類圖示 */
const open = ref(false)
const active = ref(0)
const triggerEl = ref<HTMLButtonElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

/** 目前選中的分類（找不到就是未選） */
const selected = computed(() => props.options.find((c) => c.id === props.modelValue))
const selectedIcon = computed(() =>
  selected.value ? iconForCategory(selected.value) : DEFAULT_ICON,
)
/** allowEmpty 那一顆的文字（不給就沿用 placeholder） */
const emptyText = computed(() => props.emptyLabel || props.placeholder)

/**
 * 觸發鈕要顯示什麼：
 * 選到真的分類→它的名稱；選了 allowEmpty 的佔位項（空字串）→佔位項自己的文字
 * （例如「新增分類」）；還沒選→placeholder（例如「請選擇分類」）。
 */
const triggerName = computed(() => {
  if (selected.value) return selected.value.name
  if (props.allowEmpty && props.modelValue === '') return emptyText.value
  return props.placeholder
})

/** 清單項目：allowEmpty 時最前面多一顆佔位項 */
const items = computed(() =>
  props.allowEmpty
    ? [{ id: '', name: emptyText.value } as Category, ...props.options]
    : props.options,
)

/**
 * 彈層以 fixed 定位並跟隨觸發鈕：
 * 這樣才能跳脫記錄明細（.sheet__body 有 overflow）的裁切，
 * 空間不足時自動往上翻。
 */
function place() {
  const t = triggerEl.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const gap = 6
  const width = Math.max(r.width, 210)
  const below = window.innerHeight - r.bottom - gap
  const above = r.top - gap
  const up = below < 200 && above > below
  const avail = up ? above : below
  const style: Record<string, string> = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(96, Math.min(avail, 296))}px`,
  }
  if (up) style.bottom = `${window.innerHeight - r.top + gap}px`
  else style.top = `${r.bottom + gap}px`
  popStyle.value = style
}

function onDocDown(e: Event) {
  const t = e.target as Node
  if (triggerEl.value?.contains(t) || popEl.value?.contains(t)) return
  closePop()
}

function scrollActive() {
  popEl.value?.querySelector<HTMLElement>('.pop__item.is-active')?.scrollIntoView({
    block: 'nearest',
  })
}

function openPop() {
  if (!items.value.length) return
  const i = items.value.findIndex((c) => c.id === props.modelValue)
  active.value = i >= 0 ? i : 0
  open.value = true
  void nextTick(() => {
    place()
    scrollActive()
  })
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onDocDown, true)
}

function closePop() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onDocDown, true)
}

function togglePop() {
  if (open.value) closePop()
  else openPop()
}

function moveTo(delta: number) {
  if (!open.value) {
    openPop()
    return
  }
  const n = items.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(scrollActive)
}

function chooseActive() {
  const c = items.value[active.value]
  if (c) pick(c.id)
}

function pick(id: string) {
  emit('update:modelValue', id)
  closePop()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveTo(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveTo(-1)
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (open.value) chooseActive()
    else openPop()
  } else if (e.key === 'Escape') {
    if (open.value) {
      e.preventDefault()
      closePop()
    }
  } else if (e.key === 'Tab') {
    closePop()
  }
}

onBeforeUnmount(closePop)

// 選項換掉時（例如換收支類型）收起，避免停在已不存在的項目
watch(
  () => props.options,
  () => {
    closePop()
  },
)
</script>

<template>
  <div class="selwrap">
    <button
      ref="triggerEl"
      type="button"
      class="field selwrap__btn"
      :class="{ 'is-open': open }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="togglePop"
      @keydown="onKey"
    >
      <span
        class="selwrap__ic"
        :class="{ 'is-empty': !selected }"
        :style="
          selected ? { '--c': selected.color, '--bg': withAlpha(selected.color, 0.14) } : undefined
        "
        aria-hidden="true"
      >
        <CategoryIcon :name="selectedIcon" :size="14" :stroke="1.9" />
      </span>
      <PathLabel
        class="selwrap__name"
        :class="{ 'is-empty': !selected }"
        :path="triggerName"
      />
      <svg class="selwrap__caret" :class="{ 'is-open': open }" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="pop">
        <div
          v-if="open"
          ref="popEl"
          class="pop"
          :style="popStyle"
          role="listbox"
          aria-label="分類"
        >
          <button
            v-for="(c, i) in items"
            :key="c.id || '__empty__'"
            type="button"
            class="pop__item"
            :class="{ 'is-on': c.id === modelValue, 'is-active': i === active }"
            role="option"
            :aria-selected="c.id === modelValue"
            @mouseenter="active = i"
            @click="pick(c.id)"
          >
            <span
              v-if="c.id"
              class="pop__ic"
              :style="{ '--c': c.color, '--bg': withAlpha(c.color, 0.14) }"
              aria-hidden="true"
            >
              <CategoryIcon :name="iconForCategory(c)" :size="16" :stroke="1.9" />
            </span>
            <span v-else class="pop__ic pop__ic--empty" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <PathLabel class="pop__name" :path="c.name" />
            <svg v-if="c.id === modelValue" class="pop__tick" viewBox="0 0 24 24">
              <path d="M5 13.2 9.2 17.4 19 7.6" />
            </svg>
          </button>
          <p v-if="!items.length" class="pop__empty">尚無分類，請到設定頁新增</p>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.selwrap {
  display: block;
  min-width: 0;
}
.selwrap__btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 28px 0 8px;
  text-align: left;
}
.selwrap__btn.is-open {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.selwrap__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 7px;
  color: var(--c);
  background: var(--bg);
}
/* 尚未選到分類：中性佔位圖示，避免欄位看起來空空的 */
.selwrap__ic.is-empty {
  color: var(--text-3);
  background: var(--surface-3);
}
.selwrap__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selwrap__name.is-empty {
  color: var(--text-3);
}
.selwrap__caret {
  position: absolute;
  top: 50%;
  right: 9px;
  width: 15px;
  height: 15px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--text-3);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.16s;
}
.selwrap__caret.is-open {
  transform: translateY(-50%) rotate(180deg);
  stroke: var(--accent);
}

/* ── 下拉彈層（Teleport 到 body，fixed 定位）── */
.pop {
  position: fixed;
  z-index: 95;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-3);
}
.pop__item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 38px;
  padding: 0 9px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 550;
  color: var(--text-2);
  text-align: left;
}
.pop__item.is-active {
  background: var(--surface-3);
}
.pop__item.is-on {
  background: var(--pick-soft);
  color: var(--pick);
  font-weight: 650;
}
.pop__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  color: var(--c);
  background: var(--bg);
}
.pop__ic--empty {
  color: var(--text-3);
  background: var(--surface-3);
}
.pop__ic--empty svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.pop__item.is-on .pop__ic {
  box-shadow: inset 0 0 0 1px var(--pick-line);
}
.pop__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop__tick {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--pick);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pop__empty {
  margin: 0;
  padding: 10px 9px;
  font-size: 13px;
  color: var(--text-3);
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
