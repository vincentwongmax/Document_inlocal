import { createStore, get, set, del, clear, keys } from 'idb-keyval'

/** 圖片實體存放（容量遠大於 localStorage） */
const store = createStore('mop-ledger-images', 'blobs')

export async function putImage(id: string, blob: Blob): Promise<void> {
  await set(id, blob, store)
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return (await get<Blob>(id, store)) ?? undefined
}

export async function deleteImage(id: string): Promise<void> {
  await del(id, store)
}

export async function clearImages(): Promise<void> {
  await clear(store)
}

export async function listImageIds(): Promise<string[]> {
  return (await keys(store)).map(String)
}

/* ── 圖片處理 ─────────────────────────────────────────────── */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('讀取失敗'))
    fr.readAsDataURL(blob)
  })
}

/** 產生縮圖 data URL（清單顯示用，控制在 ~10KB 內） */
export async function makeThumb(file: Blob, max = 240): Promise<string> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no ctx')
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return canvas.toDataURL('image/jpeg', 0.68)
  } catch {
    return ''
  }
}
