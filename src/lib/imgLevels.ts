/**
 * 0.1.71：收據圖片的壓縮等級（使用者原話：「依目前的圖片壓縮做標準，再提供原圖和
 * 多3個更高壓縮率(體積更細)的小型按鈕(ICON)選擇…記錄或儲存後就無法再選擇」）。
 *
 * 五個等級（每張圖各自選，未記錄／儲存前可自由切換）：
 *   - 原（原圖）  ：**存原始檔案本體**（0.1.71 使用者拍板：不轉檔、不縮尺寸）
 *   - A（1600px） ：現行標準（長邊 1600／300KB）—— 0.1.44 以來的預設行為
 *   - B（1080px） 、C（640px）、D（320px）：更高壓縮率，體積更細
 *
 * ⚠ 「原」存原檔的两个後續影響（使用者選擇時已知）：
 *   1. 格式可能是 HEIC／WebP／PNG —— 大部分瀏覽器的 `<img>` 看得懂 JPEG/PNG/WebP，
 *      HEIC 在部份桌機瀏覽器可能顯示不出來（分享到 Android 也常無法預覽）。
 *   2. 體積可能好幾 MB（IndexedDB 容量很大，但匯出 JSON 時不會含 blob，影響有限）。
 */

import { compressImage, MAX_EDGE, TARGET_BYTES } from './imaging'
import type { LevelKey } from '@/types'

export type { LevelKey }

export interface ImgLevel {
  key: LevelKey
  /** 按鈕上的短標（原／A／B／C／D） */
  label: string
  /** 按鈕 title（滑鼠移上去的說明） */
  title: string
  /** 長邊上限；null＝不縮尺寸（原圖） */
  edge: number | null
  /** 容量目標； Infinity＝不砍容量（原圖） */
  targetBytes: number
}

export const IMG_LEVELS: readonly ImgLevel[] = [
  { key: 'orig', label: '原', title: '原圖（不做任何壓縮，存原始檔案）', edge: null, targetBytes: Infinity },
  { key: 'a', label: 'A', title: 'A：長邊 1600px（現行標準）', edge: MAX_EDGE, targetBytes: TARGET_BYTES },
  { key: 'b', label: 'B', title: 'B：長邊 1080px（體積更細）', edge: 1080, targetBytes: 180 * 1024 },
  { key: 'c', label: 'C', title: 'C：長邊 640px（體積更細）', edge: 640, targetBytes: 140 * 1024 },
  { key: 'd', label: 'D', title: 'D：長邊 320px（體積最細）', edge: 320, targetBytes: 70 * 1024 },
]

/** 預戴等級＝A（維持現行標準，使用者每次上傳後看到的行为跟 0.1.70 一樣） */
export const DEFAULT_LEVEL: LevelKey = 'a'

export function isLevelKey(v: unknown): v is LevelKey {
  return v === 'orig' || v === 'a' || v === 'b' || v === 'c' || v === 'd'
}

/** 等級 → 長邊文字（提示用；原圖回「原尺寸」） */
export function levelEdgeText(key: LevelKey): string {
  const lv = IMG_LEVELS.find((l) => l.key === key)
  return lv?.edge ? `${lv.edge}px` : '原尺寸'
}

/**
 * 依等級壓縮。
 * 原圖＝直接用原檔（呼叫端拿到的是同一個 Blob，不做任何處理）；
 * 其餘走 `compressImage`（先降品質，最低 0.62 才縮尺寸，見 imaging.ts）。
 */
export async function compressAtLevel(file: Blob, key: LevelKey) {
  const lv = IMG_LEVELS.find((l) => l.key === key)
  if (!lv || lv.edge === null) {
    return {
      blob: file,
      width: 0,
      height: 0,
      bytes: file.size ?? 0,
      type: file.type || 'application/octet-stream',
      originalBytes: file.size ?? 0,
    }
  }
  return compressImage(file, lv.edge, lv.targetBytes)
}
