# 記帳本（mop-ledger）— 細節規範

`MEMORY.md` 的附屬檔，只在需要時讀。內容是各功能的實作約定與踩過的坑。

## 通知（SweetAlert2）

- **唯一出口 `src/lib/alerts.ts`**（舊 `ToastHost.vue`／`ConfirmDialog.vue`／`useToast.ts` 已刪）
  - `notify(text, kind, action?, ms?)`：底部置中 Toast，kind `ok|warn|info|error`；可帶動作鈕
  - `confirmDialog()` → `'confirm' | 'deny' | 'cancel'`；`danger` 用紅鈕＋warning icon
  - `askUpdate()`：PWA 有新版時問「立即更新／稍後」
- ⚠⚠ **Toast 一律要有「知道了」按鈕（使用者 0.1.21 指定，含未來所有新通知）**
  - Toast mixin：`showConfirmButton: true`、 `confirmButtonText: '知道了'`、 `showCloseButton: false`、
    `reverseButtons: true`；有 action 時再加 `showDenyButton` + `denyButtonText: action.label`
  - → 排列恆為「（復原）知道了」；**動作鈕用 deny 不用 confirm**，因為
    `res.isConfirmed` 會被「知道了」吃掉，動作只能用 `res.isDenied` 判斷
  - 官方 CSS 是 runtime 插在 `<head>` 最後的行內 `<style>` → 上色要 `!important`：
    ```css
    .swal2-toast .swal2-confirm { background: var(--accent) !important; color:#fff !important; … }
    .swal2-toast .swal2-deny    { background: var(--surface) !important; color: var(--text) !important; … }
    ```
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
- **算式會存進記錄**：`TxRecord.expr?: string`（可讀文字，如 `12+5×3`）
  - 來源一律走 **`lib/calc.ts` 的 `calcExpr(state)`**：**只有真的按過運算才回字串**，
    單純一個數字（含 `-500`）回空字串 → `records.add()` 存 `undefined`
    - 判斷 `hasCalculation()`：tokens 有 op／paren 就算；按過 `=` 之後 tokens 只剩答案，
      所以要改看 `state.formula`（`formula.replace(/^-/,'')` 再測運算子）
    - **沒按 `=` 也要記**（`calcValue` 本來就會漸進求值）→ 非 done 時用 `calcText(state)`
  - ⚠ **`calcText()` 拼接時不加空格**（`1+1` 不是 `1 + 1`），`displaySub()` 給的是
    `公式=`（等號也貼著）。使用者明確要求過「不需要空格，即 1+1=2」
    - 改動會連帶影響：CalcSheet／HomeView 的大小字、**存進記錄的 `expr`**、
      記錄列表與明細 → 相關測試的期望字串要一起改（v70／v83／v86）
    - **顯示記錄裡的算式一律走 `displayExpr(expr)`**（把所有空白拿掉）：
      0.1.14 之前存在裝置上的舊記錄是 `12 + 5 × 3`，不處理的話清單上新舊混在一起，
      看起來就像沒改到。只清顯示，不動存起來的字串
  - 顯示：記錄列表 `RecordRow.vue` 的 `.row__expr`（備註下方、灰字、`num` 字型、
    等號單獨一格才不會被省略號吃掉，**`gap` 必須是 0** 才不會多出空隙）；
    明細 `RecordSheet.vue` 金額欄下方的 `.expr`（唯讀，`{{ displayExpr(expr) }}=`）
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
- **日期欄是「普通文字框 ＋ 日曆鈕」**（`DateTimeField.vue`，記帳頁與明細共用）
  - 看得見的是 `<input type="text">`（值＝`YYYY/MM/DD HH:mm` 文字）→ 手機點它只出鍵盤，
    不會彈系統日期滾輪；Safari 把原生日期框拆成多個 shadow DOM 小欄位、
    各自帶 padding 導致比備註框高的問題也一併消失
  - 右側兩顆 26px 小鈕：`.dt__pick`（日曆，`right:34px`）、`.dt__now`（設為現在，`right:5px`）
    → `padding-right: 72px`。**刻意與 `ClearableInput` 的兩顆（`.cf__extra` 34px／`.cf__x` 5px）
    對齊**，兩列的鈕會落在同一條垂直線上
  - 日曆鈕的「真身」是**蓋在上面的透明原生 `datetime-local`（`.dt__native`）**：
    指尖直接落在原生輸入框上，由系統自己開選擇器
    - ⚠ 只能 `opacity: 0`（加 `top/bottom:-6px` 擴大熱區）。**不能用 `display:none`／
      `visibility:hidden`／`pointer-events:none`**——那三種都會讓它收不到手指，等於鈕壞掉
    - ⚠ `font-size` 一定要 ≥16px，否則 iOS 聚焦時會把整頁 zoom in
    - 為什麼不用 `showPicker()`：iOS 對它的支援反覆，靠「真的按到原生框」才穩
  - 打字走寬鬆解析 `lib/date.ts` 的 **`parseLooseDateTime(text, fallback)`**：
    `2026/10/7 8:05`、`2026-10-07 20:53`、`2026年10月7日 14:30`、`20261007 2053`、
    只寫 `10/7`（沿用原本時分）、只寫 `20:53`（沿用原本日期）；看不懂回 `null` → 還原
    顯示用 `toDisplayInput()`。**在 `blur` 才提交**（按「記錄」時 blur 早於 click，
    所以打完字直接按按鈕也存得到）
  - 回歸：`.smoke/v92.mjs`（v74 的「設為現在」、v82 的同高斷言已跟著改成新行為）
