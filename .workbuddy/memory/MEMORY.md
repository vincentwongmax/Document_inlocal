# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。

## 版本
- 只加 Z（目前 0.1.53）；改 package.json ＋ CHANGELOG（插最前面 --- 後）

## 開發/驗證
- preview :4173（改完先 build）；dev :5173（ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v128（52 支）
- ⚠⚠ 回歸跑著時**不要編輯 run-regress.sh**｜升版後必先 build｜冷啟 goto 30s＝**假紅**（單獨重跑）｜守門員 v119~v128；RecordSheet＝`.mask > .sheet.card`

## Git/部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；線上驗證＝**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log `ghp_…`（**不寫進任何檔案**）
- ⚠⚠ **git push 常被代理截斷**（fetch 也可能掛）→ 走 **REST API**：`.smoke/api-push.mjs`（main）＋`.smoke/deploy-api.mjs`（gh-pages）；對齊＝`fetch`＋`reset <sha>`（樹同才安全）
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

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField｜彈層開背景不能滑｜可編輯元素 16px｜點/雙擊空白不能動
6~10. 子頁面＝底部彈層（幾何在 style.css）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator
11~14. 金額顯示用凍結匯率（0.1.53 起）｜快速金額只帶入不送出｜「依新增時間」＝最右黃框｜統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；拔 @esbuild 要裝回

視覺：米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題
