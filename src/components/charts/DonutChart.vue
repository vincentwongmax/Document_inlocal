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
          /**
           * ⚠ 0.1.29：`position: 'nearest'`（Chart.js 預設是 `'average'`）。
           * 使用者反映點圖表時文字看不清 —— 除了透明度（見 useChart 的全域修正），
           * 還有「tooltip 蓋住甜甜圈中心」的問題：`average` 會把 tooltip 放在
           * 扇形的質心附近，小扇形的質心很靠近圓心，tooltip 就壓在
           * 「總支出／總收入」那行字上。改成 `nearest` 會貼著**手指點的位置**
           * （扇形外緣），離中心遠，中心文字就不會被蓋住。
           */
          position: 'nearest',
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
