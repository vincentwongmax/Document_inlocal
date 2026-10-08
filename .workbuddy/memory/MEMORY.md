# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`（**無 E: 槽**），main。
完整約定／踩坑／測試殺手 → **同目錄 `CONVENTIONS.md`**（要用再讀）。

## 版本
- 只加 Z（目前 0.1.36＝旅行六需求）。package.json → `__APP_VERSION__` → 設定頁膠囊
- 每次更新：package.json ＋ CHANGELOG（新筆插 0.1.19 精選區之後，最新遞減）

## 開發/驗證
- preview :4173（服務 dist/，**改完先 build**）；dev :5173（兩埠 localStorage 分開）
- 流程：vue-tsc → build → .smoke/vNN.mjs → 截圖 → CHANGELOG → memory → commit
- 回歸 `bash .smoke/run-regress.sh`；**判準看 exit code**；維護中＝v70~v107＋v109~v111
- ⚠ 升版後必先 build 再跑測試（`__APP_VERSION__` 編譯期注入）；斷言「與某來源一致」要讀來源
- puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`（node 版本目錄會變）
- RecordSheet 骨架＝`.mask > .sheet.card`（關閉 `.sheet__close`）；子頁面才是 `.bsheet`；記錄列點 `.row__main` 才開明細
- 新守門員：v104 字級/下拉｜v105 雙擊/彈層｜v106 safe-area｜v107 主幣換算｜v109 快速金額｜v110 旅行基礎｜v111 六需求（獨立區塊/鎖定幣別/旅行名搜索/歷史旅行組）。⚠ `.smoke/` gitignored，回退手動改 ALL
- ⚠ v111 三課：JS dispatchEvent 繞過 disabled（別測「塞值不生效」）；fmtMoney 負數＝符號後帶 -（"JP¥-4,000.00"）；統計頁 MOP regex 要排除 .row 的原幣換算說明（刻意設計）

## Git/部署
- Pages＝gh-pages（legacy build）；線上 `vincentwongmax.github.io/Document_inlocal/`
- ⚠ 只 commit 本機；push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`（草稿排除）
- PAT：grep audit-log 的 `ghp_[A-Za-z0-9]{36}`（**不寫進任何檔案**）
- Actions 全紅＝帳號 billing 鎖；`GH_TOKEN=… npm run deploy` 手動部署（建到 os.tmpdir() 再 force push gh-pages）
- 線上驗證：CDN 等 1~2 分；雜湊檔名用 trees API 撈；驗**內容特徵**；BASE 換線上 URL 跑端到端

## 資料
- `mop-ledger.wallets.v1`＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；記錄單鍵 `records.v1` 每筆蓋 walletId；**預設錢包 id 固定 `w_default`**
- store 對外 `records`＝computed(當前錢包)，內部 `all` 才是全部；settings.state＝當前錢包設定；records import settings 單向
- ⚠ 「初始化時改資料要自己寫回去」（watcher 掛上前的遷移不會被看見）
- 匯出 JSON=format2 可還原；Excel=.zip（自寫 zip.ts/xlsx.ts，動前讀 CONVENTIONS）
- 收據圖 IndexedDB(idb-keyval)；`mop-ledger.settings.v1` 是單錢包舊鍵刻意不刪；defaultCategoryId 與 favoriteCategories 獨立；記帳金額帶入＝initCalc→逐字 input→equals（不記成算式）

## 旅行模式（0.1.35 起）
- 一次一個：`activeTrip` 存每錢包設定；記錄蓋 `tripId?`；移入→note 補「_旅行名」，移出只清 tripId
- 0.1.36 定案：結束旅行**保留**標籤（推 `tripHistory`，tripById 兜底查名）；顯示層改旅行貨幣 `displayCurrency`/`toDisplay`；搜索支援旅行名；旅行按鈕獨立區塊（`.travel-cell`）；旅行中主幣 select disabled；TravelSheet 列過去旅行；明細旅行欄改 select 可選歷史旅行

## 全站約定（細節都在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField（禁 type=date）｜彈層開著背景不能滑｜可編輯元素 16px（不含 select）｜點/雙擊空白不能動（**按鈕連點合法勿擋**）
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`；onClose 必 emit('close')）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator（`.bsheet.bsheet.bsheet` 三連類別刻意）｜`<Transition>` wrapper 自補 flex+gap
11. 金額顯示用即時換算（**勿用 record.baseAmount**）；只換顯示不改資料（0.1.36 起顯示層＝toDisplay；RecordSheet 詳細與匯出維持歷史事實）
12. 快速金額只帶入不送出；13. 「檢視」列只在記錄頁，「依新增時間」＝最右黃框 `.bycat--basis`（**不是「最近」**）；14. `.ttag--recent` 只改外框；15. 統計組標題金額用完整清單加總
16. 測試殺手（完整清單在 CONVENTIONS）：deleteDatabase 只能在 reload 後；wallets.v1 非裸陣列；照抄 isRealErr()+ENV_NOISE；等狀態不等時間；防空集合假通過；Touch 需 hasTouch:true；npm install 會拔 @esbuild/win32-x64 要裝回

## 視覺
米白紙感；accent/收入 墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326（soft #fdf4e0）＝旅行主題；icon 24×24 currentColor
