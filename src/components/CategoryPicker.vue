<script setup lang="ts">
import type { Category, TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type: TxType
    modelValue: string
    /** 只顯示常用的前 N 個（0 = 全部） */
    limit?: number
  }>(),
  { limit: 0 },
)
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const settings = useSettingsStore()
const list = computed<Category[]>(() => {
  const all = settings.categoriesByType(props.type)
  return props.limit > 0 ? all.slice(0, props.limit) : all
})
</script>

<template>
  <div class="cats">
    <button
      v-for="c in list"
      :key="c.id"
      type="button"
      class="cat"
      :class="{ 'is-on': c.id === modelValue }"
      @click="emit('update:modelValue', c.id)"
    >
      <span class="cat__dot" :style="{ background: c.color }" />
      <span class="cat__name">{{ c.name }}</span>
    </button>
    <p v-if="!list.length" class="muted tiny">尚無分類，請到設定頁新增</p>
  </div>
</template>

<style scoped>
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
</style>
