/**
 * 出来上がったページ（dist/ の中身）を、GitHub の `gh-pages` ブランチへ送る。
 * 送られた中身が、そのまま
 *   https://junnosuke0923.github.io/yojaku/
 * になる。
 *
 * `npm run deploy` から呼ばれる。その前に検算とビルドが済んでいるので、
 * ここでは「送る」ことだけをする。
 *
 * GitHub Actions（GitHub 側で自動ビルドするしくみ）は使っていない。
 * それには `workflow` という追加の権限が要り、依頼者の端末では
 * `gh` のログイン状態がそこまで整っていなかったため、
 * 手元でビルドして送るこの形にした（2026-08-26 の判断）。
 *
 * dist/ の中には、この用途だけの小さな git の記録が住んでいる。
 * ソースの履歴とは別物で、`vite build` はこの記録を消さない。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REMOTE = 'https://github.com/junnosuke0923/yojaku.git'
const NAME = 'junnosuke0923'
const MAIL = '251002352+junnosuke0923@users.noreply.github.com'

const app = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(app, 'dist')

/** dist/ の中で git を動かす。画面にそのまま出す */
const git = (...args) => execFileSync('git', args, { cwd: dist, stdio: 'inherit' })
/** 動かしてみて、失敗しなかったかどうかだけを返す */
const ok = (...args) => {
  try {
    execFileSync('git', args, { cwd: dist, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html が見当たりません。先に npm run build を実行してください。')
  process.exit(1)
}

// GitHub Pages に、これは Jekyll ではないと伝える目印
writeFileSync(join(dist, '.nojekyll'), '')

if (!existsSync(join(dist, '.git'))) {
  git('init', '-q', '-b', 'gh-pages')
}
// このパソコンには git の名前が設定されていないので、ここで補う。
// 学校のメールアドレスは公開したくないため、GitHub が用意している
// 転送用のアドレスを使う
if (!ok('config', 'user.name')) git('config', 'user.name', NAME)
if (!ok('config', 'user.email')) git('config', 'user.email', MAIL)

git('add', '-A')

// 前回とまったく同じなら、送るものが無い
if (ok('diff', '--cached', '--quiet')) {
  console.log('前回と中身が同じでした。送るものはありません。')
  process.exit(0)
}

const stamp = new Date().toLocaleString('sv-SE').slice(0, 16)
git('commit', '-q', '-m', `deploy ${stamp}`)

// gh-pages は「出来上がったものを置くだけ」の場所なので、
// 手元の内容で上書きしてよい
git('push', '-q', '--force', REMOTE, 'gh-pages:gh-pages')

console.log('\n送りました。1分ほどで反映されます:\n  https://junnosuke0923.github.io/yojaku/\n')
