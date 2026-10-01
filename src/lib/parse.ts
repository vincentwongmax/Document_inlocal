import type { AmountCandidate } from '@/types'

/* ── 幣別標記（順序 = 優先度，長的先配對） ───────────────── */
const MARKERS: Array<{ re: RegExp; code: string }> = [
  { re: /mop\s*\$?/i, code: 'MOP' },
  { re: /澳門幣|澳门币|葡幣|葡币|澳門元|澳门元/i, code: 'MOP' },
  { re: /hk\s*\$|hkd/i, code: 'HKD' },
  { re: /港幣|港币|港元/i, code: 'HKD' },
  { re: /nt\s*\$|ntd|twd/i, code: 'TWD' },
  { re: /台幣|台币|新台幣|新台币/i, code: 'TWD' },
  { re: /us\s*\$|usd/i, code: 'USD' },
  { re: /美元|美金/i, code: 'USD' },
  { re: /jp\s*¥|jpy/i, code: 'JPY' },
  { re: /日圓|日元|日币|円/i, code: 'JPY' },
  { re: /rmb|cny/i, code: 'CNY' },
  { re: /人民幣|人民币/i, code: 'CNY' },
  { re: /rm|myr/i, code: 'MYR' },
  { re: /s\s*\$|sgd/i, code: 'SGD' },
  { re: /€|eur/i, code: 'EUR' },
  { re: /£|gbp/i, code: 'GBP' },
  { re: /฿|thb/i, code: 'THB' },
  { re: /₩|krw/i, code: 'KRW' },
  { re: /¥|￥/i, code: 'CNY' },
  { re: /元|圓|块|塊/i, code: 'CNY' },
  { re: /\$/, code: 'USD' },
]

/** 金額數字 */
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\d+`

/** 疑似數字但被 OCR 認錯的字母，做保守還原 */
function fixDigits(tok: string): string {
  if (!/^\d[\dOoDlIiSsB,.]{0,15}\d$/.test(tok)) return tok
  return tok
    .replace(/[OoD]/g, '0')
    .replace(/[lIi]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
}

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '')
  const n = Number(cleaned)
  if (!isFinite(n) || n <= 0) return null
  return Number(n.toFixed(2))
}

/** 命中「總計/合計」類關鍵字 => 高優先度 */
const TOTAL_RE =
  /總計|合計|總額|合共|共計|應付|實付|付款|支付|金額|消費|小計|結帳|結算|total|amount|grand|due|paid|payable|subtotal|balance/i
/** 應該排除（不是消費金額） */
const SKIP_RE = /找零|change|折扣|discount|稅|tax|單號|發票號|invoice\s*no|tel|電話|會員|積分|點數/i

function currencyNear(text: string, index: number): string | null {
  // 往前看 8 個字元
  const before = text.slice(Math.max(0, index - 8), index)
  // 往後看 8 個字元
  const after = text.slice(index, index + 8)
  for (const m of MARKERS) {
    if (m.re.test(before)) return m.code
    if (m.re.test(after)) return m.code
  }
  return null
}

/** 從 OCR 文字抽出金額候選 */
export function extractAmounts(text: string): AmountCandidate[] {
  const lines = text.split(/\r?\n/)
  const out: AmountCandidate[] = []
  const seen = new Set<string>()

  lines.forEach((line) => {
    const raw = line.trim()
    if (!raw) return
    if (SKIP_RE.test(raw) && !TOTAL_RE.test(raw)) return

    const isTotal = TOTAL_RE.test(raw)
    const re = new RegExp(NUM, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(raw))) {
      const fixed = fixDigits(m[0])
      const value = toNumber(fixed)
      if (value === null) continue
      // 排除看起來像日期、電話、編號的長數字
      if (fixed.replace(/[,.]/g, '').length > 10) continue
      const cur = currencyNear(raw, m.index) ?? 'UNKNOWN'
      const key = `${cur}|${value}|${m.index}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ value, currency: cur, line: raw, isTotal })
    }
  })

  return sortCandidates(out)
}

/** 排序：總計關鍵字 > 數值大者，但同幣別只留前幾個 */
export function sortCandidates(list: AmountCandidate[]): AmountCandidate[] {
  return [...list].sort((a, b) => {
    if (a.isTotal !== b.isTotal) return a.isTotal ? -1 : 1
    return b.value - a.value
  })
}

/** 取出現過的幣別（去掉 UNKNOWN） */
export function currenciesOf(list: AmountCandidate[]): string[] {
  const s = new Set<string>()
  for (const c of list) if (c.currency !== 'UNKNOWN') s.add(c.currency)
  return [...s]
}

/* ── 日期 ────────────────────────────────────────────────── */

function build(y: number, mo: number, d: number, h = 12, mi = 0, s = 0): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d, h, mi, s)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString()
}

/** 從 OCR 文字抽出日期候選（ISO），最多回傳 3 個 */
export function extractDates(text: string): string[] {
  const now = new Date()
  const found: string[] = []
  const push = (iso: string | null) => {
    if (iso && !found.includes(iso)) found.push(iso)
  }

  const full = new RegExp(
    String.raw`(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT]*(?:上午|下午)?\s*(\d{1,2})[:時](\d{2})(?:[:分](\d{2}))?)?`,
    'g',
  )
  let m: RegExpExecArray | null
  while ((m = full.exec(text))) {
    push(build(+m[1], +m[2], +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0))
  }

  const compact = /(20\d{2})\s*(\d{2})\s*(\d{2})(?![\d])/g
  while ((m = compact.exec(text))) {
    push(build(+m[1], +m[2], +m[3]))
  }

  const short = /(?:^|[^\d:])(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?![\d:])/g
  while ((m = short.exec(text))) {
    const mo = +m[1]
    const d = +m[2]
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) push(build(now.getFullYear(), mo, d))
  }

  return found.slice(0, 3)
}
