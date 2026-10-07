<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'

/**
 * 備註欄右側的「快速備註」鈕：按下去列出設定頁的一組常用文字，點一下就填進備註。
 *
 * 只負責顯示與轉發，備註內容由呼叫端持有（v-model），所以這個元件本身不碰記錄。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const settings = useSettingsStore()
const router = useRouter()

const notes = computed(() => settings.quickNotes)

/* ── 彈層狀態（作法同 CategorySelect：fixed 定位 + Teleport）─────────
   ⚠ 一定要 Teleport 到 body：記錄明細的 .sheet__body 有 overflow，
   留在原地會被裁掉。 */
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
  active.value = Math.max(0, notes.value.indexOf(props.modelValue))
  open.value = true
  void nextTick(() => {
    place()
    scrollActive()
  })
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onDocDown, true)
  // 鍵盤一律掛在 document 上（capture）：程式呼叫 click()、iOS 用手指點按鈕，
  // 都不會讓按鈕拿到焦點，靠鈕自己的 @keydown 會收不到 Esc
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
  const n = notes.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(scrollActive)
}

/**
 * 點一項＝把備註換成它（**取代**，不疊加）。
 * 已經一樣的再點一次還是一樣的結果，不做「再點一下取消」——那種反選很容易誤清。
 */
function pick(text: string) {
  emit('update:modelValue', text)
  closePop()
}

/** 沒有快速備註（或想改）時的出口：直接跳設定頁那一段 */
function goSettings() {
  closePop()
  void router.push({ name: 'settings', query: { sec: 'quicknotes' } })
}

/**
 * 彈層開著時的鍵盤操作。
 *
 * ⚠ 兩個關鍵：
 * 1. 掛在 document 的 capture 階段，並在處理到時 **stopPropagation**——
 *    記帳頁在全域（window）監聽 Escape 會把金額清掉，不擋掉的話「按 Esc 關清單」
 *    會順手把剛輸入的金額清空。
 * 2. 焦點在文字框裡時只認 Esc，其餘按鍵留給輸入框（不然打空白鍵會被當成「選取」）。
 */
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
    const t = notes.value[active.value]
    if (t) pick(t)
  } else if (e.key === 'Tab') {
    closePop()
  }
}

/** 焦點在按鈕上、而且彈層還沒開時，用 Enter／空白／下鍵打開它 */
function onTriggerKey(e: KeyboardEvent) {
  if (open.value) return // 開著時交給 document 上的監聽器，否則會處理兩次
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault()
    openPop()
  }
}

onBeforeUnmount(closePop)
</script>

<template>
  <span ref="rootEl" class="qnp">
    <button
      type="button"
      class="qnp__btn"
      :class="{ 'is-open': open }"
      title="快速備註"
      aria-label="快速備註"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="togglePop"
      @keydown="onTriggerKey"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 2.8 5.6 12.4h5.2l-.6 8.8 8.2-9.6h-5.2z" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="qnpop">
        <div v-if="open" ref="popEl" class="pop" :style="popStyle" role="listbox" aria-label="快速備註">
          <button
            v-for="(t, i) in notes"
            :key="t"
            type="button"
            class="pop__item"
            :class="{ 'is-on': t === modelValue, 'is-active': i === active }"
            role="option"
            :aria-selected="t === modelValue"
            :data-note="t"
            @mouseenter="active = i"
            @click="pick(t)"
          >
            <span class="pop__name">{{ t }}</span>
            <svg v-if="t === modelValue" class="pop__tick" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 13.2 9.2 17.4 19 7.6" />
            </svg>
          </button>

          <p v-if="!notes.length" class="pop__empty">還沒有快速備註，到設定頁新增</p>

          <button type="button" class="pop__more" @click="goSettings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>管理快速備註</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
/* 這一顆要跟 ClearableInput 的清空鈕長得一模一樣（同一個 26×26 內嵌小按鈕規範），
   差別只有圖示與 hover 反白後的底色語意 */
.qnp {
  display: inline-flex;
}
.qnp__btn {
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
.qnp__btn:hover {
  background: var(--accent);
  color: #fff;
}
.qnp__btn:active {
  transform: scale(0.94);
}
/* 彈層開著時維持反白，才看得出是按了哪一顆 */
.qnp__btn.is-open {
  background: var(--accent);
  color: #fff;
}
.qnp__btn svg {
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
.pop__more {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 36px;
  margin-top: 6px;
  padding: 0 9px;
  border-top: 1px solid var(--line);
  border-radius: 0 0 9px 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-align: left;
}
.pop__more:hover {
  background: var(--accent-soft);
}
.pop__more svg {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.qnpop-enter-active,
.qnpop-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.qnpop-enter-from,
.qnpop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
