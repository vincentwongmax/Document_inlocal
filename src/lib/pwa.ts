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

/**
 * 0.1.60：第一次連線就把 Google Fonts 主動塞進 Service Worker 快取。
 *
 * 為什麼需要這一層（runtimeCaching 不夠的時機）：
 *   - index.html 的 `<link rel=stylesheet href="fonts.googleapis.com...">` 是渲染阻塞的外部樣式；
 *     頁面第一次載入時 Service Worker 多半**還沒接管（controller === null）**，
 *     所以這一批字型請求直接走瀏覽器預設快取（HTTP disk cache），不會進 SW 快取。
 *   - 若使用者「只連線這一次」就離線 14 天，字型就只躺在 HTTP disk cache 裡——
 *     那層快取不保證持久（空間壓力下可能被回收），違反使用者「第一次連線後永久離線」的要求。
 *   - 解法：App 啟動、`serviceWorker.ready` 之後主動 fetch 字型樣式表與其 woff2，
 *     直接 `caches.put` 進 gf-stylesheets / gf-webfonts（與 vite.config 的 runtimeCaching
 *     同名快取），之後離線冷啟動由 SW 的 CacheFirst 直接命中，零網路等待、且持久。
 *
 * ⚠ 只在第一線上連線做一次：gf-webfonts 已有內容就跳過（避免每次開機都重新抓字型）。
 * ⚠ 離線或快取 API 不可用時靜默略過，不擋啟動、不報錯。
 */
const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap'

async function precacheGoogleFonts() {
  if (typeof caches === 'undefined') return
  if (!navigator.onLine) return
  try {
    const fontCache = await caches.open('gf-webfonts')
    // 已經有字型就跳過（只在第一線上連線做一次）
    if ((await fontCache.keys()).length > 0) return

    const cssRes = await fetch(FONT_CSS_URL)
    if (!cssRes.ok) return
    const cssText = await cssRes.text()

    // 樣式表本身也塞進 gf-stylesheets（opaque/no-cors 的 <link> 不一定會被 SW 攔到）
    const cssCache = await caches.open('gf-stylesheets')
    await cssCache.put(
      FONT_CSS_URL,
      new Response(cssText, { status: 200, headers: { 'Content-Type': 'text/css' } }),
    )

    // 抽出 woff2 網址並逐一下載進 gf-webfonts
    const urls = [...cssText.matchAll(/url\(\s*(https:\/\/[^)\s]+\.woff2)\s*\)/g)].map((m) => m[1])
    await Promise.all(
      urls.map(async (u) => {
        try {
          const r = await fetch(u)
          if (r.ok) await fontCache.put(u, r)
        } catch {
          /* 單一字型失敗不影響其他 */
        }
      }),
    )
  } catch {
    /* 離線 / 網路異常都靜默 */
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready
    .then(() => precacheGoogleFonts())
    .catch(() => {})
}
