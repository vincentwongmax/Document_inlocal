<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

/**
 * 0.1.62：「更多」多選下拉（記錄頁檢視列的最右邊那一顆）。
 *
 * 使用者原話：「依實時的按鈕改成一個下拉選單…名字改成更多，下拉選單: (圖片，旅行，待辦事項)，
 *   用戶可以單選或多選，只顯示在目前條件下有這些標籤的記錄…下拉的選單格式可參考記帳頁
 *   預設值頁面中的日期時間的下拉選單」。
 *
 * 所以格局照 `MiniSelect`（自訂彈層：fixed 定位、Teleport 到 body、空間不足往上翻、
 * 點外面／Esc 關閉），只有兩點不同：
 *  ① **多選**：點選項是「切換」而且**不關閉**彈層（要能一次勾好幾個）；
 *     每一項用方框（空／打勾）表示勾選狀態，而不是單選那種「選中就跳走」的感覺。
 *  ② 觸發鈕上的字由呼叫端給（未選＝「更多」、勾了＝「圖+旅」這種首字組合），
 *     這個元件不認識任何業務概念。
 */
const props = withDefaults(
  defineProps<{
    /** 已勾選的 `v`（順序一律照 `options`，不是點擊順序） */
    modelValue: string[]
    options: { v: string; label: string }[]
    /**
     * 0.1.69：下半段的「開關」選項（不是篩選條件）。
     *
     * 使用者要求在這個下拉裡加一個「顯示實際時間」——它**不會過濾記錄**，
     * 只是改時間標籤的顯示方式，所以不能混在上面那組標籤篩選裡
     * （混進去的話按鈕標題會寫成「只顯示符合以下條件」，語意就不對了）。
     * 這裡用同樣的方框外觀，但以分隔線隔開、標題換成「顯示方式」。
     */
    extras?: { v: string; label: string }[]
    /** 已打開的開關（`extras` 的 v） */
    extraOn?: string[]
    /** 觸發鈕上的字 */
    label: string
    /** 有勾東西嗎（觸發鈕要不要亮） */
    active?: boolean
    ariaLabel?: string
    title?: string
  }>(),
  { extras: () => [], extraOn: () => [], active: false, ariaLabel: '', title: '' },
)
const emit = defineEmits<{
  'update:modelValue': [v: string[]]
  'update:extraOn': [v: string[]]
}>()

// 多根元件（觸發鈕＋Teleport）→ class 不會自動 fallthrough，手動綁到觸發鈕上
defineOptions({ inheritAttrs: false })

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

/**
 * 定位：對齊觸發鈕的**右緣**（這一顆在檢視列最右邊，往左長才不會跑出畫面）。
 * 下面空間不夠就往上翻——跟 MiniSelect 同一套數學。
 */
