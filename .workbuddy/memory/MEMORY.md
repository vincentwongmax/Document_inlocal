# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。

## 版本
- 只加 Z（目前 0.1.58）；改 package.json ＋ CHANGELOG（插最前面 --- 後）
- ⚠ `.smoke/` 在 .gitignore（測試檔**不會**進 commit）→ 版本 commit 只含 src/、CHANGELOG、package.json、.workbuddy/memory

## 開發/驗證
- preview :4173（改完先 build）；dev :5173（ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v133（57 支）
- ⚠⚠ 回歸跑著時**不要編輯 run-regress.sh**｜升版後必先 build｜冷啟 goto 30s＝**假紅**（單獨重跑）｜守門員 v119~v130；RecordSheet＝`.mask > .sheet.card`
- ⚠⚠ **本地回歸 dist 不能帶 VITE_BASE**（preview 在根目錄伺服，帶了全 404 → App 空白假紅）；部署前才帶 base 重建
- ⚠⚠ **測「無限滾動/餵食」不能用 `scrollTo(0, scrollHeight)` 一次跳到底**（會跳過死區、掩蓋卡死 bug）→ 一律 `scrollBy` 一小段一小段滑模擬手指

## Git/部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；線上驗證＝**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log `ghp_…`（**不寫進任何檔案**）
- ⚠⚠ **git push 常被代理截斷**（fetch 也可能掛）→ 走 **REST API**：`.smoke/api-push.mjs`（main）＋`.smoke/deploy-api.mjs`（gh-pages）；對齊＝`fetch`＋`reset <sha>`（樹同才安全）
- ⚠ 走 API 推完後**本地 remote-tracking ref 一定是舊的**（`git fetch` 也常被截斷，且遠端 commit 物件不在本地）→ 這是**正常現象不用修**；`.smoke/api-push.mjs` 以遠端 tree 當 base，**不依賴本地 ref**。要確認遠端狀態就用 `curl .../commits/<branch>` 或看線上 `version.json`
- ⚠⚠ **api-push.mjs 會讀 `.smoke/show.txt`（單一 commit 的 diff 清單）**——忘記重新產生就會推到**舊清單**（0.1.57 實慘：推到 RecordList.vue、四個真正改動的檔沒上去）→ **以後一律改用 `.smoke/api-sync.mjs`**：比對「遠端 recursive tree vs 本機 tracked 檔案的 blob sha」，把所有不同的檔案補上去 → 遠端必然等於本機
  - 產生本機清單：`git ls-files | while IFS= read -r p; do [ -f "$p" ] && printf '%s\t%s\n' "$(git hash-object "$p")" "$p"; done > .smoke/local-hash.txt`
  - ⚠ node 在這個環境叫 `cmd.exe` 會 **EBUSY** → 清單要在 bash 端生好再讓 node 讀，不要 spawn
  - deploy 前後各跑一次（第二次應該印「遠端已與本機一致，不用推」）當驗證
- ⚠⚠ Git Bash 的 `VITE_BASE=/Document_inlocal/` 被 **MSYS 路徑轉換**改掉→線上 404；加 `MSYS_NO_PATHCONV=1`

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包 `setting.<id>.v1`（預設 `w_default`）；`records`＝當前錢包 computed；匯出 JSON=format2；Excel=.zip

## 旅行模式（0.1.35 起）
- 一次一個 `activeTrip`；記錄蓋 `tripId?`；結束**保留**標籤（推 `tripHistory`）；`?trip=` 過濾；旅行色 `--trip-c`

## 0.1.44~50（舊版重點）
- 自訂貨幣＝`settings.customCurrencies`＋匯率進 `rates`；**代碼不設限**（只擋 空白/撞內建/重複）；0.1.49 起**可當主幣別**
- 排版＝`settings.homeLayout`（空=全顯示；分類=3 號）；預設值＝`settings.homeDefaults`（即改即存；幣別下拉只有區塊 1 隱藏才套用）；`dateOffset`：`before|after:N:m|h|d|mo|y`／`'now'`／`'at:…'`；**MiniSelect** class 不 fallthrough→`inheritAttrs:false`＋父 span 包

