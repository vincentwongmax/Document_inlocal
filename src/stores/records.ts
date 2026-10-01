import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ImageRef, TxRecord, TxType, OcrInfo } from '@/types'
import { Keys, readJSON, writeJSON } from '@/lib/storage'
import { uid } from '@/lib/id'
import { clearImages, deleteImage } from '@/lib/imageDb'
import { useSettingsStore } from './settings'

export interface NewRecordInput {
  type: TxType
  categoryId: string
  amount: number
  currency: string
  occurredAt: string
  note?: string
  images?: ImageRef[]
  source?: TxRecord['source']
  ocr?: OcrInfo
}

export const useRecordsStore = defineStore('records', () => {
  const settings = useSettingsStore()
  const records = ref<TxRecord[]>(readJSON<TxRecord[]>(Keys.RECORDS_KEY) ?? [])
  const persistError = ref<string | null>(null)

  let timer: number | undefined
  watch(
    records,
    () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const ok = writeJSON(Keys.RECORDS_KEY, records.value)
        persistError.value = ok ? null : 'localStorage 空間不足，最新變動可能無法保存'
      }, 200)
    },
    { deep: true },
  )

  /** 已存在的圖片 MD5，上傳去重用 */
  const knownMd5 = computed(() => {
    const s = new Set<string>()
    for (const r of records.value) for (const im of r.images ?? []) s.add(im.md5)
    return s
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
      source: input.source ?? 'manual',
      images: input.images ?? [],
      ocr: input.ocr,
    }
    records.value.push(rec)
    return rec
  }

  function update(id: string, patch: Partial<Omit<TxRecord, 'id' | 'createdAt'>>) {
    const r = records.value.find((x) => x.id === id)
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
    const idx = records.value.findIndex((x) => x.id === id)
    if (idx < 0) return
    const [r] = records.value.splice(idx, 1)
    for (const im of r.images ?? []) {
      const stillUsed = records.value.some((x) => (x.images ?? []).some((y) => y.md5 === im.md5))
      if (!stillUsed) void deleteImage(im.id)
    }
  }

  /** 重置：清空所有記錄與圖片 */
  async function reset() {
    records.value = []
    await clearImages()
    writeJSON(Keys.RECORDS_KEY, [])
  }

  /** 匯入：一律合併，以 id 與圖片 MD5 去重 */
  function mergeImport(list: TxRecord[]): { added: number; skipped: number } {
    const byId = new Set(records.value.map((r) => r.id))
    const md5 = new Set(knownMd5.value)
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
      records.value.push(r)
      added++
    }
    return { added, skipped }
  }

  function replaceAll(list: TxRecord[]) {
    records.value = list
  }

  /* ── 查詢 ─────────────────────────────────────────────── */
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
    persistError,
    knownMd5,
    add,
    update,
    remove,
    reset,
    mergeImport,
    replaceAll,
    byNewest,
    byOccurred,
    totalExpense,
    totalIncome,
  }
})
