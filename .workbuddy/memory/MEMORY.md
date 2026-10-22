# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。
逐版細節在 `CONVENTIONS.md` 與 `.workbuddy/memory/YYYY-MM-DD.md`；這裡只放**每次動手都會用到**的。

## 版本
- 只加 Z（目前 **0.1.80**，已部署線上：main `787c3cf`／gh-pages `4a415c6`）；改 package.json ＋ CHANGELOG（插最前面 `---` 後）
- ⚠ `.smoke/` 在 .gitignore → 版本 commit 只含 src/、CHANGELOG、package.json、.workbuddy/memory
- **0.1.80（已部署）**：① 數量模式「記帳頁排版」清單恢復「支出/收入」（0.1.75 濾掉、0.1.76 只修了 HomeView 忘了 SettingsView 的 `layoutItems`）；② 「顯示與上一筆記錄的時間差」改名「上一筆記錄時間差」；③ 第四款 app icon「翠綠」mint（鮮綠＋奶油核對勾，`public/icons/mint/`）
- **0.1.79（本地 commit，未部署）**：移除 0.1.78 的一次性遷移（`runQtyModeMigration`/`clearWalletRecords`/旗標全刪）——不會有用戶踩到舊數量錢包
- **0.1.78（已部署）**：① 模式切換整套移除，只在「新增錢包」面板選；② 管理分類頁匯出/匯入 icon 鈕；③ 3 款 app icon（classic/ink/blaze）

## 開發／驗證
- preview :4173（**改完必先 build**）；dev :5173（兩個 ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準＝每支 exit code**；ALL＝v70~v152（76 支，v108 不存在；v84 既有紅燈不修）
- ⚠ 升版後必先 build（APP_VERSION 編譯期注入）＋每支「版本是 X」斷言跟著改（v132~v147、v149~v152；v148 與 `-live` 系列除外）
- ⚠ 升版「版本斷言清单」要一次看完 v132~v152 全部——0.1.78 那次只改守門員，v132~v145 共 14 支靠回歸才暴露（0.1.79 起事前全改，回歸一次過）
- ⚠⚠ 本地回歸 dist **不能帶 VITE_BASE**（preview 伺服根目錄，帶了全 404 假紅）；部署前才 `MSYS_NO_PATHCONV=1 VITE_BASE=/Document_inlocal/` 重建，部署後重建回不帶 base
- ⚠ 冷啟 `Navigation timeout 30s`＝環境假紅（單獨重跑）；v113/v135 偶發 timing flake 同理
- ⚠⚠ 往既有元件加按鈕/徽章前，先 grep 舊測試脆弱選擇器（「第一顆 `.wcard__btn`」「精確比對 `.wcard__sub`」）——開關鈕放編輯鈕**後**、徽章放 `.wcard__row` 內但 `.wcard__sub` **外**
- ⚠⚠ 設定頁加區塊/新下拉前，先 grep `querySelector('.page-head select, select')` 這類「頁面第一個 select」（區塊順序＝測試隱性依賴）
- ⚠⚠ `<script setup>` 模板裡對 const computed 賦值**不觸發 setter** → 一律寫明確函式接事件
- ⚠ 測試 seed 用相對現在的時間，別寫當天絕對時刻（記錄頁預設區間「今天」，未來時間會退回絕對值）
- ⚠ 測滾動/餵食用 `scrollBy` 小段滑，別 `scrollTo` 一次跳底
- ⚠ headless 下 `input[type=file].click()` 不發 `filechooser` → await 會**永遠卡死**，改監測 click 次數（覆寫 `HTMLInputElement.prototype.click` 計數）
- ⚠ `git -c core.quotePath=false ls-files`（中文檔名會被跳逸輸出 → `[ -f "$p" ]` 判 false → 靜默漏檔）
- MoreFilterMenu 點選項**不會自己關閉** → 測試第二次操作前先判斷 `.mf__pop` 是否已開
- 測試殺手：`deleteDatabase` 只能 reload 後；`isRealErr()+ENV_NOISE` 照抄；等狀態不等時間；防空集合假通過

