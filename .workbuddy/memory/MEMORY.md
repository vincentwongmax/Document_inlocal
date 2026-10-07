# 記帳本（mop-ledger）

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（本機沒有 E: 槽），分支 `main`。

## 版本號與變更紀錄（2026-10-07 起）

- 版號 `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.2`
- **單一來源＝`package.json` 的 `version`**：`vite.config.ts` 的 `define` 注入
  `__APP_VERSION__`（型別在 `env.d.ts`）→ `src/lib/version.ts` 的 `APP_VERSION`
  → 設定頁「離線與版本」顯示
- 每次更新：改 `package.json` 的 `version` ＋ 到 **`CHANGELOG.md`** 補一筆

## 啟動 / 部署 / Git

- 平常 `npm run preview` → :4173（服務 `dist/`，改完要先 `npm run build`）；開發 `npm run dev` → :5173
- ⚠ 兩個埠的 localStorage 分開，真實資料只在其中一邊
- ⚠ **只 commit 本機，不主動 push／部署**（使用者指示）；要動遠端先問、先拿 PAT
- Repo `vincentwongmax/Document_inlocal`，部署走 `gh-pages`，線上 `…github.io/Document_inlocal/`
- ⚠ **別用 Pages base 蓋掉 `dist/`**（白畫面）；base 由 `resolveBase()` 自動判斷
- PWA 快取：看到舊版先 Ctrl+Shift+R／無痕；測試一律用全新 profile
## 驗證流程

`npx vue-tsc --noEmit` → `npm run build` → `.smoke/vNN.mjs` → 截圖 → commit（本地）

- 跑：`"C:/Users/User/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" .smoke/vNN.mjs`
  （**不要**設 `TEMP=E:\wb-tmp`，沒有 E: 槽會 mkdtemp ENOENT）
