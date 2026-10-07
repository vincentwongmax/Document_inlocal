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
- ⚠ **彈窗尺寸**（使用者要求「置中、不要全屏」）：
  官方 container 的留白只有 `--swal2-container-padding: 0.625em`（10px），在 390px 手機上
  彈窗會撐到 370px 幾乎滿版。`style.css` 裡覆寫成：
  ```css
  body.swal2-shown:not(.swal2-toast-shown) .swal2-container { padding: 24px 20px; }
  .swal2-container .swal2-popup { max-height: calc(100dvh - 48px); overflow-y: auto; }
  ```
  - ⚠ **一定要用 `body.swal2-shown:not(.swal2-toast-shown)` 限定**：直接寫 `.swal2-container`
    會連 Toast 的 container 一起改（Toast 的寬度與留白是另外調好的）
  - 官方的尺寸規則用的是 `div:where(.swal2-container) div:where(.swal2-popup)`，
    `:where()` 權重為 0 → 整條只有 (0,0,2)，所以我們用一般選擇器就蓋得過，**不需要 `!important`**
  - 只改尺寸與留白，**外觀維持官方原生**（配色／圓角／按鈕都不動）
  - ⚠ **SweetAlert2 即使 `showDenyButton: false` 也會把 deny 鈕留在 DOM 裡**（只是隱藏，
    沒有寬度）。測試數按鈕數量時要濾掉 `offsetWidth === 0` 的，否則會多算一顆空的
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
- **記錄頁的「最近」檢視**（`RecordsView.vue` 的 `recent` ref）：
  開啟後整頁改用 **`createdAt`（新增時間）** 查詢，而不是 `occurredAt`（使用者填的交易時間）。
  用途＝補登舊帳時用交易時間找不到
  - 畫面上一律走 `timeOf(r)` 這一個函式（篩選、排序、`catGroups` 排序）——
    ⚠ 只要有一處漏改，就會出現「標題寫今天、內容排在別天」
  - `RecordList` 用 **`date-basis`** 屬性（`'occurred' | 'created'`，預設 occurred）決定分組鍵、
    組內排序與 `dayParts()`；統計頁沒傳 → 行為不變
  - 開啟時多兩處提示，否則使用者看不出基準換了：
    ①「日／月／年」右側多一顆 **「依新增時間」** rangetag
    ② 列上的時間標籤加前綴 **「交易」**（`RecordRow` 的 `timePrefix`）——
       不然分組標題寫「今天」、列上卻寫「5 天前」，會被當成 bug
  - 空清單文案跟著變「這段時間沒有新增的記錄」
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
- **算式會存進記錄**：`TxRecord.expr?: string`（可讀文字，如 `12 + 5 × 3`）
  - 來源一律走 **`lib/calc.ts` 的 `calcExpr(state)`**：**只有真的按過運算才回字串**，
    單純一個數字（含 `-500`）回空字串 → `records.add()` 存 `undefined`
    - 判斷 `hasCalculation()`：tokens 有 op／paren 就算；按過 `=` 之後 tokens 只剩答案，
      所以要改看 `state.formula`（`formula.replace(/^-/,'')` 再測運算子）
    - **沒按 `=` 也要記**（`calcValue` 本來就會漸進求值）→ 非 done 時用 `calcText(state)`
  - 顯示：記錄列表 `RecordRow.vue` 的 `.row__expr`（備註下方、灰字、`num` 字型、
    等號單獨一格才不會被省略號吃掉）；明細 `RecordSheet.vue` 金額欄下方的 `.expr`（唯讀）
  - ⚠ **在明細改過金額就要清掉算式**：`exprValid` 即時隱藏提示，`save()` 送
    `{ expr: undefined }`（`Object.assign` 設 undefined，JSON 會自然省略），
    否則列表上寫的算式會跟金額對不上。只改備註則保留
  - 舊資料沒這欄位；`parseImport` 沒有欄位白名單，所以匯出／匯入會自動帶著走
