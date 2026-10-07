const RECORDS_KEY = 'mop-ledger.records.v1'
/** ⚠ 舊鍵：多錢包之前，全 App 只有這一份設定 */
const SETTINGS_KEY = 'mop-ledger.settings.v1'
/** 錢包清單與當前錢包 */
const WALLETS_KEY = 'mop-ledger.wallets.v1'

/**
 * 每個錢包的設定各自存一個鍵。
 * 這樣切換錢包就只是「換一個鍵來讀」，不必把整包設定搬來搬去（搬一半斷電就沒了）。
 */
export function walletSettingsKey(walletId: string): string {
  return `mop-ledger.setting.${walletId}.v1`
}

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

export const Keys = { RECORDS_KEY, SETTINGS_KEY, WALLETS_KEY }

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
