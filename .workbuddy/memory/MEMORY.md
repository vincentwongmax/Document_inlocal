# 記帳本（mop-ledger）— 專案長期備忘

Vue 3 + TypeScript + Pinia + vue-router（hash routing）+ Vite + vite-plugin-pwa 的個人記帳 PWA。
Repo 根目錄：`c:\Users\user\Desktop\AI\`，分支 `main`。

## 怎麼啟動 / 打開這個程序

| 用途 | 指令 | 網址 |
|---|---|---|
| 平常使用（推薦） | `npm run preview` | http://localhost:4173/ |
| 開發（改程式即時熱更新） | `npm run dev` | http://localhost:5173/ |

- **`npm run preview` 服務的是 `dist/`**，所以改完程式要先 `npm run build` 才會生效。
- `npm run dev` 沒有 Service Worker（`devOptions.enabled: false`），永遠是最新程式碼，
  除錯時最不容易被快取誤導。
- **`localhost:4173` 與 `localhost:5173` 的 localStorage 是分開的**（同源包含埠），
  真實資料只會在其中一邊，不要隨便換埠否則會看到空帳本。

## 快取陷阱（很重要）

App 是 PWA，`registerType: 'autoUpdate'`，Service Worker 會預快取整個 dist。
- 部署新版本後若畫面看起來還是舊的：**Ctrl+Shift+R 硬重新整理**，或用無痕視窗。
- 徹底解決：DevTools → Application → Service Workers → Unregister。
- 截圖／自動化測試一律用全新的瀏覽器 profile（puppeteer 預設即是），不要同 profile 反覆 reload。
- 純靜態資產有變時若還看到舊版，先確認 `dist/index.html` 的 `assets/index-*.js` 雜湊
  與 `curl http://localhost:4173/` 回傳的一致。

## 分類階層（子分類）

- `Category.parentId?: string | null`，null／省略＝頂層大類；**支援多層**（子分類還能再有子分類）
- 子分類的 `type` 與 `color` 一律沿用上層（store 的 `addCategory` 會自動帶），
  改大類的 type 時 `updateCategory` 會連整棵子樹一起改
- **有大類底下還有子分類時不給刪**（`canRemove()` 回傳原因，UI 顯示並停用刪除鈕），
  要先刪到最底層才能往上刪；刪除一律是封存（`archived = true`），記錄仍讀得到名稱
- store 的樹狀工具：`childrenOf / hasChildren / pathOf / descendantIds / fullNameOf / canRemove /
  topCategoriesByType`；`fullNameOf` 回傳「餐飲 › 早餐」
- 記帳頁：第一列只放大類，選了大類後下方沿路徑逐層展開子分類標籤列（`.subs`）
  ⚠ `CategoryPicker` 的 chips 模式用 `topCategoriesByType`，**下拉模式（`variant="select"`）
  必須改用 `selectList`**，否則下拉會漏掉子分類
- 統計頁：分類佔比每列的金額含整棵子樹，點箭頭展開看子分類；展開後的百分比是「佔上一層」，
  大類自己身上的金額會補一列「未細分」
- 常用分類可以勾到子分類，記帳頁第一列會直接出現（展開「更多」時會補回來，不會消失）
- ⚠ `CategoryManageModal` 的表單載入**不要用 `watch(pickedId)`**：watch 是非同步的，
  會蓋掉同步設定好的值（曾因此讓「＋ 在 X 底下新增子分類」的上層被清空、只能建兩層）。
  改用 CategorySelect 的 `@update:model-value="choose"`；`addChild()` 也要先把
  `editing.value?.id` 存下來再 `choose(NEW)`，因為 choose 之後 editing 就變 null 了

## 資料存放位置

- `localStorage`：`mop-ledger.records.v1`（記錄）、`mop-ledger.settings.v1`（設定／分類）、
  `mop-ledger.draft.v1`（待確認草稿）
- `IndexedDB`（`idb-keyval`）：收據圖片原始檔，鍵為 ImageRef.id；縮圖以 data URL 存在記錄裡
- 分類結構：`{ id, name, type, color, icon?, builtin, archived }`
  - `icon` 為 `src/lib/icons.ts` 的鍵值；舊資料沒有此欄位，載入時 `settings` store 的
    `withIcons()` 會自動補（先對照內建 id，再依名稱猜），並立即回寫一次

## 開發慣例

- 改完一定要跑：`npx vue-tsc --noEmit` → `npm run build` → 一個 `.smoke/vNN.mjs` 實測 → 截圖 → commit
- 詳細的 headless Chrome 驗證流程見 skill `vite-pwa-smoke-verify`
- 視覺規範：米白紙感、石墨灰文字、**單一墨綠強調色 `--accent: #2c6e5b`**；
  支出 `--expense: #bf563c`（紅／暖）、收入 `--income: #2c6e5b`（綠）；
  不用漸層／玻璃擬態／霓虹色
- 墨綠色階（由淺到深）：`--accent-soft: #e7f0ec`（淡底／內嵌小按鈕）→
  `--accent-light: #cde6da`（淺綠，等號鍵底；配 `--accent` 深字）→
  `--accent: #2c6e5b`（主按鈕、強調）→ `--accent-hover: #245c4b`
- 「已選分類」一律用粉紅 `--pick: #b85773`（白字對比 4.5:1）、`--pick-soft: #fbeef2`（下拉已選列底）、
  `--pick-line: #eccfd9`（已選列的 icon 描邊）；**不要用 `--text`（近黑）當已選底色**（使用者明確要求）
  - 兩處實作都在 `CategoryPicker.vue`：`.cat.is-on`（chips）與 `.pop__item.is-on`（自訂下拉）
- 字體：`--font` = Noto Sans TC，`--font-display` = Noto Serif TC（Google Fonts，CJK subset 按需載入）
- 圖示一律用描邊線性圖示（24×24 網格、`currentColor`），不要混用 emoji 或填充圖示
- 元件在被多處共用時（例如 `RecordList` 同時用於記錄頁與統計頁），改動要一併回歸測試
- 共用元件：`DateTimeField`（`datetime-local` 輸入框，右側內嵌「設為現在」小按鈕，v-model 為
  `YYYY-MM-DDTHH:mm` 本地字串）用於記帳頁、記錄明細、收據複核三處；
  `ClearableInput`（文字輸入框，右側內嵌「清空」小按鈕，空值時變灰停用，支援 placeholder/maxlength）
  同樣用於那三處的備註欄位；
  `CategoryIcon` / `CategoryPicker` / `RecordList` / `RecordRow` 為其他共用件
- 「輸入框內嵌小按鈕」的統一樣式：26×26、radius 8px、`right: 5px` 垂直置中、
  底色 `--accent-soft` + 圖示 `--accent`、hover 反白（`--accent` 底 + 白圖示）；
  輸入框一律 `padding-right: 40px` 讓開（datetime 還需容納 Chromium 原生日曆選擇器）
- `HighlightText.vue`：把文字按關鍵字切成片段、命中處包 `<mark class="hl">`（黃底 `--hl: #ffe066`）。
  不用 RegExp、不分大小寫、保留原文大小寫；多根 fragment 輸出不影響外層 ellipsis。
  目前用於 `RecordRow` 的分類名與備註（`highlight` prop 由 RecordsView 搜尋框傳入）
