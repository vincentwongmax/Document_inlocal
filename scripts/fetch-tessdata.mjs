/**
 * 準備「離線執行 OCR」所需的靜態資源：
 *  1. 下載 Tesseract 語言包並 gzip 到 public/tessdata/
 *  2. 複製 tesseract.js 的 worker 與 wasm 核心到 public/tesseract-core/
 *
 * 全部會被 Service Worker 預快取，確保完全離線可用。
 *
 * 用法：node scripts/fetch-tessdata.mjs [--force]
 */
import { mkdir, writeFile, stat, copyFile, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const TESSDATA_DIR = resolve(ROOT, 'public/tessdata')
const CORE_DIR = resolve(ROOT, 'public/tesseract-core')
const REPO = 'tesseract-ocr/tessdata_fast'
const BRANCH = 'main'
const LANGS = ['eng', 'chi_sim', 'chi_tra']
/** 只需 LSTM 版本（OEM.LSTM_ONLY）；完整版體積過大 */
const CORE_FILES = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
]
const force = process.argv.includes('--force')

async function bigEnough(p) {
  try {
    return (await stat(p)).size > 1024
  } catch {
    return false
  }
}

async function fetchLang(lang) {
  const out = resolve(TESSDATA_DIR, `${lang}.traineddata.gz`)
  if (!force && (await bigEnough(out))) {
    console.log(`· ${lang} 已存在，略過`)
    return
  }
  const url = `https://github.com/${REPO}/raw/${BRANCH}/${lang}.traineddata`
  console.log(`↓ ${lang} ← ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${lang} 下載失敗：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const gz = gzipSync(buf, { level: 9 })
  await writeFile(out, gz)
  console.log(`✓ ${lang}：${(buf.length / 1048576).toFixed(1)}MB → ${(gz.length / 1048576).toFixed(1)}MB`)
}

async function copyCore() {
  const src = resolve(ROOT, 'node_modules/tesseract.js-core')
  await mkdir(CORE_DIR, { recursive: true })
  for (const f of CORE_FILES) {
    const to = resolve(CORE_DIR, f)
    if (!force && (await bigEnough(to))) {
      console.log(`· ${f} 已存在，略過`)
      continue
    }
    await copyFile(resolve(src, f), to)
    console.log(`✓ 複製 ${f}`)
  }
  // worker 腳本（來自 tesseract.js）
  const workerTo = resolve(CORE_DIR, 'worker.min.js')
  if (force || !(await bigEnough(workerTo))) {
    await copyFile(resolve(ROOT, 'node_modules/tesseract.js/dist/worker.min.js'), workerTo)
    console.log('✓ 複製 worker.min.js')
  }
  // 若核心目錄是舊版殘留，清掉不再需要的完整版
  const keep = [...CORE_FILES, 'worker.min.js']
  const extra = (await readdir(CORE_DIR)).filter((f) => !keep.includes(f))
  for (const f of extra) {
    console.log(`· 移除多餘核心檔 ${f}`)
    await import('node:fs/promises').then((fs) => fs.rm(resolve(CORE_DIR, f), { force: true }))
  }
}

await mkdir(TESSDATA_DIR, { recursive: true })
for (const lang of LANGS) await fetchLang(lang)
await copyCore()
console.log('✓ 離線 OCR 資源就緒')
