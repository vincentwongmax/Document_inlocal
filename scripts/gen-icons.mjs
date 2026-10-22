/**
 * 產生 PWA 圖示（純 Node，無外部依賴）。
 *
 * 0.1.78（需求 3）：改成**三款**——使用者原話：
 *   「建立多兩種不同的 app ICON（共3款，新兩個，舊1个）…在設定頁中增加一個欄塊，
 *     可以給用戶選擇不同的 app icon（預設是舊 icon）」
 * 風格（0.1.78 釐清時使用者選的）：**鮮明對比**——大色塊、高飽和、粗造形。
 *
 *   - classic（舊／預設）：墨底收據 → `public/icons/icon-*.png`（原地不動）
 *   - ink（墨夜）：近黑底 + 奶油圓 + 深色三槓統計圖 + 橘色 accent 點
 *     → `public/icons/ink/icon-*.png`
 *   - blaze（烈橘）：鮮橘底 + 粗造形奶油上箭頭（成長／結餘向上）
 *     → `public/icons/blaze/icon-*.png`
 *
 * 每款三張：192（apple-touch-icon 用）、512、512-maskable（滿版＋安全區內縮）。
 * ⚠ maskable 版**不畫圓角**（系統會自己套遮罩），一般版圓角照舊 0.22。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/icons')

/* ── CRC32 ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4)
    raw[off] = 0
    rgba.copy(raw, off + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
  255,
]

const INK = hex('#1b1a18')
const PAPER = hex('#f6f5f2')
const MUTE = hex('#b9b3a7')
const ACCENT = hex('#2c6e5b')
/* 0.1.78 兩款新色 */
const NIGHT = hex('#1b1e26') // ink：近黑藍墨
const CREAM = hex('#f7f1e2') // ink／blaze 共用的奶油色
const EMBER = hex('#ff7a1f') // ink 的橘色 accent 點
const BLAZE = hex('#ee5a12') // blaze：鮮橘底

/** 畫布＋基本筆觸（三款共用） */
function canvas(size) {
  const buf = Buffer.alloc(size * size * 4)
  const put = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(buf[i + k] * (1 - a) + c[k] * a)
    buf[i + 3] = 255
  }
  const rect = (x0, y0, w, h, c, a = 1) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(x, y, c, a)
  }
  const rrect = (x0, y0, w, h, r, c) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
        const dx = Math.min(x - x0, x0 + w - 1 - x)
        const dy = Math.min(y - y0, y0 + h - 1 - y)
        if (dx < 0 || dy < 0) continue
        if (dx >= r || dy >= r) {
          put(x, y, c)
          continue
        }
        const d = Math.hypot(r - dx, r - dy)
        if (d <= r) put(x, y, c)
        else if (d <= r + 1) put(x, y, c, r + 1 - d)
      }
    }
  }
  /** 實心圓（邊緣一格抗鋸齒） */
  const disc = (cx, cy, r, c, a = 1) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d <= r) put(x, y, c, a)
        else if (d <= r + 1) put(x, y, c, a * (r + 1 - d))
      }
    }
  }
  /** 有粗細的線段（blaze 的箭頭用） */
  const seg = (x0, y0, x1, y1, w, c) => {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    for (let y = Math.floor(Math.min(y0, y1) - w - 1); y <= Math.ceil(Math.max(y0, y1) + w + 1); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - w - 1); x <= Math.ceil(Math.max(x0, x1) + w + 1); x++) {
        const t = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0
        const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
        if (d <= w) put(x, y, c)
        else if (d <= w + 1) put(x, y, c, w + 1 - d)
      }
    }
  }
  /** 滿版底（maskable）／圓角底（一般） */
  const base = (c, maskable) => {
    if (maskable) rect(0, 0, size, size, c)
    else rrect(0, 0, size, size, size * 0.22, c)
  }
  return { buf, put, rect, rrect, disc, seg, base }
}

