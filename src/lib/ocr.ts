import { createWorker, type Worker as TesseractWorker } from 'tesseract.js'
import { extractAmounts, extractDates } from './parse'
import type { AmountCandidate } from '@/types'

const BASE = import.meta.env.BASE_URL || '/'
const withBase = (p: string) => `${BASE.replace(/\/$/, '')}/${p.replace(/^\//, '')}`

const LANG_PATH = withBase('tessdata')
const CORE_PATH = withBase('tesseract-core')
const WORKER_PATH = withBase('tesseract-core/worker.min.js')

export interface OcrProgress {
  status: string
  progress: number
}

export interface OcrResult {
  text: string
  confidence: number
  dates: string[]
  amounts: AmountCandidate[]
}

let worker: TesseractWorker | null = null
let workerLangs = ''
let creating: Promise<TesseractWorker> | null = null
/** 目前這張圖的進度回呼（worker 會被多張圖依序共用） */
let progressCb: ((p: OcrProgress) => void) | null = null

async function getWorker(langs: string[]): Promise<TesseractWorker> {
  const key = langs.slice().sort().join('+')
  if (worker && workerLangs === key) return worker
  if (creating && workerLangs === key) return creating

  if (worker) {
    try {
      await worker.terminate()
    } catch {
      /* ignore */
    }
    worker = null
  }

  creating = (async () => {
    const w = await createWorker(key, 1, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: LANG_PATH,
      gzip: true,
      logger: (m: { status?: string; progress?: number }) => {
        progressCb?.({ status: m.status ?? '', progress: m.progress ?? 0 })
      },
    })
    workerLangs = key
    worker = w
    creating = null
    return w
  })()

  return creating
}

/** 對單張圖片做離線 OCR，並解析日期與金額候選 */
export async function recognize(
  image: Blob | File,
  langs: string[],
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  progressCb = onProgress ?? null
  const w = await getWorker(langs.length ? langs : ['eng'])
  const { data } = await w.recognize(image, {}, { text: true })
  progressCb = null
  const text = (data?.text ?? '').trim()
  return {
    text,
    confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
    dates: extractDates(text),
    amounts: extractAmounts(text),
  }
}

/** 釋放 worker（切換語言或離開時呼叫） */
export async function terminateOcr(): Promise<void> {
  if (worker) {
    try {
      await worker.terminate()
    } catch {
      /* ignore */
    }
  }
  worker = null
  creating = null
  workerLangs = ''
}
