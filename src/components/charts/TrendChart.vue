<script setup lang="ts">
import { watch } from 'vue'
import type { ChartConfiguration } from 'chart.js'
import { useChart } from '@/composables/useChart'
import { fmtMoney } from '@/lib/currency'

const props = defineProps<{
  points: { month: string; expense: number; income: number }[]
  currency: string
}>()

const { setCanvas, render } = useChart(() => {
  if (!props.points.length) return null
  const cfg: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: props.points.map((p) => `${Number(p.month.split('-')[1])}月`),
      datasets: [
        {
          label: '支出',
          data: props.points.map((p) => p.expense),
          borderColor: '#bf563c',
          backgroundColor: 'rgba(191,86,60,0.10)',
          fill: true,
          tension: 0.32,
          pointRadius: 3,
          pointBackgroundColor: '#bf563c',
          borderWidth: 2,
        },
        {
          label: '收入',
          data: props.points.map((p) => p.income),
          borderColor: '#2c6e5b',
          backgroundColor: 'rgba(44,110,91,0.08)',
          fill: true,
          tension: 0.32,
          pointRadius: 3,
          pointBackgroundColor: '#2c6e5b',
          borderWidth: 2,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(27,26,24,0.06)' },
          border: { display: false },
          ticks: {
            callback: (v) => {
              const n = Number(v)
              if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 ? 1 : 0)}萬`
              return n.toLocaleString('zh-Hant')
            },
          },
        },
        x: {
          grid: { display: false },
          border: { display: false },
        },
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
