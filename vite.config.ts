import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相対パスで出力する。Cloudflare Pages（ルート配信）でも
  // GitHub Pages（/リポジトリ名/ 配下）でも、そのまま動かすため。
  base: './',
  plugins: [react(), tailwindcss()],
})