- **底部面板下拉關閉用 `composables/usePullToClose.ts`**（目前只有 `RecordSheet` 用）
  - 手指走 **touch 事件（非 passive ＋ preventDefault）**：pointer 事件在瀏覽器決定
    接管捲動時會收到 `pointercancel`，壓不過原生捲動
  - 判定順序（`mode` -1→0/1）：橫向滑、往上滑、**可捲區還沒到頂** → 交還瀏覽器；
    否則拖面板。⚠ 決定方向前要**先 preventDefault**（iOS 只要放掉第一個 touchmove
    就會把整次手勢鎖定成原生捲動，之後再擋也擋不回來）
  - ⚠ 沒收到 `touchstart` 的野生 touchmove 一律不理（`armed` 旗標）——
    否則 v75 那種「直接丟一個 touchmove 驗有沒有被擋」的測試會被誤擋
  - 門檻＝面板高的 22%（夾 64～160px）或甩速 > 0.55 px/ms；關閉時把 `offset`
    設成 `面板高 + 48` 讓它順著手勢滑出去
  - ⚠ `offset` **不能在收起時歸零**（inline transform 還撐著送出動畫），
    靠 `watch(panel)` 在面板重新出現時歸零
  - 滑鼠只能從 `.sheet__grab`／`.sheet__head` 起拖（在內容上拖是選字）；
    抓把有 `touch-action: none`；`.sheet__body` 加 `overscroll-behavior: contain`
  - 回歸：`.smoke/v92.mjs`
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

### ⚠ 0.1.21 重寫：貼上邏輯收進 `composables/usePasteImages.ts`

兩個呼叫端（`ReceiptImages.vue`／`RecordSheet.vue`）**共用同一份**，不要再各自複製一份。
建構參數 `{ target: () => HTMLElement|null, tile: () => HTMLElement|null, onFiles, onNothing }`。

- **不要再靠 `fetch()` 去讀 `<img src>`**：iOS 貼上時給的是 `applewebdata://` 之類的
  內部 scheme，`fetch` 一律失敗 → 這就是「PWA iPhone 貼上無效」的根因。
  新做法是**路徑 ②：不要 preventDefault**，讓瀏覽器把 `<img>` 真的插進 DOM，
  再用 `fileFromImageEl()`（canvas `toBlob`）把像素讀回來，`setTimeout(…,0)` 後 `harvest()`。
- 三條路徑的順序：① `dt.files`／`items` 有圖檔（桌機／Android，同步 preventDefault）
  → ② 讓瀏覽器插入後讀 DOM 的 `<img>` → ③ `filesFromMarkup(html, text)` 文字兜底。
  另外 `navigator.clipboard.read()` 是加分項，失敗是常態。
- ⚠⚠ **收完圖清現場只能「移除 `<img>` ＋ 清掉 target 底下的文字節點」**：
  對整顆磚做 `textContent = ''` 會把接收面自己一起刪掉 → 這顆磚**從此再也收不到貼上**
  （真的踩到過，第二次貼上直接失效）。
- 圖要去重：磚本身**包含** target，兩個根會掃到同一張 `<img>` → 用 `Set<HTMLImageElement>`。
- `onTile()` 的判斷要放寬到四種（target 本人 / target 內含 / activeElement / 磚內含）。
- ⚠ **接收面 `font-size` 必須 ≥16px**：iOS 上任何可編輯元素小於 16px 被聚焦時會
  把整頁放大（zoom）→ 頁面變寬 → 又變成「向左滑出現空白」。

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

### 共用元件：`ImageLightbox.vue` ╱ `lib/clipboard.ts`

- 放大檢視自 0.1.18 起抽成 **`components/ImageLightbox.vue`**（props `src`、emit `close`），
  記帳頁的 `ReceiptImages.vue` 與明細的 `RecordSheet.vue` **共用同一份**。
  class 名稱刻意沿用舊的（`.lightbox`／`.lightbox__stage`／`.lightbox__bar`／`.lbbtn`／
  `.lbzoom`／`.lightbox__x`），v89 才不必改。**改動時別改名**。
- ⚠ 明細要把檢視區列進 `useScrollLock` 白名單，而檢視區現在在子元件裡 →
  `ImageLightbox` 必須 `defineExpose({ stageEl })`，明細端用
  `lbEl.value?.stageEl ?? bodyEl.value`。**拿掉 expose 就會重現「放大後拖不動」**。
- 剪貼簿解析抽成 **`lib/clipboard.ts`**：`IMG_MIME`、`extOf`、`pastedFile`、`filesFromClipboard`。
  ⚠ 兩個呼叫端各自在 `document` capture 階段掛 `paste`（記帳頁 `onMounted`、
  明細看 `props.open`），各自決定要不要 `preventDefault`——**不要**把監聽也收進 lib，
  明細的開關時機跟記帳頁不同。

## 記帳頁：收據圖片區塊（`ReceiptImages.vue`）

- 位置：`.pad__meta` 裡、`.pad__row`（清空／記錄）**之前**。最上方那顆
  `.upload`「上傳收據圖片」是**辨識記帳**（OCR → 清單 → 建記錄），跟這塊是兩件事，**兩個都留**。
