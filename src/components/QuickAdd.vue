<script setup lang="ts">
import { computed, ref } from 'vue'
import type { QuickItem, TxType } from '@/types'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { fmtMoney } from '@/lib/currency'

interface Pick {
  type: TxType
  categoryId: string
  amount: number
  currency: string
  note: string
  label: string
}

const props = defineProps<{
  /** 主頁目前的表單狀態（供「加入常用」使用） */
  context: { type: TxType; amount: number; categoryId: string; currency: string; note: string }
}>()

const records = useRecordsStore()
const settings = useSettingsStore()
const toast = useToast()

const picked = ref('')
const managing = ref(false)

const keyOf = (p: Pick) => `${p.type}|${p.categoryId}|${p.amount}|${p.currency}|${p.note.trim()}`

function nameOf(categoryId: string, fallback = '未分類') {
  return settings.category(categoryId)?.name ?? fallback
}

/** 使用者自行維護的常用清單 */
const pinned = computed<QuickItem[]>(() =>
  settings.state.quickItems.filter((q) => q.amount > 0 && settings.category(q.categoryId)),
)

/** 從歷史記錄自動歸納的常用組合（已排除與常用清單重複者） */
const auto = computed<Pick[]>(() => {
  const m = new Map<string, Pick & { count: number; last: number }>()
  for (const r of records.records) {
    if (!(r.amount > 0)) continue
    const note = (r.note ?? '').trim()
    const p: Pick = {
      type: r.type,
      categoryId: r.categoryId,
      amount: r.amount,
      currency: r.currency,
      note,
      label: '',
    }
    const key = keyOf(p)
    const hit = m.get(key)
    const t = Date.parse(r.occurredAt) || 0
    if (hit) {
      hit.count++
      hit.last = Math.max(hit.last, t)
    } else {
      m.set(key, { ...p, count: 1, last: t })
    }
  }
  const dup = new Set(pinned.value.map((q) => keyOf({ ...q })))
  return [...m.values()]
    .filter((e) => !dup.has(keyOf(e)))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, 8)
    .map((e) => ({
      type: e.type,
      categoryId: e.categoryId,
      amount: e.amount,
      currency: e.currency,
      note: e.note,
      label: '',
    }))
})

function labelOf(p: Pick): string {
  const name = p.label?.trim() || nameOf(p.categoryId)
  const tail = p.note?.trim() ? ` · ${p.note.trim()}` : ''
  return `${name}${tail} · ${fmtMoney(p.amount, p.currency)}`
}

const canAddCurrent = computed(() => props.context.amount > 0 && !!props.context.categoryId)

function onPick(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  picked.value = ''
  if (!v) return
  if (v.startsWith('p:')) {
    const item = pinned.value.find((q) => q.id === v.slice(2))
    if (item) submit(item)
    return
  }
  if (v.startsWith('a:')) {
    const item = auto.value[Number(v.slice(2))]
    if (item) submit(item)
  }
}

function submit(p: Pick) {
  const rec = records.add({
    type: p.type,
    categoryId: p.categoryId,
    amount: p.amount,
    currency: p.currency,
    occurredAt: new Date().toISOString(),
    note: p.note ?? '',
    source: 'manual',
  })
  toast.push(`已記錄 ${labelOf(p)}`, 'ok', {
    label: '復原',
    run: () => records.remove(rec.id),
  })
}

function addCurrent() {
  if (!canAddCurrent.value) {
    toast.push('請先輸入金額與分類', 'warn')
    return
  }
  const c = props.context
  const q = settings.addQuickItem({
    label: c.note.trim() || nameOf(c.categoryId),
    type: c.type,
    categoryId: c.categoryId,
    amount: Number(c.amount.toFixed(2)),
    currency: c.currency,
    note: c.note.trim(),
  })
  managing.value = true
  toast.push(`已加入常用：${labelOf(q)}`, 'ok')
}
</script>

<template>
  <section class="card qadd">
    <header class="qadd__hd">
      <h2 class="qadd__title">快速記帳</h2>
      <div class="qadd__acts">
        <button class="btn btn--ghost btn--sm" @click="addCurrent">＋ 加入常用</button>
        <button
          class="btn btn--ghost btn--sm"
          :class="{ 'is-on': managing }"
          @click="managing = !managing"
        >
          管理
        </button>
      </div>
    </header>

    <select class="field qadd__sel" :value="picked" @change="onPick">
      <option value="" disabled>從常用清單選一筆…</option>
      <optgroup v-if="pinned.length" label="我的常用">
        <option v-for="q in pinned" :key="q.id" :value="`p:${q.id}`">{{ labelOf(q) }}</option>
      </optgroup>
      <optgroup v-if="auto.length" label="自動（依歷史頻率）">
        <option v-for="(a, i) in auto" :key="i" :value="`a:${i}`">{{ labelOf(a) }}</option>
      </optgroup>
    </select>

    <p v-if="!pinned.length && !auto.length" class="tiny muted qadd__hint">
      還沒有常用項目。輸入金額、選好分類後按「＋ 加入常用」，之後一鍵就能記帳。
    </p>
    <p v-else class="tiny muted qadd__hint">選取後立即記一筆（時間為現在），可一鍵復原。</p>

    <div v-if="managing && pinned.length" class="qadd__list">
      <div v-for="q in pinned" :key="q.id" class="qi">
        <span class="qi__dot" :style="{ background: settings.category(q.categoryId)?.color }" />
        <span class="qi__name">{{ labelOf(q) }}</span>
        <button class="qi__x" title="從常用清單移除" @click="settings.removeQuickItem(q.id)">
          ✕
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.qadd {
  padding: 13px 14px 14px;
}
.qadd__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.qadd__title {
  font-size: 15px;
}
.qadd__acts {
  display: flex;
  gap: 2px;
}
.qadd__sel {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  font-size: 14.5px;
  font-weight: 600;
}
.qadd__hint {
  margin: 7px 0 0;
}
.qadd__list {
  margin-top: 11px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line);
}
.qi {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line);
}
.qi__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.qi__name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qi__x {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-3);
}
.qi__x:hover {
  background: var(--expense-soft);
  color: var(--expense);
}
.is-on {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