- **鎖背景捲動用 `composables/useScrollLock.ts`**，三段缺一都會漏：
  ① `<html>` 掛 `is-locked`（`overflow:hidden`＋`overscroll-behavior:none`）
  ② **body 變 `position:fixed; top:-savedY`**（只加 overflow 會讓 scrollTop 歸零；
  也是 iOS Safari 唯一擋得住手指的做法）　③ 非 passive `touchmove` preventDefault
  - `{ scrollable: () => el }` 只放行該元素內滑動；模組層有 `locks` 計數器
  - ⚠ 別在彈窗最外層設 `touch-action:none`（交集會把子孫的 pan-y 一起取消）
  - ⚠ 測背景有沒有動別看 `scrollTop`（body fixed 後就是 0），量 `rect.top`
- **日期欄要跟備註同寬**：`DateTimeField` 放 `.pad__meta`（**別放回 `.pad__row`**）
- 數主頁 chips 用 `.catbox .picker > .cats .cat__name`（`.catbox .cat` 會混入子分類列）
- **分類第一列永遠只有大類**：`CategoryPicker` 的 `list` 在 collapsed（記帳頁）模式會
  「保證選中的分類看得到」，但**子分類不補進第一列**——它已經有自己的子分類列，
  補上去會插一顆到最前面（使用者反映「選了早餐就變成 早餐(選取), 餐飲, 交通」）。
  改成補「**所屬大類**」（`selectedRoot = settings.pathOf(id)[0]`），
  並由 `activeId` 決定第一列標亮誰：子分類自己不在第一列時，標亮它所屬的大類
  - 例外：子分類被勾成常用分類、本來就在第一列時，`activeId` 標它自己（不要兩個一起亮）
  - 每一層子分類列只亮「真正選中的那一顆」：選「餐飲 › 早餐 › 麵」時，
    餐飲那層**不亮**早餐，只有麵亮
  - 非 collapsed 的地方（`CategorySheet` 分類彈窗、`ReviewSheet` 收據複核）同步適用：
    選子分類時標亮所屬大類，而不是整個第一列沒東西亮
  - ⚠ 大類若已封存就不補（`root.archived`），免得冒出已封存的大類
  - 回歸：`.smoke/v91.mjs`

## 計算機鍵盤 `Keypad.vue`

- **按鍵一律用 `pointerdown` 觸發，不要用 `click`**（使用者反映過「按太快沒反應」）
  - `click` 是合成的：手指碰下去後要等手勢辨識器認定「這是一下 tap」才送出；
    兩指觸碰重疊（快按時手指就是會疊到）、兩下之間有位移、子樹 effective
    `touch-action: none`（計算機彈窗為了擋滑動而設）→ 事件整個靜默消失
  - 實測（CDP `Input.dispatchTouchEvent`）：**兩指同時落在同一顆鍵 → 2 個 pointerdown、
    0 個 click**，畫面完全不動。⚠ **零位移的乾淨連點是測不出來的**（10ms 間隔也全過），
    一定要測「兩指重疊」與「手指微位移」這兩種
  - pointerdown 之後瀏覽器仍可能補一個 `click` → 用 `pressedFromPointer` 旗標吃掉，
    並附 **600ms 自動過期**（沒等到 click 時旗標不能卡住，否則下次鍵盤 Enter 會被吃掉）；
    鍵盤／讀屏走的仍然是 `click`，功能不變
- **按下樣式自己做（`.is-tap`），不能只靠 `:active`**：實測按住 120ms 期間
  `el.matches(':active')` 都是 `false`，按鍵要等手指放開才變色 → 快按就像沒反應。
  在 pointerdown 加 class、pointerup／pointercancel／pointerleave 移除
  - ⚠ `.key--eq`（等號）要另外寫 `:active, .is-tap { background: --accent-light-hover }`，
    否則會被 `.key:active`／`.key.is-tap` 的灰底蓋掉（原本按等號會閃成灰色）
  - 放開後底色仍停在 `--surface-3` 是**觸控的 sticky :hover**（Chrome／iOS 都會把最後
    碰到的元素留在 hover 態），全站既有行為、不是 bug，驗收時不要當成沒還原

## 收據圖片：貼上（剪貼簿）

- **iOS 只在「可編輯元素」取得焦點時才發 `paste`**（`document.addEventListener('paste')` 在
  WebKit 上靜默失效）→ 做法是在「貼上圖片」磚上鋪一層**鋪滿整顆磚的隱形 `contenteditable`**
  當接收面，點磚＝聚焦，使用者再長按選「貼上」。⚠ 接收面要 `inputmode="none"` ＋
  `virtualkeyboardpolicy="manual"`，不然 iOS 會彈鍵盤
