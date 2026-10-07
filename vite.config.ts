import { defineConfig } from 'vite'
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

export default defineConfig({
  base: resolveBase(),
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    vue(),
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
