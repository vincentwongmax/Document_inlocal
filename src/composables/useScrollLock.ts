import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 開啟彈窗時鎖住背景捲動。
 *
 * 這個專案沒有內層的捲動容器（`html, body { height: 100% }`，`.shell` 也不捲），
 * 所以捲動是發生在 documentElement 上；直接在它身上加 `is-locked`
 * （全域樣式在 src/style.css：`html.is-locked, html.is-locked body { overflow: hidden }`）。
 *
 * 用法：useScrollLock(toRef(props, 'open'))
 */
export function useScrollLock(open: Ref<boolean>) {
  watch(open, (v) => document.documentElement.classList.toggle('is-locked', v), {
    immediate: true,
  })
  onBeforeUnmount(() => {
    document.documentElement.classList.remove('is-locked')
  })
}
