<script setup lang="ts">
import { computed } from 'vue'
import { iconDef, type IconShape } from '@/lib/icons'

const props = withDefaults(
  defineProps<{
    /** 圖示鍵值（見 src/lib/icons.ts）；未知或未給時使用預設圖示 */
    name?: string | null
    size?: number
    stroke?: number
  }>(),
  { size: 20, stroke: 1.7 },
)

const shapes = computed<IconShape[]>(() => iconDef(props.name).shapes)
</script>

<template>
  <svg
    class="cicon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-for="(s, i) in shapes" :key="i">
      <path v-if="s.t === 'path'" :d="s.d" />
      <circle v-else-if="s.t === 'circle'" :cx="s.cx" :cy="s.cy" :r="s.r" />
      <rect v-else-if="s.t === 'rect'" :x="s.x" :y="s.y" :width="s.w" :height="s.h" :rx="s.rx" />
      <line v-else :x1="s.x1" :y1="s.y1" :x2="s.x2" :y2="s.y2" />
    </g>
  </svg>
</template>

<style scoped>
.cicon {
  display: block;
  flex: none;
}
</style>
