import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

/** 是否已可完全離線使用（Service Worker 安裝完成） */
export const offlineReady = ref(false)
/** 是否有新版本待套用 */
export const needRefresh = ref(false)
/** 是否正在瀏覽器以 PWA 模式執行 */
export const isStandalone = ref(false)

function checkStandalone() {
  isStandalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}
checkStandalone()

export const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    offlineReady.value = true
  },
  onNeedRefresh() {
    needRefresh.value = true
  },
  onRegistered() {
    checkStandalone()
  },
})
