/**
 * 手動部署到 GitHub Pages（把建置產物推到 gh-pages 分支）。
 *
 * 為什麼要獨立一支腳本：
 *  1. Pages 的資源路徑需要 `/<repo>/` 這個 base，但本機 `npm run preview` 服務的就是
 *     `dist/`；直接用 Pages 的 base 蓋掉 `dist/` 會讓本機打開變**白畫面**。
 *  2. 所以這裡建到**專案外**的全新臨時目錄：
 *     - 完全不動 `dist/`
 *     - 目錄每次都是空的，不需要刪任何東西（沙箱會攔檔案刪除），
 *       也不會殘留上一次的 `.git` 或舊的雜湊檔
 *
 * 用法：
 *   GH_TOKEN=ghp_xxx node scripts/deploy-gh-pages.mjs [owner/repo]
 *   token 需要 classic 的 repo 權限，或 fine-grained 的 Contents: Read and write
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = process.argv[2] ?? process.env.GH_REPO ?? 'vincentwongmax/Document_inlocal'
const token = process.env.GH_TOKEN

if (!token) {
  console.error('✗ 需要 GH_TOKEN 環境變數（GitHub Personal Access Token）')
  process.exit(1)
}

const [owner, repoName] = repo.split('/')
if (!owner || !repoName) {
  console.error(`✗ repo 參數要長得像 owner/repo，收到：${repo}`)
  process.exit(1)
}

// 使用者站台（<user>.github.io）base 是 /，專案站台是 /<repo>/
const base = repoName.endsWith('.github.io') ? '/' : `/${repoName}/`
const OUT = resolve(tmpdir(), `mop-ledger-pages-${Date.now()}`)

/** 印出指令時把 token 遮掉，避免 PAT 進到終端紀錄 */
function mask(text) {
  return token ? text.split(token).join('***') : text
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

console.log(`▶ 以 base=${base} 建置到 ${OUT}`)
// 直接叫 vite 的進入點、不走 shell：參數含空白或反斜線都不會被拆爛
const vite = spawnSync(
  process.execPath,
  [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', OUT],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_BASE: base } },
)
if (vite.status !== 0) fail('vite build 失敗')

if (!existsSync(resolve(OUT, 'index.html'))) fail(`${OUT}/index.html 不存在，建置沒有成功`)

// GitHub Pages 不跑 Jekyll 需要 .nojekyll，避免底線開頭的檔案被忽略
writeFileSync(resolve(OUT, '.nojekyll'), '')

console.log(`▶ 推送到 ${repo} 的 gh-pages 分支`)
// git 這幾道走 shell：參數都刻意不含空白，會被拆爛的只有含空白的參數
const git = (args) => {
  const shown = mask(args.join(' '))
  console.log(`  $ git ${shown}`)
  const r = spawnSync('git', args, { cwd: OUT, stdio: 'inherit', shell: true })
  if (r.status !== 0) fail(`git ${shown}`)
}

git(['init', '-q'])
git(['symbolic-ref', 'HEAD', 'refs/heads/gh-pages'])
git(['config', 'user.name', owner])
git(['config', 'user.email', `${owner}@users.noreply.github.com`])
git(['add', '-A'])
git(['commit', '-q', '-m', `deploy-${new Date().toISOString()}`])
git(['push', '-f', `https://${token}@github.com/${repo}.git`, 'gh-pages'])

// 清掉臨時目錄；沙箱可能攔刪除，失敗就算了（下次用的是新目錄）
try {
  rmSync(OUT, { recursive: true, force: true })
} catch {
  console.log(`· 臨時目錄留著沒關係：${OUT}`)
}

console.log(`✓ 完成。等 GitHub Pages 建置後開：https://${owner}.github.io/${repoName}/`)