- ⚠ **必須把全站規則關掉的兩件事打開**：`style.css` 給 `button, [role='button'], a` 的
  `-webkit-touch-callout: none` 與 `user-select: none` 正是 iOS 長按選單的開關，
  關著就永遠貼不了。覆寫要用**兩層選擇器**（`.imgs .imgs__pasteArea`）確定蓋得過，
  同權重只靠載入順序太脆（元件樣式是 lazy chunk，順序會變）
- 點磚的處理函式裡**聚焦要同步做**，不能等 `await` 之後：iOS 只認手勢的同步階段；
  且要先站穩「長按可貼」這條保證路徑，再去試 `navigator.clipboard.read()`（加分項，
  Safari 支援反覆、失敗是常態，一律 try/catch）
- `preventDefault()` 必須**同步**決定（事件派送完就跑預設行為，await 回來才擋太遲）：
  在接收面上一律擋；其他位置只在**真的夾帶圖片檔案**時才擋 → 純文字貼上不受影響
- 剪貼簿來源有三種，都要接：① `files`／`items` 的檔案（桌機／Android）
  ② iOS 常給的 `text/html` 內含 `<img src="blob:">` 或 `data:` ③ `text/plain` 裡的 data URL。
  外部 `http(s)` 網址刻意不處理（跨域只會拿到不透明回應）
- 貼上與上傳共用 `addFiles()`，壓縮／縮圖／IndexedDB／孤兒清理才一致

## 收據圖片 / iOS 觸控

- `lib/imaging.ts`：`MAX_EDGE=1600`、`TARGET_BYTES=300KB`、品質最低 0.62、縮尺寸只退兩階。
  ⚠ **別再往下調**（使用者反映過「壓縮太嚴重、看不清」）；舊圖救不回來。
  ⚠ 量失真要把舊圖**放大回新圖尺寸**再比
- iOS 連點被判成 double-tap → 全域 `html { touch-action: manipulation }` ＋按鈕類
  `touch-action: manipulation; user-select: none`。⚠ 別套 `label`（會繼承進 input 不能選字）；
  touch-action 不是繼承屬性，要寫在元素本身且**由目標往上交集**

### 放大檢視的縮放／拖曳（`RecordSheet.vue` 的 lightbox）

- ⚠ **放大不能只用 `transform: scale()`**：transform 不影響 layout，外層 `overflow: auto`
  的 `.lightbox__stage` 就永遠沒有可捲動的內容 → 放大後上下左右都滑不動（桌機滾輪也一樣）。
  正解是開圖時量出「100% 時該多大」（`measureFit()`：用 `naturalWidth/Height` 對檢視區內距
  取 `min(1, …)`，只縮不放），之後 `width/height` 隨倍率**實際長大**，捲動交給瀏覽器原生處理
  （iOS 才有慣性滑動）。量到後要用 inline `max-width/height: none` 放掉，否則放大會被壓回畫面內
- ⚠ 圖片的 flex 子項預設 `flex-shrink: 1` → 放大的圖會被硬縮回容器寬，等於又沒有 overflow。
  必須 `flex: none`
- ⚠ **捲動區要列進 `useScrollLock` 的白名單**：鎖背景的 `touchmove → preventDefault` 掛在
  `document` 上，沒放行手指一滑就被整段擋掉。檢視區是整面 `fixed` 覆蓋層，
  開著時直接取代 `bodyEl` → `scrollable: () => stageEl.value ?? bodyEl.value`
- 置中靠 `margin: auto`：內容超出時 auto margin 會歸零，溢位只往右下長、四邊都捲得到
  （`grid place-items: center` 則會把左上裁掉且捲不到）
- 點背景關閉要用 `pointerdown` 記起點，位移 > 8px 視為拖曳不關（不然滑到一半放開就關掉了）
- 量測時機：圖片 `@load` ＋ `watch(lightbox)` 的 `nextTick`（快取命中時 load 可能更早）
  ＋ window `resize`／`orientationchange`。⚠ 檢視區是 `fixed inset: 0`，別用 ResizeObserver
  盯它——捲軸出現會改變 clientWidth，可能來回震盪

