/**
 * 分類圖示庫：全部以 24×24 網格、描邊（stroke）繪製，
 * 只提供線條，顏色一律用 currentColor，方便跟著分類顏色走。
 */

export type IconShape =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }

export interface IconDef {
  /** 挑選器顯示的名稱 */
  label: string
  shapes: IconShape[]
}

const p = (d: string): IconShape => ({ t: 'path', d })
const c = (cx: number, cy: number, r: number): IconShape => ({ t: 'circle', cx, cy, r })
const r = (x: number, y: number, w: number, h: number, rx?: number): IconShape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  rx,
})
const l = (x1: number, y1: number, x2: number, y2: number): IconShape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
})

export const CATEGORY_ICONS: Record<string, IconDef> = {
  dots: { label: '其他', shapes: [c(5, 12, 1.7), c(12, 12, 1.7), c(19, 12, 1.7)] },

  food: {
    label: '餐飲',
    shapes: [
      p('M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2'),
      p('M7 2v20'),
      p('M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z'),
      p('M21 15v7'),
    ],
  },
  coffee: {
    label: '咖啡飲品',
    shapes: [
      p('M4 8.5h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z'),
      p('M16 10h1.5a2.75 2.75 0 0 1 0 5.5H16'),
      p('M3 20.5h13.5'),
    ],
  },
  bakery: {
    label: '甜點烘焙',
    shapes: [
      p('M5 20.5h14'),
      p('M5.5 20.5v-5.2h13v5.2'),
      p('M12 15.3c0-2.6-3-4.4-6.6-5.2.5-2.3 2.3-3.9 4.6-3.9'),
      p('M12 15.3c0-2.6 3-4.4 6.6-5.2-.5-2.3-2.3-3.9-4.6-3.9'),
    ],
  },
  bag: {
    label: '購物',
    shapes: [p('M5.2 8h13.6l-1 12.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z'), p('M9 8V6a3 3 0 0 1 6 0v2')],
  },
  tshirt: {
    label: '服飾',
    shapes: [
      p('M9 3 4.5 5.2 6.2 9l2-.9V21h7.6V8.1l2 .9 1.7-3.8L15 3a3 3 0 0 1-6 0z'),
    ],
  },
  bus: { label: '交通', shapes: [r(4.5, 4.5, 15, 13, 2), p('M4.5 11.5h15'), c(8.5, 19.5, 1.6), c(15.5, 19.5, 1.6)] },
  car: {
    label: '汽車',
    shapes: [p('M5 16v-4l1.7-4.4A1.8 1.8 0 0 1 8.4 6.4h7.2a1.8 1.8 0 0 1 1.7 1.2L19 12v4'), p('M5 12h14'), c(7.8, 17.6, 1.6), c(16.2, 17.6, 1.6)],
  },
  home: { label: '居住', shapes: [p('M3.5 10.8 12 3.8l8.5 7'), p('M5.8 9.6V20h12.4V9.6'), p('M10 20v-5.2h4V20')] },
  bolt: { label: '電費', shapes: [p('M13.2 2.5 5.5 13.4h5.2l-.9 8.1 7.7-10.9h-5.2z')] },
  droplet: { label: '水費', shapes: [p('M12 2.8s6.2 6.7 6.2 11a6.2 6.2 0 0 1-12.4 0c0-4.3 6.2-11 6.2-11z')] },
  flame: { label: '燃氣', shapes: [p('M12 2.6c3 3.6 5.6 6.1 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-1.7.8-3.1 1.9-4.4.4 1 1 1.6 1.8 1.9-.2-2.4.4-5 1.9-7.1z')] },
  phone: { label: '通訊', shapes: [r(7, 2.5, 10, 19, 2.6), l(10.5, 18.6, 13.5, 18.6)] },
  wifi: { label: '網路', shapes: [p('M3 9.2a14 14 0 0 1 18 0'), p('M6.4 12.9a9 9 0 0 1 11.2 0'), p('M9.7 16.5a4.2 4.2 0 0 1 4.6 0'), p('M12 20h.01')] },
  medical: {
    label: '醫療',
    shapes: [r(3, 7, 18, 13, 2.5), p('M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7'), p('M12 10.8v5.4'), p('M9.3 13.5h5.4')],
  },
  pill: {
    label: '藥物',
    shapes: [p('M8.4 3.6 3.6 8.4a5.1 5.1 0 0 0 7.2 7.2l4.8-4.8a5.1 5.1 0 0 0-7.2-7.2z'), p('M7.2 12.9 12.9 7.2')],
  },
  music: { label: '娛樂', shapes: [p('M9.5 18.6V6.4l9.4-2.1v12.3'), c(6.8, 18.6, 2.7), c(16.2, 16.6, 2.7)] },
  game: {
    label: '遊戲',
    shapes: [p('M8.4 8h7.2a5.4 5.4 0 0 1 0 10.8 3 3 0 0 1-2.3-1.1H10.7a3 3 0 0 1-2.3 1.1A5.4 5.4 0 0 1 8.4 8z'), p('M8.6 11.2v3.6'), p('M6.8 13h3.6'), c(15.6, 12, 0.9), c(17.6, 14.4, 0.9)],
  },
  film: { label: '影音', shapes: [r(3.5, 4.5, 17, 15, 2.5), p('M8 4.5v15'), p('M16 4.5v15'), p('M3.5 12h17')] },
  book: {
    label: '閱讀',
    shapes: [p('M12 6.5v14'), p('M12 6.5C10.5 5.2 8.6 4.5 6.3 4.5H4v13h2.3c2.3 0 4.2.7 5.7 2'), p('M12 6.5c1.5-1.3 3.4-2 5.7-2H20v13h-2.3c-2.3 0-4.2.7-5.7 2')],
  },
  graduation: {
    label: '學費',
    shapes: [p('M12 3.8 2.8 8.6 12 13.4l9.2-4.8z'), p('M6.4 10.8v5c0 1.4 2.5 2.6 5.6 2.6s5.6-1.2 5.6-2.6v-5'), p('M21.2 8.6v5.6')],
  },
  luggage: {
    label: '旅遊',
    shapes: [r(3.5, 7.5, 17, 13, 2.5), p('M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9'), l(8, 12, 8, 17), l(16, 12, 16, 17)],
  },
  bed: { label: '住宿', shapes: [p('M3 19v-8.5h14.5a3.5 3.5 0 0 1 3.5 3.5V19'), p('M3 15.2h18'), c(7.4, 10.4, 2.2)] },
  dumbbell: { label: '運動', shapes: [l(4, 9, 4, 15), l(6.8, 7.5, 6.8, 16.5), l(20, 9, 20, 15), l(17.2, 7.5, 17.2, 16.5), l(6.8, 12, 17.2, 12)] },
  scissors: { label: '美容', shapes: [c(6.5, 7, 2.1), c(6.5, 17, 2.1), p('M8.3 8.2 20 18.4'), p('M8.3 15.8 20 5.6')] },
  paw: {
    label: '寵物',
    shapes: [c(8, 8.2, 2), c(12, 6.4, 2), c(16, 8.2, 2), c(18.2, 12.4, 1.9), p('M12.1 20.3c-3.3 0-6-1.9-6-4.4 0-1.8 2.4-3.3 6-3.3s6 1.5 6 3.3c0 2.5-2.7 4.4-6 4.4z')],
  },
  baby: { label: '嬰兒', shapes: [c(12, 8.4, 4.4), c(10.4, 7.8, 0.55), c(13.6, 7.8, 0.55), p('M10.2 10.4a2.6 2.6 0 0 0 3.6 0'), p('M6.6 21v-4.6A3.4 3.4 0 0 1 10 13h4a3.4 3.4 0 0 1 3.4 3.4V21')] },
  tag: { label: '標籤', shapes: [p('M3.4 11.7V4.6a1.2 1.2 0 0 1 1.2-1.2h7.1a1.2 1.2 0 0 1 .85.35l8.1 8.1a1.2 1.2 0 0 1 0 1.7l-6.9 6.9a1.2 1.2 0 0 1-1.7 0l-8.1-8.1a1.2 1.2 0 0 1-.35-.65z'), c(7.4, 7.4, 1.4)] },
  star: { label: '特別', shapes: [p('M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z')] },
  wallet: { label: '支出', shapes: [p('M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z'), p('M20 10.5h-3.2a1.8 1.8 0 0 0 0 3.6H20')] },
  banknote: { label: '現金', shapes: [r(2.5, 6, 19, 12, 2), c(12, 12, 2.4), l(6, 9.5, 6, 14.5), l(18, 9.5, 18, 14.5)] },
  card: { label: '信用卡', shapes: [r(2.5, 5, 19, 14, 2.5), p('M2.5 9.8h19'), p('M6.2 14.8h4')] },
  trending: { label: '投資', shapes: [p('M3 17.5 9.2 11l3.6 3.6L21 6.2'), p('M15 6.2h6v6')] },
  chart: { label: '圖表', shapes: [p('M3.5 20.5h17'), r(5.5, 13.5, 3.2, 7, 1), r(10.4, 9.5, 3.2, 11, 1), r(15.3, 5.5, 3.2, 15, 1)] },
  medal: { label: '獎金', shapes: [c(12, 9, 5.2), p('M8.6 13.4 7.2 21l4.8-2.6L16.8 21l-1.4-7.6')] },
  gift: {
    label: '禮物',
    shapes: [r(3.5, 8.2, 17, 4.4, 1.2), r(5.2, 12.6, 13.6, 8.4, 1.6), p('M12 8.2v12.8'), p('M12 8.2C10.4 5.4 8.6 4.6 7.7 5.6 6.9 6.5 8.6 7.9 12 8.2z'), p('M12 8.2c1.6-2.8 3.4-3.6 4.3-2.6.8.9-.9 2.3-4.3 2.6z')],
  },
  heart: { label: '愛心', shapes: [p('M12 20.4 4.5 13a4.8 4.8 0 0 1 6.8-6.8l.7.7.7-.7A4.8 4.8 0 0 1 19.5 13z')] },
  key: { label: '租金', shapes: [c(8, 15, 4.6), p('M11.3 11.7 20 3'), p('M17.5 5.5 20 8')] },
  shield: { label: '保險', shapes: [p('M12 2.8 4.6 5.8v6.1c0 4.5 3.1 8.1 7.4 9.3 4.3-1.2 7.4-4.8 7.4-9.3V5.8z')] },
  receipt: { label: '單據', shapes: [p('M6 3h12v18l-1.8-1.3-1.8 1.3-1.8-1.3-1.8 1.3-1.8-1.3L6 21z'), p('M9.2 8.2h5.6'), p('M9.2 12.2h5.6')] },
  briefcase: { label: '工作', shapes: [r(3, 7.5, 18, 12.5, 2.5), p('M9 7.5V5.7A1.7 1.7 0 0 1 10.7 4h2.6A1.7 1.7 0 0 1 15 5.7v1.8'), p('M3 12.5h18')] },
  users: { label: '人情', shapes: [c(9, 8, 3.2), p('M3.2 20a5.8 5.8 0 0 1 11.6 0'), p('M16.2 5.4a3.2 3.2 0 0 1 0 5.3'), p('M17.6 14.6A5.8 5.8 0 0 1 20.8 20')] },
  refresh: { label: '訂閱', shapes: [p('M20.4 11.6a8.4 8.4 0 1 1-2.46-5.94'), p('M20.5 3.6v5.2h-5.2')] },
}