- Chrome 在 `C:/Program Files/Google/Chrome/Application/chrome.exe`；
  puppeteer-core 裝在 `C:\Users\user\.workbuddy\binaries\node\workspace\`
- ⚠ 斷言「跟某來源一致」要去讀來源（如 v79 讀 `package.json`），別寫死值
- ⚠ **`npm install <pkg>` 會拔掉 `@esbuild/win32-x64`**，接著 build 就爆「needed by esbuild」。
  那是 esbuild 的 optionalDependencies（**不該**寫進 package.json）：從 package.json 刪掉
  那行再跑一次 `npm install` 就會裝回來
- 沙箱：`reg.exe` 被擋、Bash 叫 powershell 被擋、個人目錄刪除被攔 → 回報使用者別硬刪
- `.smoke/` 在 `.gitignore`；`CHANGELOG.md` 要進版控

## 通知（SweetAlert2，2026-10-07 起）

- **唯一出口 `src/lib/alerts.ts`**（參數與 JSDoc 在檔案裡），不要再自己刻 toast／確認彈窗
  （舊的 `ToastHost.vue`／`ConfirmDialog.vue`／`composables/useToast.ts` 已刪）
  - `notify()` 底部置中 Toast，kind `ok|warn|info|error` → 對應 icon；可帶一顆動作按鈕
    （「已記錄…〔復原〕」，只有 `isConfirmed` 才執行）
  - `confirmDialog()` → `'confirm' | 'deny' | 'cancel'`（三鍵＝匯入的 連設定／只記錄／取消）；
    `danger` 用紅鈕＋warning icon
  - `askUpdate()`：PWA 有新版時問「立即更新／稍後」
- 外觀用 **SweetAlert2 官方原生樣式**（使用者指定），**不要**套專案的米白墨綠
- ⚠ **官方 CSS 不要 import**：入口 `sweetalert2.all.js` 執行時會把整份 CSS 插成 `<head>` 的
  **行內 `<style>`**，排在所有 `<link>` 之後 → 同權重就贏過 style.css。所以唯一的覆寫
  （置底 Toast 讓開導航列）**必須加 `!important`**：
  `body.swal2-toast-shown .swal2-container.swal2-bottom { bottom: calc(var(--nav-h) + var(--safe-b) + 14px) }`
  （≥1024px 改 22px）
- sheet 開著（body 被釘成 fixed）時 SweetAlert 仍正確疊在最上層 —— fixed 的包含塊是視窗
- ⚠ 想驗「Toast 沒遮罩」別看 `body.swal2-shown`（Toast 也會加），要看容器的計算底色

## 分類階層

- `parentId` 多層；子分類沿用上層 type／color；有子分類不給刪；刪除＝封存
- 樹工具：`childrenOf / hasChildren / pathOf / descendantIds / fullNameOf / canRemove / topCategoriesByType`
- **下拉一律用 `lib/tree.ts` 的 `flattenCategories()`**（直接 map 會讓子分類全擠到最後）；
  chips 用 `topCategoriesByType`，下拉（`variant="select"`）**必須用 `selectList`**；下拉不縮排
- `PathLabel.vue` 折成「頭 › … › 尾」，只能放在 `flex: 1; min-width: 0` 的容器
- `CategoryManageModal` 分段展開（哨兵 `PICK='__pick__'`）；**表單載入別 `watch(pickedId)`**
  （非同步會蓋值）→ 用 `@update:model-value="choose"`；切類型用同步 `setType()`
- 記錄頁「分類」檢視只依根大類分組，大類自身金額補「未細分」列（id 加 `__own`）
- 統計頁分類佔比含整棵子樹，展開後百分比是「佔上一層」

## 收據圖片

- `lib/imaging.ts`：`MAX_EDGE=1600`、`TARGET_BYTES=300KB`、品質最低 0.62、縮尺寸只退兩階
  - ⚠ **不要再往下調**（使用者反映過「壓縮太嚴重、看不清」）；舊圖（480p／40KB）救不回來
  - ⚠ 量失真要把舊圖**放大回新圖尺寸**再比，別各自在自己的尺寸比

## iOS（PWA）觸控

- 連點按鈕被判成 double-tap → 放大／畫面往下跑。解法：全域
  `html { touch-action: manipulation }` ＋ 按鈕類 `touch-action: manipulation; user-select: none`
  - ⚠ `user-select: none` **不要套 `label`**（iOS 會繼承進 input，輸入框不能選字）
  - touch-action 不是繼承屬性，要寫在元素本身；且**由目標往上交集**

## 記帳頁

- 金額欄 → `CalcSheet.vue`（置中卡片、整頁不捲）；分類「更多」→ `CategorySheet.vue`
- **計算機只有一個模式**：`Keypad.vue` 固定 5 列 × 4 欄、沒有展開鈕
  （⌫ ( ) ÷ ／ 7 8 9 × ／ 4 5 6 − ／ 1 2 3 ＋ ／ C 0 . ＝）
  - 運算鍵與 ⌫ 用 SVG 描邊圖示；每顆鍵有 `data-key`（測試用 `[data-key="×"]`，別用 textContent）
  - ⚠ ÷ 圓點要**用 class** 設 `fill: currentColor`（`.kic{fill:none}` 是 CSS，會蓋掉屬性）
- **鎖背景捲動用 `composables/useScrollLock.ts`**，三段缺一都會漏：
  ① `<html>` 掛 `is-locked`（`overflow:hidden`＋`overscroll-behavior:none`）擋滾輪
  ② **body 變 `position:fixed; top:-savedY`**（只加 overflow 會讓 scrollTop 歸零、跳回最上面；
  也是 iOS Safari 唯一擋得住手指滑動的做法）　③ 非 passive `touchmove` preventDefault
  - `{ scrollable: () => el }` 只放行該元素內的滑動；模組層有 `locks` 計數器
  - ⚠ 別在彈窗最外層設 `touch-action:none`（交集會把子孫的 pan-y 一起取消）
  - ⚠ 測背景有沒有動別看 `scrollTop`（body fixed 後就是 0），量 `rect.top`
- **日期欄要跟備註同寬**：`DateTimeField` 放 `.pad__meta`（**別放回 `.pad__row`**，
  那列按鈕的 min-width 會把日期欄帶寬）
- 數主頁 chips 用 `.catbox .picker > .cats .cat__name`（`.catbox .cat` 會混入子分類列）

## 統計頁 / 設定頁

- 統計頁三張摘要卡用 `fmtNum()` 純數字，**幣別只在標題右邊膠囊**（`.page-cur`）；
  其餘金額（副標題、分類佔比、甜甜圈中心）維持 `fmtMoney(..., base)`
- 設定頁「離線與版本」顯示 `v{{ APP_VERSION }}` 膠囊（容器要用 **`div`**：
  `.row > span` 有 `flex-direction: column`，用 span 會把膠囊擠到按鈕上面）
- 「主頁常用分類」面板**不做縮排、不改格線對齊**（使用者要求排列整齊）；子分類靠 `└` 記號

## 資料與樣式

- localStorage `mop-ledger.{records,settings,draft}.v1`；收據原圖在 IndexedDB
- 米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
  支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）
- 字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`）
- ⚠ 「標籤＋說明」列**別用 flex**（中文 min-content 只 1 字會壓縮標籤）→ 用
  `grid-template-columns: max-content minmax(0, 1fr)`
- 共用件（改動要一併回歸）：`DateTimeField`、`ClearableInput`、`CategoryIcon`、
  `CategoryPicker`、`RecordList`、`RecordRow`、`HighlightText`- **維護中的回歸集＝v70～v80**（41／31／18／21／39／17／15／48／20／42）
  - ⚠ `v45`／`v46`／`v56`／`v57` 是舊的（引用首頁 `.key--eq`、`.toast__text`、舊 `.catbox`），
    早就陸續失效，別拿它們當基準
- ⚠ 已知未修：`ReviewSheet.vue` 的 `.grid` 在 ≥768px 變兩欄，「時間」只剩半寬、對不齊「備註」
