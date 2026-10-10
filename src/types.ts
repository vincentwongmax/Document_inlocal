export type TxType = 'expense' | 'income'
export type RecordSource = 'manual' | 'image'

/** 自訂貨幣（0.1.44）：code＝1~12 碼大寫字母/數字（0.1.49 放寬）、name＝顯示名（例如「澳門幣」） */
export interface CustomCurrency {
  code: string
  name: string
}

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
  /**
   * 旅行模式（0.1.35）：這筆記錄屬於哪個旅行（`TravelTrip.id`）。
   * 模式一開著時記帳會自動蓋上；明細頁也可手動歸入／改歸（0.1.36 起，歷史旅行也行）。
   * ⚠ 0.1.36 起「結束旅行」**不再解除標記**——標籤跟著記錄一直留著
   *   （使用者：結束後標籤還在才有意義）；要改只能自己在明細頁改。
   * ⚠ 只是「顯示歸組」用的標記——分類資料完全不動（原分類照樣留在記錄上）。
   * 舊資料沒有這個欄位。
   */
  tripId?: string
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
  /**
   * 記帳幣別（0.1.32）：空字串＝「預設」（維持記帳頁目前的幣別）；
   * 填了某個幣別（MOP／HKD…）＝點下去連幣別一起切過去，補登外幣帳時不用再手動換。
   */
  currency: string
}

/**
 * 旅行模式（0.1.35）：一個進行中的旅行。
 *
 * 使用者拍板的設計（0.1.35 討論定案）：
 * - 一次只有一個進行中的旅行；出發／回程日期**純顯示**（不影響記錄歸屬）。
 * - **模式一**＝期間的記錄自動蓋 `tripId` 標記，記錄頁／統計頁歸到「日本旅行」名下
 *   （＝日本旅行→餐飲→午餐 的效果）；記帳頁分類介面**外觀完全不變**。
 * - **模式二**＝提交記錄後備注自動補「_旅行名」（例：買了一個包包_日本旅行）。
 *   兩個模式可同時開。
 * - 旅行貨幣：旅行期間記帳頁自動用該幣別（每一筆仍可手動改），結束後恢復。
 * - 「結束旅行」（0.1.36 改）：記錄的旅行標記**全部保留**（不回歸一般記錄——
 *   使用者：「結束後也要保留旅行時的標籤，不要回歸一般記錄，因為這樣沒有意義」），
 *   旅行本體移進 `tripHistory`（設定頁可回看）；備注已加的後綴**保留不動**。
 */
export interface TravelTrip {
  id: string
  /** 旅行名稱（例：日本旅行）；也是模式二要補進備注的字、歸組顯示的組名 */
  name: string
  /** 出發日 YYYY-MM-DD（純顯示）；空字串＝沒填 */
  startDate: string
  /** 回程日 YYYY-MM-DD（純顯示）；空字串＝沒填 */
  endDate: string
  /**
   * 旅行貨幣；空字串＝不自動切換（記帳頁維持目前的幣別）。
   * 旅行期間記帳頁的預設幣別會切到它（`settings.inputCurrency`），結束後恢復。
   * 0.1.36 起旅行期間的「顯示幣別」也是它（記錄頁／統計頁金額都用旅行貨幣呈現）。
   */
  currency: string
  /** 開始旅行當下的輸入幣別快照（結束旅行時恢復用）；空字串＝開始時沒有自動切換 */
  prevCurrency: string
  /** 模式一：期間的記錄歸入這個旅行（tripId 標記） */
  mode1: boolean
  /** 模式二：提交記錄後備注自動補「_旅行名」 */
  mode2: boolean
  /** 開始旅行的時間 ISO（0.1.36；舊資料沒有） */
  createdAt?: string
  /** 結束旅行的時間 ISO（0.1.36；只在 tripHistory 裡的旅行才有） */
  endedAt?: string
  /**
   * 旅行顏色（0.1.39）：#rrggbb。記錄列的「旅」標籤、旅行頁面的強調色都跟著它。
   * ⚠ 每趟旅行**各自**存一個——之後新旅行選別的顏色，不會影響到以前旅行的標籤
   * （舊資料沒有這個欄位 → 顯示層一律回退琥珀 `DEFAULT_TRIP_COLOR`）。
   */
  color?: string
  /**
   * 在「過去的旅行」清單裡隱藏（0.1.41）：true＝列表收起來，
   * 底部顯示「已隱藏 N 趟旅行」、點了才展開。舊資料沒有＝不隱藏。
   */
  hidden?: boolean
}

