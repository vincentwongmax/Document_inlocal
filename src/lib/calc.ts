/**
 * 記帳鍵盤運算：支援 + - × ÷，遵循先乘除後加減
 * 全程以字串 token 保存，避免浮點誤差與狀態錯亂
 */

type Token = { t: 'num'; v: string } | { t: 'op'; v: string }

export interface CalcState {
  tokens: Token[]
  /** 是否已按下 = （下一顆數字鍵會重新開始） */
  done: boolean
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

export function input(s: CalcState, key: string): CalcState {
  const next: CalcState = { tokens: s.tokens.map((t) => ({ ...t })), done: false }

  if (key === 'C') return initCalc()

  if (key === '⌫') {
    const last = lastToken(next)
    if (!last) return initCalc()
    if (last.t === 'op') {
      next.tokens.pop()
      return next
    }
    last.v = last.v.slice(0, -1)
    if (last.v === '') next.tokens.pop()
    return next
  }

  if (key === '.') {
    const last = lastToken(next)
    if (!last || last.t === 'op') {
      next.tokens.push({ t: 'num', v: '0.' })
      return next
    }
    if (!last.v.includes('.')) last.v += '.'
    return next
  }

  if (key === '±') {
    const last = lastToken(next)
    if (!last || last.t === 'op') {
      next.tokens.push({ t: 'num', v: '-' })
      return next
    }
    last.v = last.v.startsWith('-') ? last.v.slice(1) : `-${last.v}`
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
    if (last.t === 'op') {
      // 連續按運算子：後者取代前者（但 "-0-" 這種負號開頭不覆蓋）
      if (last.v === '-' && next.tokens.length === 1) return next
      last.v = key
      return next
    }
    if (last.v === '-' || last.v === '' || !isFinite(Number(last.v))) return next
    next.tokens.push({ t: 'op', v: key })
    return next
  }

  // 數字
  if (s.done) {
    return { tokens: [{ t: 'num', v: key }], done: false }
  }
  const last = lastToken(next)
  if (!last || last.t === 'op') {
    next.tokens.push({ t: 'num', v: key })
    return next
  }
  if (last.v === '0') last.v = key
  else if (last.v.replace(/[.\-]/g, '').length < 12) last.v += key
  return next
}

export function equals(s: CalcState): CalcState {
  const v = calcValue(s)
  return { tokens: [{ t: 'num', v: trimNum(v) }], done: true }
}

export function trimNum(n: number): string {
  if (!isFinite(n)) return '0'
  return String(Number(n.toFixed(4)))
}

/** 依先乘除後加減求值；不完整表達式（如 "12+"）以目前為止的結果呈現 */
export function calcValue(s: CalcState): number {
  const nums: number[] = []
  const ops: string[] = []
  for (const tk of s.tokens) {
    if (tk.t === 'num') {
      const n = Number(tk.v)
      nums.push(isFinite(n) ? n : 0)
    } else {
      ops.push(tk.v)
    }
  }
  if (nums.length === 0) return 0

  // 先處理 × ÷
  const stack: number[] = [nums[0]]
  const restOps: string[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const rhs = nums[i + 1]
    if (op === '×' || op === '÷') {
      const lhs = stack.pop() ?? 0
      stack.push(op === '×' ? lhs * rhs : rhs === 0 ? lhs : lhs / rhs)
    } else {
      restOps.push(op)
      stack.push(rhs)
    }
  }
  let total = stack[0]
  for (let i = 0; i < restOps.length; i++) {
    total = restOps[i] === '+' ? total + stack[i + 1] : total - stack[i + 1]
  }
  return total
}

/** 顯示用表達式，例如 12 + 5 × 3 */
export function calcText(s: CalcState): string {
  return s.tokens
    .map((t) => (t.t === 'op' ? ` ${t.v} ` : t.v))
    .join('')
    .trim()
}

/** 目前正在輸入的那個數字（大字顯示） */
export function currentNumber(s: CalcState): string {
  const last = lastToken(s)
  if (!last) return '0'
  if (last.t === 'op') return last.v
  return last.v === '-' ? '-' : last.v
}
