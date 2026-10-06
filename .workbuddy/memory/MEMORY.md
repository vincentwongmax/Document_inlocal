# 記帳本（mop-ledger）— 專案長期備忘

Vue 3 + TypeScript + Pinia + vue-router（hash routing）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo 根目錄：**`E:\AI\`**（2026-10-06 從 `C:\Users\user\Desktop\AI` 整體搬過來，C: 上不再保留），
分支 `main`。**所有指令都要在 `E:\AI` 下跑**。

## 怎麼啟動 / 打開這個程序

| 用途 | 指令 | 網址 |
|---|---|---|
| 平常使用（推薦） | `npm run preview` | http://localhost:4173/ |
| 開發（改程式即時熱更新） | `npm run dev` | http://localhost:5173/ |

- **`npm run preview` 服務的是 `dist/`**，所以改完程式要先 `npm run build` 才會生效。
- `npm run dev` 沒有 Service Worker（`devOptions.enabled: false`），永遠是最新程式碼，
  除錯時最不容易被快取誤導。
- **`localhost:4173` 與 `localhost:5173` 的 localStorage 是分開的**（同源包含埠），
  真實資料只會在其中一邊，不要隨便換埠否則會看到空帳本。

## 執行環境：整個專案都在 `E:\AI`

C: 總共只有 60GB，很容易被 node_modules／npm cache／測試截圖塞爆（曾剩 1.2GB，導致整批回歸
**靜默失敗、完全沒輸出**）。**2026-10-06 已把整個專案搬到 `E:\AI`**，C: 上不保留任何東西。
目前還在 C: 上留連結的只剩一項：

| C: 路徑 | 實際位置 | 大小 |
|---|---|---|
| `AppData\Local\npm-cache` | `E:\Moved\npm-cache` | 261MB |

- 專案本體很小（本機約 39MB）；`node_modules`（144MB）與 `.smoke`（24MB）
  **現在就是 `E:\AI` 裡的實體目錄**，不再是連結
- 搬移工具放在 `E:\wb-run\`（`move-to-e.mjs` / `junction-to-e.mjs` / `move-project.mjs`
  / `purge-c-project.mjs`）；**不要用 `fs.cpSync`**，大檔會 segfault，
  要用 `fs.copyFileSync`（走 OS 的 CopyFileEx）
- 跨槽搬目錄＝複製再刪除，**沒有原子性**；腳本要寫成**可重跑**（目標檔存在且大小相同就略過），
  且**一律先驗證 byte 數再刪來源**
- ⚠ 搬移含 junction 的目錄時，**先拆 junction 再刪來源**：`fs.rmdirSync(連結)` 只移除連結本身、
  **不會遞迴進目標**；反之對整個目錄 `rm -rf` 可能跟進 junction，把 E: 的檔案一起砍掉
- 建連結用 Node：`fs.symlinkSync(目標, 原路徑, 'junction')`，**不需管理員權限**；
  Git Bash 的 `mklink /J` 會被路徑轉換搞爛，別用
- **`TEMP`/`TMP` 已 `setx` 指向 `E:\Temp`**（也備有 `E:\wb-tmp`）
  - ⚠ 只對**之後新開的行程**生效；既有殼層仍是舊值，所以**跑測試一律明寫**
    `TEMP='E:\wb-tmp' TMP='E:\wb-tmp'`，並且 `cd /e/AI` 執行
    （截圖等相對產出就落在 `E:\AI\.smoke\`）
  - `AppData\Local\Temp` 本身**沒辦法**改成 junction：有行程佔用，`rename` 會 EPERM
    （`E:\wb-run\redirect-temp.mjs` 會乾淨放棄，不會留半套狀態）

⚠ 沙箱限制（常遇到，別浪費時間重試）：
- `reg.exe` 在程式黑名單 → `reg query` 一律被擋
- 從 Bash 叫 `powershell.exe` 被擋；PowerShell 工具本身**不回 stdout**（只回 exit code 0）
- **桌面等個人目錄的刪除會被攔**：`fs.rmSync` 被導向資源回收桶（可能失敗），
  `cmd rd /s /q` 直接被安全策略擋掉。**遇到就回報使用者，不要一直換招硬刪**
- 驗證請用 **Node 寫檔／讀檔** 或直接看檔案系統

## 快取陷阱（很重要）

App 是 PWA，`registerType: 'autoUpdate'`，Service Worker 會預快取整個 dist。
- 部署新版本後若畫面看起來還是舊的：**Ctrl+Shift+R 硬重新整理**，或用無痕視窗。
- 徹底解決：DevTools → Application → Service Workers → Unregister。
- 截圖／自動化測試一律用全新的瀏覽器 profile（puppeteer 預設即是），不要同 profile 反覆 reload。
- 純靜態資產有變時若還看到舊版，先確認 `dist/index.html` 的 `assets/index-*.js` 雜湊
  與 `curl http://localhost:4173/` 回傳的一致。

