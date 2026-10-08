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
    // 只是給個起手式（打開就有東西可按），使用者可以在設定頁改掉或刪光
    quickNotes: ['M記', '麵'],
  }
}
