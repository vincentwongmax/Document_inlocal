# 記帳本 · mop-ledger

極速記帳、離線收據辨識、清楚掌握收支趨勢的個人記帳 PWA。
純前端、資料只存在你自己的瀏覽器（`localStorage` + `IndexedDB`），不上傳任何伺服器。

- Vue 3 + TypeScript + Pinia + vue-router（hash routing）
- Vite + vite-plugin-pwa（可加到手機主畫面、完全離線可用）
- 收據 OCR 用 tesseract.js，語言包與 wasm 核心由 Service Worker 預快取

## 線上版本

<https://vincentwongmax.github.io/Document_inlocal/>

> 手機用 Chrome / Safari 開啟後可「加到主畫面」，離線也能記帳。

## 本機開發

```bash
npm install
npm run dev        # http://localhost:5173/ 改程式即時熱更新
```

平常使用（服務已建置好的 `dist/`）：

```bash
npm run build      # 會先下載 OCR 語言包，再 vue-tsc 檢查、vite build
npm run preview    # http://localhost:4173/
```

其他指令：`npm run typecheck`、`npm run prepare:assets`。

## 部署到 GitHub Pages

推上 `main` 就會自動建置並部署，流程定義在 `.github/workflows/deploy.yml`
（⚠️ 目前因帳號 billing 被鎖而無法執行，見本節末說明）：

1. `npm ci` → `npm run build`
2. 把 `dist/` 的內容**強制推送**到 `gh-pages` 分支（不需要 Pages 的 Actions API）

首次使用請到 **Settings → Pages** 把 **Source** 設成 **Deploy from a branch**、
分支選 **`gh-pages`** / **`/ (root)`**。

`gh-pages` 這個分支**只有建置產物**（`dist/` 的內容），由 workflow 每次覆蓋推送，
平常不用手動碰它。分支根目錄帶 `.nojekyll`，避免 GitHub Pages 用 Jekyll 處理而漏掉
底線開頭的檔案。

要手動部署一次也可以（例如 Actions 掛掉時）：

```bash
GH_TOKEN=ghp_xxx npm run deploy
```

`npm run deploy`（`scripts/deploy-gh-pages.mjs`）會用正確的 base 建置到**專案外的臨時目錄**
再把內容強制推到 `gh-pages`，所以不會動到 `dist/`、也不會讓本機 `npm run preview` 白畫面。
`GH_TOKEN` 需要 classic PAT 的 `repo` 權限（或 fine-grained 的 Contents: Read and write）。

> ⚠️ **2026-10-05 起 `deploy.yml` 這個 workflow 一直失敗，原因與程式無關**：GitHub 帳號被
> billing 問題鎖住，runner 根本沒被分配。失敗訊息是
> `The job was not started because your account is locked due to a billing issue.`
> （特徵：job 只跑 ~2 秒、`steps: []`、`runner_id: 0`）。
> 到 <https://github.com/settings/billing> 處理完畢後 workflow 就會自己恢復。
> 在那之前，**用上面的 `npm run deploy` 手動部署**（Pages 的 legacy 建置不受影響，
> 推上去照樣會成功上線）。

`vite.config.ts` 會依 `GITHUB_REPOSITORY` 自動決定 `base`：

| 站台 | base |
| --- | --- |
| 專案站台 `https://<user>.github.io/<repo>/` | `/<repo>/` |
| 使用者站台 `<user>.github.io` | `/` |
| 本機 dev / preview | `/`（可用 `VITE_BASE` 覆寫） |

因為用的是 hash routing，重新整理任何頁面都不會 404，不需要額外的 404.html。

## 注意事項

- **資料是「每個網址各自一份」**：`localhost:4173`、`localhost:5173` 與 GitHub Pages 的
  `localStorage` 互相獨立。上線後第一次打開會是空帳本。
  想搬資料可用設定頁的匯出／匯入功能。
- OCR 語言包（`public/tessdata/`、`public/tesseract-core/`，約 19MB）**沒有進版控**，
  由 `npm run build` 自動下載／複製，所以 CI 需要對外網路。
- 這是 PWA，部署新版後若畫面看起來還是舊的，按 **Ctrl+Shift+R** 硬重新整理即可。
