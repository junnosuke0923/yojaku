/**
 * 輪郭のガタガタをならす。
 *
 * 写真から切り抜いた輪郭は、どうしても紙の端のけばと画素の階段で
 * こまかく波打つ。実寸としては 1mm ほどの揺れなのだけれど、
 * 画面に線として出ると目立ち、「うまく取れていない」ように見える
 * （依頼者の指摘・2026-08-31）。
 *
 * やっていることは2つだけ。
 *
 * 1. **どこが角か**を先に見分けて、そこは動かさないと決めておく
 * 2. 角でないところを、輪郭に沿ってぼかす（周りの点の平均へ寄せる）
 *
 * 1 が要るのは、単純にぼかすと型紙の四隅のような**本物の角まで丸くなり**、
 * 最大丈・最大幅がじわじわ小さくなってしまうため。
 * 寸法が勝手に変わるのは、このアプリではいちばん起きてはいけないことなので、
 * 角だけはなぞったままの位置に残す。
 */

import type { Polygon } from './geom'

/**
 * 角かどうかを見るとき、前後どれだけ離れた点と比べるか（ぼかす幅に対する倍率）。
 *
 * **広く取るのが肝心**。狭く見ると、紙の端の 1mm ほどの波まで
 * 「向きが大きく変わった＝角」と数えてしまい、
 * ならしたいところがちょうど守られて、押しても何も変わらない。
 * 型紙の本物の角は、この幅ぶん進んでも向きが戻らない
 */
const CORNER_SPAN_SCALE = 2.5
const CORNER_SPAN_MIN = 10
/** これ以上向きが変わっていたら「角」とみなし、まったく動かさない */
const CORNER_TURN = Math.PI / 3

/**
 * 点ごとの「動かしてよさ」。0 なら動かさない（角）、1 なら思いきりならす。
 */
function movability(poly: Polygon, span: number): number[] {
  const n = poly.length
  const s = Math.min(Math.max(Math.round(span), CORNER_SPAN_MIN), Math.floor(n / 4))
  const w: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const a = poly[(i - s + n) % n]
    const b = poly[i]
    const c = poly[(i + s) % n]
    const diff = Math.abs(
      Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x),
    )
    const turn = Math.min(diff, Math.PI * 2 - diff)
    w[i] = Math.max(0, 1 - turn / CORNER_TURN)
  }
  return w
}

/**
 * 閉じた輪郭をならす。`sigma` はぼかす幅（輪郭に沿った画素数）。
 * 0 なら何もしない（＝なぞったまま）。
 */
export function smoothClosed(poly: Polygon, want: number): Polygon {
  const n = poly.length
  if (want <= 0 || n < 16) return poly

  // 細いパーツでは、ぼかす幅をそのパーツの細いほうに合わせて抑える。
  // ベルトのように 3cm しかないものを 2cm の幅でぼかすと、
  // 四隅を守っていても短いほうの辺ごと丸まり、丈が縮んでしまう
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const short = Math.min(maxX - minX, maxY - minY)
  const sigma = Math.min(want, short / 8)
  if (sigma <= 0) return poly

  const r = Math.min(Math.round(sigma * 3), Math.floor(n / 4))
  if (r < 1) return poly

  // 釣り鐘型の重み。中心ほど重く、離れるほど軽い
  const kernel: number[] = []
  let sum = 0
  for (let d = -r; d <= r; d++) {
    const k = Math.exp(-(d * d) / (2 * sigma * sigma))
    kernel.push(k)
    sum += k
  }

  const w = movability(poly, sigma * CORNER_SPAN_SCALE)
  const out: Polygon = new Array(n)
  for (let i = 0; i < n; i++) {
    if (w[i] <= 0) { out[i] = poly[i]; continue }
    let x = 0
    let y = 0
    for (let d = -r; d <= r; d++) {
      const p = poly[(i + d + n * 2) % n]
      const k = kernel[d + r]
      x += p.x * k
      y += p.y * k
    }
    x /= sum
    y /= sum
    // 角に近いところは、ならしを控えめにして、なぞったままの位置へ寄せる
    out[i] = {
      x: poly[i].x + w[i] * (x - poly[i].x),
      y: poly[i].y + w[i] * (y - poly[i].y),
    }
  }
  return out
}

/**
 * 学生に見せる「なめらかさ」の段階。
 *
 * 入り／切りの2つではなく、素直な段階1組にしてある。
 * なめらかにするかどうかは強さの問題であって、別の機能ではないため。
 *
 * `mm` はぼかす幅を**実寸**で言ったもの（画素ではない）。
 * 写真の大きさや撮った距離が変われば 1画素の意味も変わるので、
 * 実寸で決めておかないと、同じ「中」でも写真によって効き方が変わってしまう。
 * `epsilon` はそのあと点を間引く強さ（px）。
 * 間引きは強くしない。ならしたあとで点まで減らすと、
 * アームホールのような**本物の曲線がカクカクの折れ線になる**。
 * ならすのは波を取るためで、点を減らすためではない。
 */
export const SMOOTH_LEVELS = [
  { key: 0, label: 'なし', mm: 0, epsilon: 1.2 },
  { key: 1, label: '弱', mm: 3, epsilon: 1.0 },
  { key: 2, label: '中', mm: 8, epsilon: 1.0 },
  { key: 3, label: '強', mm: 18, epsilon: 1.0 },
] as const

export type SmoothLevel = 0 | 1 | 2 | 3

export const smoothLevel = (n: number) =>
  SMOOTH_LEVELS[Math.min(Math.max(Math.round(n), 0), SMOOTH_LEVELS.length - 1)]
