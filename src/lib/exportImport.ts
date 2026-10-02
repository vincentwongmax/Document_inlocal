import type { ExportPayload, Settings, TxRecord } from '@/types'
import { blobToDataUrl, getImage, putImage } from './imageDb'
import { makeThumb } from './imaging'

/** 匯出：記錄＋設定＋圖片（base64），單一 JSON 檔 */
export async function buildExport(
  records: TxRecord[],
  settings: Settings,
): Promise<ExportPayload> {
  const images: Record<string, string> = {}
  const needed = new Map<string, string>() // md5 -> imageId
  for (const r of records) {
    for (const im of r.images ?? []) {
      if (!needed.has(im.md5)) needed.set(im.md5, im.id)
    }
  }
  for (const [md5, id] of needed) {
    const blob = await getImage(id)
    if (blob) images[md5] = await blobToDataUrl(blob)
  }
  return {
    app: 'mop-ledger',
    format: 1,
    exportedAt: new Date().toISOString(),
    settings,
    records,
    images,
  }
}

export function downloadJson(payload: ExportPayload): string {
  const json = JSON.stringify(payload)
  const blob = new Blob([json], { type: 'application/json' })
  const ts = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `ledger-${ts.getFullYear()}${p(ts.getMonth() + 1)}${p(ts.getDate())}-${p(ts.getHours())}${p(ts.getMinutes())}.json`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export interface ParsedImport {
  records: TxRecord[]
  settings?: Settings
  images: Record<string, string>
  exportedAt?: string
}

export function parseImport(text: string): ParsedImport {
  const data = JSON.parse(text) as ExportPayload
  if (!data || data.app !== 'mop-ledger' || !Array.isArray(data.records)) {
    throw new Error('這不是記帳本的匯出檔')
  }
  return {
    records: data.records,
    settings: data.settings,
    images: data.images ?? {},
    exportedAt: data.exportedAt,
  }
}

/** 把匯入檔裡的圖片寫回 IndexedDB（鍵值沿用記錄上的 image id） */
export async function restoreImages(
  records: TxRecord[],
  images: Record<string, string>,
): Promise<number> {
  let n = 0
  for (const r of records) {
    for (const im of r.images ?? []) {
      const dataUrl = images[im.md5]
      if (!dataUrl) continue
      const blob = dataUrlToBlob(dataUrl)
      await putImage(im.id, blob)
      if (!im.thumb) im.thumb = await makeThumb(blob)
      n++
    }
  }
  return n
}
