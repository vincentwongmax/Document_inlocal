<script setup lang="ts">
import { ref, watch } from 'vue'
import { parseLooseDate, toDisplayDate } from '@/lib/date'

/**
 * 日期欄（只要日期、不要時間）：**普通的文字框** ＋ 右邊一顆日曆鈕。
 *
 * ⚠⚠ 全站約定（0.1.21 起）：**任何日期輸入框都必須是純文字框**，
 *    使用者按右邊的日曆鈕才彈出選擇器。不要再用 `<input type="date">` 直接放在畫面上：
 *      1. iOS（尤其 PWA）一碰到原生日期框就彈系統滾輪，只是想把游標移開也會被攔；
 *      2. Safari 會把它拆成多個 shadow DOM 小欄位，各自帶內距 → 高度對不齊、
 *         欄位還有自己的最小寬度，看不見的溢出會把整頁撐寬（見下面 `.df__pick` 的註解）。
 *    需要「日期＋時間」時用 `DateTimeField.vue`，兩邊的外觀與操作方式一致。
 *
 * 打字一樣可以用（見 lib/date 的 parseLooseDate）：`2026/10/7`、`10/7`、`20261007`
 * 都看得懂；打完離開欄位才解析，看不懂就還原成原值。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

/** 欄位裡顯示的文字（使用者邊打邊改的就是它） */
const text = ref(toDisplayDate(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    // 外部的值變了（按了預設區間、換了模式）才跟著換；使用者打字時只改 text。
    text.value = toDisplayDate(v)
  },
)

function onType(e: Event) {
  text.value = (e.target as HTMLInputElement).value
}

/** 離開欄位（或按 Enter）才解析；看不懂就還原，不留怪東西 */
function commit() {
  const next = parseLooseDate(text.value, props.modelValue)
  if (!next) {
    text.value = toDisplayDate(props.modelValue)
    return
  }
  text.value = toDisplayDate(next) // 順手正規化（`10/7` → `2026/10/07`）
  if (next !== props.modelValue) emit('update:modelValue', next)
}

/** 原生選擇器送進來的新值 */
function onPicked(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v) emit('update:modelValue', v)
  else text.value = toDisplayDate(props.modelValue)
}
</script>

<template>
  <div class="df">
    <input
      class="field df__in"
      type="text"
      autocomplete="off"
      enterkeyhint="done"
      :value="text"
      @input="onType"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />

    <!-- 日曆鈕。
         ⚠ 真正接到手指的不是這顆鈕，而是蓋在它上面的「透明原生 date」——
           指尖直接落在原生輸入框上，系統就會用「使用者真的按了日期框」的方式
           打開選擇器（比 showPicker() 可靠）。 -->
    <span class="df__pick">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.6" y="5" width="16.8" height="15.4" rx="2.6" />
        <path d="M3.6 9.6h16.8M8 3.4v3.2M16 3.4v3.2" />
      </svg>
      <input class="df__native" type="date" aria-label="選擇日期" :value="modelValue" @change="onPicked" />
    </span>
  </div>
</template>

<style scoped>
.df {
  position: relative;
  min-width: 0;
}
.df__in {
  min-width: 0;
  /* 右側留白讓開那一顆日曆鈕（26px 鈕貼齊右緣 5px → 留 38px） */
  padding-right: 38px;
}
.df__pick {
  position: absolute;
  top: 50%;
  right: 5px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  transform: translateY(-50%);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  /**
   * ⚠⚠ 一定要裁掉溢出：Safari 會把原生 date 拆成多個自帶內距的 shadow DOM 欄位，
   *    那些欄位有各自的最小寬度，加起來遠超過這顆 26px 的鈕 → 內容往右溢出。
   *    因為它是 opacity:0，畫面上看不出來，但**溢出照樣把整頁撐寬** →
   *    使用者往左滑就看到一大片空白。裁在鈕上就從根上不會發生。
   *    （DateTimeField.vue 的 .dt__pick 有一模一樣的一條，別漏。）
   */
  overflow: hidden;
  transition:
    background 0.12s,
    color 0.12s;
}
.df__pick:hover {
  background: var(--accent);
  color: #fff;
}
.df__pick svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* 圖示只是背景，不要擋到下面那層原生輸入框 */
  pointer-events: none;
}
/**
 * 透明的原生選擇器：鋪滿整顆鈕。
 * ⚠ 一定要讓它「收得到手指」：不能用 display:none／visibility:hidden／
 *   pointer-events:none，那三種都會讓它收不到點擊，等於這顆鈕壞掉。
 * ⚠ font-size 必須 ≥ 16px：iOS 聚焦到字太小的輸入框時會把整頁放大。
 */
.df__native {
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: -2px;
  right: -2px;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  font-size: 16px;
  cursor: pointer;
}
</style>
