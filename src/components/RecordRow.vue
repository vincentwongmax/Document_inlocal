<script setup lang="ts">
import { computed } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { formatFull, relativeTime } from '@/lib/date'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'

const props = defineProps<{ record: TxRecord; showTime?: boolean }>()
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>()
const settings = useSettingsStore()

const cat = computed(() => settings.category(props.record.categoryId))
const catColor = computed(() => cat.value?.color ?? '#8a857c')
const catIcon = computed(() =>
  cat.value ? iconForCategory(cat.value) : iconForCategory({ id: '', name: '' }),
)
const isExpense = computed(() => props.record.type === 'expense')
const converted = computed(() => props.record.currency !== props.record.baseCurrency)
/** 舊資料可能沒有 images 欄位 */
const imgCount = computed(() => props.record.images?.length ?? 0)
</script>

<template>
  <div class="row">
    <span class="row__ic" :style="{ '--c': catColor, '--bg': withAlpha(catColor, 0.14) }">
      <CategoryIcon :name="catIcon" :size="17" :stroke="1.9" />
    </span>
    <button class="row__main" type="button" @click="emit('edit', record.id)">
      <span class="row__top">
        <span class="row__cat">{{ cat?.name ?? '未分類' }}</span>
        <span v-if="showTime" class="ttag" :title="formatFull(record.occurredAt)">
          <svg class="ttag__ic" viewBox="0 0 16 16" aria-hidden="true">
            <circle class="ttag__face" cx="8" cy="8" r="6.3" />
            <path d="M8 4.55v3.75l2.3 1.4" />
          </svg>
          <span>{{ relativeTime(record.occurredAt) }}</span>
        </span>
        <span v-if="imgCount" class="imtag">
          <svg class="imtag__ic" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2.4" />
            <circle cx="6.1" cy="6.9" r="1.15" />
            <path d="M3.6 11.9 6.6 9l2.1 1.9 2-1.8 2.2 2.5" />
          </svg>
          <span>有圖片</span>
          <span v-if="imgCount > 1" class="imtag__n">· {{ imgCount }}</span>
        </span>
        <span v-else-if="record.source === 'image'" class="imtag imtag--plain">收據</span>
      </span>
      <span v-if="record.note" class="row__note tiny muted">{{ record.note }}</span>
    </button>
    <div class="row__amt">
      <strong class="num" :class="isExpense ? 'is-exp' : 'is-inc'">
        {{ isExpense ? '−' : '+' }}{{ fmtMoney(record.baseAmount, record.baseCurrency) }}
      </strong>
      <span v-if="converted" class="tiny muted num">
        {{ fmtMoney(record.amount, record.currency) }} × {{ record.rate }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  transition: background 0.15s ease;
}
.row:hover {
  background: var(--surface-3);
}
.row__ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  color: var(--c);
  background: var(--bg);
  flex: none;
}
.row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}
.row__top {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}
.row__cat {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.01em;
}
.row__note {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imtag,
.ttag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 19px;
  padding: 0 7px;
  flex: none;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.imtag__ic,
.ttag__ic {
  width: 12px;
  height: 12px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 時間標籤：暖調軟底膠囊，比圖片標籤輕一階 */
.ttag {
  border-color: transparent;
  background: var(--surface-3);
  color: var(--text-2);
  font-weight: 650;
  padding: 0 9px;
  box-shadow: var(--shadow-1);
  font-variant-numeric: tabular-nums;
}
.ttag__ic {
  stroke: var(--text-3);
  stroke-width: 1.25;
}
.ttag__face {
  fill: currentColor;
  fill-opacity: 0.16;
}
.imtag__ic {
  stroke: var(--accent);
}
.imtag__ic circle {
  fill: var(--accent);
  stroke: none;
}
.imtag__n {
  color: var(--text-3);
  font-weight: 700;
}
.imtag--plain {
  border-color: var(--line);
  color: var(--text-3);
  font-weight: 550;
}
.row__amt {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex: none;
}
.row__amt strong {
  font-size: 15px;
}
.is-exp {
  color: var(--text);
}
.is-inc {
  color: var(--income);
}
</style>
