<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { dayKey, formatDay } from '@/lib/date'
import RecordRow from './RecordRow.vue'

const props = withDefaults(
  defineProps<{
    records: TxRecord[]
    /** 顯示時間（同一天內多筆時有用） */
    showTime?: boolean
    /** 一開始只顯示前 N 筆，其餘用「顯示全部」展開（0 = 全部） */
    collapseAfter?: number
    emptyText?: string
  }>(),
  { showTime: true, collapseAfter: 0, emptyText: '這個範圍沒有記錄' },
)
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>()

const settings = useSettingsStore()
const showAll = ref(false)

const groups = computed(() => {
  const m = new Map<string, TxRecord[]>()
  for (const r of props.records) {
    const k = dayKey(r.occurredAt)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      return {
        key,
        label: formatDay(list[0].occurredAt),
        total: sorted.reduce((s, r) => s + (r.type === 'expense' ? r.baseAmount : -r.baseAmount), 0),
        list: sorted,
      }
    })
})

const total = computed(() => props.records.length)
const collapsed = computed(
  () => props.collapseAfter > 0 && !showAll.value && total.value > props.collapseAfter,
)

/** 摺疊時只顯示最新的前 N 筆（跨日分組計算） */
const visibleGroups = computed(() => {
  if (!collapsed.value) return groups.value
  let left = props.collapseAfter
  const out: typeof groups.value = []
  for (const g of groups.value) {
    if (left <= 0) break
    const slice = g.list.slice(0, left)
    if (slice.length) out.push({ ...g, list: slice })
    left -= slice.length
  }
  return out
})

watch(
  () => props.records,
  () => {
    showAll.value = false
  },
)
</script>

<template>
  <div class="list">
    <div v-if="!props.records.length" class="empty card">
      <p class="muted">{{ emptyText }}</p>
    </div>

    <template v-else>
      <div v-for="g in visibleGroups" :key="g.key" class="day">
        <div class="day__head">
          <span class="day__label">{{ g.label }}</span>
          <span class="day__total num">{{ fmtMoney(g.total, settings.baseCurrency) }}</span>
        </div>
        <div class="card day__card">
          <template v-for="(r, i) in g.list" :key="r.id">
            <hr v-if="i > 0" class="divider" />
            <RecordRow
              :record="r"
              :show-time="showTime"
              @edit="emit('edit', $event)"
              @remove="emit('remove', $event)"
            />
          </template>
        </div>
      </div>

      <button v-if="collapsed" class="btn btn--sm more" @click="showAll = true">
        顯示全部 {{ total }} 筆
      </button>
      <button v-else-if="collapseAfter > 0 && total > collapseAfter" class="btn btn--sm more" @click="showAll = false">
        只顯示最近 {{ collapseAfter }} 筆
      </button>
    </template>
  </div>
</template>

<style scoped>
.day {
  margin-bottom: 12px;
}
.day__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 6px;
}
.day__label {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.day__total {
  font-size: 12.5px;
  color: var(--text-3);
}
.day__card {
  overflow: hidden;
}
.empty {
  padding: 30px 18px;
  text-align: center;
}
.more {
  display: flex;
  margin: 0 auto;
}
</style>
