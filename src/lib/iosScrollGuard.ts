/**
 * iOS（PWA）捲動基準護欄 —— 修「點過文字輸入框後，點／雙擊空白處頁面會往上滑」。
 *
 * ── 使用者回報的完整歷程 ────────────────────────────────────
 *   0.1.23：「連點空白處，頁面會向上滑」→ 用 `body { min-height: 100% }` 修好了一半
 *   0.1.25：「只要點過文字輸入框就會復發」→ 加了 16px 字級 ＋ 點空白處自動收鍵盤
 *   0.1.26：「**雙擊**空白的地方也是會向上移。一開始打開時不會，點選了輸入框再回到
 *           空白地方雙擊，就會回到頁面向上移的 BUG」（使用者強調：無論怎樣點都不要動）
 *
 * ── 為什麼 0.1.25 還不夠 ────────────────────────────────────
 * 0.1.25 只在「當下有輸入框聚焦」時才動手（收掉它）。可是**雙擊的第二次點擊**
 * 發生時，輸入框早就被第一次點擊收掉了 → 護欄完全沒插手，
 * WebKit 就把它當成一次真正的 double-tap 手勢處理（smart zoom／重新對齊 visual viewport），
 * 畫面因此被推走。
 *
 * ── 0.1.26 的三層防線 ───────────────────────────────────────
 *  ① **把雙擊手勢本身擋掉**：在「空白處」的第二次 `touchend` 上 `preventDefault()`。
 *     這是關鍵的一層 —— WebKit 收不到第二個 touchend 的預設行為，
 *     就組不出 double-tap 手勢（比只靠 `touch-action: manipulation` 直接得多）。
 *  ② **收掉輸入框**（0.1.25 那層，保留）：輸入框保持聚焦時 iOS 會一直把游標
 *     對齊到可視範圍，而點空白處不會自動 blur → 每點一下就再對齊一次。
 *  ③ **扶正捲動位置**：在「剛剛才收掉輸入框」的時間窗內，
 *     任何一次「乾淨的點擊（不是滑動）」之後，都把捲動位置扶回點下去那一刻的值。
 *     收鍵盤是**非同步**的（iOS 要跑完自己的還原動畫），所以扶正分兩次：
 *     rAF×2（趕在使用者下一次繪製前）與 ~300ms（等鍵盤動畫真的結束）。
 *
 * ⚠ 只在 iOS 生效；桌機、Android 完全不受影響（判斷不過就整支不裝）。
 * ⚠ 絕不在 focus 期間動作 —— 那會跟 iOS 的「露出輸入框」打架，反而更糟。
 * ⚠ 只認「點擊」不認「滑動」：`touchmove` 一動就放棄這次判定，
 *   不然會把使用者的滑動捲動硬拉回來。
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
 * 判準跟 `.smoke/v102.mjs` / `v104.mjs` 的 `blankPoint()` 一致 ——
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

/** 兩次點擊相隔多久以內算「雙擊」（跟 WebKit 的 double-tap 視窗一致） */
const DOUBLE_TAP_MS = 350
/** 手指移動超過這個距離就不算「點擊」，算滑動 */
const TAP_SLOP = 10
/** 我們主動 blur 之後，還在這個時間窗內才做「扶正」（＝使用者回報的那個情境） */
const RECENT_BLUR_MS = 1200
/** 手指在螢幕上停留超過這個時間就不算點擊（長按是別的手勢） */
const TAP_MAX_MS = 600

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

  /* ── ③ 用得到的狀態 ───────────────────────────────────── */
  /** 上一次「我們主動收掉輸入框」的時間；用來界定「剛點過輸入框」的時間窗 */
  let blurredAt = 0
  /** 這次觸控的起點（scrollY、座標）與時間 */
  let tapY = 0
  let tapT = 0
  let tapX0 = 0
  let tapY0 = 0
  /** 這次觸控還算不算「乾淨的點擊」（移動超過 TAP_SLOP 就變 false） */
  let clean = false
  /** 上一次 touchend 的時間，以及它是不是落在空白處（判斷雙擊用） */
  let lastEnd = 0
  let lastBlank = false

  /**
   * 把捲動位置扶回 `y`。分兩個時間點做：
   *   - rAF×2：趕在使用者下一次繪製前，畫面不會閃
   *   - ~300ms：iOS 收鍵盤的還原動畫是非同步的，跑完之後可能又把畫面帶走一次
   * 只在「離目標超過 4px」時才真的動，避免跟正常的捲動打架。
   */
  function restore(y: number) {
    const fix = () => {
      if (isLocked()) return
      if (Math.abs(window.scrollY - y) <= 4) return
      try {
        window.scrollTo(window.scrollX, y)
      } catch {
        /* 忽略 */
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(fix))
    window.setTimeout(fix, 300)
  }

  /* ── ② 收掉輸入框（0.1.25 那層，保留）────────────────── */
  /**
   * 用 pointerdown 而不是 click：要趕在 iOS 開始跑它自己的對齊之前動手。
   * 不 preventDefault、不用 passive: false —— 我們不阻止任何事，只是順手收鍵盤。
   */
  function onPointerDown(e: PointerEvent) {
    if (isLocked()) return
    const active = document.activeElement
    if (!isEditable(active)) return // 沒有輸入框聚焦 → 沒有對齊迴圈，不插手
    if (!isBlankTap(e.target)) return // 點在互動元素上 → 使用者主動操作，不插手

    // 記下這一刻的位置（同一瞬間，中間不可能有使用者自己的捲動）
    const x = window.scrollX
    const y = window.scrollY

    // 收掉輸入框：鍵盤跟著收起，visual viewport 還原，游標對齊迴圈結束
    active.blur()
    blurredAt = performance.now()

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

  /* ── ① 擋掉雙擊手勢（0.1.26 新增，這是關鍵）───────────── */
  /**
   * 在空白處的**第二次** touchend 上 preventDefault。
   *
   * 為什麼要這樣做：`html { touch-action: manipulation }` 理論上已經關掉 double-tap zoom，
   * 但實測（使用者 0.1.26 回報）「點過輸入框之後」雙擊空白處仍會把畫面推走 ——
   * 那時 WebKit 是在做一次 visual viewport 的重新對齊。
   * 把第二個 touchend 的預設行為直接擋掉，WebKit 就組不出 double-tap 手勢，
   * 這是最直接、也最不依賴瀏覽器實作細節的一層。
   *
   * ⚠ 只在「空白處」且「確實是雙擊」時擋 —— 按鈕上的連點是合法的連續操作
   *   （例如計算機快速按兩下同一個數字），絕對不能擋。
   * ⚠ touchend 一定要 `{ passive: false }` 才擋得住。
   */
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      clean = false // 多指（縮放之類）→ 這次不當成點擊
      return
    }
    const t = e.touches[0]
    clean = true
    tapY = window.scrollY
    tapT = performance.now()
    tapX0 = t.clientX
    tapY0 = t.clientY
  }

  function onTouchMove(e: TouchEvent) {
    // 只是觀察，不 preventDefault（捲動交給瀏覽器與 useScrollLock）
    if (e.touches.length !== 1 || !clean) return
    const t = e.touches[0]
    // ⚠ 要有容差：手指「點」的時候難免抖個一兩 px，
    //   一點點位移就當成滑動的話，真正的點擊會被誤判掉（整個護欄等於沒作用）。
    if (Math.abs(t.clientX - tapX0) > TAP_SLOP || Math.abs(t.clientY - tapY0) > TAP_SLOP) {
      clean = false
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (!clean) {
      lastEnd = 0
      lastBlank = false
      return
    }
    if (performance.now() - tapT > TAP_MAX_MS) {
      lastEnd = 0
      lastBlank = false
      return
    }
    const now = performance.now()
    const blank = isBlankTap(e.target)
    const isDouble = now - lastEnd <= DOUBLE_TAP_MS

    if (blank) {
      // ① 雙擊的第二次：擋掉預設行為，不讓 WebKit 組成 double-tap 手勢
      if (isDouble && lastBlank && e.cancelable) e.preventDefault()
      // ③ 剛點過輸入框的話，把被推走的畫面扶回來（點下去那一刻的位置）
      if (now - blurredAt <= RECENT_BLUR_MS) restore(tapY)
    }

    lastEnd = now
    lastBlank = blank
    clean = false
  }

  // capture 階段：比任何元件的 @pointerdown 都先跑，確保看到的是「還沒被改過」的狀態
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false })
  document.addEventListener('touchcancel', () => {
    clean = false
    lastEnd = 0
    lastBlank = false
  })

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
