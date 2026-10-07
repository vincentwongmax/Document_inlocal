import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ImageRef, TxRecord, TxType, OcrInfo } from '@/types'
import { Keys, readJSON, writeJSON } from '@/lib/storage'
import { uid } from '@/lib/id'
import { deleteImage } from '@/lib/imageDb'
import { useSettingsStore } from './settings'

export interface NewRecordInput {
  type: TxType
  categoryId: string
  amount: number
  currency: string
  occurredAt: string
  note?: string
  /** 計算機的算式（只有真的算過才傳；見 lib/calc.ts 的 calcExpr） */
  expr?: string
  images?: ImageRef[]
  source?: TxRecord['source']
  ocr?: OcrInfo
  /** 指定錢包（匯入用）；不給就寫進當前錢包 */
  walletId?: string
}

export const useRecordsStore = defineStore('records', () => {
  const settings = useSettingsStore()

  /**
   * ⚠ `all` 是**全部錢包**的記錄（單一鍵持久化）。
   * 對外的 `records` 只回當前錢包的那些 —— 這樣所有畫面自動只看得到當前錢包，
   * 但圖片去重、刪除時「還有誰在用這張圖」仍然看得到全部（圖檔 blob 是跨錢包共用的）。
   */
  const all = ref<TxRecord[]>(readJSON<TxRecord[]>(Keys.RECORDS_KEY) ?? [])
  const persistError = ref<string | null>(null)

  // 單錢包時代的舊記錄沒有 walletId → 補上當前（遷移出來的預設）錢包。
  // ⚠ 這段在 store 初始化時跑，那時下面的 watch 還沒掛上 → 補完要自己寫回去，
  //   不然 localStorage 會一直留著沒有 walletId 的舊資料，每次載入都重補一次
  let migrated = false
  for (const r of all.value) {
    if (!r.walletId) {
      r.walletId = settings.activeWalletId
      migrated = true
    }
  }
  if (migrated) writeJSON(Keys.RECORDS_KEY, all.value)

  const records = computed(() => all.value.filter((r) => r.walletId === settings.activeWalletId))

  let timer: number | undefined
  watch(
    all,
    () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const ok = writeJSON(Keys.RECORDS_KEY, all.value)
        persistError.value = ok ? null : 'localStorage 空間不足，最新變動可能無法保存'
      }, 200)
    },
    { deep: true },
  )

  /** 已存在的圖片 MD5，上傳去重用（跨錢包：同一張圖不重複存） */
  const knownMd5 = computed(() => {
    const s = new Set<string>()
    for (const r of all.value) for (const im of r.images ?? []) s.add(im.md5)
    return s
  })

  /** walletId -> 筆數（錢包卡片顯示與「有記錄不給刪」用） */
  const countByWallet = computed(() => {
    const m: Record<string, number> = {}
    for (const r of all.value) m[r.walletId] = (m[r.walletId] ?? 0) + 1
    return m
  })

  function rateFor(code: string): number {
    return settings.rate(code)
  }

  function add(input: NewRecordInput): TxRecord {
    const now = new Date().toISOString()
    const amount = Number.isFinite(input.amount) ? Number(input.amount.toFixed(2)) : 0
    const rate = input.currency === settings.baseCurrency ? 1 : rateFor(input.currency)
    const rec: TxRecord = {
      id: uid('r'),
      walletId: input.walletId ?? settings.activeWalletId,
      createdAt: now,
      updatedAt: now,
      occurredAt: input.occurredAt,
      type: input.type,
      categoryId: input.categoryId,
      amount,
      currency: input.currency,
      rate,
      baseCurrency: settings.baseCurrency,
      baseAmount: Number((amount * rate).toFixed(2)),
      note: input.note ?? '',
      expr: input.expr?.trim() ? input.expr.trim() : undefined,
      source: input.source ?? 'manual',
      images: input.images ?? [],
      ocr: input.ocr,
    }
    all.value.push(rec)
    return rec
  }

  function update(id: string, patch: Partial<Omit<TxRecord, 'id' | 'createdAt'>>) {
    const r = all.value.find((x) => x.id === id)
    if (!r) return
    Object.assign(r, patch, { updatedAt: new Date().toISOString() })
    if (patch.amount !== undefined || patch.currency !== undefined || patch.rate !== undefined) {
      const rate = r.currency === r.baseCurrency ? 1 : r.rate
      r.rate = patch.rate !== undefined ? patch.rate : rate
      r.amount = Number(r.amount.toFixed(2))
      r.baseAmount = Number((r.amount * r.rate).toFixed(2))
    }
  }

  function remove(id: string) {
    const idx = all.value.findIndex((x) => x.id === id)
    if (idx < 0) return
    const [r] = all.value.splice(idx, 1)
    for (const im of r.images ?? []) {
      // ⚠ 要問「全部錢包」還有沒有人在用，不能只看當前錢包
      const stillUsed = all.value.some((x) => (x.images ?? []).some((y) => y.md5 === im.md5))
      if (!stillUsed) void deleteImage(im.id)
    }
  }

  /** 刪除後復原（供 toast 的「復原」使用；圖片實體若已清除則只剩縮圖） */
  function restore(rec: TxRecord) {
    if (all.value.some((r) => r.id === rec.id)) return
    all.value.push(rec)
  }

  /** 重置：清空**當前錢包**的記錄與它專用的圖片（其他錢包不受影響） */
  async function reset() {
    const mine = records.value.map((r) => r.id)
    for (const id of mine) remove(id)
    // remove() 已經逐筆處理圖片；這裡只確保寫入立刻落地
    writeJSON(Keys.RECORDS_KEY, all.value)
  }

  /**
   * 匯入：一律合併，以 id 與圖片 MD5 去重。
   * `walletId` 指定要併進哪個錢包（預設當前錢包）；
   * 記錄自己帶 walletId（v2 匯出檔）且那個錢包也在本機時，會沿用記錄自己的錢包。
   */
  function mergeImport(list: TxRecord[], walletId?: string): { added: number; skipped: number } {
    const target = walletId ?? settings.activeWalletId
    const byId = new Set(all.value.map((r) => r.id))
    const md5 = new Set(knownMd5.value)
    const local = new Set(settings.wallets.map((w) => w.id))
    let added = 0
    let skipped = 0
    for (const r of list) {
      const dupMd5 = (r.images ?? []).some((im) => md5.has(im.md5))
      if (byId.has(r.id) || dupMd5) {
        skipped++
        continue
      }
      byId.add(r.id)
      for (const im of r.images ?? []) md5.add(im.md5)
      const wid = r.walletId && local.has(r.walletId) ? r.walletId : target
      all.value.push({ ...r, walletId: wid })
      added++
    }
    return { added, skipped }
  }

  function replaceAll(list: TxRecord[]) {
    all.value = list
  }

  /* ── 查詢（一律只涵蓋當前錢包） ─────────────────────── */
  const byNewest = computed(() =>
    [...records.value].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
  )

  const byOccurred = computed(() =>
    [...records.value].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0)),
  )

  const totalExpense = computed(() =>
    records.value.filter((r) => r.type === 'expense').reduce((s, r) => s + r.baseAmount, 0),
  )
  const totalIncome = computed(() =>
    records.value.filter((r) => r.type === 'income').reduce((s, r) => s + r.baseAmount, 0),
  )

  return {
    records,
    all,
    persistError,
    knownMd5,
    countByWallet,
    add,
    update,
    remove,
    restore,
    reset,
    mergeImport,
    replaceAll,
    byNewest,
    byOccurred,
    totalExpense,
    totalIncome,
  }
})
