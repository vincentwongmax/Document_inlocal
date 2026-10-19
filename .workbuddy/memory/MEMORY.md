# 記帳本（mop-ledger）— 核心備忘

Vue 3 + TS + Pinia + vue-router(hash) + Vite + PWA 記帳。Repo `C:\Users\User\Desktop\AI`。
細節（逐版設計決策、CSS 慣例、測試寫法）在 `CONVENTIONS.md`；這裡只放**每次動手都會用到**的東西。

## 版本
- 只加 Z（目前 **0.1.71**）；改 package.json ＋ CHANGELOG（插最前面 `---` 後）
- ⚠ `.smoke/` 在 .gitignore（測試**不會**進 commit）→ 版本 commit 只含 src/、CHANGELOG、package.json、.workbuddy/memory

## 開發／驗證
- preview :4173（**改完必先 build**）；dev :5173（兩個 ls 分開）
- 回歸 `bash .smoke/run-regress.sh`，**判準＝每支 exit code**；ALL＝v70~v145（66 支，v108 不存在）
- ⚠⚠ 回歸跑著時**不要編輯 run-regress.sh**；升版後必先 build（APP_VERSION 是編譯期注入）
- ⚠⚠ **本地回歸 dist 不能帶 VITE_BASE**（preview 伺服在根目錄，帶了全 404 → App 空白假紅）；部署前才帶 base 重建
- 冷啟 `Navigation timeout 30s`＝**環境假紅**（單獨重跑就好）；v113/v135 等偶發 timing flake 同理
- ⚠ 升版後**每支測試的「版本是 X」斷言都要跟著改**（v132~v144 這種老測試也有；`-live` 系列除外＝跟線上版本）
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
- live 測試（v132-live…v137-live）版本斷言要跟著**線上**版本（未部署就維持舊值）

## 資料模型
- wallets.v1＝{wallets, activeWalletId}；每錢包 `setting.<id>.v1`（預設 `w_default`）；`records`＝當前錢包 computed
- 匯出 JSON=format2（可還原）／Excel=.zip（不含設定）
- **匯率凍結**：記錄顯示＝該筆快照的 `rate`；`recRate()` 最前面短路 `r.currency===dc → 1`；「更新匯率」只寫 `rates`（舊記錄不動）
- **不計入統計三態**：`undefined`＝跟隨分類／`true`／`false`；唯一判別式 `r.excludeFromStats ?? settings.categoryExcluded(r.categoryId)`

## 元件幾何（全站共用）
- 底部彈層＝`.mask > .card.bsheet`（`.bsheet__grab`＋`.box.bsheet__body` 唯一可捲＋下拉關閉＋背景鎖）
- **頁腳固定**：`.foot` 放在 `.bsheet` 直接子元素（**不是** `.box` 裡）→ `flex:none`＋`border-top`＋`padding:12px 18px 16px`（0.1.65 的修法，之後所有彈層照做）
- z-index：tabbar 40／一般彈層與匯入彈窗 90／格子編輯器 96（快速記錄頁已併入匯入彈窗，不再獨立）
- ⚠⚠ Vue 模板 HTML 註解內**不能用 `-->` 箭頭**（註解提前結束→文字外洩）；一律寫「→」

## 視覺
米白紙感；收入墨綠 `#2c6e5b`（`--accent`）、支出 `#bf563c`（`--expense`）、琥珀 `#d9a326`＝旅行、橘 `#c95f16`＝「排」。

## 近期版本重點
- **0.1.71**（已 commit 未部署）匯入彈窗桌機加寬（`@media(min-width:768px)` scoped 蓋 `.bsheet`＝`min(1080px, 100vw-48)`；手機/PWA 不動；⚠ 桌機 ≥1024 有 232px 側欄→`.page` 實寬 `100vw-232`，1280 下 1048，彈窗取上限不窄於它）；快速記錄標題列灰底補滿（根因＝`.tbl__hd` 盒子 < 7 欄地板寬 486px → `.tbl__hd, .tr { min-width: 486px }`）；記帳頁排版多區塊 8「快速記帳」（預設隱藏；兩顆鈕貼上資料/快速記錄 → `router.push('/settings?import=…')`，SettingsView watch 接住開彈窗＋`initialTab` 落分頁＋`router.replace` 清 query）；收據圖五檔壓縮等級（`src/lib/imgLevels.ts`＋`src/composables/useImgLevels.ts`＝模組級單例暫存區：`stageImage` 只留記憶體不寫 DB、`setLevel` 從記憶體原檔重算、`flushLevels` 按儲存才寫、`blobOf` 先記憶體後 DB；等級 orig/a/b/c/d，原＝存原檔本體；儲存後 `isLocked` 全鎖）。⚠ 修掉 ImportModal open watch 的 TDZ（immediate 回跑在 `editing` 宣告前 → 以 open=true 建立元件就 ReferenceError，Vue 只記 console 不中斷渲染 → 守門員 ⓪ 的 JS 錯誤檢查才抓到）；守門員 v145（39 支斷言）
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
