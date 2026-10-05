<script setup lang="ts">
/**
 * 分類路徑標籤：路徑太長時只留頭尾 —— 「餐飲 › 123 › 456 › 789 › 999」會變成
 * 「餐飲 › … › 999」。路徑裡最有意義的是最上層的大類與最後一層，砍中間最不痛；
 * 而 CSS 內建的 text-overflow 只能砍尾巴，會把最關鍵的「哪一層」砍掉。
 *
 * 量法是直接比對 DOM 的 scrollWidth / clientWidth（真的用瀏覽器排版結果），
 * 不用 canvas 猜字型寬度。
 *
 * ⚠ 只能用在**寬度由版面決定**的容器（例如 `flex: 1; min-width: 0`）。
 *   如果元素寬度是被內容撐開的，它永遠不會 overflow，這裡就永遠不會動。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ path: string }>()

const SEP = ' › '

const el = ref<HTMLElement | null>(null)
const text = ref(props.path)
let ro: ResizeObserver | null = null
/** 快速連續觸發時，只有最後一次可以寫入結果 */
let seq = 0

async function fit() {
  const node = el.value
  if (!node) return
  const id = ++seq

  const segs = props.path.split(SEP)
  const head = segs[0]
  const tail = segs[segs.length - 1]

  // 只有兩層（或一層）的路徑沒有中間可以省，維持原樣讓 CSS 的 ellipsis 收尾
  text.value = props.path
  if (segs.length < 3) return

  await nextTick()
  if (id !== seq || !el.value) return
  if (node.scrollWidth <= node.clientWidth) return // 放得下就不用動

  text.value = `${head}${SEP}…${SEP}${tail}`
  await nextTick()
  if (id !== seq || !el.value) return
  if (node.scrollWidth <= node.clientWidth) return

  // 連「大類 › … › 最後一層」都放不下 → 先捨掉大類，至少留下最精確的那一層
  text.value = `…${SEP}${tail}`
}

onMounted(() => {
  void fit()
  // ResizeObserver 開始觀察時會先回呼一次，剛好涵蓋「彈層打開後寬度才確定」的情況
  ro = new ResizeObserver(() => void fit())
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => props.path, () => void fit())
</script>

<template>
  <span ref="el">{{ text }}</span>
</template>
