import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * このビルドの目印。日時をそのまま使う。
 *
 * 同じ文字列を2か所に置く。
 *   1. アプリの中（__BUILD_ID__）
 *   2. `version.txt` という小さなファイル
 * 開いているページが自分の目印と version.txt を突き合わせれば、
 * 「新しい版が出ているのに、古いページを開いたまま」だと気づける。
 *
 * これが要るのは、置きなおすたびに JS のファイル名が変わるため。
 * スマホが古い index.html を持ったままだと、そこに書いてある名前の
 * ファイルはもうサーバーに無く、押しても何も起きない、という形で壊れる
 * （2026-08-27、実機で発生）。
 */
const BUILD_ID = new Date().toLocaleString('sv-SE').slice(0, 16)

/**
 * 覚えておく係（service worker）の中身。
 *
 * ここで文字列として書き出しているのは、この file が
 * アプリとは別の場所（ブラウザの裏側）で動くため。
 * まとめて1つに束ねる対象には入れない
 */
function swSource(buildId: string, files: string[]): string {
  return [
    `const CACHE = 'yojaku-${buildId}'`,
    `const FILES = ${JSON.stringify(files)}`,
    `/*`,
    `  覚えたものを探すときの、ゆるめかた。`,
    `  ignoreVary が要る。配信の仕方によっては Vary という但し書きが付いていて、`,
    `  「この頼み方で覚えたものは、この頼み方のときだけ返す」という約束になる。`,
    `  同じ file でも、画面が読み込むときと、あとから取りにいくときとで`,
    `  頼み方が違うため、そのままだと覚えているのに見つからない`,
    `  （実際に、圏外にしたら本体の js だけ出てこなかった・2026-09-02）`,
    `*/`,
    `const MATCH = { ignoreSearch: true, ignoreVary: true }`,
    `self.addEventListener('install', (e) => {`,
    `  e.waitUntil((async () => {`,
    `    const c = await caches.open(CACHE)`,
    `    // 1つ取りそこねても、ほかは覚えておく。addAll だと全部やり直しになる`,
    `    await Promise.all(FILES.map((f) => c.add(f).catch(() => {})))`,
    `    await self.skipWaiting()`,
    `  })())`,
    `})`,
    `self.addEventListener('activate', (e) => {`,
    `  e.waitUntil((async () => {`,
    `    const keys = await caches.keys()`,
    `    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))`,
    `    await self.clients.claim()`,
    `  })())`,
    `})`,
    `self.addEventListener('fetch', (e) => {`,
    `  const req = e.request`,
    `  if (req.method !== 'GET') return`,
    `  const url = new URL(req.url)`,
    `  if (url.origin !== location.origin) return`,
    `  // 版の確認は、覚えているほうを返してはいけない`,
    `  if (url.pathname.endsWith('/version.txt')) return`,
    `  if (req.mode === 'navigate') {`,
    `    e.respondWith((async () => {`,
    `      try { return await fetch(req) } catch {`,
    `        const hit = await caches.match('./index.html', MATCH)`,
    `        return hit || Response.error()`,
    `      }`,
    `    })())`,
    `    return`,
    `  }`,
    `  e.respondWith((async () => {`,
    `    const hit = await caches.match(req, MATCH)`,
    `    if (hit) return hit`,
    `    const res = await fetch(req)`,
    `    if (res.ok && res.type === 'basic') {`,
    `      const copy = res.clone()`,
    `      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})`,
    `    }`,
    `    return res`,
    `  })())`,
    `})`,
    ``,
  ].join(String.fromCharCode(10))
}

export default defineConfig({
  // 相対パスで出力する。Cloudflare Pages（ルート配信）でも
  // GitHub Pages（/リポジトリ名/ 配下）でも、そのまま動かすため。
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'yojaku-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.txt', source: BUILD_ID })
      },
    },
    /**
     * 電波がなくても開けるようにする（依頼者の案・2026-09-02）。
     *
     * 実習室で学生が一斉に開く場面を考えると、ここは効く。
     * 一度開いた端末が中身を覚えておけば、機内モードでも、
     * 電波の届かない教室でも、そのまま使える。
     * ホーム画面に置いてアプリのように開くこともできるようになる。
     *
     * ## 覚えておくものは、作るたびに入れかえる
     *
     * 覚え場所の名前に BUILD_ID を使っている。置きなおすと名前が変わるので、
     * 新しいほうが立ち上がった時点で、古い覚え場所はまるごと捨てられる。
     * ファイル名に混ぜてある字（index-XXXX.js）が変わるため、
     * 古いものを持っていても意味がない。
     *
     * ## version.txt だけは、必ず網ごしに見にいく
     *
     * 「置きなおした版が出ていないか」を確かめている先（App.tsx）。
     * ここを覚えてしまうと、いつまでも古い答えを返して、
     * せっかくの知らせが出なくなる。
     *
     * ## 画面そのものも、まず網ごしに取りにいく
     *
     * 覚えているほうを先に返すと、置きなおした直後に
     * 「新しい版が出ています → 読み込み直す → また古い画面」を
     * 延々くり返す輪ができる。つながらないときだけ、覚えているほうを出す
     */
    {
      name: 'yojaku-offline',
      apply: 'build',
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter((f) => f !== 'version.txt')
        const files = [
          './', './index.html', './manifest.webmanifest',
          './icon.svg', './icon-192.png', './icon-512.png', './sample-photo.jpg',
          ...assets.map((f) => `./${f}`),
        ]
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(BUILD_ID, files) })
      },
    },
  ],
})