## Git／部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；線上驗證＝**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：`grep -rhoE "ghp_[A-Za-z0-9]{36}"`（長度 40，**不寫進任何檔案**）
- ⚠⚠ **外網連線特性**：環境的 `https_proxy`（127.0.0.1:51837）對 github.io **回 502**，只有**直連**通 → 別給 Chrome 加 `--proxy-server`；直連 DNS 會瞬斷（Chrome `ERR_NAME_NOT_RESOLVED`／curl exit 6，nslookup 也超時）→ 是環境假紅，重試即可
- ⚠⚠ git push 常被代理截斷 → 走 REST API：`.smoke/api-sync.mjs`（main）＋`.smoke/deploy-api.mjs`（gh-pages）
  - 本機清單：`git -c core.quotePath=false ls-files | while IFS= read -r p; do [ -f "$p" ] && printf '%s\t%s\n' "$(git hash-object "$p")" "$p"; done > .smoke/local-hash.txt`（bash 端生好再給 node 讀）
  - ⚠ 不要用 `api-push.mjs`；deploy 前後各跑一次 api-sync（第二次應印「遠端已與本機一致」）當驗證
- ⚠⚠ 工作區文字檔（ts/vue/md/json/css/html）保持 **LF**（api-sync 上傳原始位元組，CRLF 會永不收斂）；二進位檔（png 等）**絕不能** LF 化
- 推完本地 remote-tracking ref 一定是舊的（正常）；確認遠端用 `curl .../commits/<branch>` 或線上 version.json
- live 測試（v109-live~v137-live，29 支）版本斷言跟**線上**版本；⚠ 除了 `pkgVersion ===` 還有**寫死的線上版本值**（v136-live 比對 version.json）→ 升版後 `grep "=== '0\.1\." .smoke/v*-live.mjs` 全掃
- ⚠ Pages 部署後 version.json 晚 20–120 秒才換（輪詢確認，別誤判失敗）

## 資料模型
- wallets.v1＝{wallets, activeWalletId}；每錢包 `setting.<id>.v1`（預設 `w_default`）；`records`＝當前錢包 computed
- 匯出 JSON=format2（可還原）／Excel=.zip（不含設定）
- **匯率凍結**：顯示＝該筆快照的 `rate`；`recRate()` 最前面短路 `r.currency===dc → 1`，0.1.77 起無 `currency` 回 1；「更新匯率」只寫 `rates`（舊記錄不動）
- **不計入統計三態**：`undefined`＝跟隨分類／`true`／`false`；判別式 `r.excludeFromStats ?? settings.categoryExcluded(r.categoryId)`
- **數量模式（每錢包各自，0.1.75 開場）**：`settings.quantityMode` computed（模板自動 unwrap，script 內**不可**加 `.value`）；`catStore()` 是分類唯一來源（數量模式→`qCategories`，不分收支、type 一律 'expense'）；純數字顯示 `fmtMoney(v, '')`；0.1.76 起有收支（銷貨/庫存一正一負），只有幣別/匯率全站隱藏；數量模式解析分類一律傳 'expense'
- **0.1.78：模式只能在「新增錢包」時選，不支援中途切換**（切換整套已刪）。**0.1.79 起連一次性遷移也移除**（`runQtyModeMigration`/`clearWalletRecords`/旗標全刪）——不會有用戶踩到舊數量錢包，數量錢包的記錄不會被清。`TxRecord` 的 currency/rate/baseCurrency/baseAmount 仍是 optional（0.1.77 留下來的型別狀態）
- **匯出/匯入分類（0.1.78）**：格式記號 `mop-ledger.categories.v1`；`settings.importCategories(list)` 回 `{added, skipped}`——同 id、或同名＋同收支型 → 略過；parentId 經 idMap 重新對映；保留檔案 id。匯出檔名 `分類-YYYY-MM-DD.json`，子分類自動帶入上層（`withAncestors`）
- **App 圖示（0.1.78；0.1.80 加第四款）**：`lib/appIcon.ts`；localStorage `mop-ledger.ui.appIcon.v1`（App 層級）；四款 classic/ink/blaze/mint（mint＝鮮綠底＋奶油核對勾）；iOS 讀 `<link rel="apple-touch-icon">`（每款都重設）、Android 讀 manifest（非 classic 換 `manifest-{key}.webmanifest`，classic 還原 `ORIGINAL_MANIFEST_HREF`）；圖示由 `scripts/gen-icons.mjs` 純 Node 繪製（加新款＝加 draw 函式＋STYLES 一行＋manifest-{key}.webmanifest＋appIcon.ts 三處）
- **小數位數（每錢包 `moneyDecimals` 預設 2）**：`currency.ts` module 級 `moneyDecimals`＋`setMoneyDecimals()`，`fmtMoney/fmtNum/fmtCompact` 預設讀它；只改顯示不改資料

