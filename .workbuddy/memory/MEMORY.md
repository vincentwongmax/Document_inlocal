# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。
逐版細節在 `CONVENTIONS.md` 與 `.workbuddy/memory/YYYY-MM-DD.md`；這裡只放**每次動手都會用到**的。

## 版本
- 只加 Z（目前 **0.1.84**，已部署線上：main `7b3fe00`／gh-pages `4d5879f`）；改 package.json ＋ CHANGELOG（插最前面 `---` 後）
- ⚠ `.smoke/` 在 .gitignore → 版本 commit 只含 src/、CHANGELOG、package.json、.workbuddy/memory
- **0.1.84（已部署線上）**：Face ID 模式**打開 App 就自動跳 Face ID，不用再按按鈕**——`AppLock.vue` `onMounted` 自動呼叫 `credentials.get()`（`setTimeout 160ms` 讓鎖屏先畫出來）；自動失敗**不出紅字**；按鈕留作重試（`onFaceIdClick`，⚠ 不可直接綁 `tryFaceId`，MouseEvent 會被當 `fromAuto=true`）；`appLock.ts` 加 `autoFaceIdAllowed()`——按完「立即上鎖」**5 秒內不自動跳**（否則一鎖就被解開）。非 iOS 先 `await detectPlatformAuth()` 才決定要不要跳（沒有平台驗證器就別跳，不然卡「驗證中…」）。守門員 **v155（14 斷言，CDP 虛擬平台驗證器）**＋v154 加 6 條（共 45）
  - ⚠⚠ **iOS 的「使用通行密鑰登入」系統面板無法用網頁移除**（web.dev：iCloud Keychain 的憑證一律是同步通行密鑰，RP 無法建 non-discoverable／裝置綁定）→ 本 App 只能拿掉自己那顆按鈕，剩下「系統面板 → Face ID → 進入 App」
- **0.1.83**：設定頁 › **應用鎖**（`lib/appLock.ts`＋`AppLock.vue`＋`LockSettings.vue`）：PIN 4–8 位（PBKDF2-SHA256 12 萬次＋隨機鹽，只存雜湊）／Face ID（WebAuthn，**只在 iPhone/iPad PWA**，桌面只有 PIN）／Face ID 模式保留 PIN 備用／忘記 PIN 用一次性恢復碼（10 碼、只顯示一次、可重產）／切回前台 **>1 分鐘**才重鎖／變更 PIN、開關 Face ID、重產恢復碼、關閉鎖都要先驗目前 PIN。⚠ 畫面上鎖，非資料加密
- **0.1.82（已部署線上 main `4b28723`／gh-pages `10fcd6f`）**：① 修 iOS PWA 日期欄 focus 吞點擊（選完日期後底部「儲存／刪除」要點兩下）——`DateTimeField`/`DateField` 的 `onPicked` 取完值就 `blur()` 那顆透明原生輸入框；共用元件，等於一次修好 RecordSheet/ReviewSheet/HomeView/TravelSheet/ExportModal/TripHistorySheet/RecordsView/StatsView；② 記錄頁「更多」的「上一筆記錄時間差」改名「時間差標籤」
- **0.1.81**：① 記帳頁隱藏日期區塊時記錄時間＝按下當下（不再退回進頁面那刻的殘留值）；② 記錄頁搜索框「精準搜索」開關（完全等於才顯示，localStorage `mop-ledger.ui.exactSearch.v1`，有輸入才出現）；③ 數量模式分類也按收支類型（categoriesByType 去特例、管理分類開放類型、主頁常用分類兩種模式都兩組）
- **0.1.80（已部署線上 main `787c3cf`／gh-pages `4a415c6`）**：① 數量模式「記帳頁排版」清單恢復「支出/收入」；② 「上一筆記錄時間差」改名；③ 第四款 app icon「翠綠」mint（鮮綠＋奶油核對勾，`public/icons/mint/`）
- **0.1.79（本地 commit，未部署）**：移除 0.1.78 的一次性遷移（`runQtyModeMigration`/`clearWalletRecords`/旗標全刪）——不會有用戶踩到舊數量錢包
- **0.1.78（已部署）**：① 模式切換整套移除，只在「新增錢包」面板選；② 管理分類頁匯出/匯入 icon 鈕；③ 3 款 app icon（classic/ink/blaze）

## 開發／驗證
- preview :4173（**改完必先 build**）；dev :5173（兩個 ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準＝每支 exit code**；ALL＝v70~v155（79 支，v108 不存在；v84 既有紅燈不修）
- ⚠ 升版後必先 build（APP_VERSION 編譯期注入）＋每支「版本是 X」斷言跟著改（v132~v155；`-live` 系列另外（v132-live~v137-live））
- ⚠⚠ **升版後一定要先 `npx vite build` 再跑回歸**——不然 dist 裡還是舊版本號，
  所有「設定頁版本＝package.json」／「version.json」類斷言全掛（0.1.81 一次掛了 23 支）
