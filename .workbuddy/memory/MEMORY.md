# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（**本機沒有 E: 槽**，舊筆記的 `E:\AI`、`E:\wb-tmp` 全作廢），
分支 `main`。**所有指令都在這個目錄下跑。**

> 📎 分類階層、記帳頁／彈窗、通知、樣式、各項踩坑與**測試常見殺手** →
> **同目錄的 `CONVENTIONS.md`**（要用時再讀；那裡才是完整版）

## 版本號

- `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.25`
- 單一來源＝`package.json` 的 `version` → `vite.config.ts` `define` 注入 `__APP_VERSION__`
  （型別在 `env.d.ts`）→ `src/lib/version.ts` → 設定頁「離線與版本」膠囊
- 每次更新要改 `package.json` ＋ 補一筆 `CHANGELOG.md`
  （⚠ CHANGELOG 實際順序是 0.1.24 → 0.1.23 → …，新的一筆插在最前面那個 `---` 之後）

## 開發 / 驗證

- `npm run preview` → :4173（服務 `dist/`，改完要先 build）；`npm run dev` → :5173。
  兩埠 localStorage 分開，真資料只在其中一邊
- 流程：`npx vue-tsc --noEmit` → `npm run build` → `.smoke/vNN.mjs` → 截圖 → CHANGELOG → memory → commit
- 跑測試：`bash .smoke/run-regress.sh`（全部）或 `bash .smoke/run-regress.sh v104`（指定幾支）。
  ⚠ **判準以 exit code 為主**，摘要行格式各支不一（`pass=N fail=N` vs `N 通過 / N 失敗`）
- **維護中的回歸集＝v70～v104**；`v45/v46/v56/v57` 早已失效，別當基準
- Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`；puppeteer-core 在
  `C:\Users\user\.workbuddy\binaries\node\workspace\`；`node` 已在 PATH
  （⚠ 版本目錄會變，用過 `22.22.2-3`／`22.22.2-6`，找不到先 `ls ~/.workbuddy/binaries/node/versions/`）
- ⚠⚠ **升版後一定要重新 `npm run build` 才能跑測試**：`__APP_VERSION__` 是編譯期注入的，
  `dist/` 沒重建 → v79（拿 `package.json` 對畫面版本號）必紅。這是**假紅燈**，不是程式壞
- ⚠ 斷言「跟某來源一致」要去**讀來源**（如 v79 讀 `package.json`），別寫死

### 動到哪裡就跑哪支（守門員對照）

| 動到 | 必跑 |
| --- | --- |
| 錢包／記錄／設定的存取（遷移、隔離、匯出匯入） | **v99** |
| 匯出（JSON／Excel）或設定頁「資料」統計 | **v103** |
| 圖片／放大檢視／剪貼簿 | **v77**（收據壓縮）、**v89**（明細放大後可拖曳） |
| 明細的算式顯示 | **v83**、**v93**（抓 `.sheet .expr__v`；0.1.22 已把算式移到「詳細資訊」） |
| 計算機／彈窗／通知／記錄頁／快速備註／統計頁自訂日期 | **v82~v99** |
| 連點空白處／body 幾何／連點防護 | **v102** |
| 輸入框字級／點空白處的捲動／下拉清單能不能滑 | **v104** |

- v100（42 項）＝日期輸入框約定 ＋ iOS 貼上 ＋ 向左滑空白 ＋ Toast「知道了」
- v101（51 項）＝0.1.22 六需求（徽章「圖」／計算公式位置／圖片去重／摘要卡詳情／預設分類／彈窗鎖背景）
- v102（30 項）＝「連點空白頁面不能動」（body 幾何 ＋ 捲動不動 ＋ 連點防護設定）
- v103（84 項）＝0.1.24（資料統計分本錢包／總資料 ＋ 匯出可選錢包範圍）
- v104（46 項）＝0.1.25（輸入框 16px ＋ iosScrollGuard ＋ 下拉清單滑得動）

### ⚠⚠ 測試常見殺手（**完整清單在 `CONVENTIONS.md`**，這裡只列最會掛掉的）

- **`indexedDB.deleteDatabase` 只能在「App 重新載入後」呼叫**：App 一載入就握著
  `mop-ledger-images` 連線 → 請求卡在 `blocked` 永不完成 → **整支掛死（零輸出、被 SIGTERM）**。
  正確順序：`goto` → `localStorage.clear()` → `reload` → `deleteDatabase` → `reload` → 種資料
- **`mop-ledger.wallets.v1` 是 `{ wallets, activeWalletId }`，不是裸陣列**
  （裸陣列被 `loadRoot` 當成「沒存過」→ 走遷移 → 只剩 1 個錢包）
- **照抄 `isRealErr()` + `ENV_NOISE`**：`index.html` 有 Google Fonts 外鏈，網路一抖 console 就噴
  `ERR_NAME_NOT_RESOLVED`，害「沒有 JS 錯誤」的斷言偶發紅燈（與程式無關）
- **要等狀態、不要等時間**：`waitForFunction(() => !!document.querySelector(目標))` 再 `sleep(400)`
- **空集合假通過要防**；**「不會動」要先讓它「能動」**（驗 `scrollY` 不變前要先捲到非 0）
- **沙箱不允許 Node 開子行程**（`execFileSync`／`spawnSync` → `EBUSY`）
  → 要「換個實作再驗一次」得拆成 shell 腳本（例：`.smoke/v98-verify.sh`）
- ⚠ **`npm install <pkg>` 會拔掉 `@esbuild/win32-x64`** → build 爆「needed by esbuild」。
  那是 esbuild 的 optionalDependencies（**不該**進 package.json）：把那行刪掉再 `npm install`

## Git / 部署

- Repo `vincentwongmax/Document_inlocal`；Pages 來源＝ `gh-pages` 分支（`build_type: legacy`）；
  線上 `https://vincentwongmax.github.io/Document_inlocal/`
