/**
 * iOS（PWA）捲動基準護欄 —— 修「點過文字輸入框後，連點空白處頁面會往上滑」。
 *
 * 使用者原話（0.1.25 回報，0.1.23 沒修好）：
 *   「在 pwa (IPHONE) 的所有頁面中，用戶連點空白的地方，頁面會向上滑
 *    （不需要向上滑, 要無論怎樣點都保持不動），這個問題沒有修復成功，
 *    只要用戶有在文字輸入框點擊，就會出現問題」
 *
 * ── 為什麼 0.1.23 只修好一半 ──────────────────────────────
 * 0.1.23 的根因是 `body { height: 100% }` 把 body 盒子釘死在視窗高，
 * 內容卻遠比視窗高 → iOS 的「點到哪就對齊到哪」會把文件往上推。
 * 改成 `min-height: 100%`（body 跟著內容長高）之後，
 * **沒點過輸入框**的情況確實不動了。
 *
 * ── 點過輸入框之後為什麼又會滑 ──────────────────────────────
 * 兩個各自獨立的機制，都會留下「持續狀態」：
 *
 *  ① focus zoom：iOS 對 `font-size < 16px` 的可編輯元素會自動放大整頁。
 *     這個縮放 blur 之後**不保證還原** → visual viewport 一直小於 layout viewport，
 *     之後每次點畫面 iOS 都要重新對齊一次。
 *     → 根治在 CSS：可編輯元素字級一律 16px（見 style.css）。
 *
 *  ② 游標對齊迴圈：iOS 在輸入框**保持聚焦**期間，會持續把游標位置對齊到可視範圍；
 *     而 iOS 點空白處**不會**自動 blur，鍵盤也還開著（visual viewport 被鍵盤壓短），
 *     所以每點一下空白處就再對齊一次 → 一直往上滑。
 *     → 根治在本檔：點空白處時主動 blur，把鍵盤收掉、結束對齊迴圈。
 *
 * ── 這裡的做法（刻意保守）──────────────────────────────────
 *   只在「**點在空白處**（不在任何互動元素內）且當下有可編輯元素聚焦」時動作：
 *     1. 記下這一刻的捲動位置
 *     2. blur 掉聚焦中的可編輯元素（iOS 會跟著收起鍵盤，對齊迴圈結束）
 *     3. 下一輪把捲動位置扶回第 1 步記下的值 ——
 *        因為是「同一瞬間」記的，中間使用者不可能自己捲過，
 *        所以這不是搶畫面，而是「無論怎樣點都保持不動」
 *
 * ⚠ 點在按鈕／連結等互動元素上時**完全不插手**：
 *   那是使用者的主動操作（可能本來就要換頁、開彈窗），
 *   硬把捲動拉回去只會打架。
 * ⚠ 彈窗開著時（useScrollLock 掛了 html.is-locked）也不插手，
 *   否則會打亂 useScrollLock 自己的還原邏輯。
 * ⚠ 只在 iOS 生效；桌機、Android 完全不受影響（判斷不過就整支不裝）。
 */

/** 判斷是不是 iOS（含 iPadOS 的桌機模式和 PWA 獨立視窗） */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPhone / iPod / iPad；
  // iPadOS 13+ 的 Safari 會謊報成 Mac，所以補一個「有觸控的 Mac」
  const touchPoints = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0
  return /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && touchPoints > 1)
}

/** 會被 iOS 放大整頁、且會啟動游標對齊迴圈的可編輯元素 */
const NON_TEXT_INPUTS = ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset']

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type)
  return el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''
}

/**
 * 這裡算不算「空白處」。
 * 判準跟 .smoke/v102.mjs 的 blankPoint() 一致 ——
 * 只要是任何互動元素的子孫就不算空白，也就不插手。
 */
const INTERACTIVE_SEL =
  'a,button,input,select,textarea,label,summary,[role="button"],[role="option"],[role="tab"],[contenteditable="true"]'

function isBlankTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true // 點在 document/html 上＝確定是空白
  return !target.closest(INTERACTIVE_SEL)
}

/** 彈窗開著時（useScrollLock 會給 html 掛 is-locked）不要插手捲動 */
function isLocked(): boolean {
  return document.documentElement.classList.contains('is-locked')
}

let installed = false

/**
 * 安裝護欄。重複呼叫安全（只會掛一次）。
 * 在 main.ts 開機時呼叫一次即可。
 */
export function installIosScrollGuard(): void {
  if (installed) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!isIOS()) return
  installed = true

  /**
   * 點空白處就把聚焦中的輸入框收掉，並把捲動基準扶回點擊前的位置。
   *
   * 用 pointerdown 而不是 click：
   *   - 要趕在 iOS 開始跑它自己的「對齊」之前動手，click 太晚
   *   - 也不能用 touchstart：pointerdown 涵蓋觸控筆／藍牙滑鼠等各種輸入
   * 不 preventDefault、不用 passive: false —— 我們不阻止任何事，只是「順手收鍵盤」。
   */
  function onPointerDown(e: PointerEvent) {
    if (isLocked()) return
    const active = document.activeElement
    if (!isEditable(active)) return // 沒有輸入框聚焦 → 沒有對齊迴圈，不插手
    if (!isBlankTap(e.target)) return // 點在互動元素上 → 使用者主動操作，不插手

    // ① 記下這一刻的位置（同一瞬間，中間不可能有使用者自己的捲動）
    const x = window.scrollX
    const y = window.scrollY

    // ② 收掉輸入框：鍵盤跟著收起，visual viewport 還原，游標對齊迴圈結束
    active.blur()

    // ③ 扶正：iOS 收鍵盤時常會順手把文件再捲一次（還原它當初為露出輸入框而捲的那一段），
    //    那一捲的方向就是使用者看到的「往上滑」。這裡把位置扶回點擊前，
    //    rAF ×2 是為了等 iOS 自己那一輪捲動跑完再扶，否則會被它蓋過去。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isLocked()) return
        if (window.scrollX === x && window.scrollY === y) return
        try {
          window.scrollTo(x, y)
        } catch {
          /* 忽略 */
        }
      })
    })
  }

  // capture 階段：比任何元件的 @pointerdown 都先跑，確保我們看到的是「還沒被改過」的狀態
  document.addEventListener('pointerdown', onPointerDown, true)

  /**
   * 補強：focus zoom 留下的水平位移。
   * 整頁被放大過之後，iOS 有時會留下一個非 0 的 scrollX，
   * 那會讓「往左滑出現一大片空白」的老問題復活。
   * 只在沒有輸入框聚焦、也沒有彈窗時，把水平捲動拉回原點
   * （只動水平，不改使用者的閱讀位置）。
   */
  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', () => {
      if (isEditable(document.activeElement) || isLocked()) return
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY)
    })
  }
}
