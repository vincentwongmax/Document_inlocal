import { ref } from 'vue'

/**
 * 0.1.78（需求 3）：App 圖示（PWA icon）選擇。
 *
 * 使用者原話：
 *   「建立多兩種不同的 app ICON（共3款，新兩個，舊1个）…在設定頁中增加一個欄塊，
 *     可以給用戶選擇不同的 app icon（預設是舊 icon），
 *     這樣用戶可以在建立 pwa（iphone）時可以有不同的 app icon」
 *
 * 三款（圖示由 `scripts/gen-icons.mjs` 產生，見該檔的設計說明）：
 *   - classic（舊／預設）：`public/icons/icon-*.png`（0.1.77 之前的墨底收據）
 *   - ink（墨夜）：`public/icons/ink/icon-*.png`
 *   - blaze（烈橘）：`public/icons/blaze/icon-*.png`
 *
 * 怎麼讓 iPhone 真的換到圖示：
 *   iOS 的「加入主畫面」是**當下**讀 `<link rel="apple-touch-icon">` 的網址去抓圖，
 *   所以只要在加入之前把 href 指到選定款式的檔案就生效（每一款網址不同，
 *   也不會互相踩到快取）。Android 的安裝則是讀 manifest → 所以 manifest 的
 *   `<link>` 也要一起換（manifest-ink／manifest-blaze.webmanifest，
 *   裡面的 icon 路徑是相對的，跟著 manifest 自己的位置解析）。
 *   ⚠ 已經加入過主畫面的不會自動換（iOS 限制）——要移除後重新加入。
 *
 * ⚠ 選擇是 **App 層級**的（不隨錢包）：存 localStorage，開機時由 App.vue 套用。
 */

export type AppIconKey = 'classic' | 'ink' | 'blaze'

const STORE_KEY = 'mop-ledger.ui.appIcon.v1'

export const APP_ICON_OPTIONS: { key: AppIconKey; label: string; desc: string }[] = [
  { key: 'classic', label: '經典', desc: '墨底收據（原本的圖示）' },
  { key: 'ink', label: '墨夜', desc: '近黑底＋奶油統計圓' },
  { key: 'blaze', label: '烈橘', desc: '鮮橘底＋粗造形上箭頭' },
]

function isKey(v: unknown): v is AppIconKey {
  return v === 'classic' || v === 'ink' || v === 'blaze'
}

/** 目前選定的圖示（預設 classic＝舊 icon）；storage 讀不到時也用預設 */
export function currentAppIcon(): AppIconKey {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (isKey(v)) return v
  } catch {
    /* 無痕模式／storage 被禁用 → 用預設 */
  }
  return 'classic'
}

/** 圖檔網址。⚠ 一定要帶 BASE_URL：GitHub Pages 是子路徑部署，不帶會 404 */
export function appIconUrl(key: AppIconKey, file = 'icon-192.png'): string {
  const dir = key === 'classic' ? '' : `${key}/`
  return `${import.meta.env.BASE_URL}icons/${dir}${file}`
}

/** 設定頁預覽用的 reactive 目前值（給 Vue 模板綁定） */
export const appIcon = ref<AppIconKey>(currentAppIcon())

/** 選定並**立刻套用**（寫 localStorage ＋ 改 <link>）；回傳是否真的換了 */
export function setAppIcon(key: AppIconKey): boolean {
  if (!isKey(key) || key === appIcon.value) return false
  try {
    localStorage.setItem(STORE_KEY, key)
  } catch {
    /* 寫不進去也讓這次開啟生效（記憶體那份已經換了） */
  }
  appIcon.value = key
  applyAppIcon(key)
  return true
}

/** 改某個 <link> 的 href（不存在就略過——dev 模式可能沒有 manifest 那條） */
function setLinkHref(rel: string, href: string) {
  document.head.querySelector(`link[rel="${rel}"]`)?.setAttribute('href', href)
}

/**
 * 建置時注入的 manifest 網址（classic 專用）。
 * ⚠ 一定要在模組載入時就記下來：此刻 index.html 的 `<link rel="manifest">`
 *   還是原本那一份（vite-plugin-pwa 注入的 `manifest.webmanifest`）。
 *   ⚠ 為什麼需要它：ink／blaze 會把這條 link 換掉，若使用者之後切回 classic，
 *     不還原的話 manifest 還指著 ink／blaze → Android 安裝到的會是舊選擇的圖示。
 *     （apple-touch-icon 每次都重設，所以 iPhone 不受影響；manifest 要手動還原。）
 */
const ORIGINAL_MANIFEST_HREF: string | null =
  typeof document !== 'undefined'
    ? (document.head.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null)
    : null

/**
 * 把選定的圖示套到 <head> 上（App 啟動時跑一次；切換時也會跑）。
 *
 * - iOS「加入主畫面」當下讀 `<link rel="apple-touch-icon">` → 每款都重設
 * - Android／桌機安裝讀 manifest → ink／blaze 換成 public/ 裡對應的 webmanifest
 *   （路徑相對，base 由這裡補）；classic 還原成建置時注入的那一份
 *   （內容就是經典圖示，見 ORIGINAL_MANIFEST_HREF 的說明）
 */
export function applyAppIcon(key: AppIconKey = currentAppIcon()) {
  if (!isKey(key)) key = 'classic'
  appIcon.value = key
  // iOS「加入主畫面」讀的是這一條
  setLinkHref('apple-touch-icon', appIconUrl(key))
  // Android／桌機安裝讀的是 manifest
  if (key === 'classic') {
    if (ORIGINAL_MANIFEST_HREF) setLinkHref('manifest', ORIGINAL_MANIFEST_HREF)
  } else {
    setLinkHref('manifest', `${import.meta.env.BASE_URL}manifest-${key}.webmanifest`)
  }
}