- 生命週期（元件只管「還沒存檔」的圖）：
  - ✕ 移除 → 若那張是自己加的，**直接刪 blob**（還沒有記錄引用它）
  - 送出成功 → `release()`：清單清空但 **blob 保留**（已歸記錄所有）
  - 清空表單／卸載 → `discard()`：刪掉本次新增的 blob ＋ **emit `update:modelValue = []`**
    ⚠ 只刪 blob 不清清單的話，「清空」看起來像沒生效（張數沒歸零、留一張點不開的破圖）
- 拖曳分流靠 `[data-drop="receipt"]`：拖在區塊上＝附加圖片（區塊自己 `is-over` 亮），
  拖在頁面其他地方＝走辨識流程（`.page.home` 掛 `is-drag` ＋ `.dropzone`）。
  判斷寫在 HomeView 的 `overReceipts(e)`（`e.target.closest(...)`），
  ⚠ 兩個 `dragleave` 都要用 `relatedTarget` 判斷「是否還在容器內」，不然滑過子元素就閃一下。
- MD5 去重跟主頁一致：`records.knownMd5` ＋ 本批 ＋ 目前清單，重複的略過並提示張數。
- 縮圖點開放大時，要去 IndexedDB 撈**原圖**（blob）而不是用縮圖 dataURL。

## 統計頁 / 設定頁

- 統計頁三張摘要卡用 `fmtNum()` 純數字，**幣別只在標題右邊膠囊**（`.page-cur`）；
  其餘金額維持 `fmtMoney(..., base)`
- ⚠ **原生日期框「最少需要多寬」是硬的**：內容＝日期文字＋日曆圖示，Chromium 實測
  15px 字級＋左右各 12px 內距要 **166px**（13px／8px 則只要 141px）。
  ⚠ 它**不會溢出卡片**，用「有沒有超出版面」的判準抓不到；要量的是
  「把欄位暫時設成 `width: max-content`，它最少需要多寬，再跟實際寬度比」（`.smoke/v90.mjs`）
- **統計頁「自訂」的從／到＝兩欄各半、填滿整列**（0.1.17 起；`.smoke/v96.mjs`）：
  `grid-template-columns: repeat(2, minmax(0, 1fr))` ＋ `gap: 10px`；
  這一列另收成 13px 字級＋左右各 8px 內距，高度維持 42px
  - ⚠⚠ **不要退回 `max-content` ＋ `space-between`**（0.1.10～0.1.16 的舊寫法）：
    那樣每欄寬度＝**原生日期框的內建寬度**，而那是**瀏覽器相依**的
    （Chrome 顯示 `10/07/2026`、iOS Safari 顯示 `2026/10/07` → 內建寬度不同）
    → 方塊大小與位置在不同瀏覽器會「走位」；而且中間縫隙隨螢幕變寬一路變大
    （375px 時 27px、768px 時 408px），整列根本沒填滿。`1fr` 之後寬度只跟容器有關
  - 每欄最少要 ≥ 141px：375px 時每欄 150px 剛好夠
  - **`< 375px` 改成上下堆疊**（門檻 374px）：360px 每欄只剩 142px、只有 1px 餘裕，太冒險
  - 「不走位」怎麼驗：人工把原生日期框的內建需要寬度撐大（改字級／字距），
    欄寬**不可以**跟著變 —— 舊寫法一定會變寬，新寫法完全不動（v96 的核心判準）
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

## 匯出（JSON ╱ Excel）

設定頁的「匯出」不直接下載，先開 `components/ExportModal.vue` 選**格式**與**範圍**。

- **JSON**＝備份／還原用：單一 `.json`，含記錄＋**設定**＋圖片 base64；
  匯入時會問「要不要一起還原設定」。**不要把設定從 JSON 拿掉**，匯入的
  「連設定一起還原」會直接壞掉。
- **Excel**＝給人看／拿去算：一個 `.zip`，內含一個 `.xlsx` ＋ `images/` 圖檔。
  **只含記錄，不含任何設定**（分類名稱是為了讓表格看得懂才顯示的，那不算匯出設定）。
  不能匯回 App。
- 範圍＝全部 or 日期區間（含首尾，用**本地日曆日**比對 `dayKey(occurredAt)`）。
  JSON 與 Excel 都吃同一個範圍；JSON 裡的設定一律是當下的完整設定。

### 產出檔案（`lib/zip.ts`、`lib/xlsx.ts`、`lib/exportExcel.ts`）

- ⚠ **零依賴是刻意的**：ZIP 與 XLSX 都自己寫。候選的 JSZip／SheetJS／exceljs 都不理想
  ——SheetJS 在 npm 上的版本有已知安全問題、exceljs 近 1 MB，而這是離線 PWA。
  要加東西進來之前先想想值不值得。
- `zip.ts`：STORE ＋ DEFLATE。DEFLATE 走瀏覽器內建的 `CompressionStream('deflate-raw')`
  （Chrome 103+／Safari 16.4+／Firefox 113+），**不支援就自動退回 STORE**，功能不受影響。
  ⚠ 圖檔一律 `compress: false`（WebP／JPEG 已壓縮，再 deflate 只是白花時間）。
  ⚠ 沒做 ZIP64：單檔或總量 > 4 GiB、檔案數 > 65535 就會失敗，呼叫端要先擋。
  ⚠ 檔名一律設 UTF-8 旗標（bit 11），否則中文分類名會變亂碼。
