/**
 * 全站通知的唯一出口 —— 一律走 SweetAlert2（https://sweetalert2.github.io/）。
 *
 * 專案裡有兩種通知，都在這裡：
 *   - `notify()`       畫面底部置中的 Toast（語氣＝icon），可帶一顆動作按鈕（例如「復原」）
 *   - `confirmDialog()` 需要決定的確認彈窗，回傳使用者按了哪一顆
 *   - `askUpdate()`    PWA 有新版本時的詢問
 *
 * 樣式走 SweetAlert2 原生外觀。套件入口（sweetalert2.all.js）執行時會自己把官方 CSS
 * 插入 <head>，不需要（也不要）再 import 一次；唯一的自訂在 `style.css`：
 * 底部 Toast 要往上讓開底部導航列。
 */
import Swal from 'sweetalert2'

/** 通知語氣；會對應到 SweetAlert2 的 icon */
export type NoticeKind = 'ok' | 'warn' | 'info' | 'error'

/** Toast 上的動作按鈕（例如「復原」） */
export interface NoticeAction {
  label: string
  run: () => void
}

const ICON: Record<NoticeKind, 'success' | 'warning' | 'info' | 'error'> = {
  ok: 'success',
  warn: 'warning',
  info: 'info',
  error: 'error',
}

/**
 * 底部 Toast。
 *
 * ⚠ 一律帶一顆「知道了」：使用者看到通知就想立刻關掉，不必等倒數結束
 *   （需求：彈出來的 SweetAlert 都要有「知道了」）。
 * ⚠ 有額外動作時（例如「復原」）改用 **deny** 鈕，讓「知道了」永遠是那顆
 *   單純把通知關掉的鈕，兩顆不會互相頂掉；`reverseButtons` 讓動作在左、知道了在右。
 */
const Toast = Swal.mixin({
  toast: true,
  position: 'bottom',
  showConfirmButton: true,
  confirmButtonText: '知道了',
  showCloseButton: false,
  reverseButtons: true,
  didOpen: (el) => {
    // 滑鼠停在 Toast 上時暫停倒數，讓「復原」來得及按（SweetAlert2 原生行為）
    el.addEventListener('mouseenter', Swal.stopTimer)
    el.addEventListener('mouseleave', Swal.resumeTimer)
  },
})

/**
 * 顯示一則 Toast 通知。
 *
 * @param text   訊息文字
 * @param kind   語氣（決定 icon）
 * @param action 選填；有給就會多一顆按鈕（例如「復原」），按下後執行 `run`
 * @param ms     自動關閉的毫秒數
 */
export function notify(
  text: string,
  kind: NoticeKind = 'ok',
  action?: NoticeAction,
  ms = 3200,
): void {
  void Toast.fire({
    icon: ICON[kind],
    title: text,
    timer: ms,
    timerProgressBar: true,
    // 動作鈕（deny）：按下才算；按「知道了」或時間到都只是關掉，不會觸發
    showDenyButton: !!action,
    denyButtonText: action?.label || undefined,
  }).then((res) => {
    if (res.isDenied) action?.run()
  })
}

export interface ConfirmOptions {
  title: string
  /** 說明文字（可省略） */
  message?: string
  confirmText?: string
  cancelText?: string
  /** 有給就會多一顆中間的按鈕（例如「只匯入記錄」） */
  denyText?: string
  /** 危險操作：用紅色確認鈕＋警告圖示 */
  danger?: boolean
}

export type ConfirmResult = 'confirm' | 'deny' | 'cancel'

/**
 * 確認彈窗。回傳使用者按下的那顆：
 * `confirm`＝主要動作、`deny`＝第二動作、`cancel`＝取消／按 ESC／點背景關掉。
 */
export async function confirmDialog(o: ConfirmOptions): Promise<ConfirmResult> {
  const res = await Swal.fire({
    title: o.title,
    text: o.message || undefined,
    icon: o.danger ? 'warning' : 'question',
    showCancelButton: true,
    showDenyButton: !!o.denyText,
    confirmButtonText: o.confirmText ?? '確定',
    denyButtonText: o.denyText || undefined,
    cancelButtonText: o.cancelText ?? '取消',
    // 讓「取消」在最左、主要動作在最右（跟原本的彈窗按鈕順序一致）
    reverseButtons: true,
    ...(o.danger ? { confirmButtonColor: '#d33' } : {}),
  })
  if (res.isConfirmed) return 'confirm'
  if (res.isDenied) return 'deny'
  return 'cancel'
}

/** PWA 有新版本時的詢問；回傳 true 代表使用者選擇立刻更新 */
export async function askUpdate(): Promise<boolean> {
  const res = await Swal.fire({
    title: '已有新版本',
    text: '重新載入後就會套用最新版本。',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: '立即更新',
    cancelButtonText: '稍後',
    reverseButtons: true,
  })
  return res.isConfirmed
}
