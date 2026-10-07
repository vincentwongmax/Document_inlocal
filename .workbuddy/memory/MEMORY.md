# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（**本機沒有 E: 槽**，舊筆記的 `E:\AI`、`E:\wb-tmp` 全部作廢），
分支 `main`。**所有指令都在這個目錄下跑。**

> 📎 分類階層、記帳頁／彈窗、通知、樣式與各項踩坑細節 → **同目錄的 `CONVENTIONS.md`**（要用時再讀）

## 版本號

- `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.19`
- 單一來源＝`package.json` 的 `version` → `vite.config.ts` `define` 注入 `__APP_VERSION__`
  （型別在 `env.d.ts`）→ `src/lib/version.ts` → 設定頁「離線與版本」膠囊
- 每次更新要改 `package.json` ＋ 補一筆 `CHANGELOG.md`

## 開發 / 驗證

- `npm run preview` → :4173（服務 `dist/`，改完要先 build）；`npm run dev` → :5173。
  兩埠 localStorage 分開，真資料只在其中一邊
- 流程：`npx vue-tsc --noEmit` → `npm run build` → `.smoke/vNN.mjs` → 截圖 → commit
  - 跑：`"/c/Users/User/.workbuddy/binaries/node/versions/22.22.2-6/node" .smoke/vNN.mjs`
    ⚠ **版本目錄會變**（用過 `22.22.2-3`、現在 `22.22.2-6`）→ 找不到就先
    `ls ~/.workbuddy/binaries/node/versions/` 挑當下的，或直接 `node`（已在 PATH）
    （別設 `TEMP=E:\wb-tmp`，沒 E: 槽會 mkdtemp ENOENT）
  - Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`；puppeteer-core 在
    `C:\Users\user\.workbuddy\binaries\node\workspace\`
  - ⚠ 斷言「跟某來源一致」要去**讀來源**（如 v79 讀 `package.json`），別寫死
  - ⚠⚠ **升版後一定要重新 `npm run build` 才能跑測試**：`__APP_VERSION__` 是編譯期注入的，
    `dist/` 沒重建 → v79（拿 `package.json` 對畫面版本號）必紅。這是「假紅燈」，不是程式壞
  - ⚠ **node 是 Windows binary**：curl 輸出要存到**專案內**（`.smoke/tmp/`），
    Git Bash 的 `/tmp` 讀不到
  - **維護中的回歸集＝v70～v80**；`v45/v46/v56/v57` 早已失效，別當基準
  - 改到計算機／彈窗／通知／記錄頁／設定頁匯出時另外跑 **v82~v98**（計算機 11 位／算式／SweetAlert2／
    最近檢視／按鍵快按／快速備註／收據圖片貼上／收據圖片放大拖曳／統計頁自訂日期框／
    分類第一列不塞子分類／日期欄＝普通文字框＋下拉關閉明細／算式不留空格／
    記錄頁檢視＋篩選兩列排版／記錄頁搜尋框縮小＋放大鏡可見／統計頁自訂從到日期列填滿不跑位／
    記帳頁收據圖片區塊／設定頁匯出彈窗（JSON＋Excel））
  - ⚠ **動到圖片／放大檢視／剪貼簿時，v77（收據壓縮）與 v89（明細放大後可拖曳）是守門員**，
    一定要跑（0.1.18 把明細的 lightbox 抽成共用件時就是靠它們證明沒改壞）
  - ⚠ **測試圖別用兩張「內容相同」的**：MD5 去重會擋掉第二張，多張上傳就測不到
  - ⚠ **測試用 `os.tmpdir()` 生暫存檔**（`fs.mkdtempSync`），別寫死 `/tmp`（Windows 讀不到）
  - ⚠⚠ **沙箱不允許 Node 開子行程**（`execFileSync`／`spawnSync` → `EBUSY`，連 `python -c` 都擋）
    → 要「換個實作再驗一次」的步驟得拆成 shell 腳本（例：`.smoke/v98-verify.sh`）
  - ⚠ **Node 直接 import `src/lib/*.ts` 會 ERR_MODULE_NOT_FOUND**（副檔名與 `@/` 別名只有 Vite 認得）
    → 要單獨試 lib 就先打包：見 `.smoke/run-probe.mjs`（`build({configFile:false, build:{ssr}})`，
    並用 `import { x } from '../src/lib/x'`，**從 `.smoke/` 出發是 `../` 不是 `../../`**）
  - ⚠ **Python 的管線輸出要 `PYTHONIOENCODING=utf-8`**，否則 Windows 用系統 codepage，中文被打成 `?`
    （別跑 `v73`：沒有 `v73.mjs`，只有 `v73-edge/-locale/...` 等變體）
  - ⚠⚠ **測試裡「等固定秒數」比想像中不可靠**：v84 用 `sleep(900)` 等 SweetAlert2 彈窗，
    慢的時候會量到「還沒渲染完的空彈窗」，變成偶發紅燈（約 1/10）。**要等狀態、不要等時間**
    → `waitForFunction(() => !!document.querySelector(目標))` 再 `sleep(400)` 緩衝
  - ⚠⚠ **`index.html` 有 Google Fonts 外鏈**，網路一抖 console 就噴 `ERR_NAME_NOT_RESOLVED`，
    害所有斷言「沒有 JS 錯誤」的測試偶發紅燈（跟程式無關）。已於**全部 82 支測試**插入
    `isRealErr()` 濾掉環境雜訊（`ENV_NOISE` regex）。**新測試要照抄這個 helper**，
    否則又會被環境雜訊干擾
- ⚠ **`npm install <pkg>` 會拔掉 `@esbuild/win32-x64`** → build 爆「needed by esbuild」。
  那是 esbuild 的 optionalDependencies（**不該**進 package.json）：把那行從 package.json
  刪掉再 `npm install` 就會裝回
- 沙箱：`reg.exe` 被擋、Bash 叫 powershell 被擋、個人目錄刪除被攔 → 回報使用者別硬刪
- `.smoke/`、`.deploy/` 已 gitignore；`CHANGELOG.md` 要進版控

## Git / 部署

- Repo `vincentwongmax/Document_inlocal`；Pages 來源＝ `gh-pages` 分支（`build_type: legacy`）；
  線上 `https://vincentwongmax.github.io/Document_inlocal/`
- ⚠ **只 commit 本機，不主動 push／部署**，要動遠端先問
- **沒有存起來的憑證**（無 `~/.ssh`／`~/.gitconfig`／GCM 條目），`git push` 會
  `could not read Username`。要用的 classic PAT（`repo, workflow`）從
  `~/.workbuddy/audit-log/*.jsonl` grep `ghp_`（**不要寫進任何檔案**）。
  ⚠ 別用 `git push --dry-run` 判斷有沒有憑證（一定失敗）
- ⚠ **Actions 自 2026-10-05 起全數失敗，與程式無關**：帳號被 billing 鎖住，runner 沒被分配
  → `The job was not started because your account is locked due to a billing issue.`
  - 特徵：job 只跑 ~2 秒、`steps: []`、`runner_id: 0`。**這形狀＝runner 沒起來**；
    jobs API 看不出原因，要讀 `GET /repos/{o}/{r}/check-runs/{id}/annotations`
  - 解法＝使用者去 <https://github.com/settings/billing>；在那之前 **push main 不會部署**
  - 但 **Pages 的 legacy 建置不受影響**（`pages build and deployment` 照樣 success）→
    手動部署完全可用：**`GH_TOKEN=… npm run deploy`**
- `scripts/deploy-gh-pages.mjs`：用正確 base 建到 `os.tmpdir()` 的**全新目錄**再 force push
  `gh-pages`，**不動 `dist/`**（動了 `npm run preview` 會白畫面）。
  ⚠ 別改回建到專案內 `.deploy/`（殘留舊 `.git` 會讓 Vite 清目錄被沙箱攔）
- ⚠ 部署版雜湊與本機 dist **不同**（`VITE_BASE` 會 inlined 進 bundle）→
  比對線上／本機要看「內容特徵」，不能對雜湊
- base 由 `resolveBase()` 自動判斷（`.github.io` 結尾→`/`，否則 `/<repo>/`；本機 `/`；
  `VITE_BASE` 可覆寫）。**不要在 workflow 裡設 base**
- PWA 看到舊版先 Ctrl+Shift+R／無痕；測試用全新 profile

## 資料

- **匯出**：設定頁 → 彈窗選格式（JSON／Excel）與範圍。
  JSON＝含設定的完整備份；**Excel＝只含記錄的 .zip（xlsx + `images/`，不含任何設定）**。
  兩種格式的 ZIP 與 XLSX 都是**自己寫的**（`lib/zip.ts`／`lib/xlsx.ts`，零依賴）→
  ⚠ 動到那裡之前先讀 `CONVENTIONS.md` 的「匯出（JSON ╱ Excel）」那節（有一堆一錯就檔案損毀的雷）

- localStorage `mop-ledger.{records,settings,draft}.v1`；收據原圖在 IndexedDB（`idb-keyval`）
- 分類 `{ id, name, type, color, icon?, builtin, archived }`；舊資料載入時 `withIcons()` 補 icon 並回寫

## 視覺基調

米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）；
字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`），不用漸層／玻璃擬態。
