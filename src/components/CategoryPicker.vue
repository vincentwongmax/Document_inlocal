<script setup lang="ts">
import type { Category, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { computed, ref, watch } from 'vue'

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

const hiddenCount = computed(() =>
  props.collapsed && !expanded.value ? Math.max(0, all.value.length - list.value.length) : 0,
)

function pick(id: string) {
  emit('update:modelValue', id)
  // 從展開的全部清單選了非常用分類後自動收起，維持介面精簡
  if (expanded.value) expanded.value = false
}

/** 下拉模式：目前選中的分類 */
const selected = computed<Category | undefined>(() =>
  all.value.find((c) => c.id === props.modelValue),
)

function onSelect(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  if (id) pick(id)
}

// 換收支類型時收起，避免分類暴增
watch(
  () => props.type,
  () => {
    expanded.value = false
  },
)
</script>

<template>
  <div class="picker">
    <!-- 下拉清單模式 -->
    <template v-if="variant === 'select'">
      <div class="selwrap">
        <span
          v-if="selected"
          class="selwrap__dot"
          :style="{ background: selected.color }"
          aria-hidden="true"
        />
        <select class="field selwrap__sel" :value="modelValue" @change="onSelect">
          <option v-if="!list.length" value="" disabled>尚無分類，請到設定頁新增</option>
          <option v-for="c in list" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
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
        <span class="cat__dot" :style="{ background: c.color }" />
        <span class="cat__name">{{ c.name }}</span>
      </button>

      <button
        v-if="collapsed && all.length > list.length"
        type="button"
        class="cat-more"
        :title="expanded ? '收起全部分類' : `更多分類（隱藏 ${hiddenCount} 個）`"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <svg class="cat-more__icon" :class="{ 'is-up': expanded }" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
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
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 240px;
  min-width: 160px;
}
.selwrap__dot {
  position: absolute;
  left: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 1;
}
.selwrap__sel {
  width: 100%;
  padding-left: 30px;
  height: 36px;
}
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
  background: var(--text);
  border-color: var(--text);
  color: #fff;
}
.cat__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
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
.cat-more__icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s;
}
.cat-more__icon.is-up {
  transform: rotate(180deg);
}
</style>
