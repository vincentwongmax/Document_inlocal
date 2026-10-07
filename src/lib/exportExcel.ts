/**
 * Excel 匯出：把記錄變成一包 ZIP，裡面是
 *
 *   ledger-YYYYMMDD-HHMM.zip
 *   ├── ledger-YYYYMMDD-HHMM.xlsx     ← 只有記錄，**不含任何設定**
 *   └── images/
 *       ├── 2026-10-07_餐飲_85.00_1.webp
 *       └── …
 *
 * 0.1.24 起支援「全部錢包」：同一個 ZIP 裡每個錢包各一份 .xlsx
 * （`<錢包名>-YYYYMMDD-HHMM.xlsx`，圖檔仍共用同一個 `images/` 資料夾）：
 *
 *   ledger-YYYYMMDD-HHMM.zip
 *   ├── 我的錢包-20261007-1430.xlsx
 *   ├── 旅行-20261007-1430.xlsx
 *   └── images/
 *
 * 幾個刻意的決定：
 *   - **只匯出記錄**：Excel 裡的分類／子分類名稱雖然來自設定，但那是為了讓表格看得懂
 *     （記錄本身只存 categoryId），所以只把名稱「顯示」出來，不匯出分類樹、匯率表、
 *     常用備註、幣別偏好等任何設定。要完整備份／還原請用 JSON 匯出。
 *   - 圖檔是**獨立檔案**（不是塞進儲存格），Excel 的「圖片檔名（ZIP 內）」欄寫的是相對路徑
 *     `images/xxx.webp`，解壓縮後就對得上。
 *   - 圖檔命名走「日期_分類_金額_序號」，一眼看得出是哪一筆；真的撞名時自動往後遞號，
 *     所以同一天同分類同金額的兩筆也不會蓋掉對方。**檔名一律帶錢包名**，
 *     這樣多錢包時同一天同分類同金額的兩筆也不會撞在一起。
 *   - 記錄依「發生時間」由舊到新排，跟記帳本翻頁的順序一致。
 *   - 大標題的欄名是「分類路徑」＝依錢包自己的分類樹取路徑；
 *     找不到就回常數 `PICK_FALLBACK`（預留給 UI 就地改字用）。
 */

import type { ImageRef, TxRecord } from '@/types'
import { getImage } from './imageDb'
import { formatFull } from './date'
import { displayExpr } from './calc'
import { buildXlsx, type XlsxColumn } from './xlsx'
import { buildZip, ZIP_LIMITS, type ZipEntry } from './zip'

/** 分類路徑取不到時固定回這個字串；使用者可在 UI 把它改掉 */
export const PICK_FALLBACK = '未分類'

/** 匯出過程中回報進度（先讀圖片、再打包） */
export interface ExportProgress {
  phase: 'read' | 'pack'
  done: number
  total: number
}

export interface ExcelExportResult {
  blob: Blob
  fileName: string
  recordCount: number
  imageCount: number
  /** IndexedDB 裡已經找不到、因此沒被放進 ZIP 的圖片數 */
  missingImages: number
  /** 產生幾份 .xlsx（全部錢包時 > 1） */
  fileCount: number
}

/** 一個錢包要匯出什麼：它的記錄、分類取名方式、以及顯示名稱 */
export interface ExcelWalletGroup {
  walletId: string
  /** 錢包名稱；會出現在 xlsx 檔名上（全部錢包時） */
  name: string
  records: TxRecord[]
  /** 取分類路徑（根 → 葉）的名稱；找不到就回空陣列 */
  pathNamesOf: (categoryId: string) => string[]
  /** 這個錢包的主幣別（「主幣金額」欄標題的註記用） */
  baseCurrency: string
}

/* ── 檔名處理 ───────────────────────────────────────────── */

const p2 = (n: number) => String(n).padStart(2, '0')

/**
 * 檔名安全化：拿掉 Windows／macOS 不能用的字元，順便避開會讓檔案很難處理的寫法
 * （開頭結尾的點與空白、連續底線）。
 */
function safePart(s: string, max = 40): string {
  const cleaned = (s || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
  return cleaned.slice(0, max) || '未分類'
}

/** 依 blob 的實際 MIME 決定副檔名；認不出來才退回原始檔名，最後才是 .jpg */
function extFor(blob: Blob, name: string): string {
  const t = (blob.type ?? '').toLowerCase()
  if (t.includes('webp')) return 'webp'
  if (t.includes('png')) return 'png'
  if (t.includes('gif')) return 'gif'
  if (t.includes('heic')) return 'heic'
  if (t.includes('heif')) return 'heif'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name ?? '')?.[1]
  return fromName ? fromName.toLowerCase() : 'jpg'
}

