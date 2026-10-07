/**
 * 最小 XLSX 產生器（零依賴，手寫 OOXML）。
 *
 * 為什麼自己寫：npm 上的 `xlsx`(SheetJS) 舊版有已知安全問題、`exceljs` 又接近 1 MB，
 * 而這個 App 是離線 PWA，不該為了「匯出一次」把主包養肥。xlsx 本質上就是一個 ZIP，
 * 裡面放幾份 XML；這裡只需要「一或多張工作表、標題列、幾種數字格式」，
 * 手寫反而最單純、也最好驗（測試會用 Python 的 openpyxl 真的開起來讀）。
 *
 * 產生出來的檔案結構：
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/styles.xml
 *   xl/worksheets/sheetN.xml
 *
 * 刻意省略（Excel／WPS／Numbers／LibreOffice 都不需要）：
 *   docProps/*（檔案內容資訊）、theme、sharedStrings（字串一律用 inlineStr）。
 */

import { buildZip } from './zip'

/** 欄位型別：決定儲存格格式與對齊 */
export type XlsxKind = 'text' | 'wrap' | 'date' | 'money' | 'rate' | 'int'

export interface XlsxColumn {
  label: string
  /** 欄寬（以「字元數」為單位，跟 Excel 的欄寬一致） */
  width: number
  kind: XlsxKind
}

export interface XlsxSheet {
  name: string
  columns: XlsxColumn[]
  /** 每一列的值，順序對應 `columns`；null／undefined 就是空白 */
  rows: (string | number | Date | null | undefined)[][]
}

/* ── 儲存格樣式表 ─────────────────────────────────────────
 * cellXfs 的索引就是儲存格上的 s="" 值，順序不能亂動（下面有常數對應）。
 * numFmtId：0 = 一般、4 = 內建 #,##0.00、164/165 = 自訂（自訂碼一律 >= 164）。 */
const FMT_DATE = 164
const FMT_RATE = 165

const XF = {
  default: 0,
  header: 1,
  date: 2,
  money: 3,
  rate: 4,
  wrap: 5,
  int: 6,
} as const

const KIND_STYLE: Record<XlsxKind, number> = {
  text: XF.default,
  wrap: XF.wrap,
  date: XF.date,
  money: XF.money,
  rate: XF.rate,
  int: XF.int,
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="${FMT_DATE}" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="${FMT_RATE}" formatCode="0.0000"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EFEC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FFBFD6CD"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="${FMT_DATE}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="${FMT_RATE}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/* ── XML 小工具 ───────────────────────────────────────── */

/**
 * 文字轉義。
 * ⚠ XML 1.0 不接受大部分控制字元（0x00–0x08、0x0B、0x0C、0x0E–0x1F），
 *   備註裡只要混到一個，整個檔案就會被 Excel 判定成「檔案損毀」→ 一律清掉。
 */
function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 0 → A、25 → Z、26 → AA…（Excel 的欄名） */
function colName(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * Date → Excel 的日期序號（1899-12-30 為 0，含 1900 年閏年的歷史錯誤）。
 * ⚠ 刻意用「當地時間的年月日時分」再當成 UTC 去算：Excel 的序號沒有時區概念，
 *   直接用 `getTime()`（UTC）算的話，UTC+8 的晚上記錄會被推前一天。
 */
function excelSerial(d: Date): number {
  const asUtc = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  )
  return asUtc / 86400000 + 25569
}

/** 工作表名稱：清掉 Excel 不接受的符號，並截到 31 字 */
function sheetName(name: string, fallback: string): string {
  const s = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31)
  return s || fallback
}

/* ── 工作表 XML ─────────────────────────────────────────── */

function sheetXml(sheet: XlsxSheet, first: boolean): string {
  const rows: string[] = []
  const total = sheet.rows.length + 1 // 含標題列
  const lastCol = colName(Math.max(0, sheet.columns.length - 1))
  const dim = `A1:${lastCol}${total}`

  // 標題列
  const head = sheet.columns
    .map((c, i) => `<c r="${colName(i)}1" s="${XF.header}" t="inlineStr"><is><t xml:space="preserve">${esc(c.label)}</t></is></c>`)
    .join('')
  rows.push(`<row r="1" ht="24" customHeight="1">${head}</row>`)

  sheet.rows.forEach((row, ri) => {
    const r = ri + 2
    const cells: string[] = []
    row.forEach((v, ci) => {
      const col = sheet.columns[ci]
      if (!col) return
      const ref = `${colName(ci)}${r}`
      const s = KIND_STYLE[col.kind]
      if (v === null || v === undefined || v === '') {
        // 空白但仍要帶樣式（例如圖片欄的換行），否則格式會跟隔壁不一樣
        cells.push(`<c r="${ref}" s="${s}"/>`)
        return
      }
      if (v instanceof Date) {
        cells.push(`<c r="${ref}" s="${s}"><v>${excelSerial(v)}</v></c>`)
        return
      }
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) {
          cells.push(`<c r="${ref}" s="${s}"/>`)
          return
        }
        cells.push(`<c r="${ref}" s="${s}"><v>${v}</v></c>`)
        return
      }
      cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)
    })
    // 整列都空白就整列省掉（保留 row 是為了列高；這裡不需要）
    rows.push(`<row r="${r}">${cells.join('')}</row>`)
  })

  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('')

  // 凍結標題列。⚠ `pane` 必須排在 `selection` 前面
  const view = first ? ' tabSelected="1"' : ''
  const pane =
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
<sheetViews><sheetView${view} workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows.join('')}</sheetData>
<autoFilter ref="${dim}"/>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`
}

/* ── 打包 ───────────────────────────────────────────────── */

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s)

/**
 * 產生 .xlsx 的位元組。
 *
 * @param sheets 至少一張工作表
 */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  if (!sheets.length) throw new Error('至少要有一張工作表')

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(sheetName(s.name, `Sheet${i + 1}`))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
<sheets>${sheetTags}</sheets>
</workbook>`

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const entries = [
    { name: '[Content_Types].xml', data: bytes(contentTypes), compress: true },
    { name: '_rels/.rels', data: bytes(rootRels), compress: true },
    { name: 'xl/workbook.xml', data: bytes(workbook), compress: true },
    { name: 'xl/_rels/workbook.xml.rels', data: bytes(wbRels), compress: true },
    { name: 'xl/styles.xml', data: bytes(STYLES_XML), compress: true },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: bytes(sheetXml(s, i === 0)),
      compress: true,
    })),
  ]

  return buildZip(entries)
}
