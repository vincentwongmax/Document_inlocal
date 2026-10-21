/**
 * 0.1.66：快速匯入的**貼上資料解析器**（設定頁 → 匯入 → 「貼上資料」分頁）。
 *
 * 使用者原話：「貼上資料(輸入框)(增量匯入) --> 用戶輸入 -->
 * A MOP 10 1 test 2026/10/17 23:13 --> 支出(A支出，B收入)(用戶也可以輸入文字
 * 支出/收入), MOP , 金額10 , 分類(分類中的第1個)(用戶也可以輸入分類的全稱)
 * (在設定頁中，把分類裡面的都分配一個數字，由1開始) , 備注: test ,
 * 日期時間 2026/10/17 23:13 , 可以支持多行，多筆…支持用戶由EXCEL 複製貼上的格式」
 *
 * 設計（全部由我自行決策，詳見 CHANGELOG 0.1.66）：
 * - **純函式**：不碰 store、不碰 DOM，輸入是文字＋上下文（分類、幣別、預設貨幣），
 *   輸出是一列列的 `QuickDraft`——所以守門員可以直接餵字串斷言，UI 也能即時預覽。
 * - **欄位靠型樣辨認、不靠位置**：這樣 Excel 貼上（缺收支、缺貨幣）與
 *   完整格式（A MOP 10 1 test 日期）能用同一套規則吃掉。
 * - **日期時間視為單一 token**：`2026/10/17 23:13` 中間有空白，先正則切成
 *   一個 token，才不會把時間當成備註。
 * - **分工种**：第一個數字＝金額、第二個數字＝分類編號（使用者範例的順序）。
 * - **寬鬆**：看不懂的 token 一律併進備註；缺的欄位（收支、貨幣、日期）
 *   補預設值並記在 `issues`，由快速記錄頁標紅讓使用者當場修。
 */
import type { Category, TxType } from '@/types'
import { flatTreeByType } from '@/lib/tree'
import { fromLocalInput, parseLooseDateTime } from '@/lib/date'

/** 一列待確認的資料（貼上解析或手動新增都是它） */
export interface QuickDraft {
  type: TxType
  /** 幣別代碼；沒填就用記帳幣別 */
  currency: string
  /** 金額；0＝還沒填（視為不完整） */
  amount: number
  /** 分類 id；''＝還沒解析到（視為不完整） */
  categoryId: string
  note: string
  /** 發生時間（ISO）；沒填就用「現在」 */
  occurredAt: string
  /** 原始的那一行文字（貼上來的才有；手動新增是 ''） */
  raw: string
  /** 不完整的理由；空陣列＝可以提交 */
  issues: string[]
}

export interface QuickParseCtx {
  /** 全部分類（設定頁的順序）——編號與名稱都靠它解 */
  categories: Category[]
  /** 認得的幣別代碼（內建＋自訂＋匯率選單） */
  currencyCodes: Set<string>
  /** 沒填貨幣時的預設（記帳幣別） */
  defaultCurrency: string
  /**
   * 0.1.75：數量模式 —— 沒有**幣別**之分（貨幣代碼當一般文字），
   * 完整性提示改說「數量」。
   * 0.1.76：數量模式也有收支了（銷貨／庫存是一正一負）→ A／B／支出／收入
   * 恢復解析，只有幣別這一项仍然跳過。
   */
  quantityMode?: boolean
}

/* ── token 切分 ──────────────────────────────────────────────── */

/** 日期時間（2026/10/17 23:13、2026-10-17、2026.10.7 20:53…）——中間的空白要整顆吃掉 */
const DATE_TOKEN = String.raw`\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?`
/** 整顆就是日期時間（用來分類 token；切分用上面那條） */
const DATE_FULL = new RegExp(`^${DATE_TOKEN}$`)
/** 先試日期時間，失敗才當一般 token（非空白一串） */
const TOKEN_RE = new RegExp(`${DATE_TOKEN}|\\S+`, 'g')

/** 全形 → 半形（只有數字與幾個常見分隔，其他原樣留著） */
const FW: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '／': '/', '．': '.', '－': '-', '：': ':', '　': ' ',
}
function halfWidth(s: string): string {
  return s.replace(/[０-９／．－：　]/g, (c) => FW[c] ?? c)
}