- `xlsx.ts`：手寫 OOXML。字串用 `inlineStr`（省掉 sharedStrings），只產生必要部件。
  幾個一錯就會「Excel 說檔案損毀」的地方：
  - `fills[0]` 必須是 `patternType="none"`、`fills[1]` 必須是 `gray125`（Excel 的硬性規定）
  - XML 1.0 **不接受大部分控制字元**（0x00–0x08、0x0B、0x0C、0x0E–0x1F）→ 文字一律清掉，
    備註裡混到一個整個檔案就開不起來
  - `sheetView` 裡 `pane` 必須排在 `selection` **前面**
  - `numFmtId`：0 = 一般、4 = 內建 `#,##0.00`、**自訂碼一律 >= 164**
  - 日期要寫成 Excel 序號（1899-12-30 為 0）。⚠ 用**當地時間的年月日時分**再當 UTC 算
    （`Date.UTC(getFullYear(), …)`）；直接用 `getTime()` 的話 UTC+8 的晚間記錄會被推前一天
- `exportExcel.ts`：
  - **先讀實體再命名**——副檔名要看 blob 真正的 MIME（壓縮後可能是 webp，不是原始檔名）
  - 圖檔名 `日期_分類_金額_序號`，撞名就往後遞號（`used` set 比對**含副檔名**的小寫全名）
  - 讀不到的圖就從表格裡拿掉，免得 Excel 指到不存在的檔案；並回報 `missingImages`
  - 欄位依發生時間**由舊到新**排；「主幣別」欄只在記錄之間基準不一致時才多開（否則跟標題重複）
  - 大小上限 1.5 GB（保守值），超過就請使用者用日期區間分批

### 驗證（`.smoke/v98.mjs` ＋ `validate-export.py`）

- 這種「產出檔案」的功能一定要**真的開起來讀**，不能只驗有沒有呼叫到函式。
  v98 會接住下載的 Blob、寫到磁碟，自己算 CRC 對每個 entry，並解兩層 ZIP
  （外層 zip 挖出 xlsx 再解一次）檢查 XML 內容。
- ⚠ **沙箱不允許 Node 開子行程**（`spawnSync … EBUSY`）→ 沒辦法從 Node 叫 Python。
  Python 的第二意見拆到 `.smoke/v98-verify.sh`（依序跑 v98 與 `validate-export.py`）。
  ⚠ 從 Node／shell 叫 Python 時要 `PYTHONIOENCODING=utf-8`，否則 Windows 會用系統
  codepage 輸出，中文被打成 `?`。
- ⚠ 測 Excel 的**選擇器要 scope 到彈窗的 `.box`**：設定頁自己有 `.chip`（OCR 語言），
  不 scope 會數到 6 個「快速鈕」。
- ⚠ 找「圖片欄」的儲存格**只能用欄名過濾，不能用樣式**：圖片欄與備註欄共用換行樣式（`s="5"`）。

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

## 記錄頁：檢視／篩選列（`.rangebar__top`）

固定**兩列**（`.rangebar__top` 是 `flex-direction: column`，桌機也是上下兩列）：

```
檢視
[分類] [最近]

篩選
[全部｜支出｜收入]                    [依單位｜自訂範圍]
```

- `.grp` 本身是 `column`（標籤在上、控制項在下）；同一列的按鈕要自己包一層 `.grp__row`
- 「依單位／自訂範圍」用 `.grp__row--split .rangebar__mode { margin-left: auto }` 推到最右邊，
  所以它**屬於篩選群組**、不再是檢視那一列的第三個成員
- ⚠ **`.seg2 button` 的左右內距是 10px（不是 14px）**：這是為了讓「全部/支出/收入」＋
  「依單位/自訂範圍」塞得進 375px（原本 14px 需要 341px，卡片內寬只有 309px → 必斷行）。
  **任何讓按鈕變寬的改動都要重跑 `.smoke/v94.mjs`**（它會在 320/375/390/480/768 量右緣與溢出）
- 320px 這種極窄寬度仍放不下兩個段控 → 換行、範圍切換靠右自成一行（可接受，v94 有容許這情況）
- `.rangebar__mode` 在 `StatsView.vue` 是**另一份**（文字是「自訂」，且 `#sec` 結構不同）——
  改記錄頁不會影響統計頁，別把兩邊的 CSS 混在一起看

## 記錄頁：標題列的搜尋框（`.search`）

- 比一般 `.field` **小一號**：高 34（`.field` 是 42）、字級 13、`max-width: 200px`、
  圓角 10、放大鏡 14、清空鈕 22。改動要看 `.smoke/v95.mjs`
- 覆寫寫在 `RecordsView.vue` 的 scoped `:deep()`，**不動 `ClearableInput.vue`**
  （它是共用件，動了所有用到的地方都要回歸）
- ⚠⚠ **`:deep()` 的特異度陷阱**：`.search :deep(.cf__in)` 與 ClearableInput 自己的
  `.cf__in` **同為 (0,2,0)**，誰贏取決於**打包順序**（實測 ClearableInput 在後 → 它贏）。
  所以覆寫時刻意多帶一個 class／一層提高特異度：
  - 輸入框用 `.search :deep(.field.cf__in)` → (0,4,0)
  - 清空鈕用 `.search :deep(.cf .cf__x)` → (0,4,0)
  改這裡若「改了沒生效」，先懷疑是特異度，不是沒 rebuild
