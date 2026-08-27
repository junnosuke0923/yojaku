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
  ],
})
