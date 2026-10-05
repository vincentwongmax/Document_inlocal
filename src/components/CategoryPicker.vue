<script setup lang="ts">
import type { Category, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { iconForCategory, DEFAULT_ICON } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    type: TxType
    modelValue: string
    /** 只顯示常用的前 N 個（0 = 全部） */
    limit?: number
    /** 依使用頻率排序（記帳更快） */
    usageOrder?: boolean
    /** 主頁模式：只顯示常用分類，其餘收進「更多」 */
    collapsed?: boolean
    /** 顯示方式：chips 標籤（預設）／ select 下拉清單 */
    variant?: 'chips' | 'select'
  }>(),
  { limit: 0, usageOrder: true, collapsed: false, variant: 'chips' },
)
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const settings = useSettingsStore()
const records = useRecordsStore()
const expanded = ref(false)

/* ── 自訂下拉的狀態 ─────────────────────────────────────── */
/** 原生 <select> 的展開清單無法渲染 SVG，改用自訂彈層才能讓每一項都帶分類圖示 */
const open = ref(false)
const active = ref(0)
const triggerEl = ref<HTMLButtonElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

const usage = computed(() => {
  const m = new Map<string, number>()
  for (const r of records.records) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1)
  return m
})

/** 完整清單（依使用頻率或原始順序） */
const all = computed<Category[]>(() => {
  const list = settings.categoriesByType(props.type)
  return props.usageOrder
    ? [...list].sort((a, b) => (usage.value.get(b.id) ?? 0) - (usage.value.get(a.id) ?? 0))
    : list
})

/** 使用者勾選的常用分類（限目前收支類型），照勾選順序 */
const favorites = computed<Category[]>(() =>
  settings.favoriteCategories
    .map((id) => all.value.find((c) => c.id === id))
    .filter((c): c is Category => !!c),
)

/** 實際顯示的清單 */
const list = computed<Category[]>(() => {
  let out = all.value
  if (props.limit > 0) out = out.slice(0, props.limit)

  if (!props.collapsed || expanded.value) return out

  // 有勾選就只顯示勾選的；沒勾選則全部顯示（不限制數量）
  const fav = favorites.value.length ? favorites.value : out

  // 目前選中的分類一定要看得到，不然會出現「看不到自己選了什麼」
  if (props.modelValue && !fav.some((c) => c.id === props.modelValue)) {
    const sel = out.find((c) => c.id === props.modelValue)
    if (sel) return [sel, ...fav]
  }
  return fav
})

/**
 * 能否展開／收起：只有在「主頁模式且確實有勾選常用分類」時才有東西可多、可收。
 * 沒勾選常用分類時一律全部顯示，此時兩顆鈕都不該出現。
 */
const expandable = computed(
  () =>
    props.collapsed && favorites.value.length > 0 && all.value.length > favorites.value.length,
)

const hiddenCount = computed(() =>
  props.collapsed && !expanded.value
    ? Math.max(0, all.value.length - favorites.value.length)
    : 0,
)

function pick(id: string) {
  emit('update:modelValue', id)
  // 從展開的全部清單選了非常用分類後自動收起，維持介面精簡
  if (expanded.value) expanded.value = false
  closePop()
}

/** 下拉模式：目前選中的分類 */
const selected = computed<Category | undefined>(() =>
  all.value.find((c) => c.id === props.modelValue),
)

/** 下拉欄位一律顯示圖示；尚未選到分類時用中性佔位圖示 */
const selectedIcon = computed(() =>
  selected.value ? iconForCategory(selected.value) : DEFAULT_ICON,
)

/* ── 自訂下拉：定位 / 開關 / 鍵盤操作 ───────────────────── */

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
  if (!list.value.length) return
  const i = list.value.findIndex((c) => c.id === props.modelValue)
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
  const n = list.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(scrollActive)
}

