<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

/**
 * 0.1.44：記錄頁搜索框裡的「分類選擇器」。
 *
 * 按下去列出現有分類，點一下就把分類名稱填進搜索框（取代現有文字），
 * 搜索框的關鍵字比對本來就會比對分類名稱 → 等於「只看這個分類的記錄」。
 *
 * 作法完全照 `QuickNotePicker`（26×26 內嵌小鈕＋Teleport 到 body 的 fixed 彈層＋
 * place() 對齊右緣/上翻＋document capture keydown），只把清單換成分類。
 * 只負責顯示與轉發，搜索文字由呼叫端持有（v-model）。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const settings = useSettingsStore()

/** 只列沒被封存的分類（支出＋收入都列；名稱就是搜索用的關鍵字） */
const cats = computed(() => settings.categories.filter((c) => !c.archived))

/* ── 彈層狀態（同 QuickNotePicker）────────────────────────────── */
const open = ref(false)
const active = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

/** 對齊觸發鈕的右緣（空間不夠時自動往內縮、往上翻） */
function place() {
  const t = rootEl.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const gap = 6
  const width = Math.max(r.width, 210)
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
  const below = window.innerHeight - r.bottom - gap
  const above = r.top - gap
  const up = below < 180 && above > below
  const avail = up ? above : below
  const style: Record<string, string> = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(96, Math.min(avail, 296))}px`,
  }
  if (up) style.bottom = `${window.innerHeight - r.top + gap}px`
  else style.top = `${r.bottom + gap}px`
  popStyle.value = style
}

function onDocDown(e: Event) {
  const t = e.target as Node
  if (rootEl.value?.contains(t) || popEl.value?.contains(t)) return
  closePop()
}

function scrollActive() {
  popEl.value?.querySelector<HTMLElement>('.pop__item.is-active')?.scrollIntoView({
    block: 'nearest',
  })
}

function openPop() {
  active.value = Math.max(
    0,
    cats.value.findIndex((c) => c.name === props.modelValue),
  )
  open.value = true
  void nextTick(() => {
    place()
    scrollActive()
  })
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onDocDown, true)
  // 鍵盤掛 document capture（同 QuickNotePicker：程式 click() 拿不到焦點）
  document.addEventListener('keydown', onDocKey, true)
}

function closePop() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey, true)
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
  const n = cats.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(scrollActive)
}

/** 點一項＝把搜索框換成分類名稱（**取代**，不疊加） */
function pick(name: string) {
  emit('update:modelValue', name)
  closePop()
}

function onDocKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName
  const inField = tag === 'INPUT' || tag === 'TEXTAREA'
  const eaten = () => {
    e.preventDefault()
    e.stopPropagation()
  }

  if (e.key === 'Escape') {
    eaten()
    closePop()
    return
  }
  if (inField) return

  if (e.key === 'ArrowDown') {
    eaten()
    moveTo(1)
  } else if (e.key === 'ArrowUp') {
    eaten()
    moveTo(-1)
  } else if (e.key === 'Enter' || e.key === ' ') {
    eaten()
    const c = cats.value[active.value]
    if (c) pick(c.name)
  } else if (e.key === 'Tab') {
    closePop()
  }
}

function onTriggerKey(e: KeyboardEvent) {
  if (open.value) return
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault()
    openPop()
  }
}

onBeforeUnmount(closePop)
</script>

<template>
  <span ref="rootEl" class="csp">
    <button
      type="button"
      class="csp__btn"
      :class="{ 'is-open': open }"
      title="選分類"
      aria-label="選分類"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="togglePop"
      @keydown="onTriggerKey"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.6" y="3.6" width="7" height="7" rx="1.8" />
        <rect x="13.4" y="3.6" width="7" height="7" rx="1.8" />
        <rect x="3.6" y="13.4" width="7" height="7" rx="1.8" />
        <rect x="13.4" y="13.4" width="7" height="7" rx="1.8" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="csppop">
        <div v-if="open" ref="popEl" class="pop" :style="popStyle" role="listbox" aria-label="選分類">
          <button
            v-for="(c, i) in cats"
            :key="c.id"
            type="button"
            class="pop__item"
            :class="{ 'is-on': c.name === modelValue, 'is-active': i === active }"
            role="option"
            :aria-selected="c.name === modelValue"
            :data-cat="c.name"
            @mouseenter="active = i"
            @click="pick(c.name)"
          >
            <span
              class="pop__dot"
              :style="{ background: c.color, borderColor: c.color }"
              aria-hidden="true"
            ></span>
            <span class="pop__name">{{ c.name }}</span>
            <span class="pop__type">{{ c.type === 'income' ? '收' : '支' }}</span>
            <svg v-if="c.name === modelValue" class="pop__tick" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 13.2 9.2 17.4 19 7.6" />
            </svg>
          </button>

          <p v-if="!cats.length" class="pop__empty">還沒有分類，到設定頁新增</p>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
/* 26×26 內嵌小鈕規範，同 QuickNotePicker／ClearableInput 清空鈕 */
.csp {
  display: inline-flex;
}
.csp__btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  transition:
    background 0.12s,
    color 0.12s,
    transform 0.06s;
}
.csp__btn:hover {
  background: var(--accent);
  color: #fff;
}
.csp__btn:active {
  transform: scale(0.94);
}
.csp__btn.is-open {
  background: var(--accent);
  color: #fff;
}
.csp__btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── 彈層（Teleport 到 body，fixed 定位）── */
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
.pop__dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
}
.pop__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop__type {
  flex: none;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-3);
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
.csppop-enter-active,
.csppop-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.csppop-enter-from,
.csppop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