function tokenize(line: string): string[] {
  return line.match(TOKEN_RE) ?? []
}

/* ── token 型樣 ──────────────────────────────────────────────── */

/** 收支的各種講法（A／B 大小寫都收，也收中文與英文全字） */
const TYPE_WORDS: Record<string, TxType> = {
  a: 'expense',
  b: 'income',
  expense: 'expense',
  income: 'income',
  支出: 'expense',
  收入: 'income',
}
const NUM_RE = /^-?\d+(?:\.\d{1,2})?$/
const INT_RE = /^\d+$/

/* ── 分類解析 ────────────────────────────────────────────────── */

/** 根 → 自己的路徑字串（"餐飲 › 午餐"），跟 PathLabel 的分隔一致 */
function pathName(c: Category, all: Category[]): string {
  const byId = new Map(all.map((x) => [x.id, x]))
  const segs: string[] = []
  const seen = new Set<string>()
  let cur: Category | undefined = c
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    segs.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return segs.join(' › ')
}

/**
 * 用**名字**找分類：先同一種收支、再另一種（跨型別是便利性，
 * 例如收入分類剛好叫「餐飲」）。比對順序：全名 → 完整路徑 → 路徑尾段。
 */
export function findCatByName(name: string, type: TxType, cats: Category[]): Category | undefined {
  const key = name.trim()
  if (!key) return undefined
  const pick = (list: Category[]): Category | undefined =>
    list.find((c) => c.name === key) ??
    list.find((c) => pathName(c, cats) === key) ??
    list.find((c) => pathName(c, cats).endsWith(' › ' + key))
  return (
    pick(cats.filter((c) => c.type === type && !c.archived)) ??
    pick(cats.filter((c) => c.type !== type && !c.archived))
  )
}

/** 用**編號**找分類（1 起，依設定頁「分類」區的順序，同一種收支內） */
export function findCatByNo(no: number, type: TxType, cats: Category[]): Category | undefined {
  return flatTreeByType(cats, type)[no - 1]?.cat
}

/* ── 單欄解析（格子編輯器的「確定」也靠這幾個） ────────────────── */

/** 'a'/'支出'/'expense' → expense；看不懂回 null */
export function parseTypeText(s: string): TxType | null {
  const t = halfWidth(s).trim()
  return TYPE_WORDS[t.toLowerCase()] ?? TYPE_WORDS[t] ?? null
}

