import type { Category, Settings } from '@/types'
import { defaultRates } from './currency'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'c_food', name: '餐飲', type: 'expense', color: '#c0563c', icon: 'food', builtin: true, archived: false },
  { id: 'c_transport', name: '交通', type: 'expense', color: '#4a6fa5', icon: 'bus', builtin: true, archived: false },
  { id: 'c_shopping', name: '購物', type: 'expense', color: '#b0803c', icon: 'bag', builtin: true, archived: false },
  { id: 'c_housing', name: '居住', type: 'expense', color: '#5e8c7a', icon: 'home', builtin: true, archived: false },
  { id: 'c_medical', name: '醫療', type: 'expense', color: '#7a8fa0', icon: 'medical', builtin: true, archived: false },
  { id: 'c_fun', name: '娛樂', type: 'expense', color: '#a2607e', icon: 'music', builtin: true, archived: false },
  { id: 'c_edu', name: '教育', type: 'expense', color: '#4f7d8c', icon: 'book', builtin: true, archived: false },
  { id: 'c_travel', name: '旅遊', type: 'expense', color: '#6e8b4e', icon: 'luggage', builtin: true, archived: false },
  { id: 'c_other_e', name: '其他支出', type: 'expense', color: '#8a857c', icon: 'dots', builtin: true, archived: false },

  { id: 'c_salary', name: '薪資', type: 'income', color: '#2c6e5b', icon: 'wallet', builtin: true, archived: false },
  { id: 'c_bonus', name: '獎金', type: 'income', color: '#4e8e4a', icon: 'medal', builtin: true, archived: false },
  { id: 'c_invest', name: '投資', type: 'income', color: '#3e7c8c', icon: 'trending', builtin: true, archived: false },
  { id: 'c_other_i', name: '其他收入', type: 'income', color: '#6b6a63', icon: 'dots', builtin: true, archived: false },
]

export function defaultSettings(base = 'MOP'): Settings {
  return {
    baseCurrency: base,
    inputCurrency: base,
    rates: defaultRates(base),
    ratesUpdatedAt: null,
    autoUpdateRates: true,
    ocrLangs: ['eng', 'chi_sim', 'chi_tra'],
    preferredCurrency: 'MOP',
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)) as Category[],
    favoriteCategories: [],
    // 空字串＝沒有指定預設分類（記帳頁就沿用「上次用過的 / 該類型第一個」的舊行為）
    defaultCategoryId: '',
    visibleCurrencies: [],
    rateCurrencies: ['MOP', 'CNY', 'HKD'],
    // 自訂貨幣（0.1.44）：一開始沒有；使用者在設定頁「幣別與匯率 → 自訂貨幣」新增
    customCurrencies: [],
    // 只是給個起手式（打開就有東西可按），使用者可以在設定頁改掉或刪光
    quickNotes: ['M記', '麵'],
    /*
     * 快速金額預設（0.1.29）：先給三顆當起手式，數量與內容都可以在設定頁改。
     * ⚠ 刻意**不預填**分類與備註：內建分類裡沒有「午餐」這種子分類，
     *   硬塞一個使用者自己沒建立的分類 id，只會讓按鈕按下去沒反應。
     *   金額帶入後分類維持記帳頁目前的選擇，要用「25 → 午餐／公司3餸飯」這種
     *   完整版請到設定頁自己填（那才會存到使用者自己的分類 id）。
     */
    quickPresets: [
      { id: 'qp_1', amount: 1, type: 'expense', categoryId: '', note: '', currency: '' },
      { id: 'qp_25', amount: 25, type: 'expense', categoryId: '', note: '', currency: '' },
      { id: 'qp_35', amount: 35, type: 'expense', categoryId: '', note: '', currency: '' },
    ],
    // 旅行模式（0.1.35）：一開始沒有進行中的旅行
    activeTrip: null,
    // 旅行模式（0.1.36）：已結束的旅行（結束時從 activeTrip 移進來）
    tripHistory: [],
  }
}