- ⚠ **只 commit 本機，不主動 push／部署**，要動遠端先問
- ⚠ **工作區有使用者自己的 `ddd.txt`**（草稿）→ 一律 `git add -A -- . ':!ddd.txt'`
- **沒有存起來的憑證**：要用的 classic PAT（`repo, workflow`）從
  `~/.workbuddy/audit-log/*.jsonl` grep `ghp_`（**不要寫進任何檔案**，
  輸出記得過 `sed -E "s/ghp_[A-Za-z0-9]{36}/ghp_***/g"`）。
  push＝`git push "https://${TOKEN}@github.com/vincentwongmax/Document_inlocal.git" main`；
  部署＝`GH_TOKEN="$TOKEN" npm run deploy`。
  ⚠ 別用 `git push --dry-run` 判斷有沒有憑證（一定失敗）
- ⚠ **Actions 自 2026-10-05 起全數失敗，與程式無關**：帳號被 billing 鎖住 → runner 沒被分配
  （特徵：job 只跑 ~2 秒、`steps: []`、`runner_id: 0`）。解法＝使用者去
  <https://github.com/settings/billing>。**但 Pages 的 legacy 建置不受影響
  → `npm run deploy` 手動部署完全可用**
- `scripts/deploy-gh-pages.mjs`：用正確 base 建到 `os.tmpdir()` 的**全新目錄**再 force push
  `gh-pages`，**不動 `dist/`**（動了 `npm run preview` 會白畫面）。
  ⚠ 別改回建到專案內 `.deploy/`（殘留舊 `.git` 會讓 Vite 清目錄被沙箱攔）
- ⚠ 部署版雜湊與本機 dist **不同**（`VITE_BASE` 會 inlined 進 bundle）→
  比對線上／本機要看「內容特徵」，不能對雜湊。
  base 由 `resolveBase()` 自動判斷（`.github.io` 結尾→`/`，否則 `/<repo>/`；本機 `/`；
  `VITE_BASE` 可覆寫）。**不要在 workflow 裡設 base**
