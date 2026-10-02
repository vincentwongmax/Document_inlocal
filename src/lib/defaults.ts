import type { Category, Settings } from '@/types'
import { defaultRates } from './currency'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'c_food', name: '餐飲', type: 'expense', color: '#c0563c', builtin: true, archived: false },
  { id: 'c_transport', name: '交通', type: 'expense', color: '#4a6fa5', builtin: true, archived: false },
  { id: 'c_shopping', name: '購物', type: 'expense', color: '#b0803c', builtin: true, archived: false },
  { id: 'c_housing', name: '居住', type: 'expense', color: '#5e8c7a', builtin: true, archived: false },
  { id: 'c_medical', name: '醫療', type: 'expense', color: '#7a8fa0', builtin: true, archived: false },
  { id: 'c_fun', name: '娛樂', type: 'expense', color: '#a2607e', builtin: true, archived: false },
  { id: 'c_edu', name: '教育', type: 'expense', color: '#4f7d8c', builtin: true, archived: false },
  { id: 'c_travel', name: '旅遊', type: 'expense', color: '#6e8b4e', builtin: true, archived: false },
  { id: 'c_other_e', name: '其他支出', type: 'expense', color: '#8a857c', builtin: true, archived: false },

  { id: 'c_salary', name: '薪資', type: 'income', color: '#2c6e5b', builtin: true, archived: false },
  { id: 'c_bonus', name: '獎金', type: 'income', color: '#4e8e4a', builtin: true, archived: false },
  { id: 'c_invest', name: '投資', type: 'income', color: '#3e7c8c', builtin: true, archived: false },
  { id: 'c_other_i', name: '其他收入', type: 'income', color: '#6b6a63', builtin: true, archived: false },
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
    quickItems: [],
    favoriteCategories: [],
    homeCategoryLimit: 6,
  }
}
