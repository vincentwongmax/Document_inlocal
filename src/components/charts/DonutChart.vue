<script setup lang="ts">
import { watch } from 'vue'
import type { ChartConfiguration } from 'chart.js'
import { useChart } from '@/composables/useChart'
import { fmtMoney } from '@/lib/currency'

const props = defineProps<{ items: { name: string; color: string; total: number }[]; currency: string }>()

const { setCanvas, render } = useChart(() => {
  if (!props.items.length) return null
  const total = props.items.reduce((s, i) => s + i.total, 0) || 1
  const cfg: ChartConfiguration<'doughnut'> = {
    type: 'doughnut',
    data: {
      labels: props.items.map((i) => i.name),
      datasets: [
        {
          data: props.items.map((i) => i.total),
          backgroundColor: props.items.map((i) => i.color),
          borderColor: '#ffffff',
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = Number(ctx.raw ?? 0)
              const pct = ((v / total) * 100).toFixed(1)
              return `${fmtMoney(v, props.currency)} · ${pct}%`
            },
          },
        },
      },
    },
  }
  return cfg
})

watch(() => props.items, render, { deep: true })
</script>

<template>
  <canvas :ref="setCanvas" />
</template>