- PWA 看到舊版先 Ctrl+Shift+R／無痕；測試用全新 profile
- ⚠⚠ **線上驗證的兩個坑**（`CONVENTIONS.md` 有完整版）：
  1. **`github.io` CDN 有傳播延遲**：剛 deploy 完抓 `index.html`，它可能還指著上一版的
     hash 檔，而那個檔在 force push 後已被換掉 → 404。**看起來像「部署把站弄壞了」，
     其實只是還沒傳播完**（`pages/builds/latest` 的 status 已是 `built`）。
     等 1～2 分鐘重抓就對了，**不要急著重新部署**
  2. **絕對不要手打 bundle 的雜湊檔名**（`index-BHF_IIia.js` 打成 `...IIIA.js` → 白繞一圈）。
     要檔名就用 `git/trees/{branch}?recursive=1` 撈、用 shell 變數帶進 URL。
     - ⚠ `contents` API 對大檔回 404（1MB 限制）→ 改用
       `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`
  3. 驗線上要看**內容特徵**（`overlay`／`MacIntel` 等程式碼標記、版本號），
     不要對雜湊——部署版的雜湊和本機 dist 一定不同

## 資料

- **錢包（0.1.20 起）**：設定頁最上方可切換，**每個錢包有自己的一整套記錄＋設定**
  （分類／匯率／幣別／常用備註都跟著錢包走）。切換＝換一本帳。
  - 存法：`mop-ledger.wallets.v1`；**每錢包設定各自一鍵** `mop-ledger.setting.<id>.v1`；
    記錄仍是單一鍵 `mop-ledger.records.v1`，每筆蓋 `walletId`
  - 預設錢包 id 固定 `w_default`（`lib/wallets.ts`）——舊記錄遷移時補的就是它，
    **不能改成每次 `uid()`**，否則對不到
  - ⚠ store 對外的 `records` 是 computed（只含當前錢包）；內部 `all` 才是全部。
    **圖片去重與「還有誰在用這張圖」一律看 `all`**（圖檔 blob 跨錢包共用）
  - ⚠ settings store 的 `state` ＝「當前錢包」的設定，形狀與單錢包時代相同
  - ⚠ **「初始化時改資料要自己寫回去」**：store 初始化階段的修改（遷移）發生在
    watcher 掛上之前，且非 immediate 的 watcher 不會因「初始值」而跑 →
    兩個真 bug 都是這樣來的（WALLETS_KEY 沒落地、records 沒補 walletId）
  - ⚠ **「有記錄不給刪錢包」擋在 WalletSection 元件**，不是 store（互相 import 會循環）
- **匯出**：設定頁 → 彈窗選格式（JSON／Excel）與範圍（本錢包／全部錢包，兩者都能選）。
  **JSON＝format 2，完整備份可還原**；**Excel＝.zip（xlsx + `images/`），不含任何設定、不能匯回**。
  ZIP 與 XLSX 都是**自己寫的**（`lib/zip.ts`／`lib/xlsx.ts`，零依賴）→
  ⚠ 動到那裡之前先讀 `CONVENTIONS.md` 的「匯出（JSON ╱ Excel）」那節（一堆一錯就檔案損毀的雷）
- localStorage `mop-ledger.{wallets,setting.<id>,records,draft}`；
  `mop-ledger.settings.v1` 是**單錢包時代的舊鍵，刻意不刪**（遷移保險）；
  收據原圖在 IndexedDB（`idb-keyval`，跨錢包共用）
- 分類 `{ id, name, type, color, icon?, builtin, archived, parentId? }`；
  舊資料載入時 `withIcons()` 補 icon 並回寫
