/**
 * 記帳鍵盤運算：支援 + − × ÷ 與左右括號，遵循先乘除後加減
 * 輸入過程顯示完整公式，按下 = 才求值顯示答案
 */

type Token = { t: 'num'; v: string } | { t: 'op'; v: string } | { t: 'paren'; v: '(' | ')' }

export interface CalcState {
  tokens: Token[]
  /** 是否已按下 = （下一顆數字鍵會重新開始） */
  done: boolean
  /** 按 = 當下的原始公式（供顯示「1+1+2 =」用） */
  formula?: string
}

export const OPS = ['+', '-', '×', '÷'] as const

export function initCalc(): CalcState {
  return { tokens: [], done: false }
}

export function isOp(v: string): boolean {
  return (OPS as readonly string[]).includes(v)
}

function lastToken(s: CalcState): Token | undefined {
  return s.tokens[s.tokens.length - 1]
}

/** 目前未閉合的左括號數 */
function openCount(s: CalcState): number {
  let n = 0
  for (const t of s.tokens) {
    if (t.t === 'paren') n += t.v === '(' ? 1 : -1
  }
  return n
}

export function input(s: CalcState, key: string): CalcState {
  const next: CalcState = { tokens: s.tokens.map((t) => ({ ...t })), done: false }

  if (key === 'C') return initCalc()

  if (key === '⌫') {
    if (s.done) return initCalc()
    if (!next.tokens.length) return next
    const last = next.tokens[next.tokens.length - 1]!
    // 數字：只刪最後一個字元；其他 token：整顆移除
    if (last.t === 'num' && last.v.length > 1 && isFinite(Number(last.v))) {
      last.v = last.v.slice(0, -1)
      if (last.v === '' || last.v === '-') next.tokens.pop()
    } else {
      next.tokens.pop()
    }
    return next
  }

  if (key === '.') {
    const last = lastToken(next)
    if (!last || last.t === 'op' || (last.t === 'paren' && last.v === '(')) {
      next.tokens.push({ t: 'num', v: '0.' })
      return next
    }
    if (last.t === 'num' && !last.v.includes('.')) last.v += '.'
    return next
  }

  if (isOp(key)) {
    if (s.done) {
      // 承接上一次結果繼續運算
      const v = calcValue(s)
      return { tokens: [{ t: 'num', v: trimNum(v) }, { t: 'op', v: key }], done: false }
    }
    const last = lastToken(next)
    if (!last) {
      // 以 0 開頭，例如直接按 "+5"
      if (key === '-') {
        next.tokens.push({ t: 'num', v: '-' })
        return next
      }
      next.tokens.push({ t: 'num', v: '0' }, { t: 'op', v: key })
      return next
    }
    if (last.t === 'paren' && last.v === '(') {
      if (key === '-') {
        next.tokens.push({ t: 'num', v: '-' })
        return next
      }
      next.tokens.push({ t: 'num', v: '0' }, { t: 'op', v: key })
      return next
    }
    if (last.t === 'op') {
      // 連續按運算子：後者取代前者（但 "-0-" 這種負號開頭不覆蓋）
      if (last.v === '-' && next.tokens.length === 1) return next
      last.v = key
      return next
    }
    if (last.t === 'num' && (last.v === '-' || last.v === '' || !isFinite(Number(last.v)))) {
      return next
    }
    next.tokens.push({ t: 'op', v: key })
    return next
  }

  if (key === '(' || key === ')') {
    if (s.done) {
      // 從結果繼續：左括號開新式，右括號無效
      return key === '(' ? { tokens: [{ t: 'paren', v: '(' }], done: false } : s
    }
    const last = lastToken(next)
    if (key === '(') {
      // 開頭、運算子或左括號之後可直接開；數字或右括號之後隱含 ×
      if (!last || last.t === 'op' || (last.t === 'paren' && last.v === '(')) {
        next.tokens.push({ t: 'paren', v: '(' })
        return next
      }
      if (last.t === 'num' && (last.v === '-' || !isFinite(Number(last.v)))) return next
      next.tokens.push({ t: 'op', v: '×' }, { t: 'paren', v: '(' })
      return next
    }
    // 右括號：要有未閉合的左括號，且前面是數字或右括號
    if (openCount(next) <= 0 || !last) return next
    if (last.t === 'num' && isFinite(Number(last.v)) && last.v !== '-') {
      next.tokens.push({ t: 'paren', v: ')' })
      return next
    }
    if (last.t === 'paren' && last.v === ')') {
      next.tokens.push({ t: 'paren', v: ')' })
      return next
    }
    return next
  }

  // 數字
  if (s.done) {
    return { tokens: [{ t: 'num', v: key }], done: false }
  }
  const last = lastToken(next)
  if (
    !last ||
    last.t === 'op' ||
    (last.t === 'paren' && (last.v === '(' || last.v === ')'))
  ) {
    next.tokens.push({ t: 'num', v: key })
    return next
  }
  if (last.t === 'num') {
    if (last.v === '0') last.v = key
    // 單一數字最多 11 位：顯示區只排得下 11 個位，多按的第 12 位直接不進狀態
    // （而不是先收下再靠縮小字級硬塞）。點小數點／負號不佔這個額度。
    else if (last.v.replace(/[.\-]/g, '').length < 11) last.v += key
  }
  return next
}