## 分類階層（子分類）

- `Category.parentId?: string | null`，null／省略＝頂層大類；**支援多層**（子分類還能再有子分類）
- 子分類的 `type` 與 `color` 一律沿用上層（store 的 `addCategory` 會自動帶），
  改大類的 type 時 `updateCategory` 會連整棵子樹一起改
- **有大類底下還有子分類時不給刪**（`canRemove()` 回傳原因，UI 顯示並停用刪除鈕），
  要先刪到最底層才能往上刪；刪除一律是封存（`archived = true`），記錄仍讀得到名稱
- store 的樹狀工具：`childrenOf / hasChildren / pathOf / descendantIds / fullNameOf / canRemove /
  topCategoriesByType`；`fullNameOf` 回傳「餐飲 › 早餐」
- 記帳頁：第一列只放大類，選了大類後下方沿路徑逐層展開子分類標籤列（`.subs`）
  ⚠ `CategoryPicker` 的 chips 模式用 `topCategoriesByType`，**下拉模式（`variant="select"`）
  必須改用 `selectList`**，否則下拉會漏掉子分類
- 統計頁：分類佔比每列的金額含整棵子樹，點箭頭展開看子分類；展開後的百分比是「佔上一層」，
  大類自己身上的金額會補一列「未細分」
- 常用分類可以勾到子分類，記帳頁第一列會直接出現（展開「更多」時會補回來，不會消失）
- **下拉清單一律走樹狀順序**：`src/lib/tree.ts` 的 `flattenCategories(list, sortSiblings?)` 深度優先攤平，
  子分類緊接在自己的上層後面（餐飲、餐飲 › 午餐、餐飲 › 午餐 › 麵、旅行…）。
  ⚠ 不要直接 `categories.map()` 餵給下拉——`settings.categories` 是建立順序，子分類會全擠到最後
  - 用在哪：`CategoryManageModal` 的「選擇分類」／「所屬分類」（`treeOrder`）、
    `CategoryPicker.selectList`（下拉模式）
  - **下拉不做層級縮排**（使用者明確要求）：每一項都跟大類左對齊，靠「餐飲 › 午餐」這種
    路徑名稱表達階層就好
- **路徑太長時只留頭尾**：`src/components/PathLabel.vue`（`<PathLabel :path="…" />`）把
  「餐飲美食 › 早餐時段 › … › 飯麵類」折成「餐飲美食 › … › 飯麵類」；
  CSS 的 `text-overflow` 只會砍尾巴，會把最關鍵的「哪一層」砍掉，所以要用這個
  - 判斷方式是比對 `scrollWidth > clientWidth`（真的用瀏覽器排版），不用 canvas 猜字型寬度；
    `ResizeObserver` 處理變寬變窄，`watch(path)` 處理路徑變動
  - 三階退讓：完整路徑 → 「頭 › … › 尾」→「… › 尾」（連頭都放不下時）；
    只有 1～2 段的路徑沒有中間可省，維持原樣交給 CSS 的 ellipsis
  - ⚠ **只能放在「寬度由版面決定」的容器**（`.pop__name`、`.selwrap__name` 都是
    `flex: 1; min-width: 0`）。若元素寬度被內容撐開就永遠不會 overflow，這裡就永遠不會動
  - 用在哪：`CategorySelect` 的清單項目與觸發鈕（管理彈窗兩個下拉、記錄明細的分類下拉）
- **設定頁「主頁常用分類」的標籤不做逐層縮排**（使用者要求「排列整齊、中間不要有空間間開」）：
  `marginLeft: depth * 14` 會在列內留下大小不一的空洞，看起來很亂。
  現在全部跟大類同一個左緣、同高（`.catchip.is-sub` 的高度覆寫已移除），
  子分類只靠 `└` 記號（固定 10px 寬）+ 樹狀順序辨識
  - ⚠ 這個面板是「勾選哪些分類要顯示在主頁」，但使用者把它理解成「設定頁的分類清單」，
    講到它時要說「設定頁 › 分類 › 主頁常用分類」才不會被誤認成主頁
  - 同一個面板在**做格線對齊會出問題**：3 欄時每格只有約 113px，而「年終獎金」需要約 119px
    → 會被逼得省略名稱，所以維持 flex-wrap 的自然寬度
