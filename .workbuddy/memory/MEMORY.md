# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`（**無 E: 槽**），main。
完整約定／踩坑 → 同目錄 `CONVENTIONS.md`。

## 版本
- 只加 Z（目前 0.1.42）。package.json → `__APP_VERSION__` → 設定頁膠囊
- 每次更新：package.json ＋ CHANGELOG（插精選區之後）

## 開發/驗證
- preview :4173（服務 dist/，**改完先 build**）；dev :5173（兩埠 localStorage 分開）
- 流程：vue-tsc → build → .smoke/vNN.mjs → 截圖 → CHANGELOG → memory → commit
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v107＋v109~v117
- ⚠⚠ **背景跑回歸時不要編輯 run-regress.sh**（bash 逐段讀腳本→位移→假語法錯 `near unexpected token done`，其實測試全過）
- ⚠ 升版後必先 build 再跑測試（版本編譯期注入）；斷言「與某來源一致」要讀來源
- ⚠ 冷啟＋SW 預快取超 goto 30s＝**假紅**（單獨重跑；已放寬 60s）
- puppeteer-core 在 `~/.workbuddy/binaries/node/workspace/`
- RecordSheet＝`.mask > .sheet.card`；子頁面＝`.bsheet`；列點 `.row__main` 開明細（點 `.row` 不開；骨架 `.sheet` 非 `.bsheet`）
- 守門員：v104 字級｜v105 雙擊｜v106 safe-area｜v107 換算｜v109 快速金額｜v110~v117 旅行系。⚠ `.smoke/` gitignored，回退手動改 ALL
- ⚠ 斷言課：`.meta__row` 兩 span 相鄰**沒空格**→ 預期寫無空格版；mobile 模擬按下態驗 **CSSOM**

## Git/部署
- Pages＝gh-pages（legacy build）；線上 `vincentwongmax.github.io/Document_inlocal/`
- ⚠ 只 commit 本機；push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`
- PAT：grep audit-log 的 `ghp_[A-Za-z0-9]{36}`（**不寫進任何檔案**）
- Actions 全紅＝billing 鎖；`GH_TOKEN=… npm run deploy`（tmpdir 全新建再 force push）
- 線上驗證：CDN 等 1~2 分；雜湊 trees API 撈；驗**內容特徵**

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`；記錄單鍵 `records.v1` 蓋 walletId；**預設錢包 id 固定 `w_default`**
- store 對外 `records`＝computed(當前錢包)，內部 `all`＝全部；settings.state＝當前錢包
- ⚠ 「初始化時改資料要自己寫回去」（watcher 前的遷移不會被看見）
- 匯出 JSON=format2 可還原；Excel=.zip（自寫 zip.ts/xlsx.ts，動前讀 CONVENTIONS）
- `settings.v1` 舊鍵不刪；defaultCategoryId≠favoriteCategories；金額帶入＝initCalc→逐字 input→equals

## 旅行模式（0.1.35 起）
- 一次一個 `activeTrip`（每錢包一份）；記錄蓋 `tripId?`；結束**保留**標籤（推 `tripHistory`）；顯示層 `toDisplay`
- 0.1.38：TripHistorySheet 列表↔詳情＋「N 筆」`?trip=` 精確過濾＋`is-stacked` 黏性標籤
- 0.1.39：旅行**顏色**（每趟各自色板；`--trip-c` 三變數）；0.1.40：設定頁區塊 icon/標籤跟旅行色（切換鈕排除）
- 0.1.41：**tripViewFilter**＝持久「查看旅行記錄」（**module-level ref 不進 state**→切頁保持、刷新重置；URL `?trip=` 優先、✕ 清兩源、finishTrip 自動清）｜自訂色＝彩虹票包 input color（⚠ customColor 宣告在 syncFromTrip **前**防 TDZ）｜`TravelTrip.hidden` 隱藏旅行（收合列「已隱藏 N 趟」）｜分類**不預選**（不讀 draft，唯「記帳預設」）｜日期驗證＝回程不早於出發（原話矛盾拍板）；回退要 bump `:key` 重掛 DateField（同 tick prop 無變化 watch 不觸發）
- 0.1.42：明細旅行下拉**不顯示 hidden 旅行**（`tripOptions` history 迴圈 skip，`h.id !== tripId.value`）；**例外＝記錄已歸屬那趟仍顯示**（否則歸屬憑空消失）；過濾光且無歸屬→整列隱藏（v117 守門員 14 項）

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField（禁 type=date）｜彈層開著背景不能滑｜可編輯元素 16px（不含 select）｜點/雙擊空白不能動（**按鈕連點合法勿擋**）
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`；onClose 必 emit('close')）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator（三連類別刻意）｜`<Transition>` wrapper 自補 flex+gap
11. 金額顯示用即時換算（**勿用 record.baseAmount**）；只換顯示不改資料
12. 快速金額只帶入不送出；13. 「檢視」列只在記錄頁，「依新增時間」＝最右黃框（**不是「最近」**）；14. 統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能在 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；hasTouch:true；npm install 拔 @esbuild/win32-x64 要裝回

## 視覺
米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題