- `settings.defaultCategoryId`（0.1.22，記帳頁預設分類）**與主頁
  `favoriteCategories`（常用分類）完全獨立**，互不影響。⚠ 入口 `CategoryManageModal`
  的「記帳預設」編輯／新增兩態要用 `v-if/v-else` 互斥；已封存分類不能當預設
- 設定頁「資料」統計分兩組（0.1.24）：**本錢包**／**總資料（含所有錢包）**，
  圖片數分別是「本錢包用到的張數」與「跨錢包的**聯集**張數」→
  ⚠ 圖檔 blob 跨錢包共用，**總張數 ≠ 各錢包相加**

## 全站約定（含未來所有新畫面）

> 使用者原話、成因、驗法與硬性 CSS 規則都在 `CONVENTIONS.md`，這裡只列「做什麼」

1. **`body` 一律 `min-height: 100%`，不要 `height: 100%`**（0.1.23）
   `html { height: 100% }`（捲動容器）＋ `body { min-height: 100% }`。
   ⚠ **改版時千萬不要改回去** —— body 盒子被釘在視窗高時，iOS 點畫面的那輪
   「對齊到可視範圍」會把文件往上推。驗法看**幾何關係**（`body` 盒子高 ≥ `scrollHeight`），
   不是看 computed px（844 視窗下兩者可能同值，分不出來）
2. **所有日期輸入框都是「純文字框 ＋ 右邊按鈕」**（0.1.21）
   **永遠不要**把 `<input type="date">`／`datetime-local` 當成畫面上可見的輸入框。
   只要日期 → `DateField.vue`；日期＋時間 → `DateTimeField.vue`
3. **彈窗／子頁面開著時背景不能滑動**（0.1.22）
   任何 `position: fixed` 的全螢幕彈窗接
   `useScrollLock(toRef(props,'open'), { scrollable: () => 內容區 })`，內容區加
   `overscroll-behavior: contain`。目前已接 6 個：`CalcSheet`／`CategorySheet`／
   `CategoryManageModal`／`ExportModal`／`RecordSheet`／`SumDetailSheet`
   - ⚠ **0.1.25 起 `scrollable` 不再是唯一的放行條件**：`useScrollLock` 會放行
     「任何當下真的可捲動的元素」（`overflow-y` auto/scroll **且** `scrollHeight > clientHeight`）。
     這正是「管理分類的下拉選單滑不動」的修法。`scrollable` 仍值得給，但**不再是地雷**
4. **會叫出鍵盤的可編輯元素字級一律 16px**（0.1.25）
   iOS 對 < 16px 的可編輯元素會 focus zoom，且 blur 後不保證還原
   → 之後每次點畫面都被重新對齊（＝連點空白處一直往上滑）。
   ⚠ 那段宣告**必須排在 `input, select, textarea { font: inherit }` 之後**（同特異度靠源碼順序）；
   選擇器特異度是 **(0,5,1)，會蓋過元件 scoped 樣式**（刻意：不讓任何元件把字級改小又讓 bug 復活）
   → 搜尋框 13px、`.qn__in` 14px、`.rate__input` 14px 都因此變 16px（高度與版面不變）；
   ⚠ **不含 `<select>`**（iOS 的 select 是原生滾輪、沒有游標，不會 zoom）
5. **點空白處要收掉鍵盤並扶正捲動位置**（0.1.25）
   `src/lib/iosScrollGuard.ts`（`main.ts` 開機裝一次，只在 iOS 生效）：
   點在空白處且正有輸入框聚焦時 → 記下位置 → `blur()` → rAF×2 後扶回原位。
   ⚠ 點在互動元素上、彈窗開著時都不插手
6. 連點防護別拆：`html { touch-action: manipulation }`、
   `button/a/[role=button] { -webkit-touch-callout: none; user-select: none }`、
   `body { overscroll-behavior-y: none }`、`html { overflow-x: hidden }`

## 視覺基調

米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）；
字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`），不用漸層／玻璃擬態。
