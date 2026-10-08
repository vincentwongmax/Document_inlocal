<script setup lang="ts">
import type { Category, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import { flattenCategories } from '@/lib/tree'
import CategoryIcon from './CategoryIcon.vue'
import CategorySelect from './CategorySelect.vue'
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
    /**
     * 「更多」改成發事件、由外面開彈出頁面，而不是就地展開。
     * 預設 false（維持原本就地展開的行為），其他使用處不受影響。
     */
    moreExternal?: boolean
    /** 顯示方式：chips 標籤（預設）／ select 下拉清單 */
    variant?: 'chips' | 'select'
  }>(),
  { limit: 0, usageOrder: true, collapsed: false, moreExternal: false, variant: 'chips' },
)
const emit = defineEmits<{ 'update:modelValue': [id: string]; more: [] }>()

const settings = useSettingsStore()
const records = useRecordsStore()
const expanded = ref(false)

const usage = computed(() => {
  const m = new Map<string, number>()
  for (const r of records.records) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1)
  return m
})

const byUsage = (list: Category[]) =>
  [...list].sort((a, b) => (usage.value.get(b.id) ?? 0) - (usage.value.get(a.id) ?? 0))

/** 第一列的「大類」清單（子分類不出現在這裡，依使用頻率或原始順序） */
const all = computed<Category[]>(() => {
  const list = settings.topCategoriesByType(props.type)
  return props.usageOrder ? byUsage(list) : list
})

/** 含子分類的完整清單：常用可能勾到子分類，要能查得到 */
const allWithSubs = computed<Category[]>(() => settings.categoriesByType(props.type))

/** 「餐飲 › 早餐」這種完整路徑名稱 */
function pathName(c: Category): string {
  const chain: string[] = []
  const seen = new Set<string>()
  let cur: Category | undefined = c
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur.name)
    cur = cur.parentId ? allWithSubs.value.find((x) => x.id === cur!.parentId) : undefined
  }
  return chain.join(' › ')
}

/**
 * 下拉模式的選項：整棵樹列出來，子分類緊接在自己的大類後面（而不是依使用頻率打散），
 * 名稱換成完整路徑才看得出層級。
 */
const selectList = computed<Category[]>(() =>
  flattenCategories(allWithSubs.value, props.usageOrder ? byUsage : undefined).map((c) =>
    c.parentId ? { ...c, name: pathName(c) } : c,
  ),
)

/** 使用者勾選的常用分類（限目前收支類型，可含子分類），照勾選順序 */
const favorites = computed<Category[]>(() =>
  settings.favoriteCategories
    .map((id) => allWithSubs.value.find((c) => c.id === id))
    .filter((c): c is Category => !!c),
)

/** 選中分類所屬的「大類」（自己就是大類時＝自己） */
const selectedRoot = computed<Category | undefined>(() =>
  props.modelValue ? settings.pathOf(props.modelValue)[0] : undefined,
)

/** 實際顯示的第一列清單 */
const list = computed<Category[]>(() => {
  let out = all.value
  if (props.limit > 0) out = out.slice(0, props.limit)

  if (!props.collapsed || expanded.value) {
    // 展開時是「全部大類」，但被勾選的子分類不能因此消失
    const subs = favorites.value.filter((c) => !!c.parentId)
    if (!subs.length) return out
    const seen = new Set(out.map((c) => c.id))
    return [...out, ...subs.filter((c) => !seen.has(c.id))]
  }

  // 有勾選就只顯示勾選的；沒勾選則全部顯示（不限制數量）
  const fav = favorites.value.length ? favorites.value : out

  // 選中的分類一定要看得到，不然會出現「看不到自己選了什麼」。
  // ⚠ 但**子分類不補進第一列**：它已經在下面的子分類列裡了，
  //   再塞一顆到第一列會插到最前面、整列愈長愈亂。
  //   第一列只保證「它隸屬的大類」看得到（並標亮它，見 activeId）。
  const root = selectedRoot.value
  if (root && !root.archived && !fav.some((c) => c.id === root.id)) return [root, ...fav]
  return fav
})

