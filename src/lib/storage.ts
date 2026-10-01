const RECORDS_KEY = 'mop-ledger.records.v1'
const SETTINGS_KEY = 'mop-ledger.settings.v1'

export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.warn('[storage] 寫入失敗', e)
    return false
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const Keys = { RECORDS_KEY, SETTINGS_KEY }

/** 估算 localStorage 用量（位元組，UTF-16 近似） */
export function usageBytes(): number {
  let n = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      n += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2
    }
  } catch {
    /* ignore */
  }
  return n
}
