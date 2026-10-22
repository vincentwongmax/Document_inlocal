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

/**
 * 0.1.77：切換錢包模式（數量 ⇄ 金錢）時的確認彈窗。
 *
 * 使用者原話（需求 1）：
 *   「切換後幣別（MOP／HKD 等）與匯率會被移除，保留當初輸入的數量等等其他東西…
 *     這個錢包金錢模式裡的數據完全移除（不是隱藏），
 *     當用戶想要從數量模式轉換到金錢模式的話，需要重新計算和轉換
 *     （不是用原有的數據還原，因為原數據已刪除）（即當一個新錢包處理）」
 *   補充：「只要遷移完成，所有舊東西包含記錄也要全部清空」
 *
 * ⚠⚠ 這兩句其實描述了**兩種不同的結果**（保留記錄並換算 / 全部清空當新錢包），
 *   而「記錄全部清空」是**不可逆**的破壞性操作 —— 所以不替使用者決定，
 *   直接在彈窗裡讓他二選一（再多給一個「先匯出備份」）。
 *
 * @returns 'keep'＝保留記錄並轉換｜'clear'＝全部清空（當新錢包）｜
 *          'backup'＝先匯出備份（**不切換**）｜'cancel'＝取消
 */
export type ModeSwitchChoice = 'keep' | 'clear' | 'backup' | 'cancel'

export async function switchModeDialog(o: {
  title: string
  message: string
  /** 保留記錄那顆鈕的文字 */
  keepText: string
  /** 清空全部那顆鈕的文字 */
  clearText: string
  /** 記錄有幾筆（0＝不用問了，直接切） */
  count?: number
}): Promise<ModeSwitchChoice> {
  /**
   * ⚠ SweetAlert2 原生只有 confirm／deny／cancel 三顆 → confirm＝保留並轉換、
   *   deny＝全部清空、cancel＝取消。
   * ⚠ 「先匯出備份」是**第四個動作** → 用 `html` 裡的一顆文字按鈕 +
   *   `Swal.close('backup')` 達成（關閉時帶一個自訂值，回來時 `res.value` 就是它）。
   *   這顆**不會切換**（只是打開匯出彈窗），等使用者匯出完自己再按一次。
   */
  const res = await Swal.fire({
    title: o.title,
    html:
      `<p style="margin:0 0 14px;font-size:13.5px;line-height:1.7;text-align:left">${o.message}</p>` +
      '<button type="button" id="swal-backup-btn" ' +
      'style="background:none;border:0;color:#8a857c;font-size:12.5px;font-weight:600;' +
      'text-decoration:underline;cursor:pointer;padding:0;margin-bottom:12px">' +
      '先匯出備份再說</button>',
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: o.keepText,
    denyButtonText: o.clearText,
    cancelButtonText: '取消',
    reverseButtons: true,
    focusConfirm: false,
    focusDeny: false,
    focusCancel: false,
    didOpen: () => {
      document
        .getElementById('swal-backup-btn')
        ?.addEventListener('click', () => void Swal.close({ value: 'backup' } as never))
    },
  })
  if (res.value === 'backup') return 'backup'
  if (res.isConfirmed) return 'keep'
  if (res.isDenied) return 'clear'
  return 'cancel'
}

/**
 * 0.1.77：讓使用者在彈窗裡選一個**主幣別**（數量模式切回金錢模式時用）。
 *
 * 使用者原話：「當用戶想要從數量模式轉換到金錢模式的話…（即當一個新錢包處理），
 *   彈出主幣別的下拉選單，給用戶選擇，所有的數量轉成金額都以主幣別做單位」。
 *
 * ⚠ 為什麼用 `html` 自己畫下拉而不是 `confirmDialog`：confirmDialog 的三顆按鈕
 *   沒有「輸入」的位置，而這裡必須先讓他選幣別才能確定。
 * ⚠ 回傳 `null` ＝取消（按 ESC／點背景／按取消鈕都算）。
 */
export async function pickBaseCurrency(
  options: readonly { code: string; name: string }[],
  current = '',
): Promise<string | null> {
  const opts = options
    .map(
      (c) =>
        `<option value="${escapeHtml(c.code)}"${c.code === current ? ' selected' : ''}>` +
        `${escapeHtml(c.name)}（${escapeHtml(c.code)}）</option>`,
    )
    .join('')
  const res = await Swal.fire({
    title: '選主幣別',
    html:
      '<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#666">' +
      '數量模式的資料會以你選的這個幣別重新換算（當成一個新錢包處理）。' +
      '</p>' +
      `<select id="swal-base-cur" class="swal2-input" ` +
    `style="width:100%;height:2.75em;font-size:15px;padding:0 10px;border-radius:8px">${opts}</select>`,
    showCancelButton: true,
    confirmButtonText: '用這個幣別',
    cancelButtonText: '取消',
    reverseButtons: true,
    preConfirm: () => {
      const el = document.getElementById('swal-base-cur') as HTMLSelectElement | null
      return el?.value || null
    },
  })
  if (!res.isConfirmed) return null
  const v = res.value
  return typeof v === 'string' && v ? v : null
}

/** 小工具：把字串裡的 HTML 敏感字元換掉（幣別代碼是使用者自訂的，不能直接塞進屬性） */
function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 0.1.52：設定頁「檢查更新」比對線上 version.json 後的詢問。
 *
 * 使用者原話：「彈出提示，版本號不一致，當前 X.Y.Z，將自動更新 A.B.C」。
 * 按「立即更新」＝交給呼叫端執行 updateSW(true)（套用新版並重新載入）。
 */
export async function askRemoteUpdate(current: string, remote: string): Promise<boolean> {
  const res = await Swal.fire({
    title: '發現新版本',
    html: `版本號不一致：當前 <b class="num">${current}</b>，將自動更新 <b class="num">${remote}</b>。`,
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: '立即更新',
    cancelButtonText: '稍後',
    reverseButtons: true,
  })
  return res.isConfirmed
}
