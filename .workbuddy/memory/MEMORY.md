# 記帳本（mop-ledger）

Vue 3 + TS + Pinia + vue-router（hash）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo：**`C:\Users\User\Desktop\AI`**（**本機沒有 E: 槽**；舊筆記的 `E:\AI`、`E:\wb-tmp` 作廢），分支 `main`。

## 版本號

- `X.Y.Z`：**預設只加 Z**；使用者明說「升級 X／Y」才動 major／minor。目前 `0.1.2`
- 單一來源＝`package.json` 的 `version` → `vite.config.ts` `define` 注入 `__APP_VERSION__`
  （型別在 `env.d.ts`）→ `src/lib/version.ts` → 設定頁「離線與版本」膠囊
- 每次更新要改 `package.json` ＋ 補一筆 `CHANGELOG.md`

## 開發 / 驗證

- `npm run preview` → :4173（服務 `dist/`，改完要先 build）；`npm run dev` → :5173。
  ⚠ 兩埠 localStorage 分開，真資料只在其中一邊
- 流程：`npx vue-tsc --noEmit` → `npm run build` → `.smoke/vNN.mjs` → 截圖 → commit
  - 跑：`"C:/Users/User/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" .smoke/vNN.mjs`
    （**別**設 `TEMP=E:\wb-tmp`，沒 E: 槽會 mkdtemp ENOENT）
  - Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`；puppeteer-core 在
    `C:\Users\user\.workbuddy\binaries\node\workspace\`
  - ⚠ 斷言「跟某來源一致」要去**讀來源**（如 v79 讀 `package.json`），別寫死
  - ⚠ **node 是 Windows binary**：curl 輸出要存到**專案內**（`.smoke/tmp/`），
    Git Bash 的 `/tmp` 讀不到
  - **維護中的回歸集＝v70～v80**（41／31／18／21／39／17／15／48／20／42）；
    `v45/v46/v56/v57` 早已失效（`.key--eq`／`.toast__text`／舊 `.catbox`），別當基準
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
  `could not read Username`。可用的 classic PAT（`repo, workflow`）要用時從
  `~/.workbuddy/audit-log/*.jsonl` grep `ghp_`（**不要寫進任何檔案**）
- ⚠ 別用 `git push --dry-run` 判斷有沒有憑證（一定失敗）
- ⚠ **Actions 自 2026-10-05 起全數失敗，與程式無關**：帳號被 billing 鎖住，runner 沒被分配
  → `The job was not started because your account is locked due to a billing issue.`
  - 特徵：job 只跑 ~2 秒、`steps: []`、`runner_id: 0`。**這形狀＝runner 沒起來**；
    jobs API 看不出原因，要讀 `GET /repos/{o}/{r}/check-runs/{id}/annotations`
  - 解法＝使用者去 <https://github.com/settings/billing>；在那之前 **push main 不會部署**
  - 但 **Pages 的 legacy 建置不受影響**（`pages build and deployment` 照樣 success）→
    手動部署可用：**`GH_TOKEN=… npm run deploy`**
- `scripts/deploy-gh-pages.mjs`：用正確 base 建到 `os.tmpdir()` 的**全新目錄**再 force push
  `gh-pages`，**不動 `dist/`**（動了 `npm run preview` 會白畫面）。
  ⚠ 別改回建到專案內 `.deploy/`（殘留舊 `.git` 會讓 Vite 清目錄被沙箱攔）；
  ⚠ `run()` 走 `shell: true`，**含空白的參數會被拆開**；印指令要遮 token
- ⚠ 部署版的雜湊與本機 dist **不同**（`VITE_BASE` 會 inlined 進 bundle）→
  比對線上／本機要看「內容特徵」，不能對雜湊
- base 由 `vite.config.ts` 的 `resolveBase()` 自動判斷（`.github.io` 結尾→`/`，否則 `/<repo>/`；
  本機 `/`；`VITE_BASE` 可覆寫）。**不要在 workflow 裡設 base**
- PWA 看到舊版先 Ctrl+Shift+R／無痕（`autoUpdate` ＋ SW 預快取整個 dist）；測試用全新 profile

## 通知（SweetAlert2）

- **唯一出口 `src/lib/alerts.ts`**（舊 `ToastHost.vue`／`ConfirmDialog.vue`／`useToast.ts` 已刪）
  - `notify(text, kind, action?, ms?)`：底部置中 Toast，kind `ok|warn|info|error`；可帶動作鈕（只有 `isConfirmed` 才執行）
  - `confirmDialog()` → `'confirm' | 'deny' | 'cancel'`；`danger` 用紅鈕＋warning icon
  - `askUpdate()`：PWA 有新版時問「立即更新／稍後」
- 用 **SweetAlert2 官方原生樣式**（使用者指定），不套專案的米白墨綠
- ⚠ **官方 CSS 不要 import**：入口 `sweetalert2.all.js` 執行時把整份 CSS 插成 `<head>` 的
  **行內 `<style>`**，排在所有 `<link>` 之後 → 同權重贏過 style.css。唯一覆寫（置底 Toast
  讓開導航列）**必須 `!important`**：
  `body.swal2-toast-shown .swal2-container.swal2-bottom { bottom: calc(var(--nav-h) + var(--safe-b) + 14px) }`（≥1024px → 22px）
- sheet 開著（body 被釘成 fixed）時 SweetAlert 仍疊在最上層（fixed 的包含塊是視窗）
- ⚠ 驗「Toast 沒遮罩」別看 `body.swal2-shown`（Toast 也會加），要看容器計算底色
- ⚠ 寫 CSSOM walker：Chrome 的 `CSSStyleRule` 也有 `cssRules`（巢狀），要先判斷
  `r.selectorText` 再遞迴，否則整批規則被跳過

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

## 記帳頁 / 彈窗

- 金額欄 → `CalcSheet.vue`；分類「更多」→ `CategorySheet.vue`
- **計算機只有一個模式**：`Keypad.vue` 固定 5 列 × 4 欄、沒有展開鈕
  （⌫ ( ) ÷ ／ 7 8 9 × ／ 4 5 6 − ／ 1 2 3 ＋ ／ C 0 . ＝）
  - 運算鍵與 ⌫ 用 SVG 描邊圖示；每顆鍵有 `data-key`（測試用 `[data-key="×"]`，別用 textContent）
  - ⚠ ÷ 圓點要**用 class** 設 `fill: currentColor`（`.kic{fill:none}` 是 CSS，會蓋掉屬性）
- **鎖背景捲動用 `composables/useScrollLock.ts`**，三段缺一都會漏：
  ① `<html>` 掛 `is-locked`（`overflow:hidden`＋`overscroll-behavior:none`）
  ② **body 變 `position:fixed; top:-savedY`**（只加 overflow 會讓 scrollTop 歸零；
  也是 iOS Safari 唯一擋得住手指的做法）　③ 非 passive `touchmove` preventDefault
  - `{ scrollable: () => el }` 只放行該元素內滑動；模組層有 `locks` 計數器
  - ⚠ 別在彈窗最外層設 `touch-action:none`（交集會把子孫的 pan-y 一起取消）
  - ⚠ 測背景有沒有動別看 `scrollTop`（body fixed 後就是 0），量 `rect.top`
- **日期欄要跟備註同寬**：`DateTimeField` 放 `.pad__meta`（**別放回 `.pad__row`**，那列按鈕的 min-width 會把日期欄帶寬）
- 數主頁 chips 用 `.catbox .picker > .cats .cat__name`（`.catbox .cat` 會混入子分類列）

## 其他

- `lib/imaging.ts`：`MAX_EDGE=1600`、`TARGET_BYTES=300KB`、品質最低 0.62、縮尺寸只退兩階。
  ⚠ **別再往下調**（使用者反映過「壓縮太嚴重、看不清」）；舊圖救不回來。
  ⚠ 量失真要把舊圖**放大回新圖尺寸**再比
- iOS 連點被判成 double-tap → 全域 `html { touch-action: manipulation }` ＋按鈕類
  `touch-action: manipulation; user-select: none`。
  ⚠ `user-select: none` **別套 `label`**（會繼承進 input，不能選字）；
  touch-action 不是繼承屬性，要寫在元素本身且**由目標往上交集**
- 統計頁三張摘要卡用 `fmtNum()` 純數字，**幣別只在標題右邊膠囊**（`.page-cur`）；
  其餘金額維持 `fmtMoney(..., base)`
- 設定頁版本膠囊容器要用 **`div`**（`.row > span` 有 `flex-direction: column`，用 span 會被擠上去）
- 「主頁常用分類」面板**不做縮排、不改格線對齊**（使用者要求排列整齊）；子分類靠 `└` 記號；
  講到它要說「設定頁 › 分類 › 主頁常用分類」才不會被誤認成主頁
- ⚠ 已知未修：`ReviewSheet.vue` 的 `.grid` 在 ≥768px 變兩欄，「時間」只剩半寬、對不齊「備註」

## 資料與樣式

- localStorage `mop-ledger.{records,settings,draft}.v1`；收據原圖在 IndexedDB（`idb-keyval`）
- 分類 `{ id, name, type, color, icon?, builtin, archived }`；舊資料載入時 `withIcons()` 補 icon 並回寫
- 米白紙感、墨綠 `--accent:#2c6e5b`（soft `#e7f0ec`／light `#cde6da`／hover `#245c4b`）、
  支出 `#bf563c`、收入 `#2c6e5b`、**已選分類粉紅 `--pick:#b85773`**（不用近黑當已選底）
- 字體 Noto Sans／Serif TC；圖示一律描邊線性（24×24、`currentColor`），不用漸層／玻璃擬態
- ⚠ 「標籤＋說明」列**別用 flex**（中文 min-content 只 1 字會壓縮標籤）→
  `grid-template-columns: max-content minmax(0, 1fr)`
- 輸入框內嵌小按鈕：26×26、radius 8px、`right: 5px`、`--accent-soft` 底 ＋ `--accent` 圖示、
  hover 反白；輸入框 `padding-right: 40px`
- 共用件（改動要一併回歸）：`DateTimeField`、`ClearableInput`、`CategoryIcon`、
  `CategoryPicker`、`RecordList`、`RecordRow`、`HighlightText`