## 元件幾何（全站共用）
- 底部彈層＝`.mask > .card.bsheet`（`.bsheet__grab`＋`.box.bsheet__body` 唯一可捲＋下拉關閉＋背景鎖）
- **頁腳固定**：`.foot` 放 `.bsheet` 直接子元素（**不是** `.box` 裡）→ `flex:none`＋`border-top`＋`padding:12px 18px 16px`
- z-index：tabbar 40／一般彈層與匯入彈窗 90／格子編輯器 96
- ⚠⚠ Vue 模板 HTML 註解內**不能有 `-->` 箭頭**，一律寫「→」

## 視覺
米白紙感；收入墨綠 `#2c6e5b`（`--accent`）、支出 `#bf563c`（`--expense`）、琥珀 `#d9a326`＝旅行、橘 `#c95f16`＝「排」。

## 近期版本重點（更早見 CONVENTIONS.md／日日誌）
- **0.1.80** 數量模式排版清單恢復「支出/收入」（⚠ 教訓：0.1.76 恢復收支時只改 HomeView，忘了 SettingsView 的 `layoutItems` filter——**同一份行為有兩處實作（設定頁清單＋記帳頁渲染）時，改一處要想起另一處**）＋「上一筆記錄時間差」改名＋第四款 icon 翠綠。守門員 v152（42 斷言）＋v149（52 斷言）
- **0.1.79** 移除 0.1.78 的一次性遷移整套（`runQtyModeMigration`/`clearWalletRecords`/旗標）——不會有用戶踩到舊數量錢包；數量錢包記錄不會被清（v151 ② 翻轉實測）
- **0.1.78（已部署）** 移除模式切換（只在新增錢包時選）＋管理分類頁匯出/匯入（勾選清單、跳過重複、parentId 重對映）＋3 款 app icon 可選（classic/ink/blaze；⚠ manifest 切回 classic 要還原）。守門員 **v152（40 斷言）**；v149/v151 翻修；⚠⚠ 純 Node PNG 的 rrect 圓角 `dy` 要用 `h` 不是 `w`
- **0.1.77** 模式轉換重做＋記錄頁「顯示與上一筆記錄的時間差」（`lib/date.ts` `formatGap`；RecordList `gapOf` 攤平所有日分組、RecordRow `gapText`/`.tgap`、byCat 組內算；MoreFilterMenu extras 2 項、computed 合併要寫明確函式）。守門員 **v151（30 斷言）**＋**unit-gap（11 斷言）**
- **0.1.76** 數量模式加回收支＋小數位數設定＋側欄純數字＋設定頁頁尾主幣別 v-if；守門員 v150
- **0.1.75** 數量模式開場（qCategories 進貨/銷貨/庫存/其他、全站隱藏貨幣）；守門員 v149
- **0.1.74** 明細不重複選壓縮率＋計算機長算式三級字級（⚠ 用 `Range` 量自然寬、字級直接寫 DOM 不用 `:style`、量前先還原 base 字級）；v148
- **0.1.72** 快速記帳併入匯入彈窗＋燈箱內壓縮等級＋`keepDraft` 暫存；v145/v146
- **0.1.71** 匯入彈窗桌機加寬＋快速記錄標題列 `min-width:486px`＋imgLevels 延遲寫入；v145
