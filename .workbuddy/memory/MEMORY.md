# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（**本機沒有 E: 槽**，舊筆記的 `E:\AI`、`E:\wb-tmp` 全部作廢），
分支 `main`。**所有指令都在這個目錄下跑。**

> 📎 分類階層、記帳頁／彈窗、通知、樣式與各項踩坑細節 → **同目錄的 `CONVENTIONS.md`**（要用時再讀）

## 版本號

- `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.24`
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
  - **維護中的回歸集＝v70～v103**；`v45/v46/v56/v57` 早已失效，別當基準
  - 改到計算機／彈窗／通知／記錄頁／設定頁匯出／錢包時另外跑 **v82~v99**（計算機 11 位／算式／
    SweetAlert2／最近檢視／按鍵快按／快速備註／收據圖片貼上／收據圖片放大拖曳／
    統計頁自訂日期框／分類第一列不塞子分類／日期欄＝普通文字框＋下拉關閉明細／
    算式不留空格／記錄頁檢視＋篩選兩列排版／記錄頁搜尋框縮小＋放大鏡可見／
    統計頁自訂從到日期列填滿不跑位／記帳頁收據圖片區塊／設定頁匯出彈窗（JSON＋Excel）／
    **錢包（多帳本）**）
  - **v100（42 項）＝日期輸入框約定 ＋ iOS 貼上 ＋ 向左滑空白 ＋ Toast「知道了」的守門員**
  - **v101（51 項）＝0.1.22 六需求的守門員**（徽章「圖」／計算公式位置／圖片去重兩層／
    摘要卡詳情／預設分類／彈窗鎖背景）
  - **v102（30 項）＝「連點空白頁面不能動」的守門員**（body 幾何 ＋ 捲動不動 ＋ 連點防護設定）
  - **v103（84 項）＝0.1.24 的守門員**（資料統計分本錢包／總資料 ＋ 匯出可選錢包範圍，
    含「Excel × 全部錢包＝同一個 ZIP 內每個錢包各一份 xlsx」）。**動到匯出或資料統計時必跑**
  - ⚠ **動到錢包／記錄／設定的存取時，v99 是守門員**（遷移、隔離、匯出匯入都在那）；
    **動到圖片／放大檢視／剪貼簿時，v77（收據壓縮）與 v89（明細放大後可拖曳）是守門員**；
    **動到明細的算式顯示時，v83 與 v93 會紅**（它們抓 `.sheet .expr__v`，
    0.1.22 把算式從金額底下移到「詳細資訊」了）
  - ⚠⚠ **測試種多錢包資料時，`mop-ledger.wallets.v1` 要寫成 `{ wallets, activeWalletId }`，
    不是裸陣列**（裸陣列會被 `loadRoot` 當成「沒存過」→ 走遷移 → 只剩 1 個錢包）
  - ⚠⚠ **測試裡 `indexedDB.deleteDatabase` 一定要在「App 重新載入後」才呼叫**：
    App 一載入就握著 `mop-ledger-images` 連線 → 請求卡在 `blocked` 永不完成
    → **整支測試掛死（零輸出、被 SIGTERM）**。順序：`goto` → `localStorage.clear()`
    → `reload` → `deleteDatabase` → `reload` → 種資料
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

- **錢包（0.1.20 起）**：設定頁最上方可切換，**每個錢包有自己的一整套記錄＋設定**
  （分類／匯率／幣別／常用備註都跟著錢包走）。切換＝換一本帳。
  - 存法：錢包清單 `mop-ledger.wallets.v1`；**每錢包設定各自一鍵** `mop-ledger.setting.<id>.v1`；
    記錄仍是單一鍵 `mop-ledger.records.v1`，每筆蓋 `walletId`
  - 預設錢包 id 固定 `w_default`（`lib/wallets.ts` 的 `DEFAULT_WALLET_ID`）——
    舊記錄遷移時補的就是它，**不能改成每次 `uid()`**，否則對不到
  - ⚠ store 對外的 `records` 是 computed（只含當前錢包）；內部 `all` 才是全部。
    **圖片去重與「還有誰在用這張圖」一律看 `all`**（圖檔 blob 跨錢包共用）
  - ⚠ settings store 的 `state` ＝「當前錢包」的設定，形狀與單錢包時代相同
  - ⚠ **「初始化時改資料要自己寫回去」**：store 初始化階段的修改（遷移）發生在
    watcher 掛上之前，且非 immediate 的 watcher 不會因「初始值」而跑 →
    兩個真 bug 都是這樣來的（WALLETS_KEY 沒落地、records 沒補 walletId）
  - ⚠ **「有記錄不給刪錢包」擋在 WalletSection 元件**，不是 store
    （settings↔records 互相 import 會循環）