- ⚠ 升版「版本斷言清单」要一次看完 v132~v152 全部——0.1.78 那次只改守門員，v132~v145 共 14 支靠回歸才暴露（0.1.79 起事前全改，回歸一次過）
- ⚠⚠ 本地回歸 dist **不能帶 VITE_BASE**（preview 伺服根目錄，帶了全 404 假紅）；部署前才 `MSYS_NO_PATHCONV=1 VITE_BASE=/Document_inlocal/` 重建，部署後重建回不帶 base
- ⚠ 冷啟 `Navigation timeout 30s`＝環境假紅（單獨重跑）；v113/v135 偶發 timing flake 同理
- ⚠⚠ iOS PWA「點底部鈕要點兩下」＝原生 date/datetime-local 選完仍保持 focus，第一下被 iOS 拿去 blur → 要在 `change` 取值當下就 `blur()`（DateTimeField/DateField 已修）。任何「透明原生輸入框疊在按鈕上」的寫法都要注意
- ⚠⚠ **WebAuthn 自動觸發**：iOS **17.4 起取消**「必須使用者手勢」（改速率限制）→ 可在 `onMounted` 直接 `credentials.get()`；**iOS 16~17.3 每次頁面載入只有一次**免手勢額度，且 **SPA 內不重置**（只有整頁重新載入才恢復）→ 自動嘗試**只能一次**。自動觸發前若要 `await` 別的 async，務必先排除「沒有平台驗證器」的情況（`isUserVerifyingPlatformAuthenticatorAvailable()`），否則 headless／桌機會卡在「驗證中…」90 秒
- ⚠ **測試「需要平台驗證器」的功能**：用 CDP `WebAuthn.enable` ＋ `WebAuthn.addVirtualAuthenticator`（`transport:'internal'`, `isUserVerified:true`, `automaticPresenceSimulation:true`）＝假裝有 Face ID；見 `.smoke/v155.mjs`。可以真的驗「零點擊自動解鎖」
- ⚠ 舊 live 測試 **v120~v131-live 已 drift**（寫死舊線上版本 v0.1.53~56／舊排版 6–7 格 vs 現在 8 格／舊 CSS）→ 不是回歸，別追；升版只需顧 **v132-live 起**那幾支
- ⚠⚠ **Face ID 只能走 WebAuthn**（`navigator.credentials`，iOS 跳出系統 Face ID）：需要 HTTPS＋**使用者手勢**（不能在載入時自動觸發）；判定「可用」＝iOS＋`display-mode: standalone`＋`isUserVerifyingPlatformAuthenticatorAvailable()`。credential 只在裝置上，`rp.id` 用 `location.hostname`
- ⚠ 鎖屏是全屏 fixed、`z-index: 2000`（要蓋過 App 的 96；SweetAlert 是 1060 → 鎖屏上不要用 SweetAlert，恢復碼改成頁內輸入）
- ⚠ 加設定頁新區塊很安全（測試都用「文字」找 section，不是索引）；但**新區塊不要放 `<select>`**（有測試抓「頁面第一個 select」）
- ⚠⚠ 往既有元件加按鈕/徽章前，先 grep 舊測試脆弱選擇器（「第一顆 `.wcard__btn`」「精確比對 `.wcard__sub`」）——開關鈕放編輯鈕**後**、徽章放 `.wcard__row` 內但 `.wcard__sub` **外**
- ⚠⚠ 設定頁加區塊/新下拉前，先 grep `querySelector('.page-head select, select')` 這類「頁面第一個 select」（區塊順序＝測試隱性依賴）
- ⚠⚠ `<script setup>` 模板裡對 const computed 賦值**不觸發 setter** → 一律寫明確函式接事件
- ⚠ 測試 seed 用相對現在的時間，別寫當天絕對時刻（記錄頁預設區間「今天」，未來時間會退回絕對值）
- ⚠ 測試種 `homeLayout` 一定要帶 **`homeLayoutV: 2`**：沒記號會被當 0.1.45 舊編號跑遷移（`[1,2,3,4,6,7] → [1,2,4,5,7]`，想藏的 5 反而加回來）
- ⚠ 測滾動/餵食用 `scrollBy` 小段滑，別 `scrollTo` 一次跳底
- ⚠ preview server 跨 session 會被回收（port 4173 沒人聽）→ 重啟後剛起來的幾秒會回 502，睡一下再打；vite preview 只綁 localhost（本機解析成 ::1）→ 用 `localhost`，**不要用 127.0.0.1**
- ⚠ UI 加按鈕前先想寬度：記錄頁搜索框只有 200px、字級 16px（iOS 防縮放）→ v95 有「placeholder 塞得進」斷言、v111 要求 placeholder 含「旅行」，常駐按鈕會踩雷（解法＝有輸入才出現）
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
- **數量模式（每錢包各自，0.1.75 開場）**：`settings.quantityMode` computed（模板自動 unwrap，script 內**不可**加 `.value`）；`catStore()` 是分類唯一來源（數量模式→`qCategories`）；純數字顯示 `fmtMoney(v, '')`；0.1.76 起有收支，只有幣別/匯率全站隱藏。**0.1.81 起數量分類也按收支類型篩**（`categoriesByType` 不再有數量模式特例；管理分類可選類型；主頁常用分類兩種模式都分支出／收入兩組）——既有數量分類原本全是 expense，按收入會顯示「尚無分類」
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
