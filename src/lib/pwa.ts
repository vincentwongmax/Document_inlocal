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

/**
 * 0.1.60：主動請求「持久化儲存」（`navigator.storage.persist()`）。
 *
 * 使用者原話：「請檢查，確保用戶在 PWA 模式(iphone)下，只要第一次連線後，之後永久可以
 * 離線使用，即使超過7天，14天等等以上沒網路，都不會出現訪問不到應用程序」。
 *
 * 離線能力有兩道防線，這裡補的是第二道：
 *  ① **iOS 主畫面 PWA 本來就豁免** Safari 的「7 天無互動就清掉腳本儲存」規則
 *     （WebKit 明文：home screen web applications 的 first-party domain
 *      不受 ITP 7-day cap 管）——所以加到主畫面、第一次連線過，之後 14 天、30 天
 *     沒網路照樣開得起來，SW／localStorage／IndexedDB 都還在。
 *  ② **儲存壓力驅逐**是另一回事：裝置空間緊張時瀏覽器仍可能清掉快取。
 *     `persist()` 就是請瀏覽器「這個 origin 的儲存別當可回收的 cache」——
 *     支援的瀏覽器（Chrome／Edge／Firefox）會記住這個偏好；iOS Safari 不支援
 *     → 呼叫不存在時靜默跳過（no-op），不會報錯。
 *
 * ⚠ 開機時 fire-and-forget：不 await、不擋啟動、失敗靜默。
 */
function requestPersistentStorage() {
  const storage = navigator.storage
  if (!storage?.persist) return
  void storage
    .persist()
    .then((granted) => {
      if (import.meta.env.DEV) {
        console.info('[pwa] 持久化儲存：', granted ? '已授予' : '瀏覽器未授予（仍可離線，只是空間緊張時可能被回收）')
      }
    })
    .catch(() => {})
}
requestPersistentStorage()