- **匯出**：設定頁 → 彈窗選格式（JSON／Excel）與範圍。
  **JSON＝format 2，全部錢包＋各自設定的完整備份**（v1 舊檔仍可匯入）；
  **Excel＝只含當前錢包記錄的 .zip（xlsx + `images/`，不含任何設定）**。
  兩種格式的 ZIP 與 XLSX 都是**自己寫的**（`lib/zip.ts`／`lib/xlsx.ts`，零依賴）→
  ⚠ 動到那裡之前先讀 `CONVENTIONS.md` 的「匯出（JSON ╱ Excel）」那節（有一堆一錯就檔案損毀的雷）

- localStorage `mop-ledger.{wallets,setting.<id>,records,draft}`；
  `mop-ledger.settings.v1` 是**單錢包時代的舊鍵，刻意不刪**（遷移保險）；
  收據原圖在 IndexedDB（`idb-keyval`，跨錢包共用）
- 分類 `{ id, name, type, color, icon?, builtin, archived, parentId? }`；
  舊資料載入時 `withIcons()` 補 icon 並回寫

## ⚠⚠ 全站約定：`body` 一律 `min-height`，不要 `height: 100%`（0.1.23 起永久適用）

> 使用者原話：「在 pwa (IPHONE) 的所有頁面中，用戶連點空白的地方，頁面會向上滑
> （不需要向上滑, 要無論怎樣點都保持不動）」

- `src/style.css`：`html { height: 100% }`（捲動容器）＋ **`body { min-height: 100% }`**
- 原因：`body { height: 100% }` 會把 body 盒子釘死在視窗高，但內容遠比視窗高
  （記錄 3406／統計 2611／設定 3261 px）→ 盒子比內容短；iOS 點畫面時那輪
  「對齊到可視範圍」就會把文件往上推 → 連點一直往上跑
- ⚠ **改版時千萬不要把它改回 `height: 100%`**
- 驗法看**幾何關係**（`body` 盒子高 ≥ `documentElement.scrollHeight`），
  不是看 computed px（844 視窗下兩者可能同值，分不出來）
- 連點防護別拆：`html { touch-action: manipulation }`、
  `button/a/[role=button] { -webkit-touch-callout: none; user-select: none }`、
  `body { overscroll-behavior-y: none }`
- 細節 → `CONVENTIONS.md` 的「body 一律用 min-height」

## ⚠⚠ 全站約定：日期輸入框（0.1.21 起，含未來所有新畫面）

> 使用者原話：「**所有日期的輸入框都是純文字輸入，用戶要按右手邊的按鈕才會彈出
> 日期時間的選擇器，請修正現在的所有日期選擇框和未來的也要這樣**」

- **永遠不要**把 `<input type="date">` / `type="datetime-local"` 當成畫面上可見的輸入框
- 只要日期 → `components/DateField.vue`；日期＋時間 → `components/DateTimeField.vue`
  （兩者都是「純文字框 ＋ 右邊按鈕」，按鈕底下才是透明的原生 picker）
- 承接原生 picker 的鈕要 `overflow: hidden`（Safari 的 shadow DOM 子欄位會撐寬整頁
  → 往左滑出現一大片空白）；原生 input 與可見文字框都要 `font-size: 16px`（<16px 被
  iOS 聚焦放大，一樣會把整頁撐寬）
- 細節與三條硬性 CSS 規則 → `CONVENTIONS.md` 的「日期輸入框（全站約定，0.1.21 起永久適用）」

## ⚠⚠ 全站約定：彈窗／子頁面開著時背景不能滑動（0.1.22 起，含未來所有新畫面）