- 記錄頁的「分類」檢視**只依大類分組**：分組鍵是 `pathOf(categoryId)[0]?.id`（根分類），
  所以「交通」與「交通 › 巴士」在同一組；但**記錄列仍顯示完整路徑**。
  組標題下方有子分類小計 chips（只取分類名、不取路徑），大類自己身上的金額補一列「未細分」
  （id 用 `__own` 後綴），否則 chips 加總會對不上組標題的金額
- ⚠ `CategoryManageModal` 的表單載入**不要用 `watch(pickedId)`**：watch 是非同步的，
  會蓋掉同步設定好的值（曾因此讓「＋ 在 X 底下新增子分類」的上層被清空、只能建兩層）。
  改用 CategorySelect 的 `@update:model-value="choose"`；`addChild()` 也要先把
  `editing.value?.id` 存下來再 `choose(id)`，因為 choose 之後 editing 就變 null 了
- **`CategoryManageModal` 是分段展開的**（使用者要求）：打開時只露出「選擇分類」與「類型」，
  其餘欄位全包在 `<template v-if="decided">` 裡
  - 哨兵 `const PICK = '__pick__'`（`pickedId` 的初始值）；`decided = pickedId !== PICK`
  - `editing` 必須排除 `PICK`（`pickedId && pickedId !== PICK ? find(…) ?? null : null`）；
    `usedCount` 看 `isEdit` 而不是 `pickedId` 非空（`PICK` 不是空字串，會誤判）
  - 標題未決定時是「新增或修改分類」；頁尾的「新增／儲存」按鈕 `v-if="decided"`，
    未決定時只剩「取消」；`submit()` 也有 `if (!decided) return` 保險
  - 刪除後 `choose(PICK)` 回到未決定，不是回到「新增」
  - `resetNew(under, type)` 的第二個參數是「沿用目前的收支」，`choose()` 走
    `resetNew(null, catType.value)`，否則使用者先點「收入」再開新分類會被重設回支出
- **「類型」在彈窗最上面，兩個下拉都只列那一種收支**（使用者要求「只顯示支出或收入，不要一起顯示」）：
  `typeTree = flattenCategories(categories.filter(c => c.type === catType))`，`pickOptions` 用它，
  `parentOptions` 也加同樣的條件（子分類一定跟自己的上層同類型）
  - 切類型走**同步的 `setType(t)`**，不要用 `watch(catType)`；編輯中切到另一種會 `choose(PICK)`
    回到「還沒選」（否則下拉寫「請選擇分類」、下面卻還留著舊分類）
  - ⚠ **副作用**：既有分類的收支類型不能再從這個彈窗改（切類型＝換清單，不是改這顆的 type）
- `CategorySelect` 的 `placeholder`／`emptyLabel` 是兩件事：
  `placeholder`＝還沒選時觸發鈕的文字（「請選擇分類」）；
  `emptyLabel`＝清單第一項（空字串佔位項）的文字（「新增分類」）。
  觸發鈕文字走 `triggerName` computed：選到分類→名稱；選了空字串且 `allowEmpty`→`emptyLabel`；
  其他查不到的值（如 `PICK`）→`placeholder`

## 資料存放位置

- `localStorage`：`mop-ledger.records.v1`（記錄）、`mop-ledger.settings.v1`（設定／分類）、
  `mop-ledger.draft.v1`（待確認草稿）
- `IndexedDB`（`idb-keyval`）：收據圖片原始檔，鍵為 ImageRef.id；縮圖以 data URL 存在記錄裡
- 分類結構：`{ id, name, type, color, icon?, builtin, archived }`
  - `icon` 為 `src/lib/icons.ts` 的鍵值；舊資料沒有此欄位，載入時 `settings` store 的
    `withIcons()` 會自動補（先對照內建 id，再依名稱猜），並立即回寫一次

## 開發慣例

- 改完一定要跑：`npx vue-tsc --noEmit` → `npm run build` → 一個 `.smoke/vNN.mjs` 實測 → 截圖 → commit
- 詳細的 headless Chrome 驗證流程見 skill `vite-pwa-smoke-verify`
- 視覺規範：米白紙感、石墨灰文字、**單一墨綠強調色 `--accent: #2c6e5b`**；
  支出 `--expense: #bf563c`（紅／暖）、收入 `--income: #2c6e5b`（綠）；
  不用漸層／玻璃擬態／霓虹色
