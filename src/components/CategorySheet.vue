<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import type { TxType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useScrollLock } from '@/composables/useScrollLock'
import { usePullToClose } from '@/composables/usePullToClose'
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

/**
 * 向下拉就關閉（0.1.26）。
 * 使用者要求「之前的子頁面風格全跟記錄明細的頁面」——
 * 原本只有「完成」鈕與點背景，現在補上跟記錄明細同一套的下拉手勢。
 * ⚠ `panel` 是外框 `.catsheet__card`、`scroller` 是裡面的 `.catsheet__body`：
 *   清單沒捲到頂時往下滑是捲清單，捲到頂再往下拉才是關閉。
 */
const sheetEl = ref<HTMLElement | null>(null)
const {
  dragging: pulling,
  style: pullStyle,
  onTouchStart: onSheetTouchStart,
  onTouchMove: onSheetTouchMove,
  onTouchEnd: onSheetTouchEnd,
  onMouseDown: onSheetMouseDown,
} = usePullToClose({ panel: sheetEl, scroller: bodyEl, onClose: () => emit('close') })

const currentName = computed(() => settings.category(props.modelValue)?.name ?? '')
</script>

<template>
  <Transition name="catsheet">
    <div v-if="open" class="catsheet bsheet-mask" @click.self="emit('close')">
      <div
        ref="sheetEl"
        class="catsheet__card card bsheet"
        :class="{ 'is-dragging': pulling }"
        :style="pullStyle"
        role="dialog"
        aria-modal="true"
        aria-label="選擇分類"
        @touchstart="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
        @touchcancel="onSheetTouchEnd"
        @mousedown="onSheetMouseDown"
      >
        <!-- 抓把：往下拉即可關閉（跟記錄明細同一套） -->
        <div class="bsheet__grab" aria-hidden="true"></div>

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

        <div ref="bodyEl" class="catsheet__body bsheet__body">
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
/*
 * 0.1.26：外框幾何全部來自 style.css 的 `.bsheet-mask` / `.bsheet` / `.bsheet__grab`
 * / `.bsheet__body`（＝記錄明細那套）。這裡只留 z-index、標題列與清單自己的排版。
 * ⚠ 不要再把 display / background / padding / max-width / max-height 寫回來 ——
 *   重寫就會蓋掉共用值，五個子頁面又會各長各的。
 */
.catsheet {
  z-index: 80;
}

.catsheet__card {
  padding: 0 12px 14px;
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
/* 可捲動的幾何交給共用的 `.bsheet__body`，這裡只留這個清單自己的內距 */
.catsheet__body {
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
