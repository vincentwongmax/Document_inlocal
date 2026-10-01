import SparkMD5 from 'spark-md5'

/** 計算 ArrayBuffer 的 MD5（十六進位小寫） */
export function md5OfBuffer(buf: ArrayBuffer): string {
  return SparkMD5.ArrayBuffer.hash(buf)
}

export async function md5OfBlob(blob: Blob): Promise<string> {
  return md5OfBuffer(await blob.arrayBuffer())
}

export async function md5OfFile(file: File): Promise<string> {
  return md5OfBlob(file)
}
