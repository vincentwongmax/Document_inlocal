# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（**本機沒有 E: 槽**，舊筆記的 `E:\AI`、`E:\wb-tmp` 全作廢），
分支 `main`。**所有指令都在這個目錄下跑。**

> 📎 分類階層、記帳頁／彈窗、通知、樣式、各項踩坑與**測試常見殺手** →
> **同目錄的 `CONVENTIONS.md`**（要用時再讀；那裡才是完整版）

## 版本號

- `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.29`
  （⚠ **0.1.29 來回三次**：前兩次都被使用者 ROLL BACK，第三次（現在這版）才是定案。
  內容差異：「最近」按鈕 vs 「依新增時間」標籤、方形圓角 vs 膠囊、淺綠 vs 淺黃外框）
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
- **維護中的回歸集＝v70～v107 ＋ v109**；`v45/v46/v56/v57` 早已失效，別當基準
  （`v108` 驗的是第一次被回退的 0.1.29，**刻意不放進回歸集**，檔案留在原處）
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
| **雙擊**空白處／統計摘要卡／子頁面彈層／收據 BETA／金額點擊 | **v105** |
| 摘要卡箭頭／記帳頁標題／彈層避開 home indicator／區間記錄精選／分類轉場 | **v106** |
| 彈層 safe-area 被 scoped padding 蓋掉／記帳頁副標／主幣別換算顯示／淺綠外框 | **v107** |
| 依新增時間按鈕（最右＋黃框）／分類區塊白底／快速金額／時間標籤去「交易」 | **v109**（54 項） |
| 「最近」檢視本身（補登情境、基準切換、空清單文案） | **v85** |
| 記錄頁各寬度的排版（320～768） | **v94**（⚠ 0.1.29 起「檢視」列是三顆；320px 允許掉行） |
- ⚠ **`.smoke/` 是 gitignored** → `git revert` 不會動它。回退時要**手動**把
  回歸集的 `ALL` 與被改過的舊測試（如 v85）改回去

- v102（30 項）＝「連點空白頁面不能動」。**用 390×667 跑**（記帳頁在 844 會剛好塞滿）
- v100（42 項）＝日期輸入框 ＋ iOS 貼上 ＋ Toast「知道了」；v101（51 項）＝0.1.22 六需求
- v103（84 項）＝0.1.24；v104（46 項）＝0.1.25；v105（44 項）＝0.1.26；
  v106（39 項）＝0.1.27；v107（38 項）＝0.1.28；**v109（54 項）＝0.1.29**
- （各版細節看該版的 CHANGELOG 與 CONVENTIONS，不重複在這裡）

### ⚠⚠ 測試常見殺手（**完整清單在 `CONVENTIONS.md`**）

- **`indexedDB.deleteDatabase` 只能在「App 重新載入後」呼叫** → 否則掛死。
  順序：`goto` → `localStorage.clear()` → `reload` → `deleteDatabase` → `reload` → 種資料
- **`mop-ledger.wallets.v1` 是 `{ wallets, activeWalletId }`，不是裸陣列**；
  **照抄 `isRealErr()` + `ENV_NOISE`**；**要等狀態、不要等時間**；
  **空集合假通過要防**；**「不會動」要先讓它「能動」**；沙箱不能開子行程；
  `npm install <pkg>` 會拔掉 `@esbuild/win32-x64` → 刪掉那行再裝回

## Git / 部署

- Repo `vincentwongmax/Document_inlocal`；Pages 來源＝ `gh-pages` 分支（`build_type: legacy`）；
  線上 `https://vincentwongmax.github.io/Document_inlocal/`
- ⚠ **只 commit 本機，不主動 push／部署**，要動遠端先問
- ⚠ **工作區有使用者自己的 `ddd.txt`**（草稿）→ 一律 `git add -A -- . ':!ddd.txt'`
- **沒有存起來的憑證**：classic PAT（`repo, workflow`）從
  `~/.workbuddy/audit-log/*.jsonl` grep `ghp_`（**不要寫進任何檔案**，
  輸出過 `sed -E "s/ghp_[A-Za-z0-9]{36}/ghp_***/g"`）。
  push＝`git push "https://${TOKEN}@github.com/vincentwongmax/Document_inlocal.git" main`；
  部署＝`GH_TOKEN="$TOKEN" npm run deploy`。
  ⚠ 別用 `git push --dry-run` 判斷有沒有憑證（一定失敗）
- ⚠ **Actions 自 2026-10-05 起全數失敗，與程式無關**：帳號被 billing 鎖住 → runner 沒被分配
  （特徵：job 只跑 ~2 秒、`steps: []`、`runner_id: 0`）。解法＝使用者去
  <https://github.com/settings/billing>。**但 Pages 的 legacy 建置不受影響
  → `npm run deploy` 手動部署完全可用**