/**
 * 0.1.46：記帳頁「隱藏區塊」的預設值。
 * 排版（homeLayout）裡沒排進去的區塊，提交記錄時改用這裡的值；
 * 每個欄位都可以不設（空值＝照原本的行為走）。
 */
export interface HomeDefaults {
  /** 預設收支（區塊 1 隱藏時用）；空＝不設 */
  type: TxType | ''
  /** 預設金額（區塊 2 隱藏時用，存字串、提交時轉數字）；空＝不設（這樣會擋送出） */
  amount: string
  /** 預設分類 id（區塊 3 隱藏時用）；空＝之前的設定（記帳預設分類） */
  categoryId: string
  /** 預設備註（區塊 4 隱藏時用）；空＝不設 */
  note: string
  /**
   * 預設日期（區塊 5 隱藏時用）。0.1.49 的格式：
   * - `''`＝不設定（照原本的行為走）
   * - `'now'`＝現在
   * - `'before|after:整數:m|h|d|mo|y'`＝相對現在（0.1.49 把「時(h)」加回單位）
   * - `'at:YYYY-MM-DDTHH:mm'`＝使用者手動輸入的完整時間（絕對日期）
   * 0.1.46~47 的舊值（now/yesterday/tomorrow/m5/m30/h2）載入時自動遷移。
   */
  dateOffset: '' | string
  /** 預設收據圖片（區塊 6 隱藏時用）；blob 存 IndexedDB、ImageRef 存設定裡 */
  images: ImageRef[]
}

export interface Settings {  baseCurrency: string
  /**
   * 自訂貨幣（0.1.44）：使用者自己加的幣別（不在內建 12 種清單裡的）。
   * 匯率存在 `rates` map（跟內建幣別同一個地方）；這裡只記「有哪些自訂幣別」。
   * 刪除自訂幣別**不會**動 `rates`——已記錄的資料（記錄自己凍結的 rate）完全不受影響。
   */
  customCurrencies: CustomCurrency[]
  /**
   * 目前輸入幣別（記帳頁的預設幣別，可在此手動切換）。
   * 旅行模式（0.1.35）開著且設了旅行貨幣時，會被自動切換並在結束後恢復。
   */
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
  /**
   * 0.1.46：記帳頁區塊排序（設定頁決定）。
   * 區塊編號：1=支出/收入＋幣別選單、2=輸入金額＋快速金額、3=分類、4=備註、
   * 5=日期時間、6=收據圖片、7=清空＋記錄按鈕。
   * 空陣列＝全部照預設顯示；有值＝**只顯示有排進去的**、依陣列順序由上到下
   * （沒排進去的＝不顯示；有設「預設值」就用預設值提交，沒設照原本的行為走）。
   */
  homeLayout: number[]
  /**
   * 0.1.46：排版編號的版本記號。
   * 0.1.45 的編號沒有「分類」（1..6）；0.1.46 插入分類變 3 號、後面的全部 +1。
   * 舊資料（沒有這個記號）載入時自動遷移一次，遷移後存 2，避免重複遷移。
   */
  homeLayoutV: number
  /**
   * 0.1.46：隱藏區塊的預設值——排版裡沒排進去的區塊，提交時改用這裡的值
   * （有設才用；全部留空＝跟原本完全一樣）。
   */
  homeDefaults: HomeDefaults
  /**
   * 旅行模式（0.1.35）：目前進行中的旅行；null＝沒有。
   * 一次只有一個（使用者拍板）；結束後清回 null（旅行本體移進 tripHistory）。
   */
  activeTrip: TravelTrip | null
  /**
   * 旅行模式（0.1.36）：已結束的旅行（照結束順序，最舊在最前）。
   * 「結束旅行」不再解除記錄的標記，這份清單就是「過去的旅行」的來源
   * （設定頁的旅行子頁面會列出來，明細頁也能把記錄歸進歷史旅行）。
   */
  tripHistory: TravelTrip[]
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
