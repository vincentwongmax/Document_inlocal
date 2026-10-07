# 記帳本（mop-ledger）— 細節規範

`MEMORY.md` 的附屬檔，只在需要時讀。內容是各功能的實作約定與踩過的坑。

## 通知（SweetAlert2）

- **唯一出口 `src/lib/alerts.ts`**（舊 `ToastHost.vue`／`ConfirmDialog.vue`／`useToast.ts` 已刪）
  - `notify(text, kind, action?, ms?)`：底部置中 Toast，kind `ok|warn|info|error`；可帶動作鈕
  - `confirmDialog()` → `'confirm' | 'deny' | 'cancel'`；`danger` 用紅鈕＋warning icon
  - `askUpdate()`：PWA 有新版時問「立即更新／稍後」
- 用 **SweetAlert2 官方原生樣式**（使用者指定），不套專案的米白墨綠
- ⚠ **官方 CSS 不要 import**：入口 `sweetalert2.all.js` 執行時把整份 CSS 插成 `<head>` 的
  **行內 `<style>`**，排在所有 `<link>` 之後 → 同權重贏過 style.css。唯一覆寫（置底 Toast
  讓開導航列）**必須 `!important`**：
  `body.swal2-toast-shown .swal2-container.swal2-bottom { bottom: calc(var(--nav-h) + var(--safe-b) + 14px) }`（≥1024px → 22px）
- sheet 開著（body 被釘成 fixed）時 SweetAlert 仍疊在最上層（fixed 的包含塊是視窗）
- ⚠ 驗「Toast 沒遮罩」別看 `body.swal2-shown`（Toast 也會加），要看容器計算底色
- ⚠ 寫 CSSOM walker：Chrome 的 `CSSStyleRule` 也有 `cssRules`（巢狀），要先判斷
  `r.selectorText` 再遞迴，否則整批規則被跳過
- `manualChunks` 有 `sweetalert2 → 'sweetalert'`（entry chunk 239KB → 160KB）

## 分類階層

- `parentId` 多層；子分類沿用上層 type／color；有子分類不給刪；刪除＝封存
- 樹工具：`childrenOf / hasChildren / pathOf / descendantIds / fullNameOf / canRemove / topCategoriesByType`
- **下拉一律用 `lib/tree.ts` 的 `flattenCategories()`**（直接 map 會讓子分類全擠到最後）；
  chips 用 `topCategoriesByType`，下拉（`variant="select"`）**必須用 `selectList`**；下拉不縮排
- `PathLabel.vue` 折成「頭 › … › 尾」，只能放在 `flex: 1; min-width: 0` 的容器
- `CategoryManageModal` 分段展開（哨兵 `PICK='__pick__'`）；**表單載入別 `watch(pickedId)`**
  （非同步會蓋值）→ 用 `@update:model-value="choose"`；切類型用同步 `setType()`
- 記錄頁「分類」檢視只依根大類分組，大類自身金額補「未細分」列（id 加 `__own`）
- 統計頁分類佔比含整棵子樹，展開後百分比是「佔上一層」

## 記帳頁 / 彈窗

- 金額欄 → `CalcSheet.vue`；分類「更多」→ `CategorySheet.vue`
- **計算機只有一個模式**：`Keypad.vue` 固定 5 列 × 4 欄、沒有展開鈕
  （⌫ ( ) ÷ ／ 7 8 9 × ／ 4 5 6 − ／ 1 2 3 ＋ ／ C 0 . ＝）
  - 運算鍵與 ⌫ 用 SVG 描邊圖示；每顆鍵有 `data-key`，值是：
    `⌫` `(` `)` `÷` ／ `7` `8` `9` `×` ／ `4` `5` `6` **`-`** ／ `1` `2` `3` **`+`** ／
    `C` `0` `.` `=`
    ⚠ **加減是 ASCII 的 `+` `-`，乘除才是 `×` `÷`** —— 測試寫 `press('＋')` 會靜靜地按不到
    （圖示是 SVG，`textContent` 也讀不到字，只能靠 `data-key`）
  - ⚠ ÷ 圓點要**用 class** 設 `fill: currentColor`（`.kic{fill:none}` 會蓋掉屬性）
- **單一數字上限 11 位**：`lib/calc.ts` 的 `input()` 用
  `last.v.replace(/[.\-]/g, '').length < 11` 擋住第 12 位——**是「不進狀態」不是「遮住」**，
  否則畫面 11 位、記下的 12 位會對不上。`.` 與 `-` 不佔額度（最多 12 字元）
  - 縮字級判斷抽成 **`isLongDisplay(text)`（門檻 > 12 字元）**，`CalcSheet` 與 `HomeView`
    共用；正常輸入永遠不會觸發，只有長公式／很大的結果才會
  - 基準字級：`.calcdisp__num` 38px（long 24px）、`.amount__num` 32px（long 22px）
