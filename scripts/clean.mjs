/**
 * 清空 dist/。
 * 在 Windows 上，Node 的 rmSync 會被導向系統資源回收桶，大型 wasm／語言包會刪除失敗，
 * 因此改呼叫作業系統原生的刪除指令；其他平台（GitHub Actions 的 Linux runner）
 * 直接用 rmSync 即可。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
if (!existsSync(dist)) {
  console.log('· dist 不存在，略過清理')
  process.exit(0)
}

if (process.platform === 'win32') {
  const r = spawnSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', dist], { stdio: 'inherit' })
  if (r.status !== 0 || existsSync(dist)) {
    console.error('✗ 無法清理 dist，請手動刪除後再建置')
    process.exit(1)
  }
} else {
  rmSync(dist, { recursive: true, force: true })
}
console.log('✓ 已清理 dist/')
