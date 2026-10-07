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

/* ── 日期欄的「顯示文字 ↔ 值」──────────────────────────────
 * 日期欄是普通的文字框（見 components/DateTimeField.vue），所以需要
 * ① 把值變成人看得懂的文字  ② 把使用者打的字變回值。
 * 兩件事都放在這裡，App 其他地方（例如未來要顯示同格式）可以共用。 */

/** 值（`YYYY-MM-DDTHH:mm`）→ 顯示文字（`YYYY/MM/DD HH:mm`，同 formatFull 的寫法） */
export function toDisplayInput(v: string): string {
  return (v ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})T/, '$1/$2/$3 ')
}

/** 全形 → 半形（只有數字與幾個常見標點，其他的原樣留著） */
const FULLWIDTH: Record<string, string> = {
  '０': '0',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '５': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9',
  '／': '/',
  '．': '.',
  '－': '-',
  '：': ':',
  '　': ' ',
}

/** 整理成半形、以空白分隔的統一寫法（順便收下中文寫法：年／月／日、時／點、分） */
function normalizeDateTimeText(text: string): string {
  return (text ?? '')
    .replace(/[０-９／．－：　]/g, (c) => FULLWIDTH[c] ?? c)
    .replace(/年|月/g, '/')
    .replace(/[日號]/g, ' ')
    .replace(/[時时點点]/g, ':')
    .replace(/分/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 值拆成各欄位；壞掉／空的就以「現在」代替 */
function parseLocalInput(v: string) {
  const m = (v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], hh: +m[4], mm: +m[5] }
  const now = new Date()
  return {
    y: now.getFullYear(),
    mo: now.getMonth() + 1,
    d: now.getDate(),
    hh: now.getHours(),
    mm: now.getMinutes(),
  }
}

/**
 * 寬鬆解析使用者打的日期時間 → `YYYY-MM-DDTHH:mm`；看不懂回 `null`。
 *
 * 為什麼需要：日期欄現在是普通文字框，使用者可以自由打字，打出來的樣子千百種。
 * 這裡「盡量看懂」，真的看不懂就回 null —— 呼叫端會把欄位還原成原值，
 * 所以欄位裡永遠不會留下一個解析不了的日期。
 *
 * 看懂的寫法（年/月/日之間 `/`、`-`、`.`、空白都收，全形數字也收）：
 *   2026/10/07 20:53   2026-10-07 20:53   2026.10.7 20:53   2026年10月7日 20:53
 *   20261007 2053      10/7 20:53         20:53
 * 沒打到的部分用 `fallback`（＝欄位原本的值）補齊：
 *   `2026/10/07` 只改日期（時分沿用原本的）、`20:53` 只改時間（年月日沿用原本的）。
 *
 * @param text     使用者打的字
 * @param fallback 欄位原本的值（`YYYY-MM-DDTHH:mm`）
 */
export function parseLooseDateTime(text: string, fallback: string): string | null {
  const s = normalizeDateTimeText(text)
  if (!s) return null

  const fb = parseLocalInput(fallback)
  let y: number | null = null
  let mo: number | null = null
  let d: number | null = null
  let hh: number | null = null
  let mi: number | null = null

  // 1) 時間：HH:mm（打了秒也當沒看到，欄位只需要到分）
  let rest = s
  const tm = s.match(/(\d{1,2}):(\d{1,2})/)
  if (tm) {
    hh = Number(tm[1])
    mi = Number(tm[2])
    rest = `${s.slice(0, tm.index)} ${s.slice((tm.index ?? 0) + tm[0].length)}`
  }

  // 2) 日期：把剩下的數字全抓出來
  let nums = (rest.match(/\d+/g) ?? []).map(Number)
  // 8 位連寫（20261007）會被當成一個數字 → 拆成年月日
  if (nums.length === 1 && String(nums[0]).length === 8) {
    const v = String(nums[0])
    nums = [Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8))]
  } else if (!tm && nums.length === 5) {
    // 沒有冒號卻有五段（2026 10 07 20 53）→ 當成「年月日時分」
    ;[y, mo, d, hh, mi] = nums
    nums = []
  }

  if (nums.length >= 3) [y, mo, d] = nums
  else if (nums.length === 2) [mo, d] = nums
  else if (nums.length === 1) return null // 只打一個數字 → 不敢猜是哪個欄位

  // 3) 沒打到的部分沿用原值
  //    （只打日期 → 時分沿用原本的；只打時間 → 年月日沿用原本的）
  const Y = y ?? fb.y
  const MO = mo ?? fb.mo
  const D = d ?? fb.d
  const HH = hh ?? fb.hh
  const MI = mi ?? fb.mm

  // 4) 範圍檢查（含「2/30」這種不存在的日期）
  if (Y < 1970 || Y > 2999 || MO < 1 || MO > 12 || D < 1 || D > 31) return null
  if (HH < 0 || HH > 23 || MI < 0 || MI > 59) return null
  const probe = new Date(Y, MO - 1, D)
  if (probe.getFullYear() !== Y || probe.getMonth() !== MO - 1 || probe.getDate() !== D) return null

  return `${Y}-${p(MO)}-${p(D)}T${p(HH)}:${p(MI)}`
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

/** 日曆小卡用：日數 / 月份 / 今天|昨天|週X */
export function dayParts(iso: string): { num: string; mon: string; tag: string } {
  const d = new Date(iso)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  const today = new Date()
  const diff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  )
  const tag = diff === 0 ? '今天' : diff === 1 ? '昨天' : `週${week}`
  return { num: String(d.getDate()), mon: `${d.getMonth() + 1}月`, tag }
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 相對時間：剛剛 / N 分鐘前 / N 小時前 / N 天前；超過 30 天顯示日期、未來顯示時刻 */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const diff = now - t
  if (diff < 0) return formatTime(iso)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  if (day <= 30) return `${day} 天前`
  const d = new Date(iso)
  const nowY = new Date(now).getFullYear()
  return `${d.getFullYear() !== nowY ? `${d.getFullYear()}/` : ''}${d.getMonth() + 1}/${d.getDate()}`
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