## 0.1.51~52
- 排版標題列貼右＝`#sec-homelayout` 加 `.sec__hd--lay`（`.sec__meta{flex:1}`）；HomeDefaultSheet scoped 漏 `.hidden`→補 `display:none`；`.mask` z-index 90 蓋 `.tabbar`(40)
- 記錄頁搜索＝**空白切詞 AND**（每詞在 備註／分類／旅行名 任一欄命中）；HighlightText 多詞黃底
- **version.json**（檢查更新）：vite plugin 建置時產生；**必須** `globIgnores:['**/version.json']` 排除預快取＋`?t=`＋`cache:'no-store'`；其餘可離線
- ⚠ 教訓：placeholder 有「塞得進」守門員（v95）；SweetAlert2 `.swal2-cancel` 一直在 DOM→驗對話框用可見性

## 0.1.53（匯率凍結模型＋圖片+＋記錄頁分頁）
- **記錄顯示＝該筆自己凍結的匯率**：快照 `rate`＝1 record.currency = rate record.baseCurrency；顯示走 `recRate`／`displayOf`／`displayRateOf`（settings.ts）→現行表換算成顯示幣別；`base===dc` 直接回 mult 不碰表；舊資料回退即時表
- 「更新匯率」只寫 `rates`（未來新快照）→舊記錄顯示不動；`setBaseCurrency` conv fallback（無效當 1）→自訂貨幣當主幣 A→B 不被 `defaultRates` 吃掉；`toDisplay` 只留輸入用
- 圖片 icon＝多張「圖片+」／單張「圖片」（無張數節點）
- 記錄頁分頁：`pageSize` 20/50/100/全部(0) 預設 50＋`page`；>20 筆出 pager；切篩選/搜尋回第 1 頁；桌面四鈕＋頁碼／PWA「顯示更多」
- ⚠⚠ `v-if`/`v-else` 陷阱：分頁列 `v-if="showPager"` 插在 RecordList 與「依分類」`<template v-else>` 中間→v-else 改黏 showPager，≤20 筆兩種檢視同時渲染→`<template v-if="!byCat">` 包住
- ⚠ `<select v-model>` 送字串→「全部」0 變 '0'→掛 `.number`；攔 er-api 要自帶 CORS header；setViewport 切 isMobile **會重載**

## 0.1.54（主幣＝記錄幣別不換算＋PWA 餵食＋必填外框＋K/M）
- `recRate()` 最前面短路 `r.currency===dc → return 1`（不能靠 round-trip：更新匯率後會散成 0.9879）
- PWA(≤519px)=餵食模式（IO 哨兵、無按鈕、10/20/50/全部）；桌面維持 0.1.53 分頁。RecordList `virtual` prop：一天=`.dayblk`，IO(rootMargin 1000px)+RO，離開視窗換等高空白 div；坑：子元件 onMounted 較早→`ensureObservers()` 一律建＋watch 補種；**`vis` key 只能是日期**（高度 key 才是 `日期|筆數`）；`pump()` 用 `top > innerHeight` 不加 rootMargin
- 必填未填＝`--pick` #b85773（金額/分類 `.is-missing`）；非必填＝`--line-strong` #d6d1c7；`:hover` 壓回；`.rec` 要 `:deep()`
- `fmtCompact`（K/M/B，q<10 兩位小數、<100 一位，trimZeros）；統計三卡＋`title` 完整數字；子頁面維持 fmtMoney
- ⚠⚠ **Vue 模板 HTML 註解內不能用「--＞」箭頭**（註解提前結束→文字外洩到頁面）；註解一律用「→」
- v86 Toast 吃觸控＝時序偶發（SW 快取完成才彈）→ `reset()` 每節補 `settleToast()`

## 0.1.55（修 PWA 餵食卡死）
- 死區 bug：IO rootMargin(400) ≠ pump 停止條件(innerHeight) → 哨兵在「視窗下方 0~400」時 IO 叫了 pump 卻不載，且 IO 只在狀態改變時回呼 → 永遠卡住
- 修：共用 `FEED_SLACK=200`（IO rootMargin ＋ pump `top > innerHeight + FEED_SLACK`）；pump 加 `pumping` 鎖；加 window scroll 備援(rAF)

