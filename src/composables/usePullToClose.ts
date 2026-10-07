import { computed, ref, watch, type Ref } from 'vue'

interface PullToCloseOptions {
  /** 整個面板（要跟著手指往下移的元素） */
  panel: Ref<HTMLElement | null>
  /** 面板裡可捲動的內容區。它不在最頂端時，向下滑是「捲動內容」不是「拖曳面板」 */
  scroller: Ref<HTMLElement | null>
  /** 判定為「要關閉」時呼叫 */
  onClose: () => void
}

/** 累積到這個位移才決定「這次手勢要拖面板，還是讓內容自己捲」 */
const SLOP = 5
/** 關閉門檻＝面板高度的 22%，但夾在 64～160px 之間 */
const MIN_CLOSE = 64
const MAX_CLOSE = 160
/** 「甩一下」的速度門檻（px/ms）：夠快就不必真的拉滿門檻 */
const FLICK = 0.55
/** 關閉時順著手勢把面板送出畫面的距離（面板高度再加一點） */
const FLY_EXTRA = 48

/**
 * 底部面板「向下拉就關掉」。
 *
 * 為什麼不只用 pointer 事件：手指拖曳要能壓過瀏覽器自己的捲動，
 * 這件事只有「非 passive 的 touchmove + preventDefault」做得到
 * （pointer 事件在瀏覽器決定接管捲動時會直接收到 pointercancel）。
 * 所以手指走 touch 事件；滑鼠另外接，而且只認把手／標題列——
 * 在內容上按著拖是選字，不該被搶走。
 *
 * 用法（手勢成員綁在面板上，見回傳的 handlers）：
 *   const drag = usePullToClose({ panel: sheetEl, scroller: bodyEl, onClose: close })
 *   <div :style="drag.style" :class="{ 'is-dragging': drag.dragging.value }" …>
 */
export function usePullToClose({ panel, scroller, onClose }: PullToCloseOptions) {
  /** 面板目前的位移（往下為正，px） */
  const offset = ref(0)
  /** 正在拖：拖的時候要關掉 transition，不然會跟不上手指 */
  const dragging = ref(false)

  let x0 = 0
  let y0 = 0
  let yPrev = 0
  let tPrev = 0
  /** 最後一次移動的速度（px/ms） */
  let v = 0
  /** -1 = 還沒決定、0 = 這次手勢不拖面板、1 = 這次手勢拖面板 */
  let mode: -1 | 0 | 1 = -1
  /** 手勢是從可捲動的內容區開始的嗎 */
  let fromScroller = false
  /** 這次手勢有正常開始嗎（用來忽略沒有 touchstart 的野生 move） */
  let armed = false
  /** 目前是不是滑鼠拖曳（move／up 要掛在 window 上才收得到） */
  let mouse = false

  const closeLimit = () =>
    Math.min(MAX_CLOSE, Math.max(MIN_CLOSE, (panel.value?.offsetHeight ?? 0) * 0.22))

  function begin(x: number, y: number, target: EventTarget | null, isMouse: boolean) {
    x0 = x
    y0 = y
    yPrev = y
    tPrev = performance.now()
    v = 0
    mode = -1
    armed = true
    mouse = isMouse
    const sc = scroller.value
    fromScroller = !!sc && target instanceof Node && sc.contains(target)
  }

  /** 回傳 true 表示「這次手勢歸我們管」，呼叫端要 preventDefault */
  function move(x: number, y: number): boolean {
    if (mode === 0) return false
    const dy = y - y0
    const dx = x - x0

    if (mode === -1) {
      // ⚠ 還沒決定方向前先一律擋掉：iOS 只要放掉第一個 touchmove，
      //   這次手勢就會被鎖定成原生捲動，之後再 preventDefault 也搶不回來。
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return true
      const sc = scroller.value
      const atTop = !sc || sc.scrollTop <= 0
      // 橫向滑、往上滑、內容還沒捲到頂 → 這次交給原生捲動
      if (Math.abs(dx) > Math.abs(dy) || dy < 0 || (fromScroller && !atTop)) {
        mode = 0
        return false
      }
      mode = 1
      dragging.value = true
    }

    const now = performance.now()
    const dt = now - tPrev
    if (dt > 0) v = (y - yPrev) / dt
    yPrev = y
    tPrev = now

    offset.value = Math.max(0, dy)
    return true
  }

  function end() {
    if (mode === 1) {
      const shouldClose = offset.value > closeLimit() || v > FLICK
      dragging.value = false // 先放掉 is-dragging，回彈／送出才有 transition
      if (shouldClose) {
        // 順著手勢把它送出畫面（同一個 transform 才接得順；剩下的交給淡出）
        offset.value = (panel.value?.offsetHeight ?? 0) + FLY_EXTRA
        onClose()
      } else {
        offset.value = 0
      }
    }
    dragging.value = false
    mode = 0
    armed = false
    if (mouse) {
      mouse = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    begin(t.clientX, t.clientY, e.target, false)
  }

  function onTouchMove(e: TouchEvent) {
    if (!armed || mode === 0) return
    if (e.touches.length !== 1) {
      mode = 0 // 多指 → 交還給瀏覽器（縮放之類的）
      return
    }
    const t = e.touches[0]
    if (move(t.clientX, t.clientY) && e.cancelable) e.preventDefault()
  }

  function onTouchEnd() {
    if (!armed) return
    end()
  }

  function onMouseMove(e: MouseEvent) {
    if (!armed) return
    move(e.clientX, e.clientY)
  }

  function onMouseUp() {
    if (!armed) return
    end()
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    const el = e.target as HTMLElement | null
    // 只有把手／標題列可以拖，而且不能從上面的按鈕起拖（那是「按一下」）
    if (!el?.closest('.sheet__grab, .sheet__head')) return
    if (el.closest('button, a, input, select, textarea, label')) return
    begin(e.clientX, e.clientY, e.target, true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    e.preventDefault() // 免得拖出一片文字選取
  }

  /**
   * 面板每次重新出現都把位移歸零。
   * ⚠ 一定不能在收起時就歸零：那時候 inline transform 還撐著「送下去」的動畫。
   *   （`v-if` 的元素要等淡出結束才會真的卸載，ref 也才變 null。）
   */
  watch(panel, (el) => {
    if (el) {
      offset.value = 0
      dragging.value = false
      mode = 0
      armed = false
    }
  })

  return {
    offset,
    dragging,
    /** 直接綁在面板上的 inline style；沒有位移時給 null，把 transform 還給進出場動畫 */
    style: computed(() =>
      offset.value > 0 || dragging.value ? { transform: `translateY(${offset.value}px)` } : null,
    ),
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
  }
}
