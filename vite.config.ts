import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

/**
 * 前端要顯示的版本號：唯一來源就是 package.json 的 `version`，
 * 由下面的 `define` 注入成編譯期常數 `__APP_VERSION__`（型別宣告在 env.d.ts）。
 * 這樣設定頁不必自己再維護一份版本字串，也就永遠不會跟 package.json 走鐘。
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

/**
 * 部署到 GitHub Pages 時的 base（資源路徑前綴）：
 *  - 專案站台 `https://<user>.github.io/<repo>/` → `/<repo>/`
 *  - 使用者站台 `<user>.github.io` → `/`
 * 在 GitHub Actions 裡由 GITHUB_REPOSITORY 自動判斷；本機開發／預覽一律 `/`，
 * 也可用環境變數 VITE_BASE 手動覆寫（例如部署到自訂網域時給 `/`）。
 */
function resolveBase(): string {
  if (process.env.VITE_BASE) return process.env.VITE_BASE
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (process.env.GITHUB_ACTIONS && repo) {
    return repo.endsWith('.github.io') ? '/' : `/${repo}/`
  }
  return '/'
}

/**
 * 0.1.52：建置時產生 `version.json`（版本檢查檔）。
 *
 * 使用者原話：「用戶檢查更新時，可以在 github 中建立一個版本的 File（這個 FILE 必備每次打開
 * 都馬上更新、不受快取影響）…平時用戶網頁必須要離線使用的」。
 *
 * 所以：
 *  - 這個檔**只放版本號與建置時間**，由 `package.json` 的 version 產生（唯一來源，不會走鐘）
 *  - 前端抓它時帶 `?t=時間戳` 且 `cache: 'no-store'` → 一定走網路，不受 HTTP／Service Worker 快取影響
 *  - ⚠ workbox 的 `globPatterns` 有 `json`，所以**必須**用 `globIgnores` 把 version.json
 *    排除在預快取之外——被預快取的話就永遠拿到舊的那份，「不受快取影響」就破功了
 *  - 其餘資源照舊預快取，App 平時仍然完全離線可用
 */
function versionFilePlugin(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  base: resolveBase(),
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    vue(),
    versionFilePlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: '記帳本',
        short_name: '記帳本',
        description: '極速記帳、離線收據辨識、清楚掌握收支趨勢',
        lang: 'zh-Hant',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f5f2',
        theme_color: '#f6f5f2',
        categories: ['finance', 'productivity'],
        icons: [
          { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: './icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // 語言包與 wasm 核心也一併預快取，確保離線可 OCR
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,gz,wasm}'],
        // ⚠ 0.1.52：version.json 是「檢查更新」用的，**絕不能被預快取**
        //   （被快取就永遠拿到舊版本號）；它只走網路，其餘資源照舊可離線
        globIgnores: ['**/version.json'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // 不比對開頭的 `/`：部署在 GitHub Pages 子路徑時 pathname 會是
        // `/＜repo＞/tessdata/...`，錨定 `^\/` 會失效而讓語言包被當成導覽請求
        navigateFallbackDenylist: [/\/tessdata\//, /\/tesseract-core\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    emptyOutDir: false, // 由 scripts/clean.mjs 負責清理
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('tesseract.js')) return 'ocr'
          if (id.includes('chart.js')) return 'chart'
          if (id.includes('sweetalert2')) return 'sweetalert'
          if (id.includes('node_modules/vue')) return 'vue'
        },
      },
    },
  },
  // tesseract.js 的 main 指向 CommonJS（src/index.js）且沒有 exports/module 欄位。
  // 若把它 exclude 掉，dev server 會把 CJS 當 ESM 直接送出，瀏覽器就會報
  // "does not provide an export named 'createWorker'" 而整個 App 白屏。
  // 交給 esbuild 預打包（CJS→ESM interop）即可正常運作。
  optimizeDeps: { include: ['tesseract.js'] },
})
