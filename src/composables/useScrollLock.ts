import { onBeforeUnmount, watch, type Ref } from 'vue'

interface ScrollLockOptions {
  /**
   * 彈窗裡唯一允許捲動的元素（例如分類彈窗的內容區）。
   * 有給的話，在它裡面的手指滑動照常捲動、其他一律擋掉；
   * 沒給（例如計算機＝整頁都不捲）就全部擋掉。
   */
  scrollable?: () => HTMLElement | null | undefined
}

/* ── 同一時間可能開了不只一個彈窗（例如記帳頁同時掛著計算機與分類彈窗），
      用計數器確保只有「第一個上鎖、最後一個解鎖」時才動 body ── */
let locks = 0
/** 上鎖前的捲動位置，解鎖時要還回去 */
let savedY = 0

/**
 * 鎖住背景。
 *
 * 三段一起做，因為各瀏覽器擋的東西不一樣：
 * 1. `html.is-locked` → overflow hidden：擋滑鼠滾輪／觸控板
 * 2. body 變 `position: fixed; top: -Y`：
 *    - 只給 html 加 overflow:hidden 會讓瀏覽器把 scrollTop 歸零 → 背景「跳回最上面」，
 *      關掉彈窗後也回不去了。固定住 body 才能把畫面留在原地
 *    - 這同時也是 iOS Safari 唯一擋得住手指滑動的做法（它不吃 html 的 overflow:hidden）
 * 3. `touchmove` preventDefault（非 passive）：補強，手指在任何非可捲動區滑動都不會帶動背景
 */
function applyLock() {
  savedY = window.scrollY || document.documentElement.scrollTop || 0
  const html = document.documentElement
  const b = document.body
  html.classList.add('is-locked')
  b.style.position = 'fixed'
  b.style.top = `-${savedY}px`
  b.style.left = '0'
  b.style.right = '0'
  // body 變成 fixed 之後寬度不再由內容撐開，要明確給滿寬
  b.style.width = '100%'
}

function releaseLock() {
  const html = document.documentElement
  const b = document.body
  html.classList.remove('is-locked')
  b.style.position = ''
  b.style.top = ''
  b.style.left = ''
  b.style.right = ''
  b.style.width = ''
  window.scrollTo(0, savedY)
}

/**
 * 從觸發元素往上找「自己就能捲動」的祖先。
 *
 * ⚠⚠ 這是修「設定頁 › 管理分類，下拉選單打不開」的關鍵（0.1.25）：
 *   原本只放行 `opts.scrollable()` 指定的那**一個**元素，其他一律 preventDefault。
 *   但 CategorySelect 的下拉清單（`.pop`, z-index 95）是 **Teleport 到 body** 的、
 *   不屬於彈窗內容 `.box` —— 手指在清單裡滑動時，`scroller.contains(target)` 是 false，
 *   於是 touchmove 被 preventDefault，清單根本滑不動 → 使用者「無法選取下方的選擇」。
 *
 *   修正：不要再只認那一個元素，改成「任何**當下真的可以捲動**的元素」都放行。
 *   判準是 `scrollHeight > clientHeight`（真的溢出才放行），所以：
 *     - 下拉清單（內容超高）→ 放行，可以滑
 *     - 彈窗內容 `.box`（內容超高）→ 放行
 *     - 一般靜態區塊（沒有溢出）→ 一樣擋掉，背景仍然鎖得住
 *   背景本身（`.mask` 以外的頁面）碰不到「可捲動祖先」，所以照樣被鎖。
 */
function scrollableAncestor(target: EventTarget | null): HTMLElement | null {
  let el: HTMLElement | null = target instanceof HTMLElement ? target : null
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    const oy = cs.overflowY
    const canScrollY =
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1
    if (canScrollY) return el
    el = el.parentElement
  }
  return null
}

/**
 * 開啟彈窗時鎖住背景捲動。
 *
 * 用法：
 *   useScrollLock(toRef(props, 'open'))                                  // 整頁不捲（計算機）
 *   useScrollLock(toRef(props, 'open'), { scrollable: () => bodyEl.value }) // 指定某區一定可捲
 *
 * ⚠ `opts.scrollable` 現在只是「額外保證放行」：
 *   真正的判準是「手指底下有沒有可捲動祖先」（見 scrollableAncestor），
 *   這樣 Teleport 出去的下拉清單才滑得動。傳進來的元素仍一律放行，
 *   即使它的內容當下還沒溢出（例如剛好一頁高）。
 */
export function useScrollLock(open: Ref<boolean>, opts: ScrollLockOptions = {}) {
  function onTouchMove(e: TouchEvent) {
    const scroller = opts.scrollable?.()
    // ① 明確指定的可捲區：一律放行
    if (scroller && e.target instanceof Node && scroller.contains(e.target)) return
    // ② 任何「當下真的可捲動」的祖先（含 Teleport 出去的下拉清單）：放行
    if (scrollableAncestor(e.target)) return
    // ③ 其餘（背景、靜態區）一律擋掉
    e.preventDefault()
  }

  /** 這個實例目前是不是鎖著（watch 可能重複觸發同一個值） */
  let active = false

  function set(on: boolean) {
    if (on === active) return
    active = on
    if (on) {
      if (locks === 0) applyLock()
      locks++
      document.addEventListener('touchmove', onTouchMove, { passive: false })
    } else {
      locks = Math.max(0, locks - 1)
      document.removeEventListener('touchmove', onTouchMove)
      if (locks === 0) releaseLock()
    }
  }

  watch(open, set, { immediate: true })
  onBeforeUnmount(() => set(false))
}
