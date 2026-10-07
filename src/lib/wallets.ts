import type { Wallet } from '@/types'
import { uid } from './id'

/**
 * 舊資料遷移出來的錢包固定用這個 id。
 *
 * ⚠ 一定要是「固定字串」而不是每次 `uid()`：遷移可能發生在載入時，
 * 若每次重新產生，舊記錄（沒有 walletId）補上的 id 就會對不到錢包。
 */
export const DEFAULT_WALLET_ID = 'w_default'

/** 新錢包的名稱上限（卡片只有一行的寬度） */
export const WALLET_NAME_MAX = 12

/** 錢包卡片的主色。刻意挑過：都跟米白紙感合得來，也彼此分得開 */
export const WALLET_COLORS = [
  '#2c6e5b', // 墨綠（專案主色）
  '#4a6fa5', // 藍
  '#a2607e', // 紫紅
  '#c0563c', // 磚紅
  '#b0803c', // 赭黃
  '#5e8c7a', // 灰綠
  '#7a8fa0', // 灰藍
  '#6e8b4e', // 橄欖
  '#8a857c', // 石灰
  '#3e7c8c', // 青
] as const

/** 可以給錢包用的圖示（從分類那套挑出「像容器／帳戶」的） */
export const WALLET_ICONS = [
  'wallet',
  'banknote',
  'card',
  'tag',
  'briefcase',
  'home',
  'star',
  'trending',
  'chart',
  'gift',
  'key',
  'shield',
  'users',
  'receipt',
  'luggage',
  'medal',
] as const

/** 這個圖示鍵值是否真的存在（icons.ts 的 iconDef 有 fallback，這裡只需要擋明顯亂填的） */
export function safeWalletIcon(icon: unknown): string {
  return typeof icon === 'string' && (WALLET_ICONS as readonly string[]).includes(icon)
    ? icon
    : 'wallet'
}

export function safeWalletColor(color: unknown): string {
  return typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : WALLET_COLORS[0]
}

export function newWallet(name: string, color?: string, icon?: string): Wallet {
  return {
    id: uid('w'),
    name: cleanWalletName(name) || '新錢包',
    color: safeWalletColor(color),
    icon: safeWalletIcon(icon),
    createdAt: new Date().toISOString(),
  }
}

/** 去掉頭尾空白、把換行壓成空格，並截到上限 */
export function cleanWalletName(name: unknown): string {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WALLET_NAME_MAX)
}

/** 名稱是否可用（非空、不超過上限、不與別人重複） */
export function walletNameOk(name: string, others: Wallet[]): boolean {
  const n = cleanWalletName(name)
  if (!n) return false
  return !others.some((w) => w.name === n)
}

/** 遷移時建立的預設錢包（id 固定，見 DEFAULT_WALLET_ID） */
export function defaultWallet(name = '我的錢包', color = WALLET_COLORS[0], icon = 'wallet'): Wallet {
  return {
    id: DEFAULT_WALLET_ID,
    name: cleanWalletName(name) || '我的錢包',
    color: safeWalletColor(color),
    icon: safeWalletIcon(icon),
    createdAt: new Date().toISOString(),
  }
}

/** 從「已用過」的名稱清單生出一個不撞名的（新錢包 / 匯入用） */
export function uniqueWalletName(base: string, taken: string[]): string {
  const b = cleanWalletName(base) || '新錢包'
  if (!taken.includes(b)) return b
  for (let i = 2; i < 999; i++) {
    const n = `${b.slice(0, WALLET_NAME_MAX - 3)} ${i}`
    if (!taken.includes(n)) return n
  }
  return b
}

/**
 * 把（可能來自舊版或壞檔的）錢包陣列整理成可用的形狀：
 * 過濾掉沒有 id 的、補上缺的顏色與圖示、把名稱去重、確保至少有一個。
 */
export function normalizeWallets(list: unknown, fallbackName = '我的錢包'): Wallet[] {
  const out: Wallet[] = []
  const seen = new Set<string>()
  const src = Array.isArray(list) ? list : []
  for (const raw of src) {
    const w = raw as Partial<Wallet> | null
    if (!w || typeof w !== 'object') continue
    const id = typeof w.id === 'string' && w.id ? w.id : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: uniqueWalletName(cleanWalletName(w.name) || fallbackName, out.map((x) => x.name)),
      color: safeWalletColor(w.color),
      icon: safeWalletIcon(w.icon),
      createdAt: typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString(),
    })
  }
  if (!out.length) out.push(defaultWallet(fallbackName))
  return out
}