- `scripts/deploy-gh-pages.mjs`：用正確 base 建到 `os.tmpdir()` 的**全新目錄**再 force push
  `gh-pages`，**不動 `dist/`**。⚠ 別改回建到專案內 `.deploy/`（殘留舊 `.git` 會被沙箱攔）
- ⚠ 部署版雜湊與本機 dist **不同**（`VITE_BASE` 會 inlined）→ 比對要看**內容特徵**，不能對雜湊。
  base 由 `resolveBase()` 自動判斷（`.github.io`→`/`，否則 `/<repo>/`；本機 `/`）
- PWA 看到舊版先 Ctrl+Shift+R／無痕；測試用全新 profile
- ⚠⚠ **線上驗證的坑（完整版在 `CONVENTIONS.md`）**：
  ① `github.io` CDN 有傳播延遲 → 剛 deploy 完抓 index.html 可能 404，
  等 1～2 分鐘重抓，**不要急著重新部署**
  ② **絕對不要手打 bundle 的雜湊檔名** → 用 `git/trees/{branch}?recursive=1` 撈、
  shell 變數帶進 URL；`contents` API 對大檔回 404 → 改用 `raw.githubusercontent.com`
  ③ 驗線上要看**內容特徵**（程式碼標記、版本號），不要對雜湊

## 資料

- **錢包（0.1.20 起）**：設定頁最上方可切換，**每個錢包有自己的一整套記錄＋設定**。
  存法：`mop-ledger.wallets.v1`（形狀 `{ wallets, activeWalletId }`）；
  **每錢包設定各自一鍵** `mop-ledger.setting.<id>.v1`；
  記錄單一鍵 `mop-ledger.records.v1`，每筆蓋 `walletId`
  - 預設錢包 id 固定 `w_default`（`lib/wallets.ts`）——舊記錄遷移補的就是它，**不能改成 `uid()`**
  - ⚠ store 對外的 `records` 是 computed（只含當前錢包）；內部 `all` 才是全部。
    **圖片去重與「還有誰在用這張圖」一律看 `all`**
  - ⚠ settings store 的 `state` ＝「當前錢包」的設定
  - ⚠ **「初始化時改資料要自己寫回去」**：遷移發生在 watcher 掛上之前，
    非 immediate 的 watcher 不會因「初始值」而跑 → 兩個真 bug 都是這樣來的
  - ⚠ **「有記錄不給刪錢包」擋在 WalletSection 元件**，不是 store
- **匯出**：設定頁 → 彈窗選格式（JSON／Excel）與範圍（本錢包／全部錢包）。
  **JSON＝format 2，完整備份可還原**；**Excel＝.zip（xlsx + `images/`），不含設定、不能匯回**。
  ZIP／XLSX 都是**自己寫的**（`lib/zip.ts`／`lib/xlsx.ts`）→
  ⚠ 動到那裡之前先讀 `CONVENTIONS.md` 的「匯出」那節（一錯就檔案損毀的雷）
- localStorage `mop-ledger.{wallets,setting.<id>,records,draft}`；
  `mop-ledger.settings.v1` 是**單錢包時代的舊鍵，刻意不刪**；
  收據原圖在 IndexedDB（`idb-keyval`，跨錢包共用）
- 分類 `{ id, name, type, color, icon?, builtin, archived, parentId? }`；舊資料 `withIcons()` 補 icon
- `settings.defaultCategoryId` 與主頁 `favoriteCategories` **完全獨立**。
  ⚠ `CategoryManageModal` 的「記帳預設」編輯／新增兩態用 `v-if/v-else` 互斥
- 設定頁「資料」統計分**本錢包**／**總資料**兩組；
  ⚠ 圖檔 blob 跨錢包共用，**總張數 ≠ 各錢包相加**

## 全站約定（含未來所有新畫面）

> 使用者原話、成因、驗法與硬性 CSS 規則都在 `CONVENTIONS.md`，這裡只列「做什麼」

1. **`body` 一律 `min-height: 100%`，不要 `height: 100%`**（0.1.23）
   `html { height: 100% }`（捲動容器）＋ `body { min-height: 100% }`。
   ⚠ **千萬不要改回去**。驗法看**幾何關係**（`body` 盒子高 ≥ `scrollHeight`），
   不是看 computed px（844 視窗下兩者可能同值，分不出來）
2. **所有日期輸入框都是「純文字框 ＋ 右邊按鈕」**（0.1.21）
   **永遠不要**把 `<input type="date">`／`datetime-local` 當成畫面上可見的輸入框。
   只要日期 → `DateField.vue`；日期＋時間 → `DateTimeField.vue`