## 0.1.58（代辦事項）
- 資料：`TodoItem {id,text,done}`；`TxRecord.todos?`；**勾選即時存檔**（`records.update`，不等按儲存；清空存 `undefined` 不存 `[]`）；save patch 也帶 todos 雙保險
- 明細摘要列 `.todorow`（備註下方）：`x/y`＋`x 項未完成`/`全部完成`（墨綠）＋前三項 `1.xxx 2.yyy 3.zzz`（line-clamp 2，超過補「…還有 N 項」）；沒有＝「新增代辦事項」；整列可點
- 子頁面 `TodoSheet.vue`＝bsheet 幾何（下拉關閉/✕/背景鎖/pop）；進度長條＋編號/勾選圈/input/✕；Enter 新增；空白項 blur 自動移除；清除已完成/全部完成(取消)；完成＝劃線淡出；**每次開啟從 props 重拿**（無殘影）
- ⚠⚠ `TodoSheet` 是 RecordSheet 模板**第三個根節點**（不在明細 `v-if` 內）→ 加 `watch(props.open)` 收 `todoOpen`，否則關明細後代辦面板留在畫面
- 記錄列「記」標籤＝`.ttodo`（墨綠軟底、18px 高、清單 icon）；`todos?.length` 才出現；**已加進 0.1.38 stacked 重測的 watch 依賴**
- 守門員 v133（37/37）＋v133-live；截圖 shot-1058-{records,sheet,todo}.png

## 0.1.57（記錄頁 K/M＋圖片標籤改「圖」＋放大檢視導覽＋點圖關閉）
- 記錄頁 sum 三格＝`currency().symbol + fmtCompact()`（**帶幣別符號**）；`title` 留完整數字。**沒**做「量測到超出才壓」（要 ResizeObserver、會閃），因為會被截成 … 的數字本來就 ≥1000
- 統計頁（0.1.54）維持**純數字不帶符號**→ 兩頁刻意不同，理由寫在 RecordsView 註解裡
- 圖片標籤：多張「圖+」／單張「圖」（0.1.53 的「圖片+」再短一階），RecordRow 全站一致
- ImageLightbox 新增**可選** `nav` → 底部**獨立一列** 4 顆 ICON（‹ › 上下張、« » 上下筆＋位置）；**不**放進 `.lightbox__bar`（既有測試斷言那列 3 顆）
- 無圖＝`.lightbox__empty`「無圖」佔位，燈箱**不關**、上下筆照可按；`opened = src || nav`（src 為 null 時靠 nav 撐住）
- 導覽範圍＝`rows`（完整搜尋結果）；統計頁不傳 `navIds` → 只出現上下張；「關閉停在最後看圖那筆」＝按上下筆時就 emit `goto-record` 換 `editingId`
- ⚠⚠ 坑：`releaseUrls()` 原本呼叫 `closeLightbox()` → 導覽換記錄時燈箱被關。改成 `releaseUrls()` 只收 URL **不清 `lbNav`**，只有使用者主動關圖的 `closeLightbox()` 才清
- 點圖片關閉＝`@click.stop="onImgClick"`，沿用「位移 > 8px 視為拖曳」保護；Test 用 dispatchEvent(PointerEvent + MouseEvent) 模擬點擊／拖曳

## 0.1.56（回收要積極）
- RecordList 視窗化保留範圍 `VIRTUAL_SLACK=200`（原 1000 太寬＝幾乎沒回收）；區塊高約 410px → 300 仍不回收、200 才收；上下同一 rootMargin → 對稱回收；回收後＝上次量到的真實高度（不跳）

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField｜彈層開背景不能滑｜可編輯元素 16px｜點/雙擊空白不能動
6~10. 子頁面＝底部彈層（幾何在 style.css）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator
11~14. 金額顯示用凍結匯率（0.1.53 起）｜快速金額只帶入不送出｜「依新增時間」＝最右黃框｜統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；拔 @esbuild 要裝回

視覺：米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題
