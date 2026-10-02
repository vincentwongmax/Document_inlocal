/**
 * 圖片壓縮：統一縮到長邊 480px，並降到目標容量（預設 40KB）以內。
 * 全部在瀏覽器端完成，不依賴網路。
 */

/** 480p：長邊上限 */
export const MAX_EDGE = 480
/** 單張圖片的容量目標（bytes） */
export const TARGET_BYTES = 40 * 1024
/** OCR 用的工作尺寸（長邊），兼顧辨識率與速度 */
const OCR_EDGE = 1400
/** 縮圖上限（存進 localStorage 的 data URL，越小越好） */
const THUMB_EDGE = 144
const THUMB_TARGET = 6 * 1024

const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.44, 0.36, 0.3]
const SHRINKS = [0.75, 0.55, 0.4]

let webpOk: boolean | null = null

/** 瀏覽器是否支援 WebP 編碼（同體積下畫質比 JPEG 好） */
export function supportsWebp(): boolean {
  if (webpOk !== null) return webpOk
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    webpOk = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpOk = false
  }
  return webpOk
}

function mime(): string {
  return supportsWebp() ? 'image/webp' : 'image/jpeg'
}

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  const opts = { imageOrientation: 'from-image' } as ImageBitmapOptions
  try {
    return await createImageBitmap(file, opts)
  } catch {
    // 老瀏覽器不認得 imageOrientation
    return await createImageBitmap(file)
  }
}

/** 依長邊等比例縮放並繪到 canvas */
function drawScaled(bmp: ImageBitmap, maxEdge: number, ratio = 1): HTMLCanvasElement {
  const longest = Math.max(bmp.width, bmp.height)
  const scale = Math.min(1, (maxEdge * ratio) / longest)
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('無法取得 canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // 白底：避免透明 PNG 轉 JPEG 後變黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => resolve(b), type, quality)
    } else {
      const url = canvas.toDataURL(type, quality)
      const [head, b64] = url.split(',')
      const bin = atob(b64 ?? '')
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      resolve(new Blob([arr], { type: head?.match(/:(.*?);/)?.[1] ?? type }))
    }
  })
}

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
  bytes: number
  type: string
  originalBytes: number
}

/**
 * 壓縮成 480p 小檔：先降品質，品質到底還太大就再縮尺寸。
 * 任何一步失敗都退回原檔，不讓上傳流程中斷。
 */
export async function compressImage(
  file: Blob,
  maxEdge = MAX_EDGE,
  targetBytes = TARGET_BYTES,
): Promise<CompressedImage> {
  const originalBytes = file.size ?? 0
  const type = mime()
  try {
    const bmp = await bitmapOf(file)
    try {
      let best: CompressedImage | null = null

      for (const q of QUALITIES) {
        const canvas = drawScaled(bmp, maxEdge)
        const blob = await toBlob(canvas, type, q)
        if (!blob) continue
        best = {
          blob,
          width: canvas.width,
          height: canvas.height,
          bytes: blob.size,
          type,
          originalBytes,
        }
        if (blob.size <= targetBytes) break
      }

      // 品質降到最低仍超過目標：再縮尺寸
      if (best && best.bytes > targetBytes) {
        for (const r of SHRINKS) {
          const canvas = drawScaled(bmp, maxEdge, r)
          const blob = await toBlob(canvas, type, 0.6)
          if (!blob) continue
          best = {
            blob,
            width: canvas.width,
            height: canvas.height,
            bytes: blob.size,
            type,
            originalBytes,
          }
          if (blob.size <= targetBytes) break
        }
      }

      if (best) return best
    } finally {
      bmp.close?.()
    }
  } catch (e) {
    console.warn('[imaging] 壓縮失敗，改用原檔', e)
  }
  return { blob: file, width: 0, height: 0, bytes: originalBytes, type: file.type, originalBytes }
}

/** OCR 工作圖：放大到長邊 1400 以維持辨識率（不上傳、不儲存） */
export async function makeOcrImage(file: Blob): Promise<Blob> {
  try {
    const bmp = await bitmapOf(file)
    try {
      if (Math.max(bmp.width, bmp.height) <= OCR_EDGE) return file
      const canvas = drawScaled(bmp, OCR_EDGE)
      const blob = await toBlob(canvas, mime(), 0.86)
      return blob ?? file
    } finally {
      bmp.close?.()
    }
  } catch {
    return file
  }
}

/** 清單用縮圖 data URL（存進 localStorage，控制在 6KB 內） */
export async function makeThumb(file: Blob, max = THUMB_EDGE): Promise<string> {
  try {
    const bmp = await bitmapOf(file)
    try {
      const type = mime()
      let out = ''
      for (const q of [0.72, 0.58, 0.46, 0.36]) {
        const canvas = drawScaled(bmp, max)
        out = canvas.toDataURL(type, q)
        // data URL 約為實際位元組的 1.37 倍
        if (out.length * 0.73 <= THUMB_TARGET) break
      }
      return out
    } finally {
      bmp.close?.()
    }
  } catch {
    return ''
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