3. **彈窗／子頁面開著時背景不能滑動**（0.1.22）
   一律接 `useScrollLock(toRef(props,'open'), { scrollable: () => 內容區 })`，內容區加
   `overscroll-behavior: contain`。目前 7 個彈層全接了
   - ⚠ **0.1.25 起 `scrollable` 不再是唯一的放行條件**：也會放行「任何當下真的可捲動的元素」
     （`overflow-y` auto/scroll **且** `scrollHeight > clientHeight`）—— 這是下拉清單滑不動的修法
4. **會叫出鍵盤的可編輯元素字級一律 16px**（0.1.25）
   iOS 對 < 16px 的可編輯元素會 focus zoom，且 blur 後不保證還原。
   ⚠ 宣告**必須排在 `input, select, textarea { font: inherit }` 之後**；
   特異度 **(0,5,1) 會蓋過元件 scoped 樣式**（刻意：不讓任何元件把字級改小又讓 bug 復活）
   → 搜尋框／`.qn__in`／`.rate__input` 都因此變 16px（高度與版面不變）；
   ⚠ **不含 `<select>`**（iOS 的 select 是原生滾輪、沒有游標，不會 zoom）
5. **點／雙擊空白處都不能動**（0.1.25 → 0.1.26 兩度修正）
   `src/lib/iosScrollGuard.ts`（`main.ts` 開機裝一次，只在 iOS 生效）。三層：
   - **擋掉雙擊手勢**（0.1.26 的關鍵）：空白處的第二次 `touchend` 要 `preventDefault()`
     ⚠ **只在空白處**；按鈕上的連點是合法的（計算機快速按兩下），擋掉會弄壞功能
   - **收掉輸入框**：點空白處且有輸入框聚焦時 `blur()`
   - **扶正位置**：剛收掉輸入框的 1.2 秒內，「乾淨的點擊」後把 scrollY 扶回去
     （分 rAF×2 與 ~300ms 兩次，因為收鍵盤是非同步的）
   ⚠ 只認「點擊」不認「滑動」（移動 > 10px 就放棄判定）；彈窗開著時不插手
6. **所有子頁面都是底部彈層、可向下拉關閉**（0.1.26）
   外框幾何**只寫在 `style.css` 的 `.bsheet-mask`／`.bsheet`／`.bsheet__grab`／
   `.bsheet__body`**（樣板＝`RecordSheet`）。各元件只留 `z-index` 與自己內容的排版，
   ⚠ **不要在元件裡重寫那些幾何屬性**（scoped 特異度更高，會蓋掉共用值）。
   手勢一律 `usePullToClose({ panel: 外框, scroller: 內容區 })`（兩者必須不同元素）。
   已套用 7 個：`RecordSheet`／`CategoryManageModal`／`CategorySheet`／`CalcSheet`／
   `SumDetailSheet`／`ExportModal`／`ReviewSheet`
7. **一列記錄就是一個點擊目標**（0.1.26）
   `RecordRow` 的金額是 `<button class="row__amt">`（原本是 `<div>`，點它不開明細又會選到字）；
   整列 `.row` 加 `user-select: none`
8. 連點防護別拆：`html { touch-action: manipulation }`、
   `button/a/[role=button] { -webkit-touch-callout: none; user-select: none }`、
   `body { overscroll-behavior-y: none }`、`html { overflow-x: hidden }`
9. **彈層內容要避開 iPhone 底部工作條**（0.1.27 → 0.1.28 修根因）
   `.bsheet.bsheet.bsheet { padding-bottom: calc(var(--safe-b) + 12px) }`
   （`--safe-b`＝`env(safe-area-inset-bottom)`，有 Home Indicator 的機型 34px → 共 46px）。
   ⚠ **三連類別是刻意的**（特異度 (0,3,0)）：`CalcSheet` 的 `.calccard`、
   `CategorySheet` 的 `.catsheet__card` 是 scoped（(0,2,0)），
   0.1.27 寫 `padding: 0 12px 14px` 就把全域抬升蓋掉了 —— 那正是
   「選擇分類和計算機還是弄到底部工作條」的根因。
   ⚠ **元件裡不要寫面板的 `padding-bottom`**；⚠ 背景仍延伸到最底（只抬內容）。
10. **`<Transition>` 包出來的 wrapper 要自己補 `flex + gap`**（0.1.27 的 `.reveal`）
    包一層 div 之後 `.box > *` 只剩它一個，原本的 `gap` 幫不到裡面的欄位