- ⚠⚠ **放大鏡圖示曾被輸入框整個蓋掉（0.1.16 修）**：`.search__ic` 是 `position: absolute`
  且排在 `ClearableInput` **前面**，而 `.cf` 是 `position: relative`；兩者 `z-index: auto` 時
  「DOM 在後的勝」→ 白底輸入框蓋住放大鏡。**必須給 `.search__ic` 一個 `z-index`**。
- ⚠ 測「圖示有沒有真的畫出來」**不能用 `elementFromPoint`**（放大鏡有 `pointer-events: none`，
  永遠不會被命中）→ 要**截圖讀像素**（v95 的做法：clip 放大鏡那塊，數非白像素）


---

## 錢包（多帳本，0.1.20）

使用者需求：設定頁最上方加一個區塊，可以切換不同錢包記不同內容。
確認過的四個決定：**記錄＋設定全部分開**、**各頁只看當前錢包**、
**完整管理（含排序／圖示）**、**有記錄不給刪**。

### 資料怎麼放

- `mop-ledger.wallets.v1` ＝ `{ wallets: Wallet[], activeWalletId }`（App 層級）
- `mop-ledger.setting.<walletId>.v1` ＝ 該錢包的一整套 `Settings`
  （形狀與單錢包時代的 `Settings` **完全一樣**，所以 `settings.state.xxx` 的既有程式碼都不用改）
- `mop-ledger.records.v1` ＝ **全部錢包的記錄**（單一鍵），每筆蓋 `walletId`
- `mop-ledger.settings.v1` ＝ 單錢包時代的舊鍵，**遷移後刻意不刪**（保險）
- 預設錢包 id 固定 `w_default`（`lib/wallets.ts`），舊記錄遷移補的就是它

### store 的形狀（為什麼這樣設）

- `settings.state` ＝ **當前錢包**的設定；`wallets`／`activeWalletId`／`activeWallet` 是另外的 computed
- `records` store：內部 `all`（全部、持久化），**對外的 `records` 是 computed（只含當前錢包）**
  → 所有畫面自動被隔離，不用一支一支改
- ⚠ **`knownMd5` 與 `remove()` 的「還有誰在用這張圖」一律看 `all`**：
  圖檔 blob 存在 IndexedDB、跨錢包共用，只看當前錢包會把別的錢包還在用的圖刪掉
- ⚠ **`setActiveWallet()` 一定要先把當前設定 `writeJSON` 落地再換**：
  watcher 是 microtask 才跑，那時 `activeWalletId` 已經變了，會把舊內容寫進**新**鍵

### ⚠⚠ 初始化時改資料，一定要自己寫回去

兩個真 bug（v99 抓到的），同一個形狀：
1. `loadRoot()` 遷移完只靠 `watch(root)` 持久化 → watcher 不是 immediate，
   初始值不會觸發 → `WALLETS_KEY` 一直沒寫進 localStorage，**每次重載都重遷移一次**
2. records store 在 setup 時幫舊記錄補 `walletId` → 那時 `watch(all)` 還沒掛上 →
   永遠不落地，每次載入都重補

→ **在 store 初始化階段動到的資料，改完立刻 `writeJSON`，不要指望 watcher。**

### 刪除錢包

- **「還有 N 筆記錄就不給刪」擋在 `WalletSection.vue`**，不是 store：
  store 拿不到筆數，settings↔records 互相 import 會循環。store 只擋「至少保留一個」
- 刪除時 `remove(walletSettingsKey(id))` 清掉設定鍵，不留孤兒

### 排序

- 拖曳把手：**pointer 事件 + `setPointerCapture`**，CSS 要 `touch-action: none`
  （否則 iOS 先捲頁面）；拖的時候**邊拖邊 `moveWallet()`**，清單即時重排
- 編輯面板裡另有「↑ 上移／↓ 下移」——拖曳之外一定可用的第二條路（桌機/鍵盤也好用）

### 匯出／匯入

- **JSON 升 format 2**：`wallets` + `settingsByWallet` + 全部記錄；
  頂層的 `settings` 欄位放「當前錢包那份」（向後相容，舊版 App 讀得到）
- 範圍篩選**只影響記錄**，錢包與設定一律整份帶走
- 匯入：v2 → 沒有的錢包整個加回來（含設定），記錄回**自己原本的錢包**；
  v1 → 設定套在當前錢包、記錄併入當前錢包
- **Excel 只匯出當前錢包**（彈窗摘要會點名是哪個錢包）
- 「重置」只清**當前錢包**的記錄；⚠ 不能再呼叫 `clearImages()`
  （那會把別的錢包還在用的圖一起刪）→ 用 `records.reset()`（一筆筆 remove、自己檢查）

### 測試（`.smoke/v99.mjs`，81 項）

- §1 遷移（舊設定整包進預設錢包、舊鍵留著、記錄補 walletId 且有落地）
- §2 隔離（各頁只看當前錢包、新增寫進當前錢包）
- §3 設定獨立（主幣別／快速備註跟著錢包走、各鍵各存各的）
- §4 管理 UI（新增即切換、同名擋下、改名換色、↑↓ 與拖曳、有記錄擋刪、孤兒鍵清掉）
- §5 匯出（JSON 全部錢包／Excel 當前錢包，ZIP 內層只有當前錢包的筆數）＋匯入帶回錢包
- §6 重置只清當前錢包
- §7 320/390/768 版面、無 JS 錯誤