## 統計頁 / 設定頁

- 統計頁三張摘要卡用 `fmtNum()` 純數字，**幣別只在標題右邊膠囊**（`.page-cur`）；
  其餘金額維持 `fmtMoney(..., base)`
- ⚠ **原生日期框「最少需要多寬」是硬的**：內容＝日期文字＋日曆圖示，Chromium 實測
  15px 字級＋左右各 12px 內距要 **166px**（13px／8px 則只要 141px）。
  所以「自訂」區間的從／到**不能**用 `1fr 1fr` 各切一半——手機上每欄只有 122～157px，
  日曆圖示會被硬推到日期文字上，看起來就是「爆掉」。
  ⚠ 但**它不會溢出卡片**，用「有沒有超出版面」的判準抓不到；要量的是
  「把欄位暫時設成 `width: max-content`，它最少需要多寬，再跟實際寬度比」（`.smoke/v90.mjs`）
  - 現在：`grid-template-columns: repeat(2, minmax(0, max-content))` ＋ `justify-content: space-between`
    （每欄只佔自己需要的寬度，375px 螢幕 157 → 141px），這一列另收成 13px 字級＋左右各 8px 內距，
    高度維持 42px；`minmax(0, …)` 是保險，真的放不下時可以再縮
  - `< 360px` 的超窄螢幕改成上下堆疊（兩欄再怎麼收都擠）
  - 日模式的單一日期框（`.monthbar__sel`，`font-weight: 600` → 需要 170px）沒有這個問題
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
  - **要放第二顆時走 `ClearableInput` 的 `trailing` slot**（元件本身不認識業務概念），
    第二顆放 `right: 34px`（＝5 + 26 + 3），輸入框 `padding-right` 改 72px；
    由 `:hasTrailing` 自動加 `.cf--extra` 控制
  - ⚠ 已存在的清空鈕固定在**最右緣**，新按鈕插在它**左邊**——不要為了「最右邊」把 ✕ 擠開
- 共用件（改動要一併回歸）：`DateTimeField`、`ClearableInput`、`CategoryIcon`、
  `CategoryPicker`、`RecordList`、`RecordRow`、`HighlightText`

## 快速備註（quick notes）

- 資料在 `Settings.quickNotes: string[]`；`merge()` 用 `Array.isArray` 判斷**不要用 `?.length`**，
  否則使用者把備註全部刪光（存成 `[]`）時預設值會把他們叫回來
- 設定頁 › 快速備註（`#sec-quicknotes`）：新增／直接改字（**`@change` 才寫回**，失焦或 Enter）／刪除；
  空白、超過 `QUICK_NOTE_MAX`(20)、重複都不收，呼叫端要把輸入框**還原**成原值
- 記帳頁與記錄明細的備註欄用 `<template #trailing><QuickNotePicker v-model="note" /></template>`
- `QuickNotePicker`：填入是**取代**不是疊加；目前用的那一則用 `is-on`（粉紅底＋打勾）標出來；
  空清單時顯示提示 ＋「管理快速備註」→ `#/settings?sec=quicknotes`（設定頁會自動捲過去）
  - 彈層沿用 `CategorySelect` 的模式：`Teleport to body` + fixed 定位 + `pointerdown` 點外面關閉
  - ⚠ **鍵盤要掛在 document 的 capture 階段**：程式 `click()` 與 iOS 手指點擊都不會讓按鈕拿到焦點，
    靠 `@keydown` 收不到 Esc；而且處理到時要 `stopPropagation()`——
    **記帳頁在全域（window）監聽 Escape 會清掉金額**，不擋掉會「關清單順手清金額」
  - ⚠ 焦點在 `INPUT`/`TEXTAREA` 時只認 Esc：不然在備註欄打空白鍵會被當成「選取該項」

⚠ 測這個功能時踩到的兩個坑（測試腳本層面）：
1. 要開記錄明細只能點 **`.list .row__main`**（內層按鈕）；寫成 `.list .row` 會點到外層 div，
   它沒有 handler，**失敗是靜默的**
2. 記錄頁自己的**搜尋框也是 `ClearableInput`**，查備註欄的值／幾何一定要 **scope 到 `.sheet`**，
   不然會抓到搜尋框
