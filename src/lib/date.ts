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

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