- 墨綠色階（由淺到深）：`--accent-soft: #e7f0ec`（淡底／內嵌小按鈕）→
  `--accent-light: #cde6da`（淺綠，等號鍵底；配 `--accent` 深字）→
  `--accent: #2c6e5b`（主按鈕、強調）→ `--accent-hover: #245c4b`
- 「已選分類」一律用粉紅 `--pick: #b85773`（白字對比 4.5:1）、`--pick-soft: #fbeef2`（下拉已選列底）、
  `--pick-line: #eccfd9`（已選列的 icon 描邊）；**不要用 `--text`（近黑）當已選底色**（使用者明確要求）
  - 兩處實作都在 `CategoryPicker.vue`：`.cat.is-on`（chips）與 `.pop__item.is-on`（自訂下拉）
- 字體：`--font` = Noto Sans TC，`--font-display` = Noto Serif TC（Google Fonts，CJK subset 按需載入）
- 圖示一律用描邊線性圖示（24×24 網格、`currentColor`），不要混用 emoji 或填充圖示
- ⚠ **「標籤 + 說明文字」那一列不要用 flex**（`CategoryManageModal` 的 `.lb > span` 踩過）：
  裸文字標籤是匿名彈性項目，`flex-shrink: 1` + `min-width: auto`，而中文可在任何字之間斷行
  （min-content 只有 1 個字）→ 說明一長就會把標籤壓到剩 3 個字（「所屬分」／「類」兩行，看似懸掛縮排）。
  改用 `display: grid; grid-template-columns: max-content minmax(0, 1fr)`：標籤永不壓縮，
  說明在**自己的欄位內**換行（各行左緣對齊）。說明可再加 `text-wrap: pretty` 避免尾行只剩一個字
- 元件在被多處共用時（例如 `RecordList` 同時用於記錄頁與統計頁），改動要一併回歸測試
- 共用元件：`DateTimeField`（`datetime-local` 輸入框，右側內嵌「設為現在」小按鈕，v-model 為
  `YYYY-MM-DDTHH:mm` 本地字串）用於記帳頁、記錄明細、收據複核三處；
  `ClearableInput`（文字輸入框，右側內嵌「清空」小按鈕，空值時變灰停用，支援 placeholder/maxlength）
  同樣用於那三處的備註欄位；
  `CategoryIcon` / `CategoryPicker` / `RecordList` / `RecordRow` 為其他共用件
- 「輸入框內嵌小按鈕」的統一樣式：26×26、radius 8px、`right: 5px` 垂直置中、
  底色 `--accent-soft` + 圖示 `--accent`、hover 反白（`--accent` 底 + 白圖示）；
  輸入框一律 `padding-right: 40px` 讓開（datetime 還需容納 Chromium 原生日曆選擇器）
- `HighlightText.vue`：把文字按關鍵字切成片段、命中處包 `<mark class="hl">`（黃底 `--hl: #ffe066`）。
  不用 RegExp、不分大小寫、保留原文大小寫；多根 fragment 輸出不影響外層 ellipsis。
  目前用於 `RecordRow` 的分類名與備註（`highlight` prop 由 RecordsView 搜尋框傳入）

## 記帳頁版面（2026-10-07 起）

- **金額欄是按鈕**：記帳頁只留顯示金額的欄位，點一下才開計算機子頁面
  （`src/components/CalcSheet.vue`，置中卡片彈窗）。金額狀態在 HomeView，
  CalcSheet 只負責顯示＋轉發按鍵，關掉再開輸入不會不見
- 子頁面**不滑動**、開啟時**鎖背景捲動**：在 `<html>` 掛 `is-locked`
  （全域樣式在 `src/style.css`：`html.is-locked, html.is-locked body { overflow: hidden }`）；
  卡片 `max-height + overflow hidden`，按鍵 `clamp(42px, 8vh, 54px)` 矮螢幕自動縮小
- 「常用金額」快捷列已移除（`quickAmounts`／`setAmount` 都刪了）
- 實體鍵盤：計算機開著時 Enter／Esc 只關計算機，不送出、不清空
- ⚠ Keypad 的 `＋ − × ÷ ( )` 要按左下角計算機鍵（`.key--tool`）展開才有；`=` 是基本鍵
- 驗證腳本：`.smoke/v70.mjs`（40 assertions）
- ⚠ smoke 測試需要 `puppeteer-core`，裝在
  `C:\Users\user\.workbuddy\binaries\node\workspace\`（該目錄曾整個被清空，
  不見了就 `npm install puppeteer-core` 補回去）

## 部署（GitHub Pages）

- Repo：**`vincentwongmax/Document_inlocal`**（公開、default branch `main`）
  → 線上網址 `https://vincentwongmax.github.io/Document_inlocal/`
