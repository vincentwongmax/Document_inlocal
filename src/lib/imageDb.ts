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

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('讀取失敗'))
    fr.readAsDataURL(blob)
  })
}
