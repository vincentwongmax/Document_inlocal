const p = (n: number) => String(n).padStart(2, '0')

export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromLocalInput(v: string): string {
  const d = new Date(v)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/** 本機日期 → YYYY-MM-DD（不走 UTC，避免跨日誤差） */
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : keyOf(d)
}

export function todayKey(): string {
  return keyOf(new Date())
}

/** YYYY-MM-DD 加減天數 */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return key
  return keyOf(new Date(y, m - 1, d + n))
}

/** 該月的第一天與最後一天 */
export function monthRange(key: string): { start: string; end: string } {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return { start: key, end: key }
  return { start: `${key}-01`, end: keyOf(new Date(y, m, 0)) }
}

/** 含首尾的天數 */
export function daysInclusive(start: string, end: string): number {
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = end.split('-').map(Number)
  if (!y1 || !y2) return 1
  const a = new Date(y1, m1 - 1, d1).getTime()
  const b = new Date(y2, m2 - 1, d2).getTime()
  return Math.round((b - a) / 86400000) + 1
}

/** 上一個等長區間（用於「較前期」比較） */
export function previousRange(start: string, end: string): { start: string; end: string } {
  const len = daysInclusive(start, end)
  return { start: addDays(start, -len), end: addDays(start, -1) }
}

/* ── 範圍單位：日 / 月 / 年 ─────────────────────────────── */
export type RangeUnit = 'day' | 'month' | 'year'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** ISO → 單位鍵值（日：YYYY-MM-DD、月：YYYY-MM、年：YYYY） */
export function unitKey(u: RangeUnit, iso: string): string {
  const k = dayKey(iso)
  if (!k) return ''
  if (u === 'day') return k
  if (u === 'month') return k.slice(0, 7)
  return k.slice(0, 4)
}

export function todayUnit(u: RangeUnit): string {
  return unitKey(u, new Date().toISOString())
}

/** 單位鍵值加減 n 個單位 */
export function addUnit(u: RangeUnit, key: string, n: number): string {
  if (u === 'day') return addDays(key, n)
  if (u === 'month') {
    const [y, m] = key.split('-').map(Number)
    if (!y || !m) return key
    const d = new Date(y, m - 1 + n, 1)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}`
  }
  const y = Number(key)
  return isFinite(y) ? String(y + n) : key
}

/** 單位所涵蓋的日期區間（含首尾） */
export function unitRange(u: RangeUnit, key: string): { start: string; end: string } {
  if (u === 'day') return { start: key, end: key }
  if (u === 'month') return monthRange(key)
  return { start: `${key}-01-01`, end: `${key}-12-31` }
}

/** 導覽列顯示用 */
export function unitLabel(u: RangeUnit, key: string): string {
  if (u === 'day') {
    const [y, m, d] = key.split('-').map(Number)
    if (!y || !m || !d) return key
    const w = WEEK[new Date(y, m - 1, d).getDay()]
    const nowY = new Date().getFullYear()
    return `${y !== nowY ? `${y}年` : ''}${m}月${d}日 週${w}`
  }
  if (u === 'month') {
    const [y, m] = key.split('-')
    return `${y}年${Number(m)}月`
  }
  return `${key}年`
}

/** 單位鍵值的短標籤（切換用） */
export function unitShort(u: RangeUnit, key: string): string {
  if (u === 'day') {
    const [, m, d] = key.split('-')
    return `${Number(m)}/${Number(d)}`
  }
  if (u === 'month') {
    const [y, m] = key.split('-')
    const nowY = String(new Date().getFullYear())
    return y === nowY ? `${Number(m)}月` : `${y.slice(2)}/${Number(m)}月`
  }
  return key
}

/** 單一單位，或前一個／目前／下一個（昨天／今天／明天） */
export function unitKeys(u: RangeUnit, key: string, span: 1 | 3): string[] {
  return span === 3 ? [addUnit(u, key, -1), key, addUnit(u, key, 1)] : [key]
}

/** 例：2026/09/01 – 09/30（同年省略年份） */
export function formatRange(start: string, end: string): string {
  const f = (k: string, withYear: boolean) => {
    const [y, m, d] = k.split('-')
    return withYear ? `${y}/${m}/${d}` : `${Number(m)}/${Number(d)}`
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${f(start, true)} – ${f(end, !sameYear)}`
}

export function monthKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`
}

/** 例：10月2日（週五） */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  const today = new Date()
  const diff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  )
  const suffix = diff === 0 ? '今天' : diff === 1 ? '昨天' : `週${week}`
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${suffix}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatFull(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString())
}

/** 最近 n 個月的 monthKey，由舊到新 */
export function recentMonths(n: number, from = new Date()): string[] {
  const out: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${p(m.getMonth() + 1)}`)
  }
  return out
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${y}年${Number(m)}月`
}
