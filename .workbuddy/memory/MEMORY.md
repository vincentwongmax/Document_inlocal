# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。
細節（逐版設計決策、CSS 慣例、測試寫法）在 `CONVENTIONS.md`；這裡只放**每次動手都會用到**的東西。

## 版本
- 只加 Z（目前 **0.1.77**）；改 package.json ＋ CHANGELOG（插最前面 `---` 後）
- ⚠ `.smoke/` 在 .gitignore（測試**不會**進 commit）→ 版本 commit 只含 src/、CHANGELOG、package.json、.workbuddy/memory

## 開發／驗證
- preview :4173（**改完必先 build**）；dev :5173（兩個 ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準＝每支 exit code**；ALL＝v70~v151（75 支，v108 不存在）
- ⚠⚠ 回歸跑著時**不要編輯 run-regress.sh**；升版後必先 build（APP_VERSION 是編譯期注入）
- ⚠⚠ **本地回歸 dist 不能帶 VITE_BASE**（preview 伺服在根目錄，帶了全 404 → App 空白假紅）；部署前才帶 base 重建
- 冷啟 `Navigation timeout 30s`＝**環境假紅**（單獨重跑就好）；v113/v135 等偶發 timing flake 同理
- ⚠ 升版後**每支測試的「版本是 X」斷言都要跟著改**（v132~v147、v149、v150 這種；v148 不斷言版本；`-live` 系列除外＝跟線上版本）
- ⚠⚠ **往既有元件加按鈕／徽章前，先 grep 舊測試有沒有用「第一顆 `.wcard__btn`」「精確比對 `.wcard__sub`」這類脆弱選擇器**（0.1.75 實慘：新按鈕排前面 → v99 點到開關而不是編輯 → timeout；徽章黏進 `.wcard__sub` → 精確比對失敗。修法＝開關鈕放編輯鈕**後面**、徽章放 `.wcard__row` 裡但在 `.wcard__sub` **外面**）
- ⚠⚠ **`<script setup>` 模板裡對 `const computed` 賦值不會觸發 setter**（`x = $event` 寫到 setup 物件上）→ 一律寫明確函式接事件
- ⚠⚠ **`git ls-files` 在 core.quotePath 下會把中文檔名輸出成 `"\345\225…"`**（含真的引號與反斜線）→ `[ -f "$p" ]` 判 false → **中文檔名被靜默漏掉**！解法：`git -c core.quotePath=false ls-files`
- ⚠⚠ MoreFilterMenu 的下拉**點選項不會自己關閉**（本來就是多選）→ 測試第二次操作前先判斷 `.mf__pop` 是否已開，否則「點 trigger」其實是在關閉。記錄頁預設區間是「今天」→ 測試種子用今天之外的日期會全被過濾（畫面空白）
- ⚠⚠ **設定頁加新區塊／新下拉前，先 grep `querySelector('.page-head select, select')` 這類「頁面第一個 select」**——v107 用這招改主幣別，0.1.76 加「顯示格式（小數位數）」區後第一個 select 變成它 → 改到錯的下列 → ③ 整段假紅（已把 v107 改成「含『主幣別』那一列裡面的 select」，同 v124 招式）。設定頁區塊順序＝測試隱性依賴，加區塊＝先 grep 舊測試
- ⚠ 測試 seed 別寫「當天絕對時間」（例 14:30）→ 在該時刻之前跑，記錄時間在未來 → 相對時間退回絕對值 → 假紅（v143 ⑥ 實慘，已改成相對現在回推）
- ⚠⚠ 測「無限滾動/餵食」不能用 `scrollTo(0, scrollHeight)` 一次跳到底 → 一律 `scrollBy` 小段滑模擬手指
- ⚠⚠ **puppeteer 在 headless 下 `input[type=file].click()` 不會發 `filechooser` 事件** → `await` 它會**永遠卡死**（0.1.66 實慘）。改監測「input.click 被呼叫幾次」（覆寫 `HTMLInputElement.prototype.click` 計數）
- 測試殺手：`deleteDatabase` 只能 reload 後；`isRealErr()+ENV_NOISE` 照抄；等狀態不等時間；防空集合假通過