11. **金額顯示一律用「目前的主幣別」即時換算**（0.1.28）
    `settings.toBase(amount, code)`＝`amount × rate(code)`。
    ⚠ **不要用 `record.baseAmount`**——那是記帳當下凍結的，主幣別改了不會跟著變。
    ⚠ **只換顯示，不改存的資料**（amount／rate／baseAmount 都是歷史事實）。
    已套用：RecordRow／RecordList 組標題／useStats 全部／RecordsView 合計／記帳通知。
    ⚠ `RecordSheet` 的「詳細資訊」刻意維持記帳當下的數字（那是記錄的歷史事實）。
12. **快速金額預設＝設定頁決定，按下去只帶入、不送出**（0.1.29）
    `settings.quickPresets: QuickPreset[]`（`{ id, amount, type, categoryId, note }`），
    記帳頁金額欄上方渲染成 `.qamt__b`。
    ⚠ 外觀**照記錄頁的日期方型按鈕**（`.field`）：42px 高、`--r-md`(12px) 圓角、
    `--line-strong` 描邊、白底、icon＋數字橫排。
    ⚠ **點下去不送出**，一定要使用者自己按「記錄」；金額 ≤ 0＝不帶入；
    分類／備註空＝維持目前選擇；分類被刪掉就當沒指定。
    帶入順序＝類型 → 分類 → 備註 → 金額（金額用 `initCalc()` 逐字 `input()` 再 `equals()`，
    才不會被記成算式）。設定頁那一區有**即時預覽**（`.qprev__b`，外觀跟記帳頁同步）
13. **「檢視」列（分類／最近／依新增時間）只存在於記錄頁**（0.1.29）
    ⚠ 統計頁最上面是**區間選擇**（日／月份／年份／自訂），**沒有**「檢視」那一列。
    使用者常常把兩頁搞混，講「統計頁的檢視／最近」時**先跟他確認是哪一頁**
    - ⚠⚠ **「依新增時間」是一顆按鈕（`.bycat--basis`，在那一列最右、黃框），
      不是「最近」那顆**。它原本是開「最近」時才出現在區間列的 `.rangetag` 小標籤，
      0.1.29 才搬過去並改成可按（使用者特別強調「不是最近的按鈕」）。
      ⚠ 320px 極窄時這一列會掉行（三顆 274px > 那列 254px），是既有行為、不算 bug
    ⚠ 統計頁最上面是**區間選擇**（日／月份／年份／自訂），**沒有**「檢視／最近」。
    使用者常常把兩頁搞混，講「統計頁的檢視／最近」時**先跟他確認是哪一頁**
14. **`RecordRow` 開「最近」時的時間標籤：不加「交易」二字**（0.1.29）
    prop 是 `timeRecent?: boolean`（RecordList 傳 `dateBasis==='created'`；
    RecordsView 的分類檢視傳 `recent`）。開啟時＝沙漏 icon ＋ `.ttag--recent`，
    而 `.ttag--recent` **只改外框**（淺黃 `--amber-line`）——
    底色 `--surface-3`、字色 `--text-2` 都維持原值（使用者追問時明確選「只改外框顏色」）

## 統計頁「區間記錄」的精選規則（0.1.27）

- **日**＝當天金額最大 10 筆；**月**＝以日分組、組間按「該日總額」、每天取前 2 筆、滿 10 筆；
  **年**＝以月分組（標題變「9月／2026」）、每月 2 筆；**自訂**＝最近 10 筆
- 有「顯示更多（共 N 筆）／收起」；**換範圍會自動收回**
- ⚠ 選誰由金額決定、**顯示順序仍是時間序**；組間排序用「該組**總額**」；
  大小＝`Math.abs(baseAmount)`
- ⚠ 分組標題的金額要用**完整清單**加總（`RecordList` 的 `totals-from`），
  不能用精選後的子集合，否則標題看起來像「這個月只花了這樣」

## 收據辨識記帳（BETA，0.1.26 起在設定頁）

- 入口＝設定頁的 `.sec--beta` 區塊（`ReviewSheet` 也只掛在那一頁）。
  ⚠ `useUpload()` 是**模組層級 singleton** → 搬頁面時要一起搬 `ReviewSheet`
- ⚠ **記帳頁的「收據圖片」區塊（`ReceiptImages`）是完全不同的功能**
  （附加圖片到這次記帳，沒有 OCR），**不要合併、不要動它**
- ⚠ 記帳頁的整頁拖放已拆掉，`drop` 收進 `ReceiptImages` 自己處理
  （需要 `@dragover.prevent`，不然 `drop` 不觸發）

## 視覺基調

米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）；
字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`），不用漸層／玻璃擬態。
