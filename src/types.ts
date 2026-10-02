export type TxType = 'expense' | 'income'
export type RecordSource = 'manual' | 'image'

export interface Category {
  id: string
  name: string
  type: TxType
  color: string
  /** 內建分類不可刪除，但可改名 */
  builtin: boolean
  archived: boolean
}

export interface ImageRef {
  /** IndexedDB 鍵值 */
  id: string
  /** 檔案內容 MD5（去重用） */
  md5: string
  /** EXIF 拍攝時間 ISO；取不到則為 null */
  shotAt: string | null
  name: string
  /** 縮圖 data URL，直接可顯示（小尺寸，避免每次讀 IndexedDB） */
  thumb?: string
  /** 壓縮後的寬／高（480p） */
  w?: number
  h?: number
  /** 壓縮後實際位元組數 */
  bytes?: number
  /** 原始檔案位元組數（供顯示省了多少） */
  originalBytes?: number
}

export interface AmountCandidate {
  value: number
  currency: string
  /** 來自哪一列原始文字 */
  line: string
  /** 命中「總計/合計」等關鍵字 */
  isTotal: boolean
}

export interface OcrInfo {
  text: string
  confidence: number
  /** 辨識到的日期候選（ISO，最多 3 個） */
  dateCandidates: string[]
  amountCandidates: AmountCandidate[]
  /** 使用者最終採用的幣別（多幣別時） */
  pickedCurrency?: string
}

export interface TxRecord {
  id: string
  /** 記錄被新增的時間（自動，不可改） */
  createdAt: string
  /** 最後修改時間 */
  updatedAt: string
  /** 交易發生時間（EXIF / OCR / 手動） */
  occurredAt: string
  type: TxType
  categoryId: string
  /** 原幣金額 */
  amount: number
  /** 原幣別 */
  currency: string
  /** 寫入當下的匯率快照：1 單位原幣 = rate 單位主幣 */
  rate: number
  /** 主幣別快照 */
  baseCurrency: string
  /** amount × rate，統計一律以此為準 */
  baseAmount: number
  note: string
  source: RecordSource
  images: ImageRef[]
  ocr?: OcrInfo
}

export interface Settings {
  baseCurrency: string
  /** 目前輸入幣別（旅行模式：一律以某幣記錄，自動換算為主幣） */
  inputCurrency: string
  /** currency -> 兌主幣匯率（1 外幣 = ? 主幣） */
  rates: Record<string, number>
  ratesUpdatedAt: string | null
  autoUpdateRates: boolean
  /** OCR 語言包 */
  ocrLangs: string[]
  /** 一張圖含多種幣別時，預設採用哪一個 */
  preferredCurrency: string
  categories: Category[]
  /** 主頁直接顯示的常用分類（空陣列 = 全部分類都顯示） */
  favoriteCategories: string[]
}

export interface ExportPayload {
  app: 'mop-ledger'
  format: 1
  exportedAt: string
  settings: Settings
  records: TxRecord[]
  /** md5 -> base64 data URL（還原圖片用） */
  images: Record<string, string>
}

/** 待確認草稿（上傳圖片後產生） */
export interface DraftRecord {
  key: string
  images: ImageRef[]
  occurredAt: string
  type: TxType
  categoryId: string
  amount: number | null
  currency: string
  note: string
  ocr?: OcrInfo
  status: 'pending' | 'ocr' | 'ready' | 'error' | 'duplicate'
  error?: string
}
