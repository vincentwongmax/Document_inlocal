# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`（**無 E: 槽**），main。
完整約定／踩坑 → **同目錄 `CONVENTIONS.md`**。

## 版本
- 只加 Z（目前 0.1.38）。package.json → `__APP_VERSION__` → 設定頁膠囊
- 每次更新：package.json ＋ CHANGELOG（新筆插 0.1.19 精選區之後）

## 開發/驗證
- preview :4173（服務 dist/，**改完先 build**）；dev :5173（兩埠 localStorage 分開）
- 流程：vue-tsc → build → .smoke/vNN.mjs → 截圖 → CHANGELOG → memory → commit
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v107＋v109~v113
- ⚠ 升版後必先 build 再跑測試（`__APP_VERSION__` 編譯期注入）；斷言「與某來源一致」要讀來源
- ⚠ 機器忙時冷啟＋SW 預快取 19.5MB 超 goto 30s＝**假紅**（v107/v109 已 60s；其他支先單獨重跑再查）
- puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`
- RecordSheet＝`.mask > .sheet.card`；子頁面才是 `.bsheet`；列點 `.row__main` 開明細
- 守門員：v104 字級｜v105 雙擊｜v106 safe-area｜v107 主幣換算｜v109 快速金額｜v110 旅行｜v111 六需求｜v112 三小鈕/匯率/旅標籤｜v113 堆疊/幣別提示/旅行詳情/?trip。⚠ `.smoke/` gitignored，回退手動改 ALL
- ⚠ 斷言課：dispatchEvent 繞 disabled；fmtMoney 負號在符號後；`.meta__row` 兩 span 相鄰**沒空格**（`replace(/\s+/g,'')` 連時間空格也吃）→ 預期字串寫無空格版

## Git/部署
- Pages＝gh-pages（legacy build）；線上 `vincentwongmax.github.io/Document_inlocal/`
- ⚠ 只 commit 本機；push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`
- PAT：grep audit-log 的 `ghp_[A-Za-z0-9]{36}`（**不寫進任何檔案**）
- Actions 全紅＝billing 鎖；`GH_TOKEN=… npm run deploy`（建到 os.tmpdir() 再 force push）
- 線上驗證：CDN 等 1~2 分；雜湊檔名用 trees API 撈；驗**內容特徵**；BASE 換線上 URL 跑端到端

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；記錄單鍵 `records.v1` 蓋 walletId；**預設錢包 id 固定 `w_default`**
- store 對外 `records`＝computed(當前錢包)，內部 `all` 才是全部；settings.state＝當前錢包；records→settings 單向
- ⚠ 「初始化時改資料要自己寫回去」（watcher 掛上前的遷移不會被看見）
- 匯出 JSON=format2 可還原；Excel=.zip（自寫 zip.ts/xlsx.ts，動前讀 CONVENTIONS）
- `settings.v1` 舊鍵不刪；defaultCategoryId≠favoriteCategories；金額帶入＝initCalc→逐字 input→equals

## 旅行模式（0.1.35 起）
- 一次一個：`activeTrip` 每錢包一份；記錄蓋 `tripId?`；0.1.36 結束旅行**保留**標籤（推 `tripHistory`，`tripById` 兜底查名）；顯示層 `displayCurrency`/`toDisplay`（只換顯示）；設定頁 `.travel-cell`＋三顆 `.travel-mini`；旅行中主幣 disabled
- 0.1.37：TripHistorySheet 子頁（update/deleteTripHistory＋clearTripTag，清標記**不清備注後綴**）；匯率兩位（明細完整位數）；「旅」標籤
- 0.1.38：列表↔詳情（meta__row 點列編輯＋唯讀建立/結束/總金額、刪除在底）＋「N 筆」→ `#/records?trip=<id>` tripId **精確過濾**（不看日期、琥珀 chip ✕ 解除）＋幣別提示去括號＋RecordRow 標籤過多→`is-stacked`（**黏性**；`.row__cat` nowrap 是量測前提；**單獨 commit** 可 revert）

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField（禁 type=date）｜彈層開著背景不能滑｜可編輯元素 16px（不含 select）｜點/雙擊空白不能動（**按鈕連點合法勿擋**）
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`；onClose 必 emit('close')）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator（三連類別刻意）｜`<Transition>` wrapper 自補 flex+gap
11. 金額顯示用即時換算（**勿用 record.baseAmount**）；只換顯示不改資料
12. 快速金額只帶入不送出；13. 「檢視」列只在記錄頁，「依新增時間」＝最右黃框 `.bycat--basis`（**不是「最近」**）；14. 統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能在 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；Touch 需 hasTouch:true；npm install 拔 @esbuild/win32-x64 要裝回

## 視覺
米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326（soft #fdf4e0）＝旅行主題；icon 24×24 currentColor
