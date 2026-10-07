import type { ExportPayload, Settings, TxRecord, Wallet } from '@/types'
import { blobToDataUrl, getImage, putImage } from './imageDb'
import { makeThumb } from './imaging'

export interface ExportSource {
  /** 全部錢包（照顯示順序） */
  wallets: Wallet[]
  /** 當前錢包（JSON 的 settings 欄位會放這一個，向後相容用） */
  activeWalletId: string
  /** walletId -> 該錢包的設定（全部） */
  settingsByWallet: Record<string, Settings>
  /** 這次要打包的記錄（已依範圍篩好；可能橫跨多個錢包） */
  records: TxRecord[]
  onProgress?: (p: { phase: 'read' | 'pack'; done: number; total: number }) => void
}

/**
 * 匯出成單一 JSON 檔（format 2）：
 * 錢包清單 ＋ 每個錢包各自的設定 ＋ 記錄 ＋ 圖片（base64）。
 *
 * ⚠ 這是**完整備份**：設定與錢包一律整份帶走，
 * 只有「記錄」會受彈窗上的範圍篩選影響。
 */
export async function buildExport(src: ExportSource): Promise<ExportPayload> {
  const images: Record<string, string> = {}
  const needed = new Map<string, string>() // md5 -> imageId
  for (const r of src.records) {
    for (const im of r.images ?? []) {
      if (!needed.has(im.md5)) needed.set(im.md5, im.id)
    }
  }
  const total = needed.size
  let done = 0
  src.onProgress?.({ phase: 'read', done: 0, total })
  for (const [md5, id] of needed) {
    const blob = await getImage(id)
    if (blob) images[md5] = await blobToDataUrl(blob)
    src.onProgress?.({ phase: 'read', done: ++done, total })
  }
  const primary =
    src.settingsByWallet[src.activeWalletId] ?? Object.values(src.settingsByWallet)[0]
  return {
    app: 'mop-ledger',
    format: 2,
    exportedAt: new Date().toISOString(),
    settings: primary,
    records: src.records,
    images,
    wallets: src.wallets,
    settingsByWallet: src.settingsByWallet,
    activeWalletId: src.activeWalletId,
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
  /** 1 = 單錢包時代的舊檔（記錄沒有 walletId）；2 = 有錢包的版本 */
  format: 1 | 2
  records: TxRecord[]
  settings?: Settings
  /** 只有 v2 有：全部錢包 */
  wallets?: Wallet[]
  /** 只有 v2 有：walletId -> 該錢包的設定 */
  settingsByWallet?: Record<string, Settings>
  images: Record<string, string>
  exportedAt?: string
}

export function parseImport(text: string): ParsedImport {
  let data: ExportPayload
  try {
    data = JSON.parse(text) as ExportPayload
  } catch {
    throw new Error('這個檔案不是 JSON，讀不出來')
  }
  if (!data || data.app !== 'mop-ledger' || !Array.isArray(data.records)) {
    throw new Error('這不是記帳本的匯出檔')
  }
  const hasWallets = Array.isArray(data.wallets) && data.wallets.length > 0
  return {
    // 1 是舊檔：沒有 wallets 欄位。有些舊檔的 format 寫死 1，所以兩個條件都要看
    format: data.format === 2 || hasWallets ? 2 : 1,
    records: data.records,
    settings: data.settings,
    wallets: hasWallets ? data.wallets : undefined,
    settingsByWallet:
      hasWallets && data.settingsByWallet && typeof data.settingsByWallet === 'object'
        ? data.settingsByWallet
        : undefined,
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