- **鎖背景捲動用 `composables/useScrollLock.ts`**，三段缺一都會漏：
  ① `<html>` 掛 `is-locked`（`overflow:hidden`＋`overscroll-behavior:none`）
  ② **body 變 `position:fixed; top:-savedY`**（只加 overflow 會讓 scrollTop 歸零；
  也是 iOS Safari 唯一擋得住手指的做法）　③ 非 passive `touchmove` preventDefault
  - `{ scrollable: () => el }` 只放行該元素內滑動；模組層有 `locks` 計數器
  - ⚠ 別在彈窗最外層設 `touch-action:none`（交集會把子孫的 pan-y 一起取消）
  - ⚠ 測背景有沒有動別看 `scrollTop`（body fixed 後就是 0），量 `rect.top`
- **日期欄要跟備註同寬**：`DateTimeField` 放 `.pad__meta`（**別放回 `.pad__row`**）
- 數主頁 chips 用 `.catbox .picker > .cats .cat__name`（`.catbox .cat` 會混入子分類列）

## 收據圖片 / iOS 觸控

- `lib/imaging.ts`：`MAX_EDGE=1600`、`TARGET_BYTES=300KB`、品質最低 0.62、縮尺寸只退兩階。
  ⚠ **別再往下調**（使用者反映過「壓縮太嚴重、看不清」）；舊圖救不回來。
  ⚠ 量失真要把舊圖**放大回新圖尺寸**再比
- iOS 連點被判成 double-tap → 全域 `html { touch-action: manipulation }` ＋按鈕類
  `touch-action: manipulation; user-select: none`。⚠ 別套 `label`（會繼承進 input 不能選字）；
  touch-action 不是繼承屬性，要寫在元素本身且**由目標往上交集**

## 統計頁 / 設定頁

- 統計頁三張摘要卡用 `fmtNum()` 純數字，**幣別只在標題右邊膠囊**（`.page-cur`）；
  其餘金額維持 `fmtMoney(..., base)`
- 設定頁版本膠囊容器要用 **`div`**（`.row > span` 有 `flex-direction: column`，用 span 會被擠上去）
- 「主頁常用分類」面板**不做縮排、不改格線對齊**（使用者要求排列整齊）；子分類靠 `└` 記號；
  講到它要說「設定頁 › 分類 › 主頁常用分類」才不會被誤認成主頁
- ⚠ 已知未修：`ReviewSheet.vue` 的 `.grid` 在 ≥768px 變兩欄，「時間」只剩半寬、對不齊「備註」

## 樣式細節

- ⚠ **原生日期／時間輸入框要與 `.field` 同高**（Safari 會把它撐高，跟備註欄對不齊）：
  Safari 把 `date`/`datetime-local` 拆成 shadow DOM 的多個小欄位（年、月、日、時、分…），
  **每個欄位都自帶 padding** → 整個框比文字框高。
  解法寫在 `style.css` 的 `.field` 上（**不是** `DateTimeField.vue`）：
  ① `::-webkit-datetime-edit*` 那批內部欄位 `padding: 0`
  ② `height: 42px` **＋ `min-height: 42px`**（⚠ 少了 `min-height` 會被 Safari 的 UA 最小高度壓過去）
  - 做在 `.field` 才會連**記錄頁的日期範圍**與**統計頁的 monthbar／自訂範圍**（原生 `type="date"`）
    一起修到；只改 `DateTimeField` 會漏掉那兩頁
  - ⚠ **不要用 `-webkit-appearance: none`**（會把 Chrome 的原生日曆鈕一起關掉）
  - `::-webkit-datetime-edit*` 在 Chrome 也支援且預設內距為 0 → 設 0 無副作用，**不必偵測 iOS**
- ⚠ 「標籤＋說明」列**別用 flex**（中文 min-content 只 1 字會壓縮標籤）→
  `grid-template-columns: max-content minmax(0, 1fr)`
- 輸入框內嵌小按鈕：26×26、radius 8px、`right: 5px`、`--accent-soft` 底 ＋ `--accent` 圖示、
  hover 反白；輸入框 `padding-right: 40px`
- 共用件（改動要一併回歸）：`DateTimeField`、`ClearableInput`、`CategoryIcon`、
  `CategoryPicker`、`RecordList`、`RecordRow`、`HighlightText`
