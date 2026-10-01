/**
 * 產生 PWA 圖示（純 Node，無外部依賴）
 * 輸出 public/icons/icon-192.png、icon-512.png、icon-512-maskable.png
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

function draw(size, { maskable }) {
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

  // 底：遮罩版滿版，一般版圓角
  if (maskable) rect(0, 0, size, size, INK)
  else rrect(0, 0, size, size, size * 0.22, INK)

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

await mkdir(OUT, { recursive: true })
await writeFile(resolve(OUT, 'icon-192.png'), draw(192, { maskable: false }))
await writeFile(resolve(OUT, 'icon-512.png'), draw(512, { maskable: false }))
await writeFile(resolve(OUT, 'icon-512-maskable.png'), draw(512, { maskable: true }))
console.log('✓ 圖示已產生於 public/icons/')
