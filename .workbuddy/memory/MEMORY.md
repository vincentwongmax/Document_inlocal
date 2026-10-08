# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。
Repo `C:\Users\User\Desktop\AI`（**無 E: 槽**，舊筆記 E:\AI 全作廢），分支 main。
完整約定／踩坑／測試殺手 → **同目錄 `CONVENTIONS.md`**（要用再讀）。

## 版本
- 只加 Z（目前 0.1.34）。來源＝package.json → vite define `__APP_VERSION__` → 設定頁膠囊
- 每次更新：package.json ＋ CHANGELOG（新筆插最前 `---` 之後）
- ⚠ 0.1.29 曾來回三次被回退才定案；`v108` 驗的是被回退版、刻意不入回歸集

## 開發/驗證
- preview :4173（服務 dist/，**改完先 build**）；dev :5173（兩埠 localStorage 分開）
- 流程：vue-tsc --noEmit → build → .smoke/vNN.mjs → 截圖 → CHANGELOG → memory → commit
- 回歸：`bash .smoke/run-regress.sh`（全部／指定 v104）；**判準看 exit code**
- 維護中＝v70~v107＋v109（v45/46/56/57 已失效；v109＝0.1.29 起，現 78 項）
- ⚠ 升版後必先 `npm run build` 再跑測試（`__APP_VERSION__` 編譯期注入，v79 假紅燈）
- 斷言「與某來源一致」要讀來源（如 v79 讀 package.json），別寫死
- puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`；node 在 PATH（版本目錄會變）

### 守門員（動哪裡跑哪支；⚠ `.smoke/` gitignored，回退手動改 ALL＋被改的舊測試）
v99 錢包/存取｜v103 匯出/資料統計｜v77+v89 圖片/放大｜v83+v93 算式｜v82~99 計算機/彈窗/通知｜
v102 連點空白(390×667)｜v104 字級/下拉捲動｜v105 雙擊/彈層/收據BETA｜v106 safe-area/精選｜
v107 主幣換算/淺綠框｜v109 依新增時間/快速金額/時間標籤｜v85 最近檢視｜v94 各寬度320~768

## Git/部署
- Pages＝gh-pages（legacy build）；線上 `vincentwongmax.github.io/Document_inlocal/`
- ⚠ 只 commit 本機；push/deploy 要先問（使用者明說「上傳」才行）
- `git add -A -- . ':!ddd.txt'`（使用者草稿永遠排除）
- PAT：`grep -ho "ghp_[A-Za-z0-9]\{36\}" ~/.workbuddy/audit-log/*.jsonl`（**不寫進任何檔案**）
- Actions 全紅＝帳號 billing 鎖（與程式無關）；`GH_TOKEN=… npm run deploy` 手動部署可用
- deploy 建到 `os.tmpdir()` 全新目錄再 force push gh-pages（勿建回專案內 `.deploy/`）
- 線上驗證：CDN 延遲等 1~2 分勿急著重部署；雜湊檔名用 trees API 撈勿手打；驗**內容特徵**；
  可直接跑 `.smoke/v109-live.mjs`（BASE＝線上 URL、fresh profile）
- 網路 502：curl 探測＋重試；`out=$(...); rc=$?` 判準（pipe 會吞 exit code）

## 資料
- 錢包：`mop-ledger.wallets.v1`＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；
  記錄單鍵 `records.v1` 每筆蓋 walletId；**預設錢包 id 固定 `w_default`**（勿改 uid()）
- store 對外 `records`＝computed(當前錢包)，內部 `all` 才是全部（圖片去重看 all）；
  settings.state＝當前錢包設定
- ⚠ 「初始化時改資料要自己寫回去」（watcher 掛上前的遷移不會被看見）
- 匯出：JSON=format2 可還原；Excel=.zip 自寫 lib/zip.ts、lib/xlsx.ts ⚠ 動前讀 CONVENTIONS
- 收據原圖 IndexedDB(idb-keyval 跨錢包共用)；`mop-ledger.settings.v1` 是單錢包舊鍵刻意不刪
- 分類 {id,name,type,color,icon?,builtin,archived,parentId?}（目前兩層）
- defaultCategoryId 與 favoriteCategories 完全獨立
- 記帳頁金額帶入：initCalc→逐字 input→equals（不記成算式）

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1. body `min-height:100%`（勿 height:100%）；html height:100%（驗幾何非 computed px）
2. 日期一律 DateField/DateTimeField 純文字框＋按鈕（**禁 input type=date**）
3. 彈層開著背景不能滑：useScrollLock + overscroll-behavior:contain
4. 可編輯元素字級 16px（宣在 `input{font:inherit}` 之後；**不含 select**）
5. 點/雙擊空白不能動：iosScrollGuard（iOS only；**按鈕連點合法勿擋**）
6. 子頁面＝底部彈層可下拉關閉：幾何只在 style.css `.bsheet*`（元件勿重寫）；
   usePullToClose(panel≠scroller)；**onClose 必 emit('close')**（0.1.34 卡死根因）
7. 一列記錄＝一個點擊目標（row__amt 是 button；user-select:none）
8. 連點防護別拆（touch-action: manipulation 等）
9. 彈層避 home indicator：`.bsheet.bsheet.bsheet` padding-bottom calc(var(--safe-b)+12px)；
   元件勿寫面板 padding-bottom（三連類別特異度是刻意的）
10. `<Transition>` 包出的 wrapper 要自己補 flex+gap
11. 金額顯示用 settings.toBase 即時換算（**勿用 record.baseAmount**）；只換顯示不改資料
12. 快速金額：settings.quickPresets；帶入順序 類型→幣別→分類→備注→金額；
    **只帶入不送出**；設定頁編輯走子頁 QuickAmountSheet（照 CategoryManageModal 骨架抄）
13. 「檢視」列只在記錄頁；「依新增時間」＝檢視列最右黃框按鈕 `.bycat--basis`（**不是「最近」**）
14. 最近檢視時間標籤：不加「交易」、沙漏 icon、`.ttag--recent` 只改外框淺黃
15. 收據辨識 BETA 只在設定頁（useUpload singleton）；記帳頁 ReceiptImages 是另一功能勿動
16. 統計頁精選（0.1.27）：日/月/年/自訂各有規則；組標題金額用完整清單加總（totals-from）
17. 測試殺手速記：deleteDatabase 只能在 reload 後呼叫；wallets.v1 非裸陣列；
    照抄 isRealErr()+ENV_NOISE；等狀態不等時間；防空集合假通過；合成 Touch 需 hasTouch:true；
    v-model number 要 String() 再 trim；npm install 會拔 @esbuild/win32-x64 要裝回

## 視覺
米白紙感；accent 墨綠 #2c6e5b；支出 #bf563c、收入 #2c6e5b；已選分類粉紅 --pick；
琥珀 --amber #d9a326（soft #fdf4e0／line #e6cf8c）；描邊線性 icon 24×24 currentColor
