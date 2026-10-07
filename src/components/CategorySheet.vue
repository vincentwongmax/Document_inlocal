<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import type { TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useScrollLock } from '@/composables/useScrollLock'
import CategoryPicker from '@/components/CategoryPicker.vue'

/**
 * 選擇分類用的彈出頁面（置中卡片）。
 * 主頁只留常用分類，其餘（含子分類）都在這裡選；
 * 點分類只是選中，要按右上「完成」才關閉。
 *
 * 分類內容直接沿用 CategoryPicker（不帶 collapsed），
 * 所以「大類標籤列 + 下面各層子分類標籤列」跟原本展開後的長相一致。
 *
 * ⚠ 跟計算機子頁面的差別：分類可能很多，所以這裡**內容可以捲**；
 *   只有背景是鎖住的（overscroll-behavior: contain 避免捲到底把背景也帶動）。
 */
const props = defineProps<{
  open: boolean
  type: TxType
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [id: string]; close: [] }>()

const settings = useSettingsStore()
/** 分類清單是彈窗裡唯一可以捲的地方；手指在這裡滑要照常捲，其他一律鎖背景 */
const bodyEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => bodyEl.value })

const currentName = computed(() => settings.category(props.modelValue)?.name ?? '')
</script>

<template>
  <Transition name="catsheet">
    <div v-if="open" class="catsheet" @click.self="emit('close')">
      <div class="catsheet__card card" role="dialog" aria-modal="true" aria-label="選擇分類">
        <header class="catsheet__hd">
          <div class="catsheet__ttl">
            <span class="catsheet__title">選擇分類</span>
            <span class="catsheet__sub tiny muted">
              {{ currentName ? `已選 ${currentName}` : '尚未選擇' }}
            </span>
          </div>
          <button type="button" class="btn btn--primary catsheet__done" @click="emit('close')">
            完成
          </button>
        </header>

        <div ref="bodyEl" class="catsheet__body">
          <CategoryPicker
            :type="type"
            :model-value="modelValue"
            @update:model-value="emit('update:modelValue', $event)"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.catsheet {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(28, 34, 31, 0.42);
  overscroll-behavior: contain;
}

.catsheet__card {
  width: 100%;
  max-width: 380px;
  max-height: min(72dvh, 560px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 12px 14px;
}

.catsheet__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--line);
}
.catsheet__ttl {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.catsheet__title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.catsheet__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catsheet__done {
  height: 34px;
  min-width: 70px;
  padding: 0 14px;
  font-size: 13px;
  flex: none;
}

/* 分類清單可以捲，但捲到底不會帶動背景 */
.catsheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 2px 2px;
}

/* ── 進出場 ─────────────────────────────────────────────── */
.catsheet-enter-active,
.catsheet-leave-active {
  transition: opacity 0.18s ease;
}
.catsheet-enter-from,
.catsheet-leave-to {
  opacity: 0;
}
.catsheet-enter-active .catsheet__card,
.catsheet-leave-active .catsheet__card {
  transition: transform 0.18s ease;
}
.catsheet-enter-from .catsheet__card,
.catsheet-leave-to .catsheet__card {
  transform: scale(0.96);
}
</style>
