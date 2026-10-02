<script setup lang="ts">
import { watch } from 'vue'
import type { ChartConfiguration } from 'chart.js'
import { useChart } from '@/composables/useChart'
import { fmtMoney } from '@/lib/currency'

const props = defineProps<{
  points: { key: string; label: string; expense: number; income: number }[]
  currency: string
}>()

const { setCanvas, render } = useChart(() => {
  if (!props.points.length) return null
  const cfg: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: props.points.map((p) => p.label),
      datasets: [
        {
          label: '支出',
          data: props.points.map((p) => p.expense),
          backgroundColor: '#bf563c',
          borderRadius: 4,
          maxBarThickness: 18,
        },
        {
          label: '收入',
          data: props.points.map((p) => p.income),
          backgroundColor: '#2c6e5b',
          borderRadius: 4,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(27,26,24,0.06)' },
          border: { display: false },
          ticks: {
            callback: (v) => {
              const n = Number(v)
              if (n >= 10000) return `${(n / 10000).toFixed(0)}萬`
              return n.toLocaleString('zh-Hant')
            },
          },
        },
        x: { grid: { display: false }, border: { display: false }, stacked: false },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 14 },
        },
        tooltip: {
          callbacks: {
            title: (items) => `${props.points[items[0].dataIndex]?.key ?? ''}`,
            label: (ctx) => `${ctx.dataset.label} ${fmtMoney(Number(ctx.raw ?? 0), props.currency)}`,
          },
        },
      },
    },
  }
  return cfg
})

watch(() => props.points, render, { deep: true })
</script>

<template>
  <canvas :ref="setCanvas" />
</template>
