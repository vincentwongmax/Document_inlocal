# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`，main；細節在 `CONVENTIONS.md`。

## 版本
- 只加 Z（目前 0.1.49）；每次更新：package.json ＋ CHANGELOG（插最前面 --- 之後）→ `__APP_VERSION__` → 設定頁膠囊

## 開發/驗證
- preview :4173（改完先 build）；dev :5173（兩埠 localStorage 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v124（48 支）
- ⚠⚠ 背景跑回歸時**不要編輯 run-regress.sh**｜升版後必先 build｜冷啟 goto 30s＝**假紅**（單獨重跑；批次假紅 v86/v105/v112/v113 都發生過）｜puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`
- RecordSheet＝`.mask > .sheet.card`；列點 `.row__main` 開明細；守門員 v119~v124=0.1.44~49；`.meta__row` 兩 span 相鄰**沒空格**；mobile 按下態驗 CSSOM

## Git/部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；Actions 全紅＝billing 鎖；線上驗證＝trees API＋**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log 的 `ghp_…`（**不寫進任何檔案**）
- ⚠⚠ **0.1.49 起 `git push`／`npm run deploy` 的 HTTPS 上傳會被代理截斷**（fetch、ls-remote 正常）→ 改走 **REST API**：`.smoke/api-push.mjs`（main）＋ `.smoke/deploy-api.mjs`（gh-pages 孤兒 commit force 更新）；本地對齊遠端＝`git fetch`＋`git reset <sha>`（樹相同才安全）
- ⚠⚠ Git Bash 帶 `VITE_BASE=/Document_inlocal/` 會被 **MSYS 路徑轉換**改成 PortableGit 路徑→線上 404；要加 `MSYS_NO_PATHCONV=1`

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；預設錢包 `w_default`；store 對外 `records`＝computed(當前錢包)
- 匯出 JSON=format2 可還原；Excel=.zip（自寫 zip.ts/xlsx.ts）；金額帶入＝initCalc→逐字 input→equals

## 旅行模式（0.1.35 起）
- 一次一個 `activeTrip`（每錢包一份）；記錄蓋 `tripId?`；結束**保留**標籤（推 `tripHistory`）
- 0.1.38~43：TripHistorySheet＋`?trip=` 過濾；旅行**顏色**（`--trip-c`）；tripViewFilter｜自訂色彩｜`hidden` 隱藏｜過去旅行 icon 綁旅行色（hidden 全灰）

## 0.1.44~48
- 自訂貨幣＝`settings.customCurrencies`＋匯率進 `rates`；刪除只移選單、rates 留著；幣別 select 用 `settings.allCurrencies`
- 排版＝`settings.homeLayout`（空=全顯示；沒排=不顯示；分類=3 號，`homeLayoutV` 防重遷移）；表單卡 flex gap 9（**舊測試找 `.card--ledger`**）
- 隱藏區塊預設值＝`settings.homeDefaults`（HomeDefaultSheet 即改即存；預設圖片提交時複製 blob 成新 id）
- HomeDefaultSheet 補 `.box{6/18/18+gap14}`（**`.box` 各子頁面 scoped**）；ReviewSheet 縮圖重用 ImageLightbox；`watch route.query.q` 要 **immediate**；**dateOffset**＝`before|after:N:m|d|mo|y`（月/年走日曆運算；遷移只改 state、ls 下次寫入才落地）

## 0.1.49
- **dateOffset** 再擴：`''|'now'|before|after:N:m|h|d|mo|y|'at:YYYY-MM-DDTHH:mm'`（完整時間手動輸入；單位加回「時」）
- **MiniSelect.vue**：照 CategorySelect 自訂彈層（fixed＋自動上翻＋Esc/點外關）；**多根元件 class 不 fallthrough**→`inheritAttrs:false`＋父層 `<span class="daterow__sel">` 包；PWA 日期列＝輸入框獨立一行＋兩選單在下（`.daterow__n` flex 1 1 100%、≥768px 同行）
- 自訂貨幣：代碼放寬 `[A-Z0-9]{1,12}`；cx 四元素同一行；**可當主幣別**（setBaseCurrency 整組換算）

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField（禁 type=date）｜彈層開著背景不能滑｜可編輯元素 16px（select 除外）｜點/雙擊空白不能動
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator｜`<Transition>` wrapper 自補 flex+gap
11~14. 金額顯示用即時換算｜快速金額只帶入不送出｜「檢視」列只在記錄頁、「依新增時間」＝最右黃框｜統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能在 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；拔 @esbuild 要裝回

視覺：米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題