⚠ 測試踩到的坑：
- **`$text` 讀不到 `<input>` 的內容**（textContent 是空的）→ 要讀 `.value`
- 用 v-model 的輸入框，`dispatchEvent(new Event('input'))` 之後**要等一個 tick**
  再點按鈕，否則按鈕還是 disabled（同步 click 會被吃掉）
- **記錄頁的週期預設是「日」＝今天**，種子記錄是幾天前就會「這個範圍沒有記錄」→
  先切到「月」再斷言
- `ziplib.mjs` 的 `verifyZip()` 回傳的 `bad` 是**陣列**（壞掉的項目名），要量 `.length`
- 測試一開始還在 `about:blank` 就摸 localStorage 會被拒 → 先 `goto` 一次

## ⚠⚠ 日期輸入框（全站約定，0.1.21 起永久適用）

> 使用者原話：「**所有日期的輸入框都是純文字輸入，用戶要按右手邊的按鈕才會彈出日期
> 時間的選擇器，請修正現在的所有日期選擇框和未來的也要這樣**」
> → **這是長期約定，不是一次性修改。以後任何新畫面、新表單，只要要輸入日期，
> 一律照下面做，不可以再用 `<input type="date">` / `type="datetime-local"` 當可見輸入框。**

### 元件選擇

| 需求 | 用哪個 | 行為 |
| --- | --- | --- |
| 只要日期（年/月/日） | **`components/DateField.vue`** | 純文字框 ＋ 右邊日曆鈕 → 點了開原生 date picker |
| 日期＋時間 | **`components/DateTimeField.vue`** | 純文字框 ＋ 右邊兩顆鈕（日曆／時鐘）＋「設為現在」 |

- 兩者都是 `v-model`（`DateField` 收 `YYYY-MM-DD`，`DateTimeField` 收 `YYYY-MM-DDTHH:mm`）
- 文字框**容許手打**：`lib/date.ts` 的 `parseLooseDate()`／`parseLooseDateTime()` 接受
  `2026/10/7`、`10-07` 等寬鬆寫法，失焦時正規化；顯示用 `toDisplayDate()`（斜線格式）
- 目前已經換掉的：`RecordsView`（兩顆）、`StatsView`（月份選擇 ＋ 自訂區間兩顆）、
  `ExportModal`（匯出範圍兩顆）。`HomeView`／`RecordSheet` 本來就用 `DateTimeField`

### 三條硬性 CSS 規則（缺一就會重現 iOS 的 bug）

1. **承接原生 picker 的容器要 `overflow: hidden`**
   （`.df__pick`／`.dt__pick`，就是那顆 26px 的鈕）
   - Safari 會把 `type=date`／`datetime-local` 拆成**多個各自帶 padding 與 min-width 的
     shadow DOM 子欄位**，加起來遠超過 26px → 內容往右溢出 → **整份文件變寬**
     → 使用者向左滑就看到一大片空白
   - 實測模擬（390px 視窗，datetime-local 放在靠右）：30px 寬 →
     `documentElement.scrollWidth` 390；60px → 400；**120px → 461**。
     Chrome 桌機量不出來（shadow DOM 不撐寬），但 iOS 會
2. **透明的原生 input 本體要 `font-size: 16px`** + `opacity: 0` + `position: absolute`
   （它是「收手指的那一層」，字級太小會被 iOS 判定要 zoom）
3. 可見的文字框就跟全站其他輸入框一樣吃 15px，**不要為它特別放大**
   （0.1.3 才修過「日期欄要跟備註欄對齊」，兩欄字級不一樣反而難看）。
   ⚠ 但**可編輯的貼上接收面必須 ≥16px**（`.rec__pasteArea`／`.imgs__pasteArea`）——
   那塊是給手指長按用的，一旦被 zoom 整頁就跟著變寬

### 最後一道保險

`style.css` 的 `html { overflow-x: hidden }`。這不是「修 bug」，是**保險絲**：
真的有東西溢出時至少不會出現空白區，但**不該拿它當解法**——上面的三條規則
才是正解，加了新的輸入框還是要照做。

## ⚠⚠ body 一律用 `min-height`，不要寫 `height: 100%`（全站約定，0.1.23 起永久適用）

**使用者 0.1.23 原話：「在 pwa (IPHONE) 的所有頁面中，用戶連點空白的地方，頁面會向上滑
（不需要向上滑, 要無論怎樣點都保持不動）」**

`src/style.css` 的根層：

```css
html { height: 100%; }        /* 捲動容器＝documentElement，本來就該是視窗高 */
body { min-height: 100%; }    /* ⚠ 不是 height: 100% */
html, body { margin: 0; padding: 0; }
```

### 為什麼（別改回去）

`body { height: 100% }` 會把 body 的**盒子釘死在視窗高度**，但內容（記錄頁 3406px／
統計頁 2611px／設定頁 3261px）遠比視窗高 → **body 盒子比內容短**，內容是溢出的。

iOS（PWA 與 Safari 都一樣）在使用者**點畫面上任何地方**時，會跑一輪
「把點到的位置對齊到可視範圍」。body 盒子既然只有視窗高，這一輪就把整份文件往上推 →
**連點就一直往上跑**。

改成 `min-height` 後 body 會跟著內容長高，沒有錯位，那輪對齊就無事可做。

### 怎麼驗

`.smoke/v102.mjs`。⚠ 判準是**幾何關係**，不是「computed height 等於多少 px」：
在 844 的視窗下 `min-height: 100%` 算出來也可能是 `844px`，光看數值分不出
「被釘死」還是「剛好等於視窗」。要驗的是：
**當內容比視窗高時，`body.getBoundingClientRect().height ≥ documentElement.scrollHeight`。**