/** '1,234.5'／'１２３' → 123.4…；看不懂或 ≤0 回 null */
export function parseAmountText(s: string): number | null {
  const t = halfWidth(s).trim().replace(/,/g, '')
  if (!NUM_RE.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 認得的幣別代碼（轉大寫）；看不懂回 null。空字串＝用預設（回 defaultCurrency） */
export function parseCurrencyText(s: string, ctx: QuickParseCtx): string | null {
  const t = halfWidth(s).trim().toUpperCase()
  if (!t) return ctx.defaultCurrency
  return ctx.currencyCodes.has(t) ? t : null
}

/**
 * 編號或名字 → 分類 id；看不懂回 null。空字串＝還沒決定（回 null，由呼叫端記 issue）
 * 0.1.76：數量模式的分類不分收支 → 一律用 'expense' 解（見 parseLine 的 5)）。
 */
export function parseCategoryText(s: string, type: TxType, ctx: QuickParseCtx): string | null {
  const t = halfWidth(s).trim()
  if (!t) return null
  const ty = ctx.quantityMode ? 'expense' : type
  if (INT_RE.test(t)) return findCatByNo(Number(t), ty, ctx.categories)?.id ?? null
  return findCatByName(t, ty, ctx.categories)?.id ?? null
}

/* ── 主解析 ──────────────────────────────────────────────────── */

/** 解析一整段貼上的文字（多行多筆） */
export function parseQuickLines(text: string, ctx: QuickParseCtx): QuickDraft[] {
  const out: QuickDraft[] = []
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (!halfWidth(line).trim()) continue
    out.push(parseLine(line, ctx))
  }
  return out
}

function parseLine(rawLine: string, ctx: QuickParseCtx): QuickDraft {
  const d: QuickDraft = {
    type: 'expense',
    currency: ctx.defaultCurrency,
    amount: 0,
    categoryId: '',
    note: '',
    occurredAt: new Date().toISOString(),
    raw: rawLine.trim(),
    issues: [],
  }
  let typeSet = false
  let amountSet = false
  let curSet = false
  let catNo = 0 // 第二個數字＝分類編號（迴圈結束才解，那時 type 已定）
  const notes: string[] = []
  let dateText = ''

  for (const t of tokenize(halfWidth(rawLine))) {
    // 1) 收支（A／B／支出／收入…）—— 0.1.76 起數量模式也認（只有幣別不認）
    if (!typeSet) {
      const tw = TYPE_WORDS[t.toLowerCase()] ?? TYPE_WORDS[t]
      if (tw) {
        d.type = tw
        typeSet = true
        continue
      }
    }
    // 2) 日期時間（放最後出現的那個）
    if (DATE_FULL.test(t)) {
      dateText = t
      continue
    }
    // 3) 第一個數字＝金額
    if (!amountSet && NUM_RE.test(t)) {
      d.amount = Number(t)
      amountSet = true
      continue
    }
    // 4) 幣別代碼（認得才算；已經有一個就不再收，避免吃掉備註裡的字）
    //    數量模式沒有幣別 → 這一步整個跳過（代碼當一般文字）
    if (!ctx.quantityMode && !curSet && ctx.currencyCodes.has(t.toUpperCase())) {
      d.currency = t.toUpperCase()
      curSet = true
      continue
    }
    // 5) 分類：第二個數字＝編號，否則試名字
    //    0.1.76：數量模式的分類不分收支（qCategories 全是同一型）→ 一律用
    //    'expense' 解，不然收入列會找不到任何分類。
    if (!d.categoryId) {
      if (INT_RE.test(t)) {
        catNo = Number(t)
        continue
      }
      const c = findCatByName(t, ctx.quantityMode ? 'expense' : d.type, ctx.categories)
      if (c) {
        d.categoryId = c.id
        continue
      }
    }
    // 6) 剩下的都是備註
    notes.push(t)
  }

  d.note = notes.join(' ')

  // 編號類的分類（等 type 定了才解；數量模式同樣用 'expense' 解，見上面 5)）
  if (!d.categoryId && catNo > 0) {
    const c = findCatByNo(catNo, ctx.quantityMode ? 'expense' : d.type, ctx.categories)
    if (c) d.categoryId = c.id
    else d.issues.push(`分類編號 ${catNo} 不存在`)
  }

  // 日期時間
  if (dateText) {
    const local = parseLooseDateTime(dateText, '')
    if (local) d.occurredAt = fromLocalInput(local)
    else d.issues.push('日期格式錯誤')
  }

  // 完整性（數量模式沒有「金額」，改說「數量」）
  const amtWord = ctx.quantityMode ? '數量' : '金額'
  if (!(d.amount > 0)) d.issues.push(`${amtWord}未填`)
  if (!d.categoryId) d.issues.push('分類未填')

  return d
}

/** 全新的一列（「新增一列」按鈕；欄位全是預設／空白，issues 標著還缺什麼） */
export function blankDraft(ctx: QuickParseCtx): QuickDraft {
  return {
    type: 'expense',
    currency: ctx.defaultCurrency,
    amount: 0,
    categoryId: '',
    note: '',
    occurredAt: new Date().toISOString(),
    raw: '',
    issues: [`${ctx.quantityMode ? '數量' : '金額'}未填`, '分類未填'],
  }
}

/** 提交前的最後檢查（格子編輯器改完後呼叫，issues 會即時更新） */
export function recheckDraft(d: QuickDraft, quantityMode = false): void {
  d.issues = []
  if (!(d.amount > 0)) d.issues.push(`${quantityMode ? '數量' : '金額'}未填`)
  if (!d.categoryId) d.issues.push('分類未填')
}