## Git／部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；線上驗證＝**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log `ghp_…`（**不寫進任何檔案**）
- ⚠⚠ **git push 常被代理截斷** → 走 REST API：`.smoke/api-sync.mjs`（main，比對遠端 tree vs 本機 blob sha，補齊所有差異）＋`.smoke/deploy-api.mjs`（gh-pages）
  - 本機清單：`git ls-files | while IFS= read -r p; do [ -f "$p" ] && printf '%s\t%s\n' "$(git hash-object "$p")" "$p"; done > .smoke/local-hash.txt`（bash 端生好再給 node 讀，node spawn cmd.exe 會 EBUSY）
  - ⚠ 不要用 `api-push.mjs`（讀 `.smoke/show.txt`，忘了重產生會推到舊清單）
  - deploy 前後各跑一次 api-sync（第二次應印「遠端已與本機一致」）當驗證
- ⚠ 推完後**本地 remote-tracking ref 一定是舊的**（正常，不用修）；確認遠端用 `curl .../commits/<branch>` 或線上 version.json
- ⚠⚠ Git Bash 的 `VITE_BASE=/Document_inlocal/` 會被 MSYS 路徑轉換改掉 → 加 `MSYS_NO_PATHCONV=1`
- live 測試（v132-live…v137-live）版本斷言要跟著**線上**版本（未部署就維持舊值）；0.1.71 部署完 → 這 6 支可升到 0.1.71
- ⚠⚠ **PAT 長度 40**（`ghp_`+36）；用 `grep -rhoE "ghp_[A-Za-z0-9]{36}"` 抓（寫成 `{24}` 之類會截斷成 36 → 401 Bad credentials）
- ⚠ Pages 部署後 API 立刻回新 commit，但**站點還在 building**：version.json 會晚 20–120 秒才換（輪詢確認，別誤判部署失敗）

## 資料模型
- wallets.v1＝{wallets, activeWalletId}；每錢包 `setting.<id>.v1`（預設 `w_default`）；`records`＝當前錢包 computed
- 匯出 JSON=format2（可還原）／Excel=.zip（不含設定）
- **匯率凍結**：記錄顯示＝該筆快照的 `rate`；`recRate()` 最前面短路 `r.currency===dc → 1`；「更新匯率」只寫 `rates`（舊記錄不動）
- **不計入統計三態**：`undefined`＝跟隨分類／`true`／`false`；唯一判別式 `r.excludeFromStats ?? settings.categoryExcluded(r.categoryId)`
- **數量模式（0.1.75 開場、0.1.76 修訂、0.1.77 重做切換，每錢包各自）**：`settings.quantityMode` computed（模板自動 unwrap，script 內**不可**加 `.value`）；`catStore()` 是分類唯一來源（數量模式→`qCategories`，**兩套獨立並存、切換時互不搬移**、**不分收支**、條目 type 一律 'expense'）；純數字顯示統一用 `fmtMoney(v, '')`。⚠ **0.1.76 起數量模式有收支**（銷貨／庫存是一正一負）：記帳頁區塊1／RecordRow ±／RecordSheet 類型 seg／記錄頁篩選與總覽三格／統計三卡＋甜甜圈切換＋typedRows/topRows／ImportModal 6 欄（多「收支」）／quickParse 認 A/B 全都恢復；只有**幣別／匯率**仍然全站隱藏。⚠ 數量模式解析分類一律傳 'expense'（qCategories 同型），ImportModal 的「分類與收支不符」檢查在數量模式跳過
- **⚠⚠ 0.1.77 模式切換語意（三個函式）**：`records.stripMoneyData(walletId)` **真的 `delete`** 記錄的 `currency`/`baseCurrency`/`rate`/`baseAmount`（0.1.75 只是改寫成主幣別 rate=1）→ `TxRecord` 這四欄已改 **optional**，`settings.recRate()` 對無 `currency` 的記錄回 1；`records.restoreMoneyData(walletId, code)` 反向（currency=baseCurrency=code、rate=1、baseAmount=amount）；`records.clearWalletRecords(walletId)` 整份刪（含圖片 blob）。`settings.applyModeSwitch(s, on)` 清舊模式資料：金錢→數量清 categories/favoriteCategories/defaultCategoryId/rates；數量→金錢清 qCategories 且 categories 為空則帶回預設分類。⚠ `merge()` 必須用 `Array.isArray(saved.categories)`（尊重「明確清空」）否則清空後重載又被預設叫回來
- **0.1.77 切換 UI**：`alerts.switchModeDialog()`（保留並轉換／全部清空／取消 ＋「先匯出備份再說」用 `Swal.close({value:'backup'})`）、`alerts.pickBaseCurrency()`（主幣別下拉，html+select+preConfirm）；`WalletSection.applyQuantityMode(w, on, baseCode, wipeAll)`；`settings.baseCurrencyOf(id)`／`setBaseCurrencyFor(id, code)`
- **小數位數（0.1.76，每錢包各自 `moneyDecimals`，預設 2）**：`currency.ts` module 級 `moneyDecimals`＋`setMoneyDecimals()`，`fmtMoney/fmtNum/fmtCompact` 預設讀它（K/M 小數 `Math.min(d, moneyDecimals)`）；settings store `watch(() => state.value.moneyDecimals, sync, { immediate: true })` 同步（import 要 `as syncMoneyDecimals`，store 自己的 setter 同名會遮蔽）；只改顯示不改資料；設定頁「顯示格式」區兩種模式都顯示