/** 挑選器顯示順序 */
export const ICON_KEYS = Object.keys(CATEGORY_ICONS)

export const DEFAULT_ICON = 'dots'

export function hasIcon(key?: string | null): boolean {
  return !!key && !!CATEGORY_ICONS[key]
}

/** 取圖示定義；找不到時退回預設圖示 */
export function iconDef(key?: string | null): IconDef {
  return (key && CATEGORY_ICONS[key]) || CATEGORY_ICONS[DEFAULT_ICON]
}

/** 內建分類 → 預設圖示（舊資料補圖示用） */
export const BUILTIN_CATEGORY_ICONS: Record<string, string> = {
  c_food: 'food',
  c_transport: 'bus',
  c_shopping: 'bag',
  c_housing: 'home',
  c_medical: 'medical',
  c_fun: 'music',
  c_edu: 'book',
  c_travel: 'luggage',
  c_other_e: 'dots',
  c_salary: 'wallet',
  c_bonus: 'medal',
  c_invest: 'trending',
  c_other_i: 'dots',
}

/** 依分類名稱粗略猜一個圖示（自訂分類補預設值用）；由上往下第一個命中者勝出，
 *  所以「較具體、較容易誤判」的規則要放前面。 */
const NAME_HINTS: [RegExp, string][] = [
  [/健身|運動|瑜伽|跑步|游泳|球|登山|自行車|單車/, 'dumbbell'],
  [/學費|註冊費|學雜費|補習|才藝|課外|書簿/, 'graduation'],
  [/甜|蛋糕|麵包|烘焙|餅|糖|雪糕|冰淇淋/, 'bakery'],
  [/咖啡|茶|飲|奶茶|手搖|酒|酒吧/, 'coffee'],
  [/餐|食|飯|早|午|晚|吃|小吃|外賣|外送|食材|菜/, 'food'],
  [/娛樂|電影|KTV|遊戲|唱歌|音樂|演唱會|玩樂|展覽/, 'music'],
  [/旅|遊|機票|住宿|酒店|民宿/, 'luggage'],
  [/購物|網購|超市|百貨|日用品|採購/, 'bag'],
  [/服飾|衣服|衣|衫|褲|鞋|穿搭|外套|裙|帽/, 'tshirt'],
  [/租金|房租|租房|房貸/, 'key'],
  [/居住|宿舍|物業|大廈|公寓|家居|管理費/, 'home'],
  [/電費|水費|水電|燃氣|瓦斯|煤氣|公用事業|排污/, 'bolt'],
  [/醫|藥|診|牙|健檢|體檢|身體|看診|保健|門診|掛號/, 'medical'],
  [/書|教育|閱讀|課程|文具|學/, 'book'],
  [/美容|美髮|理髮|SPA|按摩|美甲|化妝/, 'scissors'],
  [/寵|貓|狗|毛孩|毛小孩|動物/, 'paw'],
  [/嬰|幼|童|小孩|奶粉|尿布|托兒/, 'baby'],
  [/信用卡|簽帳|卡數/, 'card'],
  [/現金|提款|轉帳|匯款/, 'banknote'],
  [/薪|工資|收入|月薪|酬/, 'wallet'],
  [/獎|花紅|年終|抽獎/, 'medal'],
  [/投|股|基金|理財|利息|分紅|定期/, 'trending'],
  [/禮|紅包|送/, 'gift'],
  [/捐|愛心|慈善/, 'heart'],
  [/保險|保障/, 'shield'],
  [/稅|帳單|發票|手續費|罰款|單據/, 'receipt'],
  [/工作|公司|公務|辦公|業務/, 'briefcase'],
  [/人情|社交|朋友|婚|宴|聚會/, 'users'],
  [/訂閱|月費|會員|會費/, 'refresh'],
  [/通訊|電話|手機|上網|網費|流量|寬頻|電信/, 'phone'],
  [/交通|車|巴士|地鐵|捷運|公車|的士|計程|油費|加油|停車|船/, 'bus'],
]

export function guessIcon(name: string): string {
  for (const [re, key] of NAME_HINTS) if (re.test(name)) return key
  return DEFAULT_ICON
}

/** 取得分類應顯示的圖示（有存就用，沒有則依內建 id／名稱推斷） */
export function iconForCategory(cat: { id: string; name?: string; icon?: string | null }): string {
  if (hasIcon(cat.icon)) return cat.icon as string
  const builtin = BUILTIN_CATEGORY_ICONS[cat.id]
  if (builtin) return builtin
  return cat.name ? guessIcon(cat.name) : DEFAULT_ICON
}
