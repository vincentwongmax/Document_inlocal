import { onBeforeUnmount, onMounted } from 'vue'
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js'

Chart.register(
  ArcElement,
  DoughnutController,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
)

Chart.defaults.font.family =
  "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', sans-serif"
Chart.defaults.font.size = 12
Chart.defaults.color = '#6e6a63'
Chart.defaults.plugins.tooltip.backgroundColor = '#1b1a18'
Chart.defaults.plugins.tooltip.padding = 10
Chart.defaults.plugins.tooltip.cornerRadius = 8
Chart.defaults.plugins.tooltip.titleFont = { weight: 600, size: 12 }
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 }
Chart.defaults.plugins.tooltip.displayColors = false
Chart.defaults.maintainAspectRatio = false

/** 把 canvas 綁定成 Chart.js 實例，隨資料自動重建 */
export function useChart(build: () => ChartConfiguration | null) {
  let el: HTMLCanvasElement | null = null
  let chart: Chart | null = null

  function setCanvas(node: unknown) {
    el = (node as HTMLCanvasElement | null) ?? null
    if (el) render()
  }

  function render() {
    if (!el) return
    const config = build()
    if (!config) return
    chart?.destroy()
    chart = new Chart(el, config)
  }

  onMounted(render)
  onBeforeUnmount(() => {
    chart?.destroy()
    chart = null
    el = null
  })

  return { setCanvas, render }
}
