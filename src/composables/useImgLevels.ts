/**
 * 0.1.71：收據圖片的「壓縮等級」暫存區（記帳頁 ReceiptImages 與記錄明細 RecordSheet 共用）。
 *
 * 使用者原話：「用戶在未按下記錄或儲存前，可以自由切換選擇不同壓縮率的圖片，
 * 但記錄或儲存後，用戶就無法再選擇其他壓縮率的圖片(即只儲存用戶選擇的版本)」。
 *
 * 做法：**延遲寫入 IndexedDB**
 *   - `stage()`：上傳當下只壓縮到預設等級（A）並留在**記憶體**，不寫 DB
 *   - `setLevel()`：從記憶體裡的原檔重算（不重複讀 DB、不寫 DB）
 *   - `flush()`：按下「記錄／儲存」時，才把目前選的等級寫進 DB
 *   - 已寫入 DB 的（`saved`）或本來就在 DB 的（不在此清單）→ 等級鎖定不可改
 *
 * ⚠ 模組級單例：兩個元件（記帳頁／明細）同時存活時共用此清單，
 *   但圖片 id 全域唯一（`uid('img')`），不會互撞；各自的清理都用**自己的 id 集合**。
 */
import { ref } from 'vue'
import type { ImageRef } from '@/types'
import { compressAtLevel, DEFAULT_LEVEL, type LevelKey } from '@/lib/imgLevels'
import { makeThumb } from '@/lib/imaging'
import { getImage, putImage } from '@/lib/imageDb'

interface Pending {
  /** 原檔（切等級靠它重算；「原圖」等級直接存它） */
  file: File
  level: LevelKey
  blob: Blob
  /** 是否已寫入 IndexedDB（寫入＝鎖定，不許再換等級） */
  saved: boolean
}

const pend = ref(new Map<string, Pending>())
/** 正在重算等級的圖片 id（切換時鎖按鈕，避免連點） */
export const levelBusyId = ref<string | null>(null)

/**
 * 新圖進來：壓縮到指定等級、做縮圖，**只留記憶體**。
 * 回傳要放進清單的 ImageRef（呼叫端負責 md5 去重與 push）。
 */
export async function stageImage(
  file: File,
  id: string,
  md5: string,
  level: LevelKey = DEFAULT_LEVEL,
): Promise<ImageRef> {
  const comp = await compressAtLevel(file, level)
  // 縮圖跟等級無關（144px 預覽），用原檔做一次就夠；換等級不必重做
  const thumb = await makeThumb(file)
  pend.value.set(id, { file, level, blob: comp.blob, saved: false })
  return {
    id,
    md5,
    shotAt: null,
    name: file.name,
    thumb,
    w: comp.width || undefined,
    h: comp.height || undefined,
    bytes: comp.bytes,
    originalBytes: comp.originalBytes || file.size,
    level,
  }
}

/** 這張圖現在的等級（不在暫存區＝null，呼叫端應視為「鎖定」） */
export function levelOf(id: string): LevelKey | null {
  return pend.value.get(id)?.level ?? null
}

/** 是否在暫存區（本次上傳、還沒被記錄接手） */
export function hasPending(id: string): boolean {
  return pend.value.has(id)
}

/** 是否已寫入 DB（寫入後不許換等級） */
export function isSaved(id: string): boolean {
  return pend.value.get(id)?.saved === true
}

/** 等級是否鎖定（已儲存的記錄、或已寫入 DB 的圖） */
export function isLocked(id: string): boolean {
  const p = pend.value.get(id)
  return !p || p.saved
}

/**
 * 切換等級：從記憶體原檔重算，即時更新清單上那張圖的體積／尺寸。
 * 鎖定中的圖直接略過（record prop 傳進來的舊圖、已 flush 的圖）。
 */
export async function setLevel(im: ImageRef, level: LevelKey): Promise<void> {
  const p = pend.value.get(im.id)
  if (!p || p.saved || p.level === level || levelBusyId.value) return
  levelBusyId.value = im.id
  try {
    const comp = await compressAtLevel(p.file, level)
    p.level = level
    p.blob = comp.blob
    // 就地更新清單裡那個 ImageRef（它在父層的 reactive array 裡，改了就生效）
    im.bytes = comp.bytes
    im.w = comp.width || undefined
    im.h = comp.height || undefined
    im.originalBytes = comp.originalBytes || p.file.size
    im.level = level
  } finally {
    levelBusyId.value = null
  }
}

/**
 * 把暫存區裡的圖寫進 IndexedDB（記錄／儲存時呼叫）。
 * `ids` 有給就只寫清單內還在的（被 ✕ 移除的不寫 → 不會留孤兒）；
 * 已經寫過的不重寫。回傳實際寫入的張數。
 */
export async function flushLevels(ids?: Iterable<string>): Promise<number> {
  const allow = ids ? new Set(ids) : null
  let n = 0
  for (const [id, p] of pend.value) {
    if (p.saved) continue
    if (allow && !allow.has(id)) continue
    await putImage(id, p.blob)
    p.saved = true
    n++
  }
  return n
}

/**
 * 0.1.72：一次把**所有還沒鎖定**的圖切成同一個等級（收據圖片標題列那一排全域鈕）。
 * 已鎖定的（已寫入 DB、或舊記錄載入的）不動。
 * 回傳真正有換的張數（供呼叫端決定要不要提示）。
 */
export async function setLevelAll(ims: ImageRef[], level: LevelKey): Promise<number> {
  let n = 0
  for (const im of ims) {
    if (isLocked(im.id)) continue
    const before = pend.value.get(im.id)?.level
    await setLevel(im, level)
    if (before !== level) n++
  }
  return n
}

/** 0.1.72：這一串圖是不是都同一個等級（決定全域鈕要不要亮） */
export function commonLevel(ims: ImageRef[]): LevelKey | null {
  const ls = ims.filter((im) => !isLocked(im.id))
  if (!ls.length) return null
  const first = ls[0].level
  return ls.every((im) => im.level === first) ? (first ?? null) : null
}

/** 0.1.72：切換等級後讀回這張圖目前的 blob（給燈箱/縮圖重出 objectURL 用） */
export async function currentBlob(id: string): Promise<Blob | undefined> {
  return blobOf(id)
}

/** 從暫存區移除（放棄／移除圖片／記錄接手後都用它；DB 有無東西由呼叫端決定） */
export function dropPending(id: string): void {
  pend.value.delete(id)
}

/**
 * 讀圖片 blob：先看記憶體（本次上傳、還沒寫 DB 的），再退回 IndexedDB。
 * 燈箱放大與分享都走這裡，切換等級後看到的立刻就是新等級。
 */
export async function blobOf(id: string): Promise<Blob | undefined> {
  const p = pend.value.get(id)
  if (p) return p.blob
  return getImage(id)
}