function place() {
  const t = triggerEl.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const gap = 6
  const width = Math.max(r.width, 168)
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
  const below = window.innerHeight - r.bottom - gap
  const above = r.top - gap
  const up = below < 200 && above > below
  const avail = up ? above : below
  const style: Record<string, string> = {
    left: `${left}px`,
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

/** 勾選／取消：輸出順序照 options（「圖+旅」不會因為點擊順序變成「旅+圖」） */
function toggleItem(v: string) {
  const has = props.modelValue.includes(v)
  const next = has ? props.modelValue.filter((x) => x !== v) : [...props.modelValue, v]
  emit(
    'update:modelValue',
    props.options
      .map((o) => o.v)
      .filter((x) => next.includes(x)),
  )
}

function toggleExtra(v: string) {
  const has = props.extraOn.includes(v)
  emit(
    'update:extraOn',
    has ? props.extraOn.filter((x) => x !== v) : [...props.extraOn, v],
  )
}

onBeforeUnmount(close)
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="mf__trigger"
    :class="[{ 'is-on': active }, $attrs.class]"
    :aria-label="ariaLabel"
    :title="title"
    aria-haspopup="true"
    :aria-expanded="open"
    @click="toggle"
  >
    <!-- 漏斗（篩選）：這一顆的功能就是「再疊一層標籤篩選」 -->
    <svg class="mf__ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.6 5.4h16.8L13.8 13v5.4l-3.6 2.2V13L3.6 5.4Z" />
    </svg>
    <span class="mf__label">{{ label }}</span>
    <svg class="mf__chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="mfspop">
      <div
        v-if="open"
        ref="popEl"
        class="mf__pop"
        :style="popStyle"
        role="group"
        :aria-label="ariaLabel"
      >
        <button
          v-for="o in options"
          :key="o.v"
          type="button"
          class="mf__item"
          :class="{ 'is-on': modelValue.includes(o.v) }"
          role="checkbox"
          :aria-checked="modelValue.includes(o.v)"
          :data-v="o.v"
          @click="toggleItem(o.v)"
        >
          <!-- 方框（空／打勾）：一眼看得出**可以複選** -->
          <span class="mf__box" aria-hidden="true">
            <svg v-if="modelValue.includes(o.v)" viewBox="0 0 24 24">
              <path d="M5 13.2 9.2 17.4 19 7.6" />
            </svg>
          </span>
          <span class="mf__name">{{ o.label }}</span>
        </button>

        <!-- 0.1.69：分隔線＋「顯示方式」區（開關，不篩選） -->
        <template v-if="extras.length">
          <div class="mf__sep" role="separator"></div>
          <p class="mf__groupt tiny muted">顯示方式</p>
          <button
            v-for="o in extras"
            :key="o.v"
            type="button"
            class="mf__item"
            :class="{ 'is-on': extraOn.includes(o.v) }"
            role="checkbox"
            :aria-checked="extraOn.includes(o.v)"
            :data-x="o.v"
            @click="toggleExtra(o.v)"
          >
            <span class="mf__box" aria-hidden="true">
              <svg v-if="extraOn.includes(o.v)" viewBox="0 0 24 24">
                <path d="M5 13.2 9.2 17.4 19 7.6" />
              </svg>
            </span>
            <span class="mf__name">{{ o.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * 外觀對齊記錄頁檢視列的 `.bycat`（34px 高、膠囊圓角、13px 字），
 * 但那邊是 RecordsView 的 scoped，這裡自己寫一份（不沿用 class 名，避免耦合）。
 * 黃色外框沿用原本 `.bycat--basis` 的識別色——這一格本來就是黃框那一顆。
 */
.mf__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--amber);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  flex: none;
  /* 跟原本 `.bycat--basis` 一樣黏在那一列的最右邊 */
  margin-left: auto;
  transition:
    background 0.12s,
    color 0.12s;
}
.mf__trigger.is-on {
  background: var(--amber-soft);
  color: var(--warn);
}
.mf__ic {
  flex: none;
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mf__label {
  min-width: 0;
}
.mf__chev {
  flex: none;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── 彈層（格局照 MiniSelect 的 .ms__pop）───────────────── */
.mf__pop {
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
.mf__item {
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
.mf__item:hover {
  background: var(--surface-3);
}
.mf__item.is-on {
  background: var(--amber-soft);
  color: var(--warn);
  font-weight: 700;
}
.mf__box {
  display: grid;
  place-items: center;
  flex: none;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  color: var(--warn);
}
.mf__item.is-on .mf__box {
  border-color: var(--amber);
}
.mf__box svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mf__name {
  flex: 1;
  min-width: 0;
}
/* 0.1.69：篩選區與「顯示方式」區之間的分隔 */
.mf__sep {
  height: 1px;
  margin: 6px 4px 4px;
  background: var(--line);
}
.mf__groupt {
  margin: 0 0 2px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.mfspop-enter-active,
.mfspop-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.mfspop-enter-from,
.mfspop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
