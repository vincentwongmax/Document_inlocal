import exifr from 'exifr'

export interface ShotInfo {
  shotAt: string | null
  /** 來源：EXIF / 檔名 / 檔案修改時間 / 無 */
  from: 'exif' | 'name' | 'mtime' | 'none'
}

function toISO(d: Date | string | number | undefined | null): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/** 從檔名猜測，例如 IMG_20261002_123456 / 2026-10-02 12:34:56 */
function fromName(name: string): string | null {
  const a = name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/)
  if (a) {
    const d = new Date(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +a[6])
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const b = name.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/)
  if (b) {
    const d = new Date(+b[1], +b[2] - 1, +b[3], 12, 0, 0)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/** 取圖片拍攝時間：EXIF DateTimeOriginal > 檔名 > 檔案修改時間 */
export async function readShotTime(file: File): Promise<ShotInfo> {
  try {
    const parsed = await exifr.parse(file, {
      tiff: true,
      ifd0: true,
      exif: true,
      translateKeys: true,
      reviveValues: true,
      silentErrors: true,
    } as never)
    const iso =
      toISO(parsed?.DateTimeOriginal) ??
      toISO(parsed?.CreateDate) ??
      toISO(parsed?.ModifyDate) ??
      toISO(parsed?.DateTime)
    if (iso) return { shotAt: iso, from: 'exif' }
  } catch {
    /* EXIF 讀取失敗，往下走 */
  }

  const byName = fromName(file.name)
  if (byName) return { shotAt: byName, from: 'name' }

  const byMtime = toISO(file.lastModified)
  if (byMtime) return { shotAt: byMtime, from: 'mtime' }

  return { shotAt: null, from: 'none' }
}
