/**
 * 手動部署到 GitHub Pages（把建置產物推到 gh-pages 分支）。
 *
 * 為什麼要有這支腳本：Pages 的資源路徑需要 `/<repo>/` 這個 base，但本機
 * `npm run preview` 服務的就是 `dist/`，如果直接用 Pages 的 base 蓋掉 `dist/`，
 * 本機打開就會因為找不到 `/＜repo＞/assets/*.js` 而**白畫面**。
 * 這裡改用獨立的輸出目錄 `.deploy/`，**完全不動 dist/**。
 *
 * 用法：
 *   GH_TOKEN=ghp_xxx node scripts/deploy-gh-pages.mjs [owner/repo]
 *   token 需要 classic 的 repo 權限，或 fine-grained 的 Contents: Read and write
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '.deploy')
const repo = process.argv[2] ?? process.env.GH_REPO ?? 'vincentwongmax/Document_inlocal'
const token = process.env.GH_TOKEN

if (!token) {
  console.error('✗ 需要 GH_TOKEN 環境變數（GitHub Personal Access Token）')
  process.exit(1)
}

const repoName = repo.split('/')[1]
if (!repoName) {
  console.error(`✗  repo 參數要長得像 owner/repo，收到：${repo}`)
  process.exit(1)
}
// 使用者站台（<user>.github.io）base 是 /，專案站台是 /<repo>/
const base = repoName.endsWith('.github.io') ? '/' : `/${repoName}/`

function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) {
    console.error(`✗ 指令失敗：${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

console.log(`▶ 以 base=${base} 建置到 .deploy/（不動 dist/）`)
run('npx', ['vite', 'build', '--outDir', '.deploy', '--emptyOutDir'], {
  env: { ...process.env, VITE_BASE: base },
})

// GitHub Pages 不跑 Jekyll 需要 .nojekyll，避免底線開頭的檔案被忽略
writeFileSync(resolve(OUT, '.nojekyll'), '')

if (!existsSync(resolve(OUT, 'index.html'))) {
  console.error('✗ .deploy/index.html 不存在，建置沒有成功')
  process.exit(1)
}

console.log(`▶ 推送到 ${repo} 的 gh-pages 分支`)
const inOut = { cwd: OUT }
run('git', ['init', '-q'], inOut)
run('git', ['symbolic-ref', 'HEAD', 'refs/heads/gh-pages'], inOut)
run('git', ['config', 'user.name', repo.split('/')[0]], inOut)
run('git', ['config', 'user.email', `${repo.split('/')[0]}@users.noreply.github.com`], inOut)
run('git', ['add', '-A'], inOut)
run('git', ['commit', '-q', '-m', `deploy: ${new Date().toISOString()}`], inOut)
run(
  'git',
  ['push', '-f', `https://${token}@github.com/${repo}.git`, 'gh-pages'],
  inOut,
)

console.log(`✓ 完成。等 GitHub Pages 建置後開：https://${repo.split('/')[0]}.github.io/${repoName}/`)