> 使用者原話：「**用戶在滾動時，背景不能滑動，請把這個記憶，任何子頁面滾動時，
> 背景都不能滑動**」

- 任何 `position: fixed` 的全螢幕彈窗／子頁面，一律接 `composables/useScrollLock.ts`：
  `useScrollLock(toRef(props,'open'), { scrollable: () => 內容區 })`
- ⚠⚠ **`scrollable` 幾乎都要給**：不給的話 document 的 `touchmove` preventDefault
  會連內容一起擋住，iOS 上整個卡住滑不動。指的要是**真正 overflow 的那一層**
- 內容區再加 `overscroll-behavior: contain`（捲到底不連鎖帶動背景）
- 目前已接：`CalcSheet`／`CategorySheet`／`CategoryManageModal`（0.1.22 補）／
  `ExportModal`／`RecordSheet`／`SumDetailSheet`
- 細節 → `CONVENTIONS.md` 的「彈窗／子頁面開著時，背景一律不能滑動（全站約定，0.1.22 起永久適用）」

## 記帳頁預設分類（0.1.22）

- `settings.defaultCategoryId`（單一 id，每個錢包各自一份）
- **與主頁 `favoriteCategories`（常用分類）完全獨立**：常用分類管主頁顯示哪幾顆按鈕，
  預設分類管記帳頁一打開選中哪一個；設定預設分類**不會**動到常用分類
- 入口在 `CategoryManageModal.vue` 的「記帳預設」：編輯＝切換鈕（emit `set-default`，
  空字串取消）；新增＝勾選框 `makeDefault`（id 要等 `create` 才知道，由
  `SettingsView.onCreateCat` 補設）→ ⚠ 兩者要用 `v-if/v-else` 互斥
- 已封存分類不能當預設；`HomeView.pickInitialCategory()` 負責開頁預選、`resetCategory()` 負責記完一筆後重置

## 匯出的「錢包範圍」（0.1.24）

- `ExportModal.vue` 的 `scope: 'wallet' | 'all'`（**預設 `'all'`＝維持舊行為**）
- `pool` computed 現在**看 scope 而不是看 format**：
  `scope==='all' ? records.all : records.records`
  （0.1.23 以前是「JSON→全部、Excel→當前」，0.1.24 起兩者都能選）
- 四種組合：JSON×本錢包（單錢包備份，可還原）／JSON×全部錢包（完整備份）／
  Excel×本錢包／**Excel×全部錢包（同一個 ZIP、每個錢包各一份 xlsx）**
- `lib/exportExcel.ts`：入口是 `buildExcelExport({ groups: ExcelWalletGroup[], zipName? })`
  - `ExcelWalletGroup` **每個錢包自帶 `pathNamesOf` 與 `baseCurrency`**
    （各錢包的分類樹／主幣別是分開的，不能共用當前錢包那份）
  - ⚠ **單錢包 xlsx 檔名沿用舊行為 `ledger-….xlsx`；多錢包才改成 `<錢包名>-….xlsx`**
    （改了會讓 v98 紅）
  - ⚠ 圖檔名 `images/<錢包名>_<日期>_<分類>_<金額>_<序號>.<ext>`；
    **`pathByImage` 是全域的（跨錢包共用的圖只寫一份），`pathsByWallet` 只是各錢包自己的對照表**
  - `ExcelWalletGroup.name` 會進檔名 → 已經過 `safePart()` 清乾淨
- **Excel 一律不含任何設定**（分類樹／匯率／常用備註…），只有分類**名稱**是拿來顯示的

## 資料統計的兩種圖片數（0.1.24）

- 設定頁「資料」分兩組：**本錢包**／**總資料（含所有錢包）**
- 本錢包圖片數＝`records.records` 用到的張數；總資料＝`records.all` 的**聯集張數**
- ⚠ 圖檔 blob 跨錢包共用 → **總張數 ≠ 各錢包相加**，UI 有一行說明
- 空間：本錢包＝`walletUsageBytes(id, share)`（設定鍵整份 ＋ 記錄鍵按筆數比例分攤）；
  總資料＝`usageBytes()` 真實總量（**兩者不會剛好相加**）

## 視覺基調

米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）；
字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`），不用漸層／玻璃擬態。
