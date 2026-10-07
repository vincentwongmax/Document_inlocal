import { computed, ref } from 'vue'
import type { AmountCandidate, DraftRecord, ImageRef } from '@/types'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { md5OfFile } from '@/lib/md5'
import { readShotTime } from '@/lib/exif'
import { putImage } from '@/lib/imageDb'
import { compressImage, makeOcrImage, makeThumb } from '@/lib/imaging'
import { recognize } from '@/lib/ocr'
import { uid } from '@/lib/id'
import { notify } from '@/lib/alerts'

const drafts = ref<DraftRecord[]>([])
const stage = ref<'idle' | 'prep' | 'ocr'>('idle')
const progress = ref({ done: 0, total: 0 })
const duplicates = ref(0)
const reviewOpen = ref(false)
const lastAddedIds = ref<string[]>([])
/** OCR 工作圖（原始尺寸放大版），辨識完即釋放 */
const ocrSources = new Map<string, Blob>()
/** 本批壓縮後的圖片總容量，供提示顯示 */
const savedBytes = ref(0)
const originalBytes = ref(0)

/** 依幣別偏好挑出預設金額候選 */
function pickDefault(cands: AmountCandidate[], preferred: string): AmountCandidate | undefined {
  if (!cands.length) return undefined
  const inPreferred = cands.filter((c) => c.currency === preferred)
  const pool = inPreferred.length ? inPreferred : cands
  const total = pool.filter((c) => c.isTotal)
  const use = total.length ? total : pool
  return [...use].sort((a, b) => b.value - a.value)[0]
}

export function useUpload() {
  const records = useRecordsStore()
  const settings = useSettingsStore()

  const readyCount = computed(() => drafts.value.filter((d) => d.status === 'ready').length)
  const pendingCount = computed(
    () => drafts.value.filter((d) => d.status === 'pending' || d.status === 'ocr').length,
  )

  /** 選擇檔案（一次可多張） */
  function pick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => {
      void addFiles(Array.from(input.files ?? []))
    }
    input.click()
  }

  /** 上傳流程：MD5 去重 → 讀拍攝時間 → 排序 → 產生草稿 */
  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return

    stage.value = 'prep'
    progress.value = { done: 0, total: images.length }
    duplicates.value = 0
    savedBytes.value = 0
    originalBytes.value = 0

    const known = new Set(records.knownMd5)
    const batchSeen = new Set<string>()
    const items: Array<{ img: ImageRef; shotAt: string | null }> = []

    for (const file of images) {
      const md5 = await md5OfFile(file)
      // 100% 相同的圖片（MD5 一致）不重複建立記錄
      if (known.has(md5) || batchSeen.has(md5)) {
        duplicates.value++
        progress.value.done++
        continue
      }
      batchSeen.add(md5)

      // 先備一份給 OCR 用的工作圖（原尺寸或長邊 1400），再壓縮存檔
      const ocrSrc = await makeOcrImage(file)
      const shot = await readShotTime(file)
      const id = uid('img')
      const comp = await compressImage(file)
      await putImage(id, comp.blob)
      const thumb = await makeThumb(comp.blob)
      if (comp.width) ocrSources.set(id, ocrSrc)
      originalBytes.value += comp.originalBytes || file.size
      savedBytes.value += comp.bytes
      items.push({
        img: {
          id,
          md5,
          shotAt: shot.shotAt,
          name: file.name,
          thumb,
          w: comp.width || undefined,
          h: comp.height || undefined,
          bytes: comp.bytes,
          originalBytes: comp.originalBytes || file.size,
        },
        shotAt: shot.shotAt,
      })
      progress.value.done++
    }

    // 依圖片本身的拍攝時間排序；沒有時間的排在最後
    items.sort((a, b) => {
      const ta = a.shotAt ? Date.parse(a.shotAt) : Number.POSITIVE_INFINITY
      const tb = b.shotAt ? Date.parse(b.shotAt) : Number.POSITIVE_INFINITY
      return ta - tb
    })

    const firstExpense = settings.categoriesByType('expense')[0]?.id ?? ''
    for (const it of items) {
      drafts.value.push({
        key: uid('d'),
        images: [it.img],
        occurredAt: it.shotAt ?? new Date().toISOString(),
        type: 'expense',
        categoryId: firstExpense,
        amount: null,
        currency: settings.preferredCurrency || settings.baseCurrency,
        note: '',
        status: 'pending',
      })
    }

    reviewOpen.value = true
    stage.value = 'idle'
    await runOcr()
  }

  /** 依序對每張草稿做離線 OCR */
  async function runOcr() {
    const todo = drafts.value.filter((d) => d.status === 'pending')
    if (!todo.length) return

    stage.value = 'ocr'
    progress.value = { done: 0, total: todo.length }

    for (const d of todo) {
      d.status = 'ocr'
      try {
        const blob = ocrSources.get(d.images[0].id) ?? (await getBlob(d.images[0].id))
        if (blob) {
          const res = await recognize(blob, settings.state.ocrLangs)
          d.ocr = {
            text: res.text,
            confidence: res.confidence,
            dateCandidates: res.dates,
            amountCandidates: res.amounts,
          }
          if (res.dates.length) d.occurredAt = res.dates[0]
          const picked = pickDefault(res.amounts, d.currency || settings.preferredCurrency)
          if (picked) {
            d.amount = picked.value
            d.currency = picked.currency === 'UNKNOWN' ? settings.preferredCurrency : picked.currency
            d.ocr.pickedCurrency = d.currency
          }
        }
        d.status = 'ready'
      } catch (e) {
        d.status = 'error'
        d.error = e instanceof Error ? e.message : '辨識失敗'
      }
      ocrSources.delete(d.images[0].id)
      progress.value.done++
    }
    stage.value = 'idle'
  }

  async function getBlob(id: string) {
    const { getImage } = await import('@/lib/imageDb')
    return getImage(id)
  }

  /** 將確認過的草稿寫入記錄（接續在既有記錄之後） */
  function commit(only?: string[]) {
    const list = drafts.value.filter(
      (d) => (only ? only.includes(d.key) : true) && d.status !== 'duplicate' && d.amount !== null && d.amount > 0,
    )
    if (!list.length) {
      notify('沒有可新增的記錄（金額為空或已略過）', 'warn')
      return 0
    }
    const added: string[] = []
    for (const d of list) {
      const rec = records.add({
        type: d.type,
        categoryId: d.categoryId,
        amount: d.amount as number,
        currency: d.currency,
        occurredAt: d.occurredAt,
        note: d.note,
        images: d.images,
        source: 'image',
        ocr: d.ocr,
      })
      added.push(rec.id)
    }
    lastAddedIds.value = added
    drafts.value = []
    ocrSources.clear()
    reviewOpen.value = false
    notify(`已新增 ${added.length} 筆記錄`, 'ok', {
      label: '復原',
      run: () => added.forEach((id) => records.remove(id)),
    })
    return added.length
  }

  function removeDraft(key: string) {
    const i = drafts.value.findIndex((d) => d.key === key)
    if (i >= 0) drafts.value.splice(i, 1)
  }

  function clear() {
    drafts.value = []
    ocrSources.clear()
    reviewOpen.value = false
    stage.value = 'idle'
  }

  return {
    drafts,
    stage,
    progress,
    duplicates,
    reviewOpen,
    readyCount,
    pendingCount,
    lastAddedIds,
    savedBytes,
    originalBytes,
    pick,
    addFiles,
    runOcr,
    commit,
    removeDraft,
    clear,
  }
}