/**
 * 第一列要標亮哪一顆：選到子分類時，標亮它所屬的**大類**
 *（子分類只在下面的子分類列亮，不會多一顆到第一列）。
 * 例外：子分類自己也在第一列時（被勾成常用分類）就標它自己——
 * 兩個一起亮反而看不出到底選了哪一個。
 */
const activeId = computed(() => {
  if (!props.modelValue) return ''
  if (list.value.some((c) => c.id === props.modelValue)) return props.modelValue
  return selectedRoot.value?.id ?? props.modelValue
})

/**
 * 子分類列：沿著「目前選中分類」的祖先鏈往下，每一層有子分類就多一列。
 * 例如選了「餐飲 › 早餐」，就會出現「餐飲的子分類」與「早餐的子分類」兩列。
 */
const subRows = computed<{ parent: Category; items: Category[] }[]>(() => {
  if (props.variant === 'select' || !props.modelValue) return []
  const rows: { parent: Category; items: Category[] }[] = []
  for (const step of settings.pathOf(props.modelValue)) {
    const kids = settings.childrenOf(step.id)
    if (!kids.length) continue
    rows.push({ parent: step, items: props.usageOrder ? byUsage(kids) : kids })
  }
  return rows
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

/** 「更多」：外部模式發事件，否則就地展開 */
function onMore() {
  if (props.moreExternal) emit('more')
  else expanded.value = true
}

function pick(id: string) {
  emit('update:modelValue', id)
  // 從展開的全部清單選了非常用分類後自動收起，維持介面精簡
  if (expanded.value) expanded.value = false
}

// 換收支類型時收起標籤列的展開，避免分類暴增
watch(
  () => props.type,
  () => {
    expanded.value = false
  },
)
</script>

<template>
  <div class="picker">
    <!-- 下拉清單模式（共用 CategorySelect：自訂彈層，每一項都帶分類圖示） -->
    <CategorySelect
      v-if="variant === 'select'"
      :model-value="modelValue"
      :options="selectList"
      placeholder="選擇分類"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <!-- 標籤模式 -->
    <div v-else class="cats">
      <button
        v-for="c in list"
        :key="c.id"
        type="button"
        class="cat"
        :class="{ 'is-on': c.id === activeId }"
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
        :title="moreExternal ? `開啟全部分類（還有 ${hiddenCount} 個）` : `更多分類（還有 ${hiddenCount} 個）`"
        :aria-label="moreExternal ? '開啟全部分類' : '展開更多分類'"
        :aria-expanded="false"
        @click="onMore"
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

    <!-- 子分類：選了大類才出現，一層一列，可一直往下（多層） -->
    <div v-for="row in subRows" :key="row.parent.id" class="subs">
      <span class="subs__tag">{{ row.parent.name }}</span>
      <div class="cats cats--sub">
        <button
          v-for="c in row.items"
          :key="c.id"
          type="button"
          class="cat cat--sub"
          :class="{ 'is-on': c.id === modelValue }"
          @click="pick(c.id)"
        >
          <span
            class="cat__ic"
            :style="{ '--c': c.color, '--bg': withAlpha(c.color, 0.14) }"
            aria-hidden="true"
          >
            <CategoryIcon :name="iconForCategory(c)" :size="14" :stroke="1.9" />
          </span>
          <span class="cat__name">{{ c.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker {
  min-width: 0;
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

/* ── 子分類列：一層一列，往內縮一點並用左側引導線串起來 ── */
.subs {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--line-strong);
}
.subs__tag {
  display: block;
  margin-bottom: 5px;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-3);
}
.cats--sub {
  gap: 6px;
}
.cat--sub {
  height: 30px;
  padding: 0 10px;
  font-size: 13px;
}
.cat--sub .cat__ic {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
</style>