### 相關的連點防護（都已存在，別拆掉）

- `html { touch-action: manipulation }` ＋ 按鈕自己也寫一次 → 關掉 iOS 的 double-tap 放大
- `button/a/[role=button] { -webkit-touch-callout: none; user-select: none }` → 關掉長按選單與連點選字
- `body { overscroll-behavior-y: none }` → 捲到底不往外鏈
- ⚠ 測 `-webkit-touch-callout` 時**不要問 computed style**：Chrome 會在 CSSOM 解析時
  直接丟掉不認得的 vendor 屬性，要改成 `fetch` stylesheet 的**文字**來驗

## ⚠⚠ 彈窗／子頁面開著時，背景一律不能滑動（全站約定，0.1.22 起永久適用）

**使用者 0.1.22 明說「請把這個記憶，任何子頁面滾動時，背景都不能滑動」。**

規則：**任何**全螢幕彈窗／子頁面（`position: fixed` 的遮罩＋卡片）打開時，背景（body）
都不能跟著手指或滾輪滑動。做法一律用 `composables/useScrollLock.ts`：

```ts
import { ref, toRef } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'

const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })
```

⚠⚠ **`scrollable` 一定要給**（除非這個彈窗真的完全不捲，例如計算機）：
`useScrollLock` 是靠在 document 上 `touchmove` preventDefault 來擋背景，
如果你沒把「內容區」列進可捲清單，**iOS 上連內容自己都滑不動**（整個卡住）。
給的時候記得指到**真正 overflow 的那一層**（例如 `.box`／`.catsheet__body`／
`RecordSheet` 的 `lbEl.stageEl`）。

搭配的 CSS（第二道保險）：內容區要有 `overscroll-behavior: contain`，
捲到底才不會「連鎖」帶動背景。

**目前接了鎖的全部彈窗**（新彈窗要照這個清單補上）：
`CalcSheet`、`CategorySheet`、`CategoryManageModal`、`ExportModal`、`RecordSheet`、
`SumDetailSheet`。
（`CategorySelect`／`QuickNotePicker` 是短的 Teleported 下拉，不算子頁面，
只需 `overscroll-behavior: contain`，不用整套鎖。）

⚠ 背景解鎖後 `useScrollLock` 會把 `window.scrollTo(0, savedY)` 還原位置；
因此**不能**在彈窗開著時去改 `window.scrollY` 的預期值。

## PWA 向左滑出現大片空白（0.1.21 修）

- 症狀只在 **HomeView 與 RecordSheet**（唯二用 `DateTimeField` 的頁）→ 直接指向
  `.dt__pick` 裡那顆透明原生 input（見上一節的原因 1）
- 排查手法：在 390px 視窗量 `documentElement.scrollWidth` 與逐個元素的 `getBoundingClientRect()`，
  找不到溢出就**用模擬**（往容器裡塞一個已知寬度的 div）反向證明「靠右的原生日期欄會撐寬文件」
- ⚠ 另一個同症狀來源：**任何聚焦時會被 iOS zoom 的輸入框（font-size < 16px）**
  → 現在的接收面（`.rec__pasteArea`／`.imgs__pasteArea`）都已補 16px

## 測試（`.smoke/v100.mjs`，42 項）

四段：① 首頁日期欄（是純文字、原生層透明且被裁、16px、貼上接收面 16px 且
`-webkit-touch-callout` 有保留、焦點落在接收面）＋ 三條貼上路徑（含**第二次貼上**
證明接收面沒被清掉）② 溢出（root `overflow-x: hidden`、無水平溢出、往 `.dt__pick`
硬塞 900px 也不撐寬、明細開著也一樣）③ RecordsView／StatsView／ExportModal 的日期欄盤點
④ Toast 四種情境（沒有動作時只有「知道了」；記帳後「復原」＋「知道了」且按知道了不會復原；
刪除後按復原真的救得回來）

⚠ 測試踩到的坑：
- **`page.waitForFunction` 預設用 rAF 輪詢**，在跑完 canvas 壓圖那種重活之後會被餓死
  → 明明元素存在卻等到 timeout。解法：`{ polling: 200 }` ＋ 包一層不拋錯的 `waitSel()`
- 明細的 row 是 `div`，**要點 `.row__main`** 才會開；匯出彈窗的根是 `.mask` 不是 `.modal`

## 收據圖片去重：兩層（0.1.22）

原本 `records.knownMd5` 是**跨全部記錄**在擋重複，導致「同一張收據想在另一筆再記一次」
被無聲吃掉。0.1.22 拆成兩層：

| 情境 | 行為 |
| --- | --- |
| **同一筆記錄內**重複上傳同圖 | 靜默略過，只提示「已略過 N 張重複圖片」 |
| **不同筆記錄之間**出現同圖 | **收下**（不擋），但彈提示「這張圖片和其他記錄重複了，可能重複記帳」 |

- 新增 `records.ownersOfMd5(md5, except?)` —— 找「除了自己以外還有哪些記錄用了這張圖」。
  ⚠ 一定要看 store 內部的 `all`（全部錢包），因為**圖檔 blob 是跨錢包共用的**；
  只看當前錢包的 `records` computed 會漏掉別的錢包用過的圖。
