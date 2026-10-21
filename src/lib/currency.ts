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

/*
 * 0.1.76（需求 3）：**小數位數**（每個錢包各自設定，只影響顯示、不改資料）。
 *
 * 使用者原話：「加入設定給用戶查看多少位數的數字 例:用戶輸入2 即小數點後兩位，
 * 則100.00 , 如果用戶輸入0 , 則 --> 100 , 在所有頁面和模式都生效
 * (但原資料的記錄數據不要改，只改顯示方式) , 在每個錢包都是獨立設定的」。
 *
 * ⚠ 為什麼放 module 級而不是每個 call site 傳：fmtMoney／fmtNum／fmtCompact 的
 *   呼叫點遍布全站（記帳、記錄、統計、匯入、匯出、圖表…），逐一傳參會有一堆
 *   漏網的畫面。這裡給一份「目前生效的位數」，由 settings store 在
 *   ①App 啟動 ②切換錢包 ③使用者改設定 三個時機呼叫 `setMoneyDecimals` 同步。
 *   RouterView 用 `:key="route.path"` 重掛元件 → 換頁時模板會重跑，
 *   所以切到別的值後畫面一定會讀到新的位數。
 */
let moneyDecimals = 2

/** 設定「目前生效的小數位數」（0..4；其他值自動夾回 2） */
export function setMoneyDecimals(n: number): void {
  moneyDecimals = Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2
}

export function fmtMoney(v: number, code = 'MOP', opts?: { decimals?: number }): string {
  const d = opts?.decimals ?? moneyDecimals
  const n = Number.isFinite(v) ? v : 0
  return `${currency(code).symbol}${n.toLocaleString('zh-Hant', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`
}

export function fmtNum(v: number, decimals?: number): string {
  const d = decimals ?? moneyDecimals
  const n = Number.isFinite(v) ? v : 0
  return n.toLocaleString('zh-Hant', { minimumFractionDigits: d, maximumFractionDigits: d })
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
 * - 0.1.76：縮寫後的小數位數**不會超過**使用者設的小數位數（設 0 → 「1K」而不是「1.23K」）。
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
    const d = Math.min(q < 10 ? 2 : q < 100 ? 1 : 0, moneyDecimals)
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