- **部署走 `gh-pages` 分支**（Pages 來源 = Deploy from a branch → `gh-pages` / `/`）：
  - CI：`.github/workflows/deploy.yml` → `npm ci` → `npm run build` →
    把 `dist/` 內容 `git push -f` 到 `gh-pages`（只需 `contents: write`）
  - 手動：`GH_TOKEN=xxx npm run deploy`（`scripts/deploy-gh-pages.mjs`），
    **建置到 `os.tmpdir()` 下的全新目錄、不動 `dist/`**，所以本機預覽不受影響
    - ⚠ 不要改回建到專案內的 `.deploy/`：那個目錄會殘留上一次的 `.git`，
      Vite 清目錄時會被沙箱攔下而失敗（`prepareOutDir` 丟錯）
  - 曾用 `upload-pages-artifact` + `deploy-pages`（Pages 來源 = GitHub Actions），
    但 2026-10-06 GitHub Actions 服務降級（degraded_performance）時整批卡在佇列，
    使用者要求改用 gh-pages，這條路徑最短、也最好排查
  - ⚠ **Pages 的 legacy 建置很慢但不一定是壞的**：狀態會長時間停在 `building`、
    `duration: 0`、`updated_at` 不動（實測 6.5 分鐘才 `built`，之後站台 200）。
    別因為看起來卡住就急著砍設定（`DELETE /pages` 會被回 422 "not allowed"）
- ⚠ **絕對不要用 Pages 的 base 去蓋掉 `dist/`**：`npm run preview`（localhost:4173）服務的
  就是 `dist/`，蓋掉之後瀏覽器會去找 `/＜repo＞/assets/*.js` 而**白畫面**（踩過一次）。
  驗證 Pages 用的 base 請用 `.smoke/verify-base.mjs`（輸出到 `dist/`，跑完記得再
  `npm run build` 還原），正式部署請用 `scripts/deploy-gh-pages.mjs`（輸出到 `.deploy/`）
- `scripts/deploy-gh-pages.mjs` 的兩個坑：`run()` 走 `shell: true`，
  **參數含空白會被拆開**（commit message 別放空白）；印指令時要**把 token 遮掉**
- **base 由 `vite.config.ts` 的 `resolveBase()` 自動判斷**（依 `GITHUB_REPOSITORY`：
  `.github.io` 結尾 → `/`，否則 `/<repo>/`；本機 `/`；可用 `VITE_BASE` 覆寫）。
  **不要在 workflow 裡設 base**，也不要為不同部署位置改 `vite.config.ts`
- 子路徑部署的兩個坑（都已修）：
  - 資源路徑：Vite **只改寫「`public/` 裡真的存在」的絕對路徑**（`/favicon.svg`、
    `/icons/*.png` 會變 `${base}...`）。**manifest 的 `<link>` 不要自己寫**
    （不在 public/ 不會被改寫 → 子路徑 404），交給 `vite-plugin-pwa` 注入，它會帶 base
  - `navigateFallbackDenylist` **不要錨定開頭的 `/`**：Workbox 比對的是含 base 的
    `url.pathname`，`^\/tessdata\/` 在 `/<repo>/` 下會失效
- 用 **hash routing**，所以不需要 `404.html`；`public/.nojekyll` 是給切回分支部署時用的保險
- `public/tessdata`、`public/tesseract-core`（約 19MB）**沒進版控**，由 build 的
  `prepare:assets` 下載 → **CI runner 要有外網**；`scripts/clean.mjs` 非 Windows 走 `rmSync`
- ⚠ **Git Bash 會改寫「像 POSIX 絕對路徑」的參數與環境變數值**成 Windows 路徑
  （`VITE_BASE=/mop-ledger/` → `C:\...\PortableGit\...\mop-ledger\`）。
  要驗證 base 就寫成腳本內預設值、由 Node 設 `env` 再 spawn（`.smoke/verify-base.mjs`），
  **呼叫時不要帶參數**；否則 `dist/index.html` 會是假結果。
  `MSYS_NO_PATHCONV=1` 不保證有效
- 這台機器**沒有任何 GitHub 憑證**（無 `gh`、`~/.ssh` 空、無 `~/.gitconfig`、
  `GIT_TERMINAL_PROMPT=0`）→ 要推之前必須先跟使用者拿 PAT 或裝 gh 登入
