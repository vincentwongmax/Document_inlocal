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

/** 單一鍵的位元組數（UTF-16 近似，含鍵名） */
function keyBytes(key: string): number {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return 0
    return (key.length + v.length) * 2
  } catch {
    return 0
  }
}

/**
 * 「本錢包」的 localStorage 用量：記錄鍵是全部錢包共用的一個鍵
 * （`mop-ledger.records.v1`，每筆蓋 `walletId`），所以不能整鍵算。
 * 折衷做法：
 *   - 該錢包自己的設定鍵（`mop-ledger.setting.<id>.v1`）整份算
 *   - 記錄鍵按「這個錢包佔全部記錄的 bytes 比例」分攤
 *
 * ⚠ 這只是估算（給設定頁顯示用）；`usageBytes()` 才是真正的總量，
 *   兩者不會剛好相加等於總量，UI 文案也照這樣寫。
 */
export function walletUsageBytes(walletId: string, share: number): number {
  const base = keyBytes(walletSettingsKey(walletId)) + keyBytes(RECORDS_KEY) * share
  return Math.round(base)
}
