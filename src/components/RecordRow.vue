<script setup lang="ts">
import { computed } from 'vue'
import type { TxRecord } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import { formatFull, relativeTime } from '@/lib/date'

const props = defineProps<{ record: TxRecord; showTime?: boolean }>()
const emit = defineEmits<{ edit: [id: string]; remove: [id: string] }>()
const settings = useSettingsStore()

const cat = computed(() => settings.category(props.record.categoryId))
const isExpense = computed(() => props.record.type === 'expense')
const converted = computed(() => props.record.currency !== props.record.baseCurrency)
</script>

<template>
  <div class="row">
    <span class="row__dot" :style="{ background: cat?.color ?? '#8a857c' }" />
    <button class="row__main" type="button" @click="emit('edit', record.id)">
      <span class="row__top">
        <span class="row__cat">{{ cat?.name ?? '未分類' }}</span>
        <span
          v-if="showTime"
          class="row__time tiny muted num"
          :title="formatFull(record.occurredAt)"
        >{{ relativeTime(record.occurredAt) }}</span>
      </span>
      <span v-if="record.note" class="row__note tiny muted">{{ record.note }}</span>
      <span class="row__meta">
        <span v-for="im in record.images.slice(0, 3)" :key="im.id" class="row__thumb">
          <img v-if="im.thumb" :src="im.thumb" alt="" />
        </span>
        <span v-if="record.images.length > 3" class="row__more tiny num">
          +{{ record.images.length - 3 }}
        </span>
        <span v-if="record.source === 'image' && !record.images.length" class="tag">收據</span>
      </span>
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
.row__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
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
  align-items: baseline;
  gap: 8px;
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
.row__more {
  align-self: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-weight: 700;
}
.row__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.row__thumb {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface-3);
  flex: none;
}
.row__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