## 元件幾何（全站共用）
- 底部彈層＝`.mask > .card.bsheet`（`.bsheet__grab`＋`.box.bsheet__body` 唯一可捲＋下拉關閉＋背景鎖）
- **頁腳固定**：`.foot` 放在 `.bsheet` 直接子元素（**不是** `.box` 裡）→ `flex:none`＋`border-top`＋`padding:12px 18px 16px`（0.1.65 的修法，之後所有彈層照做）
- z-index：tabbar 40／一般彈層與匯入彈窗 90／格子編輯器 96（快速記錄頁已併入匯入彈窗，不再獨立）
- ⚠⚠ Vue 模板 HTML 註解內**不能用 `-->` 箭頭**（註解提前結束→文字外洩）；一律寫「→」

## 視覺
米白紙感；收入墨綠 `#2c6e5b`（`--accent`）、支出 `#bf563c`（`--expense`）、琥珀 `#d9a326`＝旅行、橘 `#c95f16`＝「排」。

## 近期版本重點
- **0.1.77**（本地 commit）兩項需求：① **模式轉換重做**（見資料模型「0.1.77 模式切換語意」＋「0.1.77 切換 UI」）：幣別/匯率**真的刪掉**、分類兩套獨立並存、切換時舊模式那一整套清空、切回彈主幣別下拉並重新換算、對話框三種動作（保留/清空/備份）。② **記錄頁「更多 › 顯示方式 › 顯示與上一筆記錄的時間差」**：`lib/date.ts` 的 `formatGap(newer, older)`（`435D16H26M`/`16H40M`/`4H25M`/`1H00M`/`-- --`；小時不補零、分鐘兩位補零）；RecordList 攤平**所有日分組**後算（跨日也算）→ RecordRow `gapText` prop ＋ `.tgap` 樣式；byCat 檢視在**組內**算。⚠ MoreFilterMenu 只有一個 `extraOn` v-model → computed 合併，**但 computed setter 不會被模板賦值叫到** → 必須寫明確函式 `setExtraOn()`。守門員新 **v151（30 斷言）**＋**unit-gap（11 斷言）**；v149 翻修；v132~v147/v149/v150 版本斷言升 0.1.77
- **0.1.76**（本地 commit，**未部署**）四項需求：① 電腦版側欄「本月結餘」數量模式純數字（`fmtMoney(balance, quantityMode ? '' : base)`）；② 數量模式**加回支出／收入**（0.1.75 移除的全部撤回，只保留幣別隱藏——記帳頁區塊1 的 `.seg__cur` 包 v-if、RecordRow/RecordSheet ±、記錄頁篩選＋總覽三格＋catgrp ±、統計三卡＋甜甜圈＋圖表兩條線＋typedRows/topRows、ImportModal 6 欄 `.tbl--qty` min-width 432px、QuickAmountSheet/HomeDefaultSheet 類型、quickParse 的 `!quantityMode &&` 守衛、ReviewSheet 數量模式多一顆 `.rtype`）；③ 小數位數設定（見資料模型）；④ 設定頁頁尾「主幣別…」整段 `v-if="!settings.quantityMode"`。守門員新 **v150（26 斷言）**；v149 翻修（②~⑥ 從「收支消失」改「收支恢復無貨幣」）；v132~v147 版本斷言升 0.1.76
- **0.1.75**（本地 commit，**未部署**）**數量模式**（每錢包各自開關）：`Settings` 加 `quantityMode`/`qCategories`（`DEFAULT_Q_CATEGORIES` q_ 前綴：進貨/銷貨/庫存/其他）；`WalletSection` 每卡一顆 `.wcard__qty` 開關（在 `.wcard__main` **外**、編輯鈕**後**）＋`.wcard__mode` 徽章（在 `.wcard__row` 裡、`.wcard__sub` **外**）＋三鈕 confirmDialog（deny＝先匯出備份→emit backup）；全站「金額」改「數量」、貨幣符號/下拉/匯率列整組不渲染（不是灰掉）；統計頁三卡縮一張「合計」；ImportModal 數量模式 5 欄＋`.tbl--qty` grid（min-width 434px）；exportExcel 數量模式欄位減去收支/幣別/匯率/主幣金額。⚠ 兩個實戰坑見「開發／驗證」末條（v99 脆弱選擇器）。守門員 **v149（46 斷言）**
- **0.1.74** 記錄後明細頁**不再重複選壓縮率**（0.1.73 的 `hasEditable`/`isLocked` 機制已滿足，v148① 實測釘死：記錄來的圖明細頁無等級鈕、明細頁新加圖可選原ABCD）；移除記帳頁「點擊修改」（`HomeView` 改 `<em v-if="!calc.tokens.length">點擊輸入金額</em>`）；**計算機長算式 iPhone 爆畫面修好**——⚠ 三個坑：①`.calcdisp__num` 是 flex item、`min-width:auto` 不肯被壓縮 → 新增 `.calcdisp__fit`（`min-width:0`＋`overflow:hidden`）；②量「自然寬度」**不能用 `scrollWidth`**（有 `max-width:100%` 會被夾在容器寬內 → 永遠量不到）**也不能用 `getBoundingClientRect()`**（量到已壓縮後的寬度）→ 只能用 `Range.selectNodeContents()`；③⚠⚠ **量之前必須先把字級還原成 base**，否則第二次量到縮後寬度 → 判定「放得下」→ 還原回去，在 24px 與縮排之間跳動、看起來就是沒生效。⚠⚠ **字級直接寫 DOM（`num.style.fontSize`），不要用 template `:style`**——實測 production build 下 `:style` 綁定**沒有被 Vue 寫進 DOM**（style 屬性從未出現），等距縮排等於沒作用。實測 22 字元 → 23.43px、超長 → 22.4px、v82 的 12 字元仍 38px。守門員新 **v148（29 斷言）**
- **0.1.73** 記帳頁燈箱**即時預覽**修好（根因＝`ReceiptImages.refreshUrl()` **漏了 `await`**；`RecordSheet` 同一函式有 → 沒 await 時下一行讀 `urls.value[id]` 拿到 undefined，`?? lightbox.value` 就保留舊 src。`applyAll`/`onLightboxLevel` 兩處補上）；需求 2「記錄後鎖定＋只存當前等級」經 v147 實測已由 0.1.71 延遲寫入模型滿足；**已儲存/已記錄 → 等級鈕整排不渲染**（`RecordSheet` 改 `v-if="images.length && hasEditable"`、`ImageLightbox` 改 `showLevels = !!level && !levelLocked`，不是灰掉是消失，下次重開也不長）；**所有燈箱右上角關閉鈕左方有「圖片大小」**（像素＋體積如 `1200×1600 · 65 KB`；`.lightbox__size{right:62px}`＋`bytes` prop＋`onImgLoad()` 量 naturalWidth/Height，`ReviewSheet` 也補）；`.dotp` **0.2em→0.3em**（v82 的 12 字元不溢出仍成立）；記帳頁金額**拿掉 `text-overflow: ellipsis`**（「...」的來源）改三級字級 `≤10→32px / 11→24px(is-mid) / ≥12→22px(is-xlong) / >12→19px(is-long)`——⚠ 實測 `.amount__main` 淨寬 207px、扣幣別符號 41px → 數字只有 **166px**，11 位 32px 要 211px、必然裁 36px，別憑感覺猜字級。守門員新 **v147（38 斷言）**；v145 ④ 兩條「全鎖 disabled」斷言改寫為「完全不渲染」
- **0.1.72**（已部署線上 0.1.72）快速記帳在**原地**開匯入彈窗（`ImportModal` 新增 `tabs` prop 只顯示指定分頁；記帳頁給 `['paste','quick']`，`SettingsView` 的 query watch/`router` 全移除）；壓縮等級改「**燈箱內**一排原/A/B/C/D（`ImageLightbox` 加 `level`/`levelLocked`/`set-level`）＋收據圖片**標題列最右邊全域鈕**（`setLevelAll` 只作用未鎖定的）」，單張圖下方的鈕已移除，C 級改 **540px/110KB**；**即時預覽**靠 `refreshUrl()`（revoke 舊 object URL → 用新 blob 重出，否則只換 blob 畫面不動）；移除「共 N 張…」提示；設定頁新增「**記帳頁暫存資料**」區（`keepDraft`，預設保留）——根因＝`App.vue :key="route.path"` 重掛元件，保留＝`sessionStorage` 草稿＋`ReceiptImages` 的 `keepOnUnmount`（圖片 blob 仍在 `useImgLevels` 暫存區，還原時只收 `hasPending(id)` 的→重開不留破圖）；修 `byCat` 沒傳 `abs-time` 的 bug；計算機 `.` 拆成 `.dotp`（**只能 0.2em＋letter-spacing:0**，見 2026-10-20.md 的實測序列）；統計頁區間最大與區間記錄都吃 `donutType`（收入/支出不混）+ 標題加「每日／每月最大 2 筆」說明。v52 翻新（`.lightbox__bar .lbbtn`、點圖＝關閉、寬度倍率而非 transform）。守門員 v145（44 斷言）＋新 v146（17 斷言）
- ⚠ **v84 是既有紅燈**（sweetalert2 對話框 padding/按鈕數）：`git stash` 回到 0.1.71 重跑一樣紅 → 與新版無關，未修
- **0.1.71**（已部署線上 0.1.71）匯入彈窗桌機加寬（`@media(min-width:768px)` scoped 蓋 `.bsheet`＝`min(1080px, 100vw-48)`；手機/PWA 不動；⚠ 桌機 ≥1024 有 232px 側欄→`.page` 實寬 `100vw-232`，1280 下 1048，彈窗取上限不窄於它）；快速記錄標題列灰底補滿（根因＝`.tbl__hd` 盒子 < 7 欄地板寬 486px → `.tbl__hd, .tr { min-width: 486px }`）；記帳頁排版多區塊 8「快速記帳」（預設隱藏）；收據圖五檔壓縮等級＋延遲寫入 IndexedDB（`imgLevels.ts`＋`useImgLevels.ts`）。⚠ 修掉 ImportModal open watch 的 TDZ（immediate 回跑在 `editing` 宣告前 → 以 open=true 建立元件就 ReferenceError）；守門員 v145
- **0.1.70** 收據圖片單一「分享圖片」（一次多張/桌機 zip）；「顯示實際時間」四級粒度；快速記錄刪除鈕補灰底；新上傳圖存 jpeg。守門員 v144
- **0.1.69** 修改分類頁再收斂；快速記錄標題列對齊欄位；無旅行時隱藏旅行列；明細加上一頁/下一頁 icon；收據圖片可複製/分享；「更多」可顯示實際時間；一鍵啟動 BAT。守門員 v143
- **0.1.68** 明細 meta 底部多一列旅行列 `.triprow`（點開下拉）；修改分類頁內距收斂；快速記錄標題行「刪除」鈕清空整表。守門員 v142
- **0.1.67** 快速記錄併入匯入彈窗（移除獨立 QuickRecordSheet；ImportModal 三頁籤含快速記錄表格、`savedRows` 關閉保留資料、複製/貼上＝套用＋關閉）；明細「統計」三顆 radio 改「點一下開下拉」（`.statsrow`＋Teleport `.statspop`，三態不變：統計＝false／不統計＝true／由分類控制＝undefined）；管理分類頁收斂高度（gap/igrid 高度/icon）。守門員 v138~v141 改寫對應新 UI
- **0.1.66** 匯入改三分頁彈窗（JSON／貼上資料／快速記錄表格；**QuickRecordSheet 在 0.1.67 已併入 ImportModal 移除**）：
  - `ImportModal`（頁籤 seg、JSON 分頁 emit `pick-json` 沿用 hidden file input 的原本流程）；`QuickRecordSheet`（div grid 類表格可橫滑、空白列 `--`、點格子開編輯器（輸入框＋複製/貼上/清空/確定一排）、✕ 刪列不確認、只提交完整列）
  - `src/lib/quickParse.ts`＝**純函式**解析器（欄位靠型樣不靠位置、日期時間整顆 token、第一個數字＝金額／第二個＝分類編號、看不懂併備註、缺欄補預設記 issues、全形轉半形、吃 Excel Tab）
  - 分類編號＝`src/lib/tree.ts` 的 `flatTreeByType()`（per 收支別、DFS、由 1 起）→ **設定頁 chips 編號與解析器同源**
  - 單驗 `.smoke/unit-quickparse.mjs`（23/23）；守門員 v141（44/44）
