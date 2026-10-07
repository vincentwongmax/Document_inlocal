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
 * 把「已經被貼進 DOM 的 `<img>`」轉成 `File`。
 *
 * 為什麼需要這條路：iOS 常常**不給** `dt.files`，只給一段 `text/html`，
 * 裡面的 `<img src>` 可能是 `blob:`、`data:`，也可能是只有 WebKit 才認得的
 * `applewebdata://` —— 那種網址我們自己 `fetch()` 抓不到（下面那條路會整段失敗）。
 * 但**瀏覽器自己**貼進 DOM 的圖一定載得起來，所以改成「讓它貼進來、再從 DOM 讀出來」：
 * 用 canvas 把已經解碼好的像素拿出來，網址是哪一種都不影響。
 *
 * 回傳 null 代表這張救不回來（例如畫布被跨域圖汙染），呼叫端跳過即可。
 */
export async function fileFromImageEl(
  img: HTMLImageElement,
  i: number,
  total: number,
): Promise<File | null> {
  try {
    // 還沒解碼完就等一下（貼上的當下圖通常還在載）
    if (!img.complete || !img.naturalWidth) {
      await new Promise<void>((res) => {
        const done = () => res()
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
        setTimeout(done, 1500)
      })
    }
    if (!img.naturalWidth || !img.naturalHeight) return null

    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    return blob ? pastedFile(blob, i, total) : null
  } catch {
    /* 畫布被汙染（跨域圖）→ 這張放棄，不要連累其他張 */
    return null
  }
}

/**
 * 從剪貼簿事件撈出圖片。
 * iOS 常常不是給「檔案」，而是給一段內含 `<img>` 的 HTML（src 是 blob: 或 data:），
 * 所以兩條都要試。外部 http(s) 網址刻意不處理——跨域只會拿到不透明回應，讀不出內容。
 *
 * ⚠ 這條是**備援**：真正優先是「讓瀏覽器貼進 DOM 再讀出來」（見 `fileFromImageEl` 與
 *   `composables/usePasteImages.ts`），因為只有那條路收得到 `applewebdata://` 這種
 *   WebKit 專屬網址。這裡保留給「有檔案／有可抓的 blob/data 網址」的情境。
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

  return filesFromMarkup(dt.getData('text/html'), dt.getData('text/plain'))
}

/**
 * 從剪貼簿的「文字版」內容（`text/html` 與 `text/plain`）撈圖片。
 * 抽出來是因為呼叫端常常只能先同步把字串存起來（`DataTransfer` 過了這一輪就不能再讀）。
 */
export async function filesFromMarkup(html: string, text: string): Promise<File[]> {
  const out: File[] = []
  const srcs: string[] = []
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? ''
      if (/^(blob:|data:)/.test(src)) srcs.push(src)
    }
  }
  // 有些 App 是把 data URL 塞在純文字裡
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