- 提示字串統一在 `lib/receiptDup.ts` 的 `dupNotice(count)`（單張／多張兩種講法）。
- 改動的兩個入口：`RecordSheet.vue` 的 `addFiles` 與 `ReceiptImages.vue`，兩邊邏輯一致。
- 每個檔案迴圈裡用一個 `batch: Set<string>` 記「這一批 already 進來的 md5」，
  再各自比對 `images` 與 `ownersOfMd5`，最後一次性 `notify()`。

## 統計頁摘要卡 → 詳情小卡（0.1.22）

- 三張 `.sums .sum` 從 `div` 改成 `<button>`（所以要自己去瀏覽器預設外觀：
  `text-align:left; font:inherit; color:inherit`）。
- 詳情卡元件 `SumDetailSheet.vue`，吃三種資料：`title/amount/caption` ＋ `rows[]` ＋ `ranks[]`。
  **刻意精簡**（使用者要求「不要太多資訊」）：最多 4 列數字＋一個前 3 名排行。
- 動畫用 Vue `<Transition name="pop">`：`.pop-enter-from .box { transform: translateY(10px) scale(0.94) }`
  → 卡片從略小浮出。另有 `@media (prefers-reduced-motion)` 關掉。
- ⚠ 測動畫**不要量「當下」的 transition-duration**：進場只有 ~220ms，
  等把卡抓出來早就播完、computed 回到 `0s`（假紅燈）。
  要在 `requestAnimationFrame` 的同一格內量，或去 `document.styleSheets` 找 `.pop-enter-*` 規則。

## 記帳頁預設分類（0.1.22）

- 設定欄位 `settings.defaultCategoryId`（單一字串）。
- **與 `favoriteCategories`（主頁常用分類）完全獨立**：常用分類管主頁顯示哪幾顆按鈕；
  預設分類管記帳頁「一開始選中哪一個」。設定預設分類**不會**動到常用分類。
- 元件 `CategoryManageModal.vue` 的「記帳預設」區塊：
  - **編輯既有分類** → 一顆 `.dflt` 切換鈕（emit `set-default`，傳空字串＝取消）
  - **新增分類** → 一個 `.dflt--check` 勾選框（`makeDefault`）——
    ⚠ 分類 id 要等 `create` 事件送出去才生得出來，所以**不能在元件內直接寫 settings**，
    要把旗標帶出去，由 `SettingsView.onCreateCat` 拿到剛建立的分類後再 `setDefaultCategory(c.id)`。
  ⚠ 兩者要用 `v-if="isEdit"` / `v-else` 互斥，否則編輯模式會同時冒出兩顆。
- 已封存（`archived`）的分類不能設為預設（`canDefault`），記帳頁選不到，設了等於沒設。
- `HomeView` 的 `pickInitialCategory()`：預設分類存在且屬於當前收支類型 → 用它；
  否則沿用舊行為（現有 `categoryId` → 第一個）。`resetForm()` 會呼叫 `resetCategory()`。

## 測試（`.smoke/v102.mjs`，30 項）

驗「連點空白處頁面不能動」（0.1.23）。四頁（記帳／記錄／統計／設定）各驗：
① 內容比視窗高 ② **body 盒子高度 ≥ 文件 scrollHeight**（這條才是關鍵，見上面那節）
③ html 仍是 viewport 高 ④ 無橫向溢出 ⑤ html `overflow-x: hidden`；
再加一組「連點 8 下空白處 scrollY 完全不變」與連點防護設定檢查。

⚠ 這支踩到的坑：
- **點的位置不能寫死**：記錄頁 y=620 剛好落在 `.row__main`（點下去會開明細、合法地把背景
  鎖住並把捲動歸零）→ 會被誤判成 bug。要**往下掃描挑第一個不在任何互動元素裡的位置**
  （`document.elementFromPoint` + `closest('a,button,input,...')`）
- **`-webkit-touch-callout` 不要用 computed style 驗**：Chrome 會在 CSSOM 解析時丟掉
  不認得的 vendor 屬性 → 永遠拿到空字串。要 `fetch` stylesheet 的文字做 regex
- 「內容比視窗高」的門檻別設太嚴：記帳頁常常只比視窗高 6px

## 測試（`.smoke/v101.mjs`，51 項）

六段對應 0.1.22 的六個需求：① 記錄列徽章 `.imtag` 是「圖」② 明細 `.meta__row` 裡
「計算公式」緊跟在「新增時間」下一列、值以 `=` 結尾 ③ 圖片去重兩層（**用真的
`DataTransfer` 塞 `<input type=file>`**；先存第一筆取 md5，再開第二筆上傳同圖驗提示）
④ 三張摘要卡可按、彈出小卡、有動畫、內容精簡 ⑤ 分類「記帳預設」可設 →
回記帳頁自動預選，且常用分類沒被改 ⑥ 分類彈窗開著時 `body` 是 `fixed` ＋ `.is-locked`

⚠ 這支踩到的坑（新測試要留意）：
- `CategorySelect` 的下拉選項是 **Teleport 到 body** 的，選擇器要用 `.pop__item`（**不要** `.box .pop__item`）
- 記帳頁金額不是 `<input>`，是自製鍵盤 → 用 `page.keyboard.press('5')` 走 `onKey`，再按 Enter
- 記錄列是 `.row__main`（點它才開明細）；圖片縮圖是 `.rec__cell`
- 「更多分類」鈕 `.cat-more` 只在 `favoriteCategories` 非空、且總數多於常用時才出現
