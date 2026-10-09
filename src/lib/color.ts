/** 把 #rgb / #rrggbb 轉成帶透明度的 rgba()；無法解析時原樣回傳 */
export function withAlpha(hex: string, alpha: number): string {
  const h = (hex || '').trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * 旅行顏色（0.1.39）：旅行頁的色板（色板順序＝畫面上的排列順序）。
 * 第一個＝預設琥珀（跟 0.1.35 以來的旅行主題同一色，舊資料沒有 color 欄位時也回退它，
 * 這樣「升級前後」的畫面完全一樣，不會忽然變色）。
 * ⚠ 色值都挑過：在米白紙感背景上當「字色＋外框色」都夠深、彼此放同一排也分得出來。
 */
export const TRIP_COLORS = [
  '#d9a326', // 琥珀（預設／旅行主題色）
  '#bf563c', // 磚紅（＝支出色同一族）
  '#2c6e5b', // 墨綠（＝收入色同一族）
  '#3b6ea5', // 沉穩藍
  '#7b5ea7', // 紫
  '#2b8a78', // 青綠
  '#c2557a', // 玫紅
  '#5b6472', // 石板灰
] as const

/** 旅行的預設顏色（＝琥珀）：trip.color 缺值／形狀不對時的統一回退 */
export const DEFAULT_TRIP_COLOR: string = TRIP_COLORS[0]

/** 是否為合法的 #rrggbb（normTrip／updateActiveTrip 過濾怪值用） */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())
}
