/**
 * 最小 ZIP 產生器（零依賴）。
 *
 * 為什麼自己寫：這個 App 是離線 PWA，能不加套件就不加。ZIP 對「寫入」來說
 * 其實很單純——每個檔案一段 local header、最後接一段 central directory 與 EOCD；
 * 用不到的（ZIP64、加密、多磁碟、data descriptor）一律不實作。
 *
 * 壓縮方式：
 *   - 文字（xlsx 內含的 XML）預設用 DEFLATE（走瀏覽器內建的 `CompressionStream('deflate-raw')`，
 *     Chrome 103+ / Safari 16.4+ / Firefox 113+）。不支援就自動退回 STORE，功能不受影響。
 *   - 圖片一律 STORE：WebP／JPEG 本身已經壓縮過，再 deflate 幾乎不會變小，只是白花時間。
 *
 * ⚠ 只有一個實質限制：ZIP 的經典格式用 32 位元存大小與位移，
 *   單檔或總大小超過 4 GiB、或檔案數超過 65535 個就必須用 ZIP64（這裡沒做）。
 *   呼叫端要先擋（見 exportExcel.ts 的 sizeGuard）。
 */

/** ZIP 檔名用 UTF-8（設 bit 11 = EFS），中文分類名才不會變亂碼 */
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** 沒有壓縮結果時（不支援 CompressionStream）傳 null，呼叫端會改用 STORE */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (typeof CS !== 'function') return null
  try {
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    const buf = await new Response(stream).arrayBuffer()
    const out = new Uint8Array(buf)
    // 幾乎沒變小就別用（例如內容本來就很隨機），省下解壓的麻煩
    return out.length < data.length ? out : null
  } catch {
    return null
  }
}

export interface ZipEntry {
  /** 在 ZIP 裡的路徑，用 `/` 分隔（例如 `images/a.jpg`） */
  name: string
  data: Uint8Array
  /** 這個項目要不要嘗試 DEFLATE（圖片請給 false） */
  compress?: boolean
  /** 檔案時間（只影響 ZIP 內的 DOS 時間戳，預設現在） */
  date?: Date
}

/** JS 的 Date → DOS 時間／日期（ZIP 用的老格式，秒只有 2 秒精度） */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** CRC-32（IEEE 802.3，ZIP 用的那個）；表只在第一次用到時算 */
let crcTable: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[i] = c >>> 0
    }
  }
  const table = crcTable
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 小工具：依序把數字寫進 byte 陣列（ZIP 一律 little-endian） */
class ByteWriter {
  private parts: Uint8Array[] = []
  private len = 0
  private buf = new Uint8Array(1 << 16)
  private pos = 0

  private flush() {
    if (!this.pos) return
    this.parts.push(this.buf.slice(0, this.pos))
    this.len += this.pos
    this.pos = 0
  }
  u8(v: number) {
    if (this.pos === this.buf.length) this.flush()
    this.buf[this.pos++] = v & 0xff
    return this
  }
  u16(v: number) {
    return this.u8(v).u8(v >>> 8)
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff)
  }
  bytes(b: Uint8Array) {
    // 大塊資料（圖片）直接進 parts，不逐 byte 複製
    if (b.length >= this.buf.length) {
      this.flush()
      this.parts.push(b)
      this.len += b.length
      return this
    }
    for (let i = 0; i < b.length; i++) this.u8(b[i])
    return this
  }
  /** 目前寫入的總長度（＝等一下 local header 的位移） */
  get length() {
    return this.len + this.pos
  }
  finish(): Uint8Array {
    this.flush()
    const out = new Uint8Array(this.len)
    let off = 0
    for (const p of this.parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }
}

const encoder = new TextEncoder()

export interface ZipLimits {
  maxEntries: number
  maxBytes: number
}

/** ZIP 的經典格式上限（超了就得 ZIP64，這裡不做） */
export const ZIP_LIMITS: ZipLimits = { maxEntries: 65535, maxBytes: 0xffffffff }

/**
 * 打包成 ZIP。
 *
 * @param entries    要放進去的檔案（順序就是 ZIP 裡的順序）
 * @param onProgress 每處理完一個項目回呼一次（UI 顯示進度用）
 */
export async function buildZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  if (entries.length > ZIP_LIMITS.maxEntries) {
    throw new Error(`檔案數 ${entries.length} 超過 ZIP 上限（${ZIP_LIMITS.maxEntries}）`)
  }

  // 先決定每個項目用什麼方式壓縮，才知道中央目錄要寫的大小
  const prepared: { nameBytes: Uint8Array; data: Uint8Array; method: number; crc: number; size: number; time: number; date: number; offset: number }[] = []
  const w = new ByteWriter()

  for (const e of entries) {
    const raw = e.data
    let method = METHOD_STORE
    let payload = raw
    if (e.compress) {
      const packed = await deflateRaw(raw)
      if (packed) {
        method = METHOD_DEFLATE
        payload = packed
      }
    }
    const { time, date } = dosDateTime(e.date ?? new Date())
    const nameBytes = encoder.encode(e.name)
    if (nameBytes.length > 0xffff) throw new Error(`檔名太長：${e.name}`)

    const offset = w.length
    const crc = crc32(raw)

    // ── local file header ──
    w.u32(0x04034b50)
      .u16(20) // version needed
      .u16(FLAG_UTF8)
      .u16(method)
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(payload.length)
      .u32(raw.length)
      .u16(nameBytes.length)
      .u16(0) // extra
      .bytes(nameBytes)
      .bytes(payload)

    prepared.push({ nameBytes, data: payload, method, crc, size: raw.length, time, date, offset })
    onProgress?.(prepared.length, entries.length)
  }

  // ── central directory ──
  const cdStart = w.length
  for (const p of prepared) {
    w.u32(0x02014b50)
      .u16(20) // version made by
      .u16(20) // version needed
      .u16(FLAG_UTF8)
      .u16(p.method)
      .u16(p.time)
      .u16(p.date)
      .u32(p.crc)
      .u32(p.data.length)
      .u32(p.size)
      .u16(p.nameBytes.length)
      .u16(0) // extra
      .u16(0) // comment
      .u16(0) // disk
      .u16(0) // internal attrs
      .u32(0) // external attrs
      .u32(p.offset)
      .bytes(p.nameBytes)
  }
  const cdSize = w.length - cdStart

  // ── end of central directory ──
  w.u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(prepared.length)
    .u16(prepared.length)
    .u32(cdSize)
    .u32(cdStart)
    .u16(0)

  const out = w.finish()
  if (out.length > ZIP_LIMITS.maxBytes) {
    throw new Error('匯出檔超過 4 GB，ZIP 格式需要 ZIP64（請改用日期區間分批匯出）')
  }
  return out
}
