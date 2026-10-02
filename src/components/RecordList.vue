<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { dayKey, dayParts } from '@/lib/date'
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
      const exp = sorted.reduce((s, r) => s + (r.type === 'expense' ? r.baseAmount : 0), 0)
      const inc = sorted.reduce((s, r) => s + (r.type === 'income' ? r.baseAmount : 0), 0)
      return {
        key,
        parts: dayParts(list[0].occurredAt),
        exp,
        inc,
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
          <span class="day__cal">
            <b class="day__num num">{{ g.parts.num }}</b>
            <span class="day__mon">{{ g.parts.mon }}</span>
          </span>
          <span class="day__tag" :class="{ 'is-today': g.parts.tag === '今天' }">{{ g.parts.tag }}</span>
          <span class="day__rule"></span>
          <span class="day__amt">
            <span v-if="g.inc > 0" class="day__chip is-inc num">
              +{{ fmtMoney(g.inc, settings.baseCurrency) }}
            </span>
            <span v-if="g.exp > 0" class="day__chip is-exp num">
              −{{ fmtMoney(g.exp, settings.baseCurrency) }}
            </span>
            <span v-if="g.inc === 0 && g.exp === 0" class="day__chip num">
              {{ fmtMoney(0, settings.baseCurrency) }}
            </span>
          </span>
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

      <button v-if="collapsed" class="btn btn--ghost more" @click="showAll = true">
        顯示全部 {{ total }} 筆
      </button>
      <button
        v-else-if="collapseAfter > 0 && total > collapseAfter"
        class="btn btn--ghost more"
        @click="showAll = false"
      >
        只顯示最近 {{ collapseAfter }} 筆
      </button>
    </template>
  </div>
</template>

<style scoped>
.day {
  margin-bottom: 16px;
}
.day__head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 2px 8px;
}
.day__cal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-1);
  line-height: 1;
}
.day__num {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}
.day__mon {
  margin-top: 2px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-3);
}
.day__tag {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-2);
  background: var(--surface-3);
}
.day__tag.is-today {
  color: var(--accent);
  background: var(--accent-soft);
}
.day__rule {
  flex: 1;
  min-width: 12px;
  height: 1px;
  background: var(--line);
}
.day__amt {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.day__chip {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.day__chip.is-exp {
  color: var(--expense);
}
.day__chip.is-inc {
  color: var(--income);
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
  width: 100%;
  margin: 2px auto 0;
}
</style>
