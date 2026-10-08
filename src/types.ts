export type TxType = 'expense' | 'income'
export type RecordSource = 'manual' | 'image'

/**
 * 錢包：一本獨立的帳。
 * 每個錢包有自己的一整套設定（分類、匯率、幣別、常用備註）與自己的記錄，
 * 切換錢包等於換一本帳，彼此完全看不到對方。
 */
export interface Wallet {
  id: string
  name: string
  /** 卡片與頭像的主色（見 lib/wallets.ts 的 WALLET_COLORS） */
  color: string
  /** 圖示鍵值（沿用分類那套，見 lib/icons.ts） */
  icon: string
  createdAt: string
}

/** App 層級、不屬於任何錢包的狀態 */
export interface WalletState {
  wallets: Wallet[]
  activeWalletId: string
}

export interface Category {
  id: string
  name: string
  type: TxType
  color: string
  /** 分類圖示鍵值（見 src/lib/icons.ts）；舊資料可能沒有 */
  icon?: string
  /** 內建分類不可刪除，但可改名 */
  builtin: boolean
  archived: boolean
  /**
   * 上層分類 id；null／省略代表是頂層大類。
   * 子分類本身還可以有子分類（多層），但收支類型一律沿用整條路徑的根分類。
   */
  parentId?: string | null
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
  /** 壓縮後的寬／高（長邊上限見 imaging.ts 的 MAX_EDGE） */
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
  /**
   * 這筆記錄屬於哪個錢包。舊資料（單錢包時代）沒有這個欄位，
   * 載入時會補上預設錢包的 id（見 stores/records.ts 的 migrate）。
   */
  walletId: string
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
  /**
   * 記帳當下的計算機算式（可讀文字，例如「12 + 5 × 3」）。
   * 只有「真的按過運算」才會有——單純輸入一個數字（例如 500）不記，
   * 免得每筆記錄都多一行跟金額一樣的廢話。
   * 舊資料沒有這個欄位。
   */
  expr?: string
  source: RecordSource
  images: ImageRef[]
  ocr?: OcrInfo
}

/**
 * 每個錢包各自的設定。切換錢包時這整份都會跟著換。
 * （欄位與「單錢包時代」的 Settings 完全相同，所以既有程式碼讀 state.xxx 不必改。）
 */
/**
 * 快速金額預設（0.1.29）：記帳頁金額上方那排方型小按鈕。
 *
 * 點一下就自動帶入**金額／收支類型／分類／備註**，但仍然要使用者自己按「記錄」才會存
 * ——刻意不自動送出，避免手滑多記一筆。
 *
 * 使用者原話：「按下例如 25 的按鈕，自動填寫金額、自動選取分類、自動填備注，
 * 但依然要用戶手動按記錄的按鈕。例：25 --> 支出金額 25、分類(餐飲 › 午餐)、備注(公司3餸飯)」
 */
export interface QuickPreset {
  id: string
  /** 按鈕上顯示、也是帶入的金額；0 表示還沒填（按下去不會動金額） */
  amount: number
  type: TxType
  /** 空字串＝不指定（維持記帳頁目前選到的分類） */
  categoryId: string
  /** 空字串＝不指定（維持使用者已經打的字） */
  note: string
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
  /**
   * 預設分類：每次打開 App、以及每次記錄完成後，記帳頁自動預選的那一個。
   * 空字串 = 沒有設定（照舊：沿用上次用過的，沒有就用該類型第一個）。
   *
   * ⚠ 跟 `favoriteCategories`（主頁那排常用分類按鈕）是**兩件完全獨立的事**：
   *   常用分類決定「主頁顯示哪幾顆按鈕」，預設分類決定「記帳頁預先選中哪一個」。
   *   設了預設分類不會動到常用分類，反之亦然。
   */
  defaultCategoryId: string
  /** 主頁記帳幣別選單顯示的幣別（空陣列 = 全部顯示） */
  visibleCurrencies: string[]
  /** 匯率表顯示的幣別（空陣列 = 全部顯示；可自行新增） */
  rateCurrencies: string[]
  /**
   * 快速備註：記帳頁／記錄明細的備註欄右側按鈕會列出的常用文字。
   * 點一下就填入備註欄（取代原有內容），使用者可在設定頁新增／修改／刪除。
   */
  quickNotes: string[]
  /**
   * 快速金額預設（0.1.29）：記帳頁金額上方的方型小按鈕，數量由使用者在設定頁決定。
   * 空陣列＝記帳頁不顯示那一排。
   */
  quickPresets: QuickPreset[]
}

export interface ExportPayload {
  app: 'mop-ledger'
  /** 1 = 單錢包時代的舊檔；2 = 有錢包的版本 */
  format: 1 | 2
  exportedAt: string
  /** 匯出當下的錢包設定（v1 是唯一一份；v2 是當前錢包那份，向後相容用） */
  settings: Settings
  /** v2：全部記錄（含各錢包的）。v1 檔就只有一份，缺少 walletId */
  records: TxRecord[]
  /** md5 -> base64 data URL（還原圖片用） */
  images: Record<string, string>
  /* ── 以下只有 v2 有 ─────────────────────────────────── */
  /** 全部錢包（照顯示順序） */
  wallets?: Wallet[]
  /** walletId -> 該錢包的設定 */
  settingsByWallet?: Record<string, Settings>
  activeWalletId?: string
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
