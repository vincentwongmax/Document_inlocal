/**
 * 剪貼簿裡的圖片 → `File`（「收據圖片」區塊與記錄明細共用）。
 *
 * 為什麼要兩條路（`paste` 事件 ＋ `navigator.clipboard.read()`）：
 *   1. `paste` 事件**保證可用**：iOS 的 WebKit 只在「可編輯元素」取得焦點時才發，
 *      所以接收面上要鋪一層看不見的 contenteditable（做法在呼叫端）。
 *   2. `navigator.clipboard.read()` 是加分項：支援的瀏覽器點一下就貼好。
 *      Safari 對它的支援反覆，失敗是常態 → 一律 try/catch，失敗就默默退回第 1 條。
 *      **不能只做這一條。**
 */

export const IMG_MIME = /^image\//i

/** 從 MIME 猜一個副檔名（剪貼簿來的 blob 沒有檔名） */
export function extOf(mime: string): string {
  const m = mime.toLowerCase()
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/heic') return 'heic'
  if (m === 'image/heif') return 'heif'
  return 'png'
}

/** 剪貼簿來的 blob 不會有檔名，自己取一個（列表／明細上會顯示） */
export function pastedFile(blob: Blob, i: number, total: number): File {
  const type = blob.type || 'image/png'
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`
  return new File([blob], `貼上-${stamp}${total > 1 ? `-${i + 1}` : ''}.${extOf(type)}`, { type })
}

/**
 * 從剪貼簿事件撈出圖片。
 * iOS 常常不是給「檔案」，而是給一段內含 `<img>` 的 HTML（src 是 blob: 或 data:），
 * 所以兩條都要試。外部 http(s) 網址刻意不處理——跨域只會拿到不透明回應，讀不出內容。
 */
export async function filesFromClipboard(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return []
  const out: File[] = []

  for (const f of Array.from(dt.files ?? [])) if (IMG_MIME.test(f.type)) out.push(f)
  if (out.length) return out
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && IMG_MIME.test(it.type)) {
      const f = it.getAsFile()
      if (f) out.push(f)
    }
  }
  if (out.length) return out

  const srcs: string[] = []
  const html = dt.getData('text/html')
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? ''
      if (/^(blob:|data:)/.test(src)) srcs.push(src)
    }
  }
  // 有些 App 是把 data URL 塞在純文字裡
  const text = dt.getData('text/plain')
  if (text && /^data:image\//.test(text.trim())) srcs.push(text.trim())

  for (const src of srcs) {
    try {
      const blob = await (await fetch(src)).blob()
      if (IMG_MIME.test(blob.type || 'image/png')) out.push(pastedFile(blob, out.length, srcs.length))
    } catch {
      /* 讀不到就跳過，不讓一張壞圖擋掉其他張 */
    }
  }
  return out
}
