import type { Category } from '@/types'

/**
 * 把分類攤平成「大類 → 它的子分類 → 再下一層…」的深度優先順序。
 *
 * 子分類一律緊接在自己的上層後面，下拉清單才讀得出階層，例如：
 * 餐飲、餐飲 › 午餐、餐飲 › 晚餐、旅行、旅行 › 中國、旅行 › 北京。
 * 同一層之間維持傳入時的順序，也可以用 `sortSiblings` 改成別的排法（例如依使用頻率）。
 */
export function flattenCategories(
  list: Category[],
  sortSiblings?: (kids: Category[]) => Category[],
): Category[] {
  const ids = new Set(list.map((c) => c.id))
  const byParent = new Map<string | null, Category[]>()
  for (const c of list) {
    // 上層不在這份清單裡（被過濾掉或已封存）就當成頂層，否則這一筆會整批消失
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null
    const arr = byParent.get(key)
    if (arr) arr.push(c)
    else byParent.set(key, [c])
  }

  const out: Category[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    const kids = byParent.get(parent)
    if (!kids) return
    for (const c of sortSiblings ? sortSiblings(kids) : kids) {
      if (seen.has(c.id)) continue // 資料有環時保命，不要無限遞迴
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(null)

  // 有環導致從頂層走不到的分類，補在最後，至少不會消失
  for (const c of list) if (!seen.has(c.id)) out.push(c)
  return out
}

/**
 * 0.1.66：把某一種收支的分類攤平成「大類 → 子分類 → 再下一層…」，
 * **帶著深度**，並標記 1 起的序號——設定頁「分類」區的編號與
 * 快速匯入解析器（貼上資料的分類欄）共用這一份順序。
 *
 * ⚠ 語義要跟 settings store 的 `childrenOf` 完全一致：
 *   - 已封存（archived）的分類整棵消失（它的子孫也不會出現）
 *   - 同一層之間維持 `cats` 傳入時的順序
 *   - 上層被封存時，其子分類**不會**被提成頂層（跟著上層一起消失）
 *     —— 所以不能先 filter 再交給 flattenCategories（它會把孤兒提成根）
 */
export function flatTreeByType(
  cats: Category[],
  type: Category['type'],
): { cat: Category; depth: number; no: number }[] {
  const out: { cat: Category; depth: number; no: number }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const c of cats) {
      if (c.archived || c.type !== type) continue
      if ((c.parentId ?? null) !== parentId) continue
      out.push({ cat: c, depth, no: out.length + 1 })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
