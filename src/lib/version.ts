/**
 * App 版本號。
 *
 * 單一來源是 `package.json` 的 `version`，由 `vite.config.ts` 的 `define`
 * 在編譯期注入（型別宣告見根目錄 `env.d.ts`）。設定頁顯示的、以及
 * `CHANGELOG.md` 記錄的，都是這一個值，不需要另外同步。
 *
 * 更新慣例：預設只加 patch（`X.Y.Z` 的 Z）；使用者明說「升級 X」或
 * 「升級 Y」時才動 major／minor。
 */
export const APP_VERSION: string = __APP_VERSION__
