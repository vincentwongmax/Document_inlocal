# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`（**無 E: 槽**），main。
完整約定／踩坑 → 同目錄 `CONVENTIONS.md`。

## 版本
- 只加 Z（目前 0.1.45）。package.json → `__APP_VERSION__` → 設定頁膠囊
- 每次更新：package.json ＋ CHANGELOG（插最前面 --- 之後）

## 開發/驗證
- preview :4173（改完先 build）；dev :5173（兩埠 localStorage 分開）
- 流程：vue-tsc → build → vNN 測試 → 截圖 → CHANGELOG → memory → commit- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v107＋v109~v120（44 支）
- ⚠⚠ **背景跑回歸時不要編輯 run-regress.sh**（bash 逐段讀腳本→假語法錯，其實測試全過）
- ⚠ 升版後必先 build 再跑測試（版本編譯期注入）；斷言「與某來源一致」要讀來源
- ⚠ 冷啟＋SW 預快取超 goto 30s＝**假紅**（單獨重跑）；puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`
- RecordSheet＝`.mask > .sheet.card`；列點 `.row__main` 開明細（點 `.row` 不開；骨架 `.sheet` 非 `.bsheet`）- 守門員：v104 字級｜v105 雙擊/BETA位置｜v106 safe-area｜v107 換算｜v109 快速金額｜v110~v118 旅行系｜v119=0.1.44｜v120=0.1.45
- ⚠ 斷言課：`.meta__row` 兩 span 相鄰**沒空格**；mobile 按下態驗 CSSOM

## Git/部署
- Pages＝gh-pages（legacy build）；線上 `vincentwongmax.github.io/Document_inlocal/`
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log 的 `ghp_…`（**不寫進任何檔案**）
- Actions 全紅＝billing 鎖；`GH_TOKEN=… npm run deploy`（tmpdir 全新建再 force push）；線上驗證：CDN 等 1~2 分；雜湊 trees API 撈；驗**內容特徵**

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；預設錢包 id 固定 `w_default`
- store 對外 `records`＝computed(當前錢包)，內部 `all`＝全部；「初始化時改資料要自己寫回去」
- 匯出 JSON=format2 可還原；Excel=.zip（自寫 zip.ts/xlsx.ts）；金額帶入＝initCalc→逐字 input→equals

## 旅行模式（0.1.35 起）
- 一次一個 `activeTrip`（每錢包一份）；記錄蓋 `tripId?`；結束**保留**標籤（推 `tripHistory`）；顯示層 `toDisplay`
- 0.1.38~40：TripHistorySheet 列表↔詳情＋`?trip=` 過濾；旅行**顏色**（`--trip-c`）
- 0.1.41：**tripViewFilter**＝持久「查看旅行記錄」（module-level ref 不進 state）｜自訂色彩虹票包 input color｜`hidden` 隱藏旅行｜分類不預選｜回程不早於出發
- 0.1.42：明細旅行下拉不顯示 hidden 旅行；例外＝記錄已歸屬那趟仍顯示
- 0.1.43：過去的旅行 icon 綁旅行色（hidden 全灰；fallback #d9a326）；展開隱藏列只剩「詳細」；詳情唯讀「旅行顏色」欄

## 0.1.44
- 自訂貨幣＝`settings.customCurrencies`＋匯率進 `rates`；**刪除只移選單、rates 留著**；不能設主幣別；幣別 select 用 `settings.allCurrencies`
- 明細：「圖片大小（壓縮後）」＝`ImageRef.bytes` 加總；hero 變 button→emit search-cat（記錄頁填搜索框；統計頁跳 `/records?q=`）；「收據圖片」併入「收據辨識＋BETA」（`.ocrsec`）
- `watch route.query.q` 要 **immediate**，callback 勿碰 editingId（TDZ）

## 0.1.45
- 上傳收據併進設定頁「收據辨識」節（多幣別下方＋BETA）；sec--beta 移除；自訂貨幣描述移除、「＋」鈕收合輸入列
- **記帳頁排版**＝`settings.homeLayout`（空=預設全顯示；沒排=不顯示）；設定頁 #sec-homelayout 六方塊（點擊順序=顯示順序）；**catbox 不參與排序**（固定跟金額後）；表單卡 flex gap 9、`.pad__meta` 已移除（**舊測試選擇器找 `.card--ledger`**）；ReceiptImages 在 v-for→function ref

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField（禁 type=date）｜彈層開著背景不能滑｜可編輯元素 16px（不含 select）｜點/雙擊空白不能動（按鈕連點合法勿擋）
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator（三連類別刻意）｜`<Transition>` wrapper 自補 flex+gap
11~14. 金額顯示用即時換算（勿用 record.baseAmount）｜快速金額只帶入不送出｜「檢視」列只在記錄頁、「依新增時間」＝最右黃框（不是「最近」）｜統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能在 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；npm install 拔 @esbuild 要裝回

視覺：米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題