/** classic（0.1.77 之前的舊圖示，行為完全不變） */
function drawClassic(size, { maskable }) {
  const { buf, rect, rrect, base } = canvas(size)
  base(INK, maskable)

  // 收據卡
  const pad = size * (maskable ? 0.26 : 0.2)
  const cw = size - pad * 2
  const ch = cw * 1.34
  const cx = pad
  const cy = (size - ch) / 2
  rrect(cx, cy, cw, ch, size * 0.05, PAPER)

  // 三條文字線 + 一條強調色
  const lx = cx + cw * 0.18
  const lw = cw * 0.64
  const unit = ch * 0.055
  let ly = cy + ch * 0.18
  rect(lx, ly, lw, unit, MUTE)
  ly += unit * 3
  rect(lx, ly, lw * 0.72, unit, MUTE)
  ly += unit * 3
  rect(lx, ly, lw * 0.55, unit, MUTE)
  ly += unit * 3
  rect(lx, ly, lw, unit * 1.9, ACCENT)

  return encodePNG(size, size, buf)
}

/**
 * ink（墨夜）：近黑藍墨底 + 奶油圓（硬幣）＋ 圓裡三根深色槓（統計）＋ 橘色 accent 點。
 * 粗造形、高對比——小尺寸（主畫面 60px）也認得出來。
 */
function drawInk(size, { maskable }) {
  const { buf, disc, rect, base } = canvas(size)
  base(NIGHT, maskable)

  // 畫面縮放：maskable 要縮進安全區（系統會套圓形遮罩）
  const s = size * (maskable ? 0.62 : 0.74)
  const ox = (size - s) / 2
  const oy = (size - s) / 2
  const cx = ox + s * 0.5
  const cy = oy + s * 0.52

  // 奶油硬幣
  disc(cx, cy, s * 0.33, CREAM)
  // 圓裡三根深色槓（由左到右長高，像個迷你統計圖）
  const bw = s * 0.052
  const gap = s * 0.075
  const totalW = bw * 3 + gap * 2
  let bx = cx - totalW / 2
  const baseY = cy + s * 0.15
  for (const h of [s * 0.15, s * 0.23, s * 0.31]) {
    rect(bx, baseY - h, bw, h, NIGHT)
    bx += bw + gap
  }
  // 右上角橘色 accent 點（通知／結餘的那一點）
  disc(cx + s * 0.3, cy - s * 0.3, s * 0.072, EMBER)

  return encodePNG(size, size, buf)
}

/** blaze（烈橘）：鮮橘底 + 粗造形奶油上箭頭（結餘向上）。 */
function drawBlaze(size, { maskable }) {
  const { buf, seg, rect, base } = canvas(size)
  base(BLAZE, maskable)

  const s = size * (maskable ? 0.62 : 0.74)
  const ox = (size - s) / 2
  const oy = (size - s) / 2
  const cx = ox + s * 0.5
  const top = oy + s * 0.22
  const bot = oy + s * 0.82
  const w = s * 0.082

  // 箭桿
  rect(cx - s * 0.075, top + s * 0.1, s * 0.15, bot - top - s * 0.1, CREAM)
  // 箭頭（兩段斜線構成 V）
  seg(cx - s * 0.3, top + s * 0.34, cx, top, w, CREAM)
  seg(cx + s * 0.3, top + s * 0.34, cx, top, w, CREAM)

  return encodePNG(size, size, buf)
}

const STYLES = [
  { name: 'classic', dir: OUT, draw: drawClassic },
  { name: 'ink', dir: resolve(OUT, 'ink'), draw: drawInk },
  { name: 'blaze', dir: resolve(OUT, 'blaze'), draw: drawBlaze },
]

for (const st of STYLES) {
  await mkdir(st.dir, { recursive: true })
  await writeFile(resolve(st.dir, 'icon-192.png'), st.draw(192, { maskable: false }))
  await writeFile(resolve(st.dir, 'icon-512.png'), st.draw(512, { maskable: false }))
  await writeFile(resolve(st.dir, 'icon-512-maskable.png'), st.draw(512, { maskable: true }))
}
console.log('✓ 三款圖示已產生於 public/icons/（classic／ink／blaze）')
