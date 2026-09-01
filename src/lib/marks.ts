/**
 * 型紙の中に入れる印し（地の目線・パーツ名）の置き場所。
 *
 * 地の目線の無い型紙は型紙として成立しないので、取り込んだパーツには常に描く。
 * ただし「どこに描くか」は形によって変わる。細いところに引くと図からはみ出すので、
 * 縦にいちばん長く取れる場所を探してそこへ引く。
 */

import { bounds, type Polygon } from './geom'

/** その x で、多角形の内側になっている縦の区間のうち、いちばん長いもの */
export function verticalSpan(poly: Polygon, x: number): { y1: number; y2: number } | null {
  const hits: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      hits.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x))
    }
  }
  hits.sort((p, q) => p - q)
  let best: { y1: number; y2: number } | null = null
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (!best || hits[i + 1] - hits[i] > best.y2 - best.y1) best = { y1: hits[i], y2: hits[i + 1] }
  }
  return best
}

/** その y で、多角形の内側になっている横の区間のうち、いちばん長いもの */
export function horizontalSpan(poly: Polygon, y: number): { x1: number; x2: number } | null {
  const hits: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      hits.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y))
    }
  }
  hits.sort((p, q) => p - q)
  let best: { x1: number; x2: number } | null = null
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (!best || hits[i + 1] - hits[i] > best.x2 - best.x1) best = { x1: hits[i], x2: hits[i + 1] }
  }
  return best
}

export type Grain = { x: number; y1: number; y2: number }

/**
 * 地の目線を横に引くときの位置。
 * 90度回して置いたパーツ（地の目を変えてしまった場合）に使う。
 */
export function grainLineH(poly: Polygon): { y: number; x1: number; x2: number } | null {
  const b = bounds(poly)
  const h = b.maxY - b.minY
  const w = b.maxX - b.minX
  let best: { y: number; x1: number; x2: number } | null = null

  for (const r of [0.5, 0.42, 0.58, 0.34, 0.66]) {
    const y = b.minY + h * r
    const s = horizontalSpan(poly, y)
    if (!s) continue
    if (!best || s.x2 - s.x1 > best.x2 - best.x1) best = { y, x1: s.x1, x2: s.x2 }
    if (r === 0.5 && s.x2 - s.x1 > w * 0.6) break
  }
  if (!best) return null

  const pad = (best.x2 - best.x1) * 0.1
  return { y: best.y, x1: best.x1 + pad, x2: best.x2 - pad }
}


/**
 * 地の目線を引く位置。
 * まん中を基本にしつつ、そこが細ければ左右にずらして、長く取れるところを選ぶ。
 */
export function grainLine(poly: Polygon): Grain | null {
  const b = bounds(poly)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  let best: Grain | null = null

  for (const r of [0.5, 0.42, 0.58, 0.34, 0.66]) {
    const x = b.minX + w * r
    const s = verticalSpan(poly, x)
    if (!s) continue
    if (!best || s.y2 - s.y1 > best.y2 - best.y1) best = { x, y1: s.y1, y2: s.y2 }
    // まん中で十分な長さが取れたなら、それでよい
    if (r === 0.5 && s.y2 - s.y1 > h * 0.6) break
  }
  if (!best) return null

  // 端まで届かせない。矢印の先が輪郭に刺さって見えるのを避ける
  const pad = (best.y2 - best.y1) * 0.1
  return { x: best.x, y1: best.y1 + pad, y2: best.y2 - pad }
}

/**
 * パーツ名を置く点。上から3割くらいの高さで、いちばん広く取れる横の区間のまん中。
 * width はその区間の幅。文字が図からはみ出さない大きさを決めるのに使う。
 */
export function labelSpot(poly: Polygon): { x: number; y: number; width: number } {
  const b = bounds(poly)
  const h = b.maxY - b.minY
  let best: { x: number; y: number; width: number } | null = null
  for (const r of [0.3, 0.38, 0.24, 0.46]) {
    const y = b.minY + h * r
    const s = horizontalSpan(poly, y)
    if (!s) continue
    const cand = { x: (s.x1 + s.x2) / 2, y, width: s.x2 - s.x1 }
    if (!best || cand.width > best.width) best = cand
  }
  return best ?? { x: (b.minX + b.maxX) / 2, y: b.minY + h * 0.3, width: b.maxX - b.minX }
}

/**
 * 外接する四角のまん中を軸に、好きな角度だけまわす。
 *
 * もとは 180 度専用（`rotate180`）だった。上下の入れかえしか要らなかったため。
 * いまは学生が任意の角度に回せる（依頼者の指示・2026-09-01）ので、角度を取る。
 *
 *   90 度  … 地の目の縦横をとりちがえて撮ってしまったとき
 *   180 度 … 上下だけ逆のとき（もとからあったもの）
 *   数度   … 定規の枠が少しずれて、形が斜めに取り込まれたとき
 *
 * 回す軸を外接する四角のまん中に取ってあるので、
 * 回しても形はだいたい同じ場所に居続ける。画面の中で飛んでいかない。
 *
 * **地の目線のほうは回さない。** このアプリでは実寸の座標系の縦が地の目
 * （`buildScale` が定規の長辺を縦に置いている）なので、
 * 学生の手つきは「地の目線に重なるまで形のほうを回す」になる。
 * 実物の型紙でやっていることと同じ。
 *
 * @param deg 時計まわりが正（画面の座標は下がプラスなので）
 */
export function turnPoly(poly: Polygon, deg: number): Polygon {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return poly
  const b = bounds(poly)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const r = (d * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return poly.map((q) => ({
    x: cx + (q.x - cx) * cos - (q.y - cy) * sin,
    y: cy + (q.x - cx) * sin + (q.y - cy) * cos,
  }))
}