/** 圖檔基準名：`2026-10-07_餐飲_85.00` */
function imageBaseName(r: TxRecord, catName: string): string {
  const d = new Date(r.occurredAt)
  const date = isNaN(d.getTime())
    ? '0000-00-00'
    : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  return `${date}_${safePart(catName, 24)}_${r.amount.toFixed(2)}`
}

/* ── 主流程 ─────────────────────────────────────────────── */

/** 累計大小上限（保守值）：超過就請使用者改用日期區間分批匯出，免得到最後把記憶體吃光 */
const MAX_TOTAL_BYTES = 1_500 * 1024 * 1024

/**
 * 依錢包分組匯出成一包 ZIP。
 *
 * @param input.groups  要匯出的錢包（單一錢包時就一個元素）
 * @param input.fileNamePart 檔名要帶的錢包名（單一錢包時傳錢包名；全部錢包時不傳→用 `ledger`）
 */
export async function buildExcelExport(input: {
  groups: ExcelWalletGroup[]
  /** ZIP 檔名的主體（不含日期時間與副檔名）；預設 `ledger` */
  zipName?: string
  onProgress?: (p: ExportProgress) => void
}): Promise<ExcelExportResult> {
  const { groups, onProgress } = input

  // 每個錢包各自由舊到新排（Excel 是「一本帳」的報表，不合併排序）
  const normalized = groups.map((g) => ({
    ...g,
    name: safePart(g.name, 20) || '錢包',
    list: sortByTime(g.records),
  }))

  const allRecords = normalized.flatMap((g) => g.list)
  const multi = normalized.length > 1
  /** 每個檔名前綴都要唯一，否則 ZIP 裡會撞名（後面的會蓋掉前面的） */
  const prefixUsed = new Set<string>()

  /* ── 1. 讀出所有圖片實體（同一張只讀一次；跨錢包共用） ── */
  const idsInOrder: string[] = []
  const seenId = new Set<string>()
  for (const r of allRecords) {
    for (const im of r.images ?? []) {
      if (seenId.has(im.id)) continue
      seenId.add(im.id)
      idsInOrder.push(im.id)
    }
  }

  const blobs = new Map<string, Blob>()
  let missing = 0
  let totalBytes = 0
  for (let i = 0; i < idsInOrder.length; i++) {
    onProgress?.({ phase: 'read', done: i, total: idsInOrder.length })
    const blob = await getImage(idsInOrder[i])
    if (!blob) {
      missing++
      continue
    }
    if (totalBytes + blob.size > MAX_TOTAL_BYTES) {
      throw new Error('圖片總容量過大，請改用日期區間分批匯出')
    }
    totalBytes += blob.size
    blobs.set(idsInOrder[i], blob)
  }
  onProgress?.({ phase: 'read', done: idsInOrder.length, total: idsInOrder.length })

  /* ── 2. 決定每一張圖的檔名（讀得到實體才知道真正的副檔名） ── */
  const used = new Set<string>()
  /** imageId → ZIP 內路徑（跨錢包共用同一張圖時只寫一份） */
  const pathByImage = new Map<string, string>()
  /** walletId → （imageId → ZIP 內路徑）；每個錢包的表格只看自己那份的前綴 */
  const pathsByWallet = new Map<string, Map<string, string>>()

  for (const g of normalized) {
    const mine = new Map<string, string>()
    pathsByWallet.set(g.walletId, mine)

    for (const r of g.list) {
      const catName = g.pathNamesOf(r.categoryId)[0] ?? '未分類'
      const base = imageBaseName(r, catName)
      ;(r.images ?? []).forEach((im: ImageRef, i) => {
        const blob = blobs.get(im.id)
        if (!blob) return // 實體已經不在了 → 這一列也不該指到它
        const known = pathByImage.get(im.id)
        if (known) {
          mine.set(im.id, known)
          return
        }
        const ext = extFor(blob, im.name)
        let n = i + 1
        let name = `images/${g.name}_${base}_${n}.${ext}`
        // 撞名就往後遞號（涵蓋「同一天同分類同金額」與「同一張圖被兩筆用到」）
        while (used.has(name.toLowerCase())) name = `images/${g.name}_${base}_${++n}.${ext}`
        used.add(name.toLowerCase())
        pathByImage.set(im.id, name)
        mine.set(im.id, name)
      })
    }
  }

  /* ── 3. 每個錢包各組一份工作表 ── */
  const now = new Date()
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`

  const xlsxEntries: ZipEntry[] = []
  for (const g of normalized) {
    const columns = buildColumns(g.list, g.baseCurrency)
    const mine = pathsByWallet.get(g.walletId) ?? new Map<string, string>()
    const rows = g.list.map((r) => rowOf(r, g.pathNamesOf, mine, columns.hasBaseColumn))
    const bytes = await buildXlsx([{ name: '記錄', columns: columns.list, rows }])

    // 檔名：單一錢包沿用舊行為（ledger-…），多錢包改成帶錢包名，免得互相蓋掉
    let fileBase = multi ? `${g.name}-${stamp}` : `ledger-${stamp}`
    if (prefixUsed.has(fileBase.toLowerCase())) {
      let k = 2
      while (prefixUsed.has(`${fileBase}-${k}`.toLowerCase())) k++
      fileBase = `${fileBase}-${k}`
    }
    prefixUsed.add(fileBase.toLowerCase())
    xlsxEntries.push({ name: `${fileBase}.xlsx`, data: bytes, compress: false })
  }

  /* ── 4. 打包 ── */
  const imageEntries: ZipEntry[] = []
  for (const [id, path] of pathByImage) {
    const blob = blobs.get(id)
    if (!blob) continue
    imageEntries.push({
      name: path,
      data: new Uint8Array(await blob.arrayBuffer()),
      compress: false, // WebP／JPEG 本身就壓縮過了，再 deflate 只是白花時間
    })
  }

  if (imageEntries.length + xlsxEntries.length > ZIP_LIMITS.maxEntries) {
    throw new Error(
      `圖片太多（${imageEntries.length} 張），ZIP 格式上限為 ${ZIP_LIMITS.maxEntries} 個檔案`,
    )
  }

  const zipBase = input.zipName ?? 'ledger'
  const fileName = `${safePart(zipBase, 24) || 'ledger'}-${stamp}.zip`

  const zipBytes = await buildZip([...xlsxEntries, ...imageEntries], (done, total) =>
    onProgress?.({ phase: 'pack', done, total }),
  )

  return {
    blob: new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' }),
    fileName,
    recordCount: allRecords.length,
    imageCount: imageEntries.length,
    missingImages: missing,
    fileCount: xlsxEntries.length,
  }
}

/** 由舊到新；同時發生的用 createdAt、id 當次要鍵，順序才會穩定 */
function sortByTime(records: TxRecord[]): TxRecord[] {
  return [...records].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}

/** 欄位定義。「主幣別」那欄只有整份記錄的主幣別不只一種時才多出來 */
function buildColumns(
  list: TxRecord[],
  baseCurrency: string,
): { list: XlsxColumn[]; hasBaseColumn: boolean } {
  const baseSet = new Set(list.map((r) => r.baseCurrency))
  const mixedBase = baseSet.size > 1
  const onlyBase = mixedBase ? '' : [...baseSet][0] || baseCurrency

  const list_ = [
    { label: '日期時間', width: 18, kind: 'date' },
    { label: '收支', width: 6, kind: 'int' },
    { label: '分類', width: 12, kind: 'text' },
    { label: '子分類', width: 16, kind: 'text' },
    { label: '幣別', width: 7, kind: 'int' },
    { label: '金額', width: 12, kind: 'money' },
    { label: '匯率', width: 10, kind: 'rate' },
    // 只有主幣別不只一種時才多這一欄；否則它會是整欄一樣的值，放進標題就夠了
    ...(mixedBase ? [{ label: '主幣別', width: 8, kind: 'int' } as XlsxColumn] : []),
    { label: onlyBase ? `主幣金額 (${onlyBase})` : '主幣金額', width: 14, kind: 'money' },
    { label: '備註', width: 28, kind: 'wrap' },
    { label: '算式', width: 16, kind: 'text' },
    { label: '圖片檔名（ZIP 內）', width: 34, kind: 'wrap' },
    { label: '圖片張數', width: 9, kind: 'int' },
  ] as XlsxColumn[]
  return { list: list_, hasBaseColumn: mixedBase }
}

function rowOf(
  r: TxRecord,
  pathNamesOf: (id: string) => string[],
  pathByImage: Map<string, string>,
  mixedBase: boolean,
): (string | number | Date | null)[] {
  const path = pathNamesOf(r.categoryId)
  const paths = (r.images ?? []).map((im) => pathByImage.get(im.id)).filter((x): x is string => !!x)
  const d = new Date(r.occurredAt)
  return [
    isNaN(d.getTime()) ? formatFull(r.occurredAt) : d,
    r.type === 'expense' ? '支出' : '收入',
    path[0] ?? PICK_FALLBACK,
    path.slice(1).join(' › '),
    r.currency,
    r.amount,
    r.rate,
    ...(mixedBase ? [r.baseCurrency] : []),
    r.baseAmount,
    r.note ?? '',
    r.expr ? displayExpr(r.expr) : '',
    paths.join('\n'),
    paths.length,
  ]
}

/** 觸發瀏覽器下載（與 JSON 匯出走同一條路） */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
