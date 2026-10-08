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

/**
 * 0.1.29：tooltip 的可讀性補強（使用者：「分類佔比的圖表，點擊時的文字會出現
 * 透明化的問題，有時候看不清文字」）。
 *
 * 根因有兩個：
 *  ① Chart.js 的 tooltip 有一個 **200ms 的透明度動畫**（`opacity: { duration: 200 }`）。
 *    手機上手指一點就放開、或連續點，動畫可能停在半路 → tooltip 停在半透明，
 *    圖表的亮色扇形透出來，白字就看不清了（使用者說的「透明化」）。
 *    → 把這個動畫的時長設成 0：一出現就是**實色**，不再有半路的狀態。
 *  ② `Chart.defaults.color` 我們設成了灰綠 `#6e6a63`（給座標軸用的），
 *    但 tooltip 的文字色沒有明寫 → 一旦某個版本的預設值繼承了它，
 *    深底上就是灰字。→ 明寫 `titleColor`／`bodyColor` 是白色。
 *
 * ⚠ 這些是**全域預設**（useChart 被所有圖表共用）：
 *   甜甜圈／每日收支／近六個月趨勢的 tooltip 一次全部修好。
 */
Chart.defaults.plugins.tooltip.titleColor = '#ffffff'
Chart.defaults.plugins.tooltip.bodyColor = '#ffffff'
Chart.defaults.plugins.tooltip.displayColors = false
/**
 * ⚠⚠ 關掉 tooltip 的透明度 fade。
 *
 * 0.1.29：使用者「點圖表時的文字會透明化、有時候看不清」的根因就是它 ——
 * tooltip 的 `opacity` 有一個 **200ms 線性動畫**，手機上手指一點就放開或連續點，
 * 動畫停在半路 → tooltip 半透明，亮色扇形透出來，白字就看不清。
 * 把時長設成 0：一出現就是實色，不再有半路的狀態。
 *
 * ⚠⚠ 一定要改 **`animations`（複數）**：`Tooltip._resolveAnimations()` 的原始碼是
 *   `const opts = options.enabled && chart.options.animation && options.animations`
 *   —— 它讀的是 `animations`，而且要跟 `chart.options.animation` 同時存在才會啟用。
 *   （我第一次寫成單數的 `animation`，runtime 完全不理，fade 照樣在 —— v108 抓到的。）
 *   ⚠ 只改 `opacity.duration`，不要整個物件換掉，否則會弄丟 `numbers` 那組設定。
 */
;(Chart.defaults.plugins.tooltip.animations as unknown as { opacity: { duration: number } }).opacity.duration = 0
/* ↑ 型別上 `animations` 是 `false | AnimationsSpec`（所以 TS 要 cast 兩層），
   但預設值實際上是物件；runtime 也只認得物件。 */
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
