import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'

/**
 * 電波がなくても開けるようにする係を、裏に立てる（依頼者の案・2026-09-02）。
 *
 * 立てるのは**置きなおしたものを開いたときだけ**。
 * 作っている最中（npm run dev）にこれが居ると、直したはずの字が出ない、
 * という分かりにくい詰まり方をする。
 *
 * 失敗しても何も言わない。覚えておけないだけで、アプリは今までどおり動く
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
