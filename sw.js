const CACHE = 'yojaku-2026-09-05 12:16'
const FILES = ["./","./index.html","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","./sample-photo.jpg","./assets/index-4cNHPMka.js","./assets/index-BgDGHjra.css"]
/*
  覚えたものを探すときの、ゆるめかた。
  ignoreVary が要る。配信の仕方によっては Vary という但し書きが付いていて、
  「この頼み方で覚えたものは、この頼み方のときだけ返す」という約束になる。
  同じ file でも、画面が読み込むときと、あとから取りにいくときとで
  頼み方が違うため、そのままだと覚えているのに見つからない
  （実際に、圏外にしたら本体の js だけ出てこなかった・2026-09-02）
*/
const MATCH = { ignoreSearch: true, ignoreVary: true }
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    // 1つ取りそこねても、ほかは覚えておく。addAll だと全部やり直しになる
    await Promise.all(FILES.map((f) => c.add(f).catch(() => {})))
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // 版の確認は、覚えているほうを返してはいけない
  if (url.pathname.endsWith('/version.txt')) return
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req) } catch {
        const hit = await caches.match('./index.html', MATCH)
        return hit || Response.error()
      }
    })())
    return
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, MATCH)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok && res.type === 'basic') {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
    }
    return res
  })())
})