function chooseActive() {
  const c = list.value[active.value]
  if (c) pick(c.id)
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

// 換收支類型時收起，避免分類暴增
watch(
  () => props.type,
  () => {
    expanded.value = false
    closePop()
  },
)
</script>

<template>
  <div class="picker">
    <!-- 下拉清單模式（自訂彈層，展開後每項都帶分類圖示） -->
    <template v-if="variant === 'select'">
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
          <span class="selwrap__name" :class="{ 'is-empty': !selected }">
            {{ selected?.name ?? '選擇分類' }}
          </span>
          <svg class="selwrap__caret" :class="{ 'is-open': open }" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

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
              v-for="(c, i) in list"
              :key="c.id"
              type="button"
              class="pop__item"
              :class="{ 'is-on': c.id === modelValue, 'is-active': i === active }"
              role="option"
              :aria-selected="c.id === modelValue"
              @mouseenter="active = i"
              @click="pick(c.id)"
            >
              <span
                class="pop__ic"
                :style="{ '--c': c.color, '--bg': withAlpha(c.color, 0.14) }"
                aria-hidden="true"
              >
                <CategoryIcon :name="iconForCategory(c)" :size="16" :stroke="1.9" />
              </span>
              <span class="pop__name">{{ c.name }}</span>
              <svg v-if="c.id === modelValue" class="pop__tick" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 13.2 9.2 17.4 19 7.6" />
              </svg>
            </button>
            <p v-if="!list.length" class="pop__empty">尚無分類，請到設定頁新增</p>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- 標籤模式 -->
    <div v-else class="cats">
      <button
        v-for="c in list"
        :key="c.id"
        type="button"
        class="cat"
        :class="{ 'is-on': c.id === modelValue }"
        @click="pick(c.id)"
      >
        <span
          class="cat__ic"
          :style="{ '--c': c.color, '--bg': withAlpha(c.color, 0.14) }"
          aria-hidden="true"
        >
          <CategoryIcon :name="iconForCategory(c)" :size="15" :stroke="1.9" />
        </span>
        <span class="cat__name">{{ c.name }}</span>
      </button>

      <!-- 「更多」與「收起」刻意分成兩顆：
           原本共用一顆時，展開後 list 等於全部、顯示條件不成立，按鈕會消失導致收不回來 -->
      <button
        v-if="expandable && !expanded"
        type="button"
        class="cat-more"
        :title="`更多分類（還有 ${hiddenCount} 個）`"
        aria-label="展開更多分類"
        :aria-expanded="false"
        @click="expanded = true"
      >
        <svg class="cat-more__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <!-- 收起：圖示用「向上箭頭＋上方橫線」，與更多的單一向下箭頭明顯區隔 -->
      <button
        v-if="expandable && expanded"
        type="button"
        class="cat-more cat-more--up"
        title="收起分類"
        aria-label="收起分類"
        :aria-expanded="true"
        @click="expanded = false"
      >
        <svg class="cat-more__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.4 6.6h13.2" />
          <path d="M6.9 13.4 12 8.3l5.1 5.1" />
        </svg>
      </button>

      <p v-if="!list.length" class="muted tiny">尚無分類，請到設定頁新增</p>
    </div>
  </div>
</template>

<style scoped>
.picker {
  min-width: 0;
}
/* ── 下拉模式 ── */
.selwrap {
  display: block;
  max-width: 240px;
  min-width: 160px;
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

/* ── 標籤模式 ── */
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.cat {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text-2);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.cat:hover {
  background: var(--surface-3);
}
.cat.is-on {
  background: var(--pick);
  border-color: var(--pick);
  color: #fff;
}
.cat__ic {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  color: var(--c);
  background: var(--bg);
  flex: none;
}
.cat.is-on .cat__ic {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.cat-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-3);
  flex: none;
}
.cat-more:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
/* 收起鈕：墨綠淡底，跟「更多」的白底做出區隔，一眼看得出是另一顆 */
.cat-more--up {
  background: var(--accent-soft);
  border-color: rgba(44, 110, 91, 0.28);
  color: var(--accent);
}
.cat-more--up:hover {
  background: var(--accent-light);
  border-color: var(--accent);
  color: var(--accent-hover);
}
.cat-more__icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cat-more--up .cat-more__icon {
  stroke-width: 1.9;
}
</style>
