# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`，main。

## 版本
- 只加 Z（目前 0.1.51）；每次更新：package.json ＋ CHANGELOG（插最前面 --- 之後）→ `__APP_VERSION__` → 設定頁膠囊

## 開發/驗證
- preview :4173（改完先 build）；dev :5173（兩埠 localStorage 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準看每支 exit code**；維護中＝v70~v126（50 支）
- ⚠⚠ 背景跑回歸時**不要編輯 run-regress.sh**｜升版後必先 build｜冷啟 goto 30s＝**假紅**（單獨重跑；批次假紅常見）
- RecordSheet＝`.mask > .sheet.card`；列點 `.row__main` 開明細；守門員 v119~v126=0.1.44~51
## Git/部署
- Pages＝gh-pages；線上 `vincentwongmax.github.io/Document_inlocal/`；線上驗證＝trees API＋**內容特徵**
- ⚠ push/deploy 要使用者明說「上傳」才做；`git add -A -- . ':!ddd.txt'`；PAT：grep audit-log 的 `ghp_…`（**不寫進任何檔案**）
- ⚠⚠ **git push 常被代理截斷**（間歇性；fetch 也可能掛）→ 走 **REST API**：`.smoke/api-push.mjs`（main）＋`.smoke/deploy-api.mjs`（gh-pages）；本地對齊＝`fetch`＋`reset <sha>`（樹同才安全）
- ⚠⚠ Git Bash 帶 `VITE_BASE=/Document_inlocal/` 會被 **MSYS 路徑轉換**改成 PortableGit 路徑→線上 404；要加 `MSYS_NO_PATHCONV=1`

## 資料
- wallets.v1＝{wallets, activeWalletId}；每錢包設定 `setting.<id>.v1`（預設錢包 `w_default`）；store 對外 `records`＝computed(當前錢包)；匯出 JSON=format2 可還原；Excel=.zip；金額帶入＝initCalc→逐字 input→equals

## 旅行模式（0.1.35 起）
- 一次一個 `activeTrip`（每錢包一份）；記錄蓋 `tripId?`；結束**保留**標籤（推 `tripHistory`）
- TripHistorySheet＋`?trip=` 過濾；旅行**顏色**（`--trip-c`）；tripViewFilter｜`hidden` 隱藏｜過去旅行 icon 綁旅行色

## 0.1.44~48
- 自訂貨幣＝`settings.customCurrencies`＋匯率進 `rates`；刪除只移選單、rates 留著
- 排版＝`settings.homeLayout`（空=全顯示；沒排=不顯示；分類=3 號，`homeLayoutV` 防重遷移）；表單卡 flex gap 9（**舊測試找 `.card--ledger`**）
- 預設值＝`settings.homeDefaults`（即改即存；預設圖片提交時複製 blob 成新 id）；`.box` 各子頁面 scoped；ReviewSheet 縮圖重用 ImageLightbox；dateOffset 遷移**只改 state、ls 下次寫入才落地**

## 0.1.49
- **dateOffset** 再擴：加回 `h` 單位＋`'now'`＋`'at:YYYY-MM-DDTHH:mm'`（完整時間手動輸入）
- **MiniSelect.vue**：照 CategorySelect 自訂彈層；**多根元件 class 不 fallthrough**→`inheritAttrs:false`＋父層 `<span class="daterow__sel">` 包；PWA 輸入框獨立一行＋兩選單在下
- 自訂貨幣**可當主幣別**（setBaseCurrency 整組換算）＋cx 四元素同行

## 0.1.50
- 預設值加**幣別**下拉（金額下一列整行、allCurrencies 全選；**只有區塊 1 隱藏才套用**，顯示時以頁面為準）→ `HomeDefaults.currency`；備註下方 `.frow-sep` 分割線
- **自訂貨幣代碼完全不設限**（`[A-Z0-9]{1,12}`／maxlength 整段拿掉）；只留 空白/撞內建/重複 三條保護

## 0.1.51
- 排版標題列貼右＝#sec-homelayout header 加 `.sec__hd--lay`（`.sec__meta{flex:1}`）；「恢復預設」不存在時「預設值」自己貼右
- HomeDefaultSheet：**scoped 漏 `.hidden`**（Choose Files 露出）→ 補 `display:none`；`.mask` 補 z-index 90 蓋住 `.tabbar`(40)；`.daterow`／`.daterow__sel` 各 3px＝下拉不貼底
- 記錄頁搜索＝**空白切詞 AND**（每詞在 備註／分類／旅行名 任一欄命中）；HighlightText 改字元遮罩支援多詞黃底；**沒加金額欄**
- ⚠ `placeholder` 有「必須塞得進輸入框」的守門員（v95）——改文案要量寬度，塞不下的說明放空狀態文案

## 全站約定（細節在 CONVENTIONS.md，勿回退）
1~5. body `min-height:100%`｜日期一律 DateField/DateTimeField｜彈層開著背景不能滑｜可編輯元素 16px（select 除外）｜點/雙擊空白不能動
6~10. 子頁面＝底部彈層（幾何只在 style.css `.bsheet*`）｜一列記錄＝一個點擊目標｜連點防護別拆｜彈層避 home indicator｜`<Transition>` wrapper 自補 flex+gap
11~14. 金額顯示即時換算｜快速金額只帶入不送出｜「依新增時間」＝最右黃框｜統計組標題金額用完整清單加總
15. 測試殺手：deleteDatabase 只能 reload 後；isRealErr()+ENV_NOISE 照抄；等狀態不等時間；防空集合假通過；拔 @esbuild 要裝回

視覺：米白紙感；收入墨綠 #2c6e5b、支出 #bf563c；琥珀 #d9a326＝旅行主題