- **0.1.65** 明細「統計」三顆 radio（統計／不統計／由分類控制，即時存檔，還原＝寫 undefined 讓鍵消失）＋標題括號四種格式；管理分類頁腳固定。**已 commit 未部署**（跟 0.1.66 一起上）
- **0.1.64** 統計頁「未計入統計」總結卡（點了跳記錄頁 `?excl=1`＋帶區間）；「更多」第四項 excl（short「排」，改橙色）；三態 excludeFromStats
- **0.1.63** 送出前時間非現在 → confirmDialog；不計入統計（分類含上層整棵子樹）；圖片刪除確認
- **0.1.62** 選擇分類頁搜索框＋「選擇分類」鈕常駐；記錄頁「依實時」→「更多」多選下拉（`MoreFilterMenu`）

## 舊版（一行帶過，細節見 CONVENTIONS.md）
- 0.1.44~50 自訂貨幣（代碼不設限、0.1.49 起可當主幣別）、`homeLayout`/`homeDefaults`/`dateOffset`
- 0.1.53 匯率凍結模型＋記錄頁分頁（⚠ `v-if`/`v-else` 陷阱）｜0.1.54 主幣＝記錄幣別不換算＋PWA 餵食＋必填粉紅外框＋K/M
- 0.1.55 餵食死區（IO rootMargin 與 pump 停止條件要共用 `FEED_SLACK`）｜0.1.56 回收 `VIRTUAL_SLACK=200`
- 0.1.58/0.1.59 待辦事項（`TodoItem`、`todos?`、勾選即時存檔、`.todorow` 摘要、TodoSheet）
- 0.1.60 PWA 離線（⚠ workbox 對 opaque 樣式表只收 200 → 兩條 font 路由要 `statuses:[0,200]`；v135 字型要第二次 reload 才進快取）
- 0.1.61 刪除前確認＋待辦篩選鈕＋「代辦」→「待辦」｜0.1.57 圖片標籤「圖」、燈箱導覽、點圖關閉
- ⚠ v5x/v6x **不在回歸集**且有舊世代遺留（`mop-ledger.settings.v1` 舊 key、0.1.2 前 `.toast__text`／`.box[role="alertdialog"]`）→ 紅燈與現行版無關，不修