export function equals(s: CalcState): CalcState {
  const formula = calcText(s)
  const v = calcValue(s)
  return { tokens: [{ t: 'num', v: trimNum(v) }], done: true, formula }
}

export function trimNum(n: number): string {
  if (!isFinite(n)) return '0'
  return String(Number(n.toFixed(4)))
}

/** 遞下降解析求值；不完整表達式（如 "12+"、"(1+2"）以有效部分計算 */
export function calcValue(s: CalcState): number {
  const tokens = s.tokens
  let i = 0

  function peek(): Token | undefined {
    return tokens[i]
  }

  function parseExpr(): number {
    let v = parseTerm()
    for (;;) {
      const t = peek()
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        i++
        const rhs = parseTerm()
        v = t.v === '+' ? v + rhs : v - rhs
      } else break
    }
    return v
  }

  function parseTerm(): number {
    let v = parseFactor()
    for (;;) {
      const t = peek()
      if (t && t.t === 'op' && (t.v === '×' || t.v === '÷')) {
        i++
        const rhs = parseFactor()
        v = t.v === '×' ? v * rhs : rhs === 0 ? v : v / rhs
      } else break
    }
    return v
  }

  function parseFactor(): number {
    const t = peek()
    if (!t) return 0
    if (t.t === 'paren' && t.v === '(') {
      i++
      const v = parseExpr()
      const c = peek()
      if (c && c.t === 'paren' && c.v === ')') i++
      return v
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      i++
      const v = parseFactor()
      return t.v === '-' ? -v : v
    }
    if (t.t === 'num') {
      i++
      const n = Number(t.v)
      return isFinite(n) ? n : 0
    }
    i++
    return 0
  }

  if (!tokens.length) return 0
  return parseExpr()
}

/** 顯示用公式，例如 1+2×(3−1) */
export function calcText(s: CalcState): string {
  return s.tokens
    .map((t) => (t.t === 'op' ? ` ${t.v} ` : t.v))
    .join('')
    .trim()
}

/** 大字顯示：輸入中顯示公式，按 = 後顯示答案 */
export function displayMain(s: CalcState): string {
  if (s.done) return s.tokens[0]?.t === 'num' ? s.tokens[0].v : '0'
  const text = calcText(s)
  return text === '' ? '0' : text
}

/** 小字顯示：按 = 後顯示「原公式 =」；輸入中為空 */
export function displaySub(s: CalcState): string {
  if (!s.done) return ''
  return s.formula ? `${s.formula} =` : ''
}

/**
 * 大字顯示要不要縮小字級。
 *
 * 單一數字上限是 11 位（見 `input()`），加上小數點或負號最多 12 個字元，
 * 所以**正常輸入永遠不會觸發**——多打的那一位根本不會進狀態，字級不會被縮小。
 * 只有長公式（`1 + 2 + 3 …`）或很大的計算結果才會走到這裡。
 */
export function isLongDisplay(text: string): boolean {
  return text.length > 12
}
