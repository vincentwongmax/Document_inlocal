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
 * 0.1.78（需求 2）：管理分類頁「匯出分類／匯入分類」共用的**勾選清單**。
 *
 * 使用者原話：「支持用戶匯出或匯入全部分類或指定分類（用戶可選）」。
 * 兩種流程都用這一個彈窗：
 * - 匯出：列出目前全部分類 → 勾完產 JSON 下載
 * - 匯入：列出檔案裡的全部分類 → 勾完才合併（重複的略過）
 *
 * ⚠ 為什麼用 SweetAlert2 的 `html` 自己畫清單：清單可能很長（幾十個分類），
 *   要能自己捲；SweetAlert2 的 `input: 'select'` 不支援多選，`checkbox` 群組
 *   又沒有樹狀縮排。這裡用 label + checkbox 手寫，縮排靠 padding-left。
 * ⚠ 名稱是使用者輸入的 → 一律過 `escapeHtml` 才塞進 html。
 *
 * @returns 勾選的分類 id（**父先於子**的順序）；`null`＝取消
 */
export async function pickCategoriesDialog(o: {
  title: string
  message: string
  confirmText: string
  /** 勾選清單的項目（縮排深度 0＝最上層大類） */
  items: { id: string; name: string; depth: number }[]
  /** 清單上方那顆「全選／全不選」的初始狀態 */
  allChecked?: boolean
}): Promise<string[] | null> {
  const rows = o.items
    .map(
      (it) =>
        `<label class="pcrow" data-id="${escapeHtml(it.id)}" ` +
        `style="display:flex;align-items:center;gap:9px;padding:7px 4px;` +
        `padding-left:${4 + it.depth * 18}px;font-size:13.5px;cursor:pointer;text-align:left">` +
        `<input type="checkbox" value="${escapeHtml(it.id)}" ` +
        `style="width:17px;height:17px;flex:none;accent-color:#2c6e5b" ` +
        `${o.allChecked === false ? '' : 'checked'} />` +
        `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
        `${escapeHtml(it.name)}</span></label>`,
    )
    .join('')
  const res = await Swal.fire({
    title: o.title,
    html:
      `<p style="margin:0 0 10px;font-size:12.5px;line-height:1.6;color:#7a766c;text-align:left">${o.message}</p>` +
      `<div style="max-height:44vh;overflow-y:auto;-webkit-overflow-scrolling:touch;` +
      `border:1px solid #e5e1d8;border-radius:10px;padding:4px 10px;background:#fbfaf7">${rows}</div>` +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">` +
      `<button type="button" id="swal-pc-all" style="background:none;border:0;color:#2c6e5b;` +
      `font-size:12.5px;font-weight:650;cursor:pointer;padding:0">全選／全不選</button>` +
      `<span id="swal-pc-count" style="font-size:11.5px;color:#7a766c"></span></div>`,
    showCancelButton: true,
    confirmButtonText: o.confirmText,
    cancelButtonText: '取消',
    reverseButtons: true,
    didOpen: () => {
      const box = Swal.getHtmlContainer()
      const count = () => {
        const n = box?.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked').length ?? 0
        const el = document.getElementById('swal-pc-count')
        if (el) el.textContent = `已選 ${n} ／ ${o.items.length}`
      }
      count()
      box?.addEventListener('change', count)
      document.getElementById('swal-pc-all')?.addEventListener('click', () => {
        const boxes = box?.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
        if (!boxes?.length) return
        const allOn = [...boxes].every((b) => b.checked)
        for (const b of boxes) b.checked = !allOn
        count()
      })
    },
    preConfirm: () => {
      const boxes = Swal.getHtmlContainer()?.querySelectorAll<HTMLInputElement>(
        'input[type=checkbox]:checked',
      )
      const ids = [...(boxes ?? [])].map((b) => b.value)
      if (!ids.length) {
        Swal.showValidationMessage('至少選一個分類')
        return false
      }
      return ids
    },
  })
  if (!res.isConfirmed) return null
  const v = res.value
  return Array.isArray(v) ? (v as string[]) : null
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
