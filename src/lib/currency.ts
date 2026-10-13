export interface CurrencyDef {
  code: string
  name: string
  symbol: string
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'MOP', name: '澳門幣', symbol: 'MOP$' },
  { code: 'CNY', name: '人民幣', symbol: '¥' },
  { code: 'HKD', name: '港幣', symbol: 'HK$' },
  { code: 'TWD', name: '新台幣', symbol: 'NT$' },
  { code: 'USD', name: '美元', symbol: 'US$' },
  { code: 'JPY', name: '日圓', symbol: 'JP¥' },
  { code: 'EUR', name: '歐元', symbol: '€' },
  { code: 'GBP', name: '英鎊', symbol: '£' },
  { code: 'SGD', name: '新加坡幣', symbol: 'S$' },
  { code: 'THB', name: '泰銖', symbol: '฿' },
  { code: 'KRW', name: '韓元', symbol: '₩' },
  { code: 'MYR', name: '馬來西亞幣', symbol: 'RM' },
]

const MAP = new Map(CURRENCIES.map((c) => [c.code, c]))

export function currency(code: string): CurrencyDef {
  return MAP.get(code) ?? { code, name: code, symbol: code }
}

export function fmtMoney(v: number, code = 'MOP', opts?: { decimals?: number }): string {
  const d = opts?.decimals ?? 2
  const n = Number.isFinite(v) ? v : 0
  return `${currency(code).symbol}${n.toLocaleString('zh-Hant', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`
}

export function fmtNum(v: number, decimals = 2): string {
  const n = Number.isFinite(v) ? v : 0
  return n.toLocaleString('zh-Hant', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** "1.50" → "1.5"、"1.00" → "1"、"12.30" → "12.3"（只去掉小數尾端的 0） */
function trimZeros(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

/**
 * 0.1.54：統計頁摘要卡（分類佔比上方的「支出／收入／結餘」）的 **K／M 縮寫**。
 *
 * 使用者原話：「用 K(千) --> 1000 --> 1K，M(百萬) --> 1,000,000 --> 1M 等等顯示
 * （在主頁，子頁面要詳細）」。
 *
 * - 未滿 1000：維持原本的兩位小數（`fmtNum`）——小額不縮寫，避免「12.35」變成「0.01K」這種
 *   看了更難讀的東西。
 * - ≥1000：`1K`／`1.23K`／`12.3K`／`123K`／`1M`／`1.5M`／`1B`（B＝十億，只是備位）。
 *   小數位數看量級：不到 10 給 2 位、不到 100 給 1 位、百位以上不給（尾端的 0 會去掉）。
 * - 進位後撞到下一個單位時往上跳一階（999,999 → 「1000K」很醜 → 變成 `1M`）。
 * - 負號走 `fmtNum` 同一套（ASCII 的 `-`），結餘為負才會出現。
 * - ⚠ **只影響顯示**：子頁面（SumDetailSheet）與 `title` 一律用 `fmtMoney` 的完整數字。
 */
export function fmtCompact(v: number): string {
  const n = Number.isFinite(v) ? v : 0
  if (Math.abs(n) < 1000) return fmtNum(n)
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  const steps: { scale: number; unit: string }[] = [
    { scale: 1e3, unit: 'K' },
    { scale: 1e6, unit: 'M' },
    { scale: 1e9, unit: 'B' },
  ]
  let i = a >= 1e9 ? 2 : a >= 1e6 ? 1 : 0
  for (; i < steps.length; i += 1) {
    const q = a / steps[i].scale
    const d = q < 10 ? 2 : q < 100 ? 1 : 0
    const s = q.toFixed(d)
    if (Number(s) < 1000 || i === steps.length - 1) return `${sign}${trimZeros(s)}${steps[i].unit}`
  }
  return fmtNum(n)
}

/** 匯率 API 回傳的是「1 主幣 = x 外幣」，換算成「1 外幣 = y 主幣」 */
export function invertRate(r: number): number {
  return r > 0 ? 1 / r : 0
}

/** 預設匯率（對 MOP），離線或 API 失敗時使用 */
export const FALLBACK_RATES_TO_MOP: Record<string, number> = {
  MOP: 1,
  CNY: 1.136,
  HKD: 1.03,
  TWD: 0.25,
  USD: 8.03,
  JPY: 0.054,
  EUR: 8.7,
  GBP: 10.3,
  SGD: 6.0,
  THB: 0.24,
  KRW: 0.0058,
  MYR: 1.8,
}

/** 帶著主幣別換算預設值（若主幣別不是 MOP，用交叉匯率粗算） */
export function defaultRates(base: string): Record<string, number> {
  const baseToMop = FALLBACK_RATES_TO_MOP[base] ?? 1
  const out: Record<string, number> = {}
  for (const c of CURRENCIES) {
    const toMop = FALLBACK_RATES_TO_MOP[c.code] ?? 1
    out[c.code] = Number((toMop / baseToMop).toFixed(6))
  }
  out[base] = 1
  return out
}

export interface RateFetchResult {
  rates: Record<string, number>
  updatedAt: string
  ok: boolean
}

/** 線上更新匯率；失敗時回傳 ok:false，由呼叫端沿用舊匯率 */
export async function fetchRates(base: string): Promise<RateFetchResult> {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`匯率 API HTTP ${res.status}`)
  const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
  if (!json.rates) throw new Error('匯率 API 回應格式異常')
  const rates: Record<string, number> = {}
  for (const c of CURRENCIES) {
    const v = json.rates[c.code]
    if (typeof v === 'number' && v > 0) rates[c.code] = Number(invertRate(v).toFixed(6))
  }
  rates[base] = 1
  if (Object.keys(rates).length < 2) throw new Error('匯率 API 無可用資料')
  return { rates, updatedAt: new Date().toISOString(), ok: true }
}
