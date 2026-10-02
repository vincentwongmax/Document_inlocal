/** 把 #rgb / #rrggbb 轉成帶透明度的 rgba()；無法解析時原樣回傳 */
export function withAlpha(hex: string, alpha: number): string {
  const h = (hex || '').trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
