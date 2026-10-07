<script setup lang="ts">
import { ref, watch } from 'vue'
import { nowLocalInput, parseLooseDateTime, toDisplayInput } from '@/lib/date'

/**
 * 日期時間欄：**普通的文字框** ＋ 一顆日曆鈕。
 *
 * 為什麼不是 `<input type="datetime-local">`：
 *   1. 手機上點到它就會直接彈出系統的日期滾輪（iPhone 的 PWA 尤其明顯），
 *      只是想把游標移到下一個欄位也會被攔下來。這裡改成「平常就是文字框，
 *      只有按下日曆鈕才開選擇器」。
 *   2. Safari 會把原生日期輸入框拆成好幾個 shadow DOM 小欄位、各自帶 padding，
 *      整個框就是比旁邊的備註框高一點，怎麼調都對不齊。文字框沒有這個問題。
 *
 * 打字一樣可以用（見 lib/date 的 parseLooseDateTime）：`2026/10/7 20:53`、
 * `10/7`、`20:53` 都看得懂；打完離開欄位才解析，看不懂就還原成原值。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

/** 欄位裡顯示的文字（使用者邊打邊改的就是它） */
const text = ref(toDisplayInput(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    // 外部的值變了（換了一筆記錄、按了「設為現在」、送出後歸零）才跟著換；
    // 使用者打字時只改 text，不會走到這裡。
    text.value = toDisplayInput(v)
  },
)

function onType(e: Event) {
  text.value = (e.target as HTMLInputElement).value
}

/**
 * 離開欄位（或按 Enter）才解析。
 * ⚠ 一定要在 blur 就做：使用者打完日期常常直接去按「記錄」／「儲存」，
 *   那時先發生的就是 blur，不趁現在提交的話會存到舊的值。
 */
function commit() {
  const next = parseLooseDateTime(text.value, props.modelValue)
  if (!next) {
    text.value = toDisplayInput(props.modelValue) // 看不懂 → 還原，不留怪東西
    return
  }
  text.value = toDisplayInput(next) // 順手正規化（`10/7` → `2026/10/07 20:53`）
  if (next !== props.modelValue) emit('update:modelValue', next)
}

/** 原生選擇器送進來的新值 */
function onPicked(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v) emit('update:modelValue', v)
  else text.value = toDisplayInput(props.modelValue)
}

/** 一鍵帶入「當前」的日期時間 */
function setNow() {
  emit('update:modelValue', nowLocalInput())
}
</script>

<template>
  <div class="dt">
    <input
      class="field dt__in"
      type="text"
      autocomplete="off"
      enterkeyhint="done"
      :value="text"
      @input="onType"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />

    <!-- 日曆鈕。
         ⚠ 真正接到手指的不是這顆鈕，而是蓋在它上面的「透明原生 datetime-local」——
           指尖直接落在原生輸入框上，系統就會用「使用者真的按了日期框」的方式
           打開選擇器。這比 `showPicker()` 可靠（iOS 上那個支援度反覆）。 -->
    <span class="dt__btn dt__pick">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.6" y="5" width="16.8" height="15.4" rx="2.6" />
        <path d="M3.6 9.6h16.8M8 3.4v3.2M16 3.4v3.2" />
      </svg>
      <input
        class="dt__native"
        type="datetime-local"
        aria-label="選擇日期時間"
        :value="modelValue"
        @change="onPicked"
      />
    </span>

    <button class="dt__now" type="button" title="設為現在" aria-label="設為現在的日期時間" @click="setNow">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7.3v5.1l3.2 1.9" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.dt {
  position: relative;
  min-width: 0;
}
/* 右側留白要同時讓開兩顆鈕（日曆＋現在），數字跟備註欄那排一樣：
   兩顆 26px 的鈕分別貼齊右緣 5px 與 34px → 留 72px。
   這樣「備註」與「日期」兩列的內嵌小鈕會剛好在同一條垂直線上。 */
.dt__in {
  min-width: 0;
  padding-right: 72px;
}
/* 兩顆小鈕共用的外觀（尺寸與備註欄的清空鈕一致） */
.dt__btn,
.dt__now {
  position: absolute;
  top: 50%;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  transform: translateY(-50%);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  transition:
    background 0.12s,
    color 0.12s,
    transform 0.06s;
}
.dt__btn:hover,
.dt__now:hover {
  background: var(--accent);
  color: #fff;
}
.dt__now:active {
  transform: translateY(-50%) scale(0.94);
}
.dt__btn svg,
.dt__now svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 日曆鈕在左邊那一格、時鐘鈕在右邊那一格（與備註欄的「快速備註 / 清空」同一欄） */
.dt__pick {
  right: 34px;
  /**
   * ⚠⚠ 一定要裁掉溢出：Safari 會把原生 datetime-local 拆成多個自帶內距的
   *    shadow DOM 欄位（年／月／日／時／分），那些欄位有各自的最小寬度，
   *    加起來遠超過這顆 26px 的鈕 → 內容往右溢出。它是 opacity:0，畫面上看不出來，
   *    但**溢出照樣把整頁撐寬** → 使用者往左滑就看到一大片空白（iPhone PWA 實測）。
   *    裁在鈕上就從根上不會發生。（DateField.vue 的 .df__pick 有一模一樣的一條。）
   */
  overflow: hidden;
}
.dt__now {
  right: 5px;
}
/* 圖示只是背景，不要擋到下面那層原生輸入框 */
.dt__btn svg {
  pointer-events: none;
}
/**
 * 透明的原生選擇器：鋪滿整顆鈕（還往外多一點，比較好按）。
 *
 * ⚠ 一定要讓它「收得到手指」：不能用 display:none／visibility:hidden／
 *   pointer-events:none，那三種都會讓它收不到點擊，等於這顆鈕壞掉。
 *   用 opacity: 0 才是「看不見但按得到」。
 * ⚠ font-size 必須 ≥ 16px：iOS 聚焦到字太小的輸入框時會把整頁放大（zoom in）。
 */
.dt__native {
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
