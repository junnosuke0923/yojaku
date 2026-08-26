/**
 * 射影変換（ホモグラフィ）。
 *
 * 斜めから撮ると長方形は台形に写る。その歪みを打ち消す 3×3 の変換表を、
 * 対応する4点の組から求める。8個の未知数を、8本の連立一次方程式で解く。
 */

import type { Point, Quad } from './geom'

/** 3×3 行列を1次元で持つ（h8 は 1 に固定）。 */
export type Homography = readonly [number, number, number, number, number, number, number, number, number]

/** ガウスの消去法。n元連立一次方程式 A x = b を解く。 */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    // 部分ピボット選択（絶対値の大きい行を持ってくる）
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]

    const p = m[col][col]
    for (let c = col; c <= n; c++) m[col][c] /= p

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }

  return m.map((row) => row[n])
}

/**
 * from の4点を to の4点へ写す変換を求める。
 * 4点はどちらも同じ回り順に並んでいること。
 */
export function computeHomography(from: Quad, to: Quad): Homography | null {
  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: u, y: v } = to[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v)
  }

  const h = solveLinear(A, b)
  if (!h) return null
  if (h.some((v) => !Number.isFinite(v))) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as const
}

/** 1点を変換する。分母が 0 に近いときは失敗として null を返す。 */
export function applyH(H: Homography, p: Point): Point | null {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  if (Math.abs(w) < 1e-9) return null
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  }
}

/** 点の列をまとめて変換する。変換できない点が混ざったら null。 */
export function applyHToPolygon(H: Homography, poly: Point[]): Point[] | null {
  const out: Point[] = []
  for (const p of poly) {
    const q = applyH(H, p)
    if (!q) return null
    out.push(q)
  }
  return out
}

/**
 * 4点から「相似変換」を最小二乗で当てる（回転＋一様な拡大＋平行移動の4自由度）。
 *
 * ここが射影変換と分かれる肝。射影変換は8自由度あり、4点をぴったり通す代わりに、
 * 指のずれをそのまま歪みとして受け取ってしまう。しかも定規の短辺はたった5cmなので、
 * 数画素のずれが1割の縮尺違いになり、それが写真全体の横幅に効く。
 *
 * 相似変換は自由度が4しかないので、4点8個の値に対して余裕がある。
 * ずれは打ち消し合い、縮尺はほぼ長辺（50cm）だけで決まる。
 * 定規は細長いほど長辺が正確に測れるので、この形がいちばん強い。
 *
 * 代わりに遠近（奥ほど小さく写る）は表せない。真上から撮る前提の割り切り。
 */
export type Similarity = { c: number; s: number; tx: number; ty: number }

export function fitSimilarity(from: readonly Point[], to: readonly Point[]): Similarity | null {
  const n = Math.min(from.length, to.length)
  if (n < 2) return null

  let fx = 0, fy = 0, tx = 0, ty = 0
  for (let i = 0; i < n; i++) {
    fx += from[i].x; fy += from[i].y
    tx += to[i].x; ty += to[i].y
  }
  fx /= n; fy /= n; tx /= n; ty /= n

  let norm = 0, dot = 0, cross = 0
  for (let i = 0; i < n; i++) {
    const ax = from[i].x - fx, ay = from[i].y - fy
    const bx = to[i].x - tx, by = to[i].y - ty
    norm += ax * ax + ay * ay
    dot += ax * bx + ay * by
    cross += ax * by - ay * bx
  }
  if (norm < 1e-9) return null

  const c = dot / norm
  const s = cross / norm
  if (!Number.isFinite(c) || !Number.isFinite(s) || c * c + s * s < 1e-12) return null

  return { c, s, tx: tx - c * fx + s * fy, ty: ty - s * fx - c * fy }
}

/** 相似変換を、射影変換と同じ 3×3 の形にそろえる（遠近の項は 0） */
export const similarityToH = ({ c, s, tx, ty }: Similarity): Homography =>
  [c, -s, tx, s, c, ty, 0, 0, 1] as const

/** 相似変換の逆向き */
export function invertSimilarity({ c, s, tx, ty }: Similarity): Similarity | null {
  const d = c * c + s * s
  if (d < 1e-12) return null
  return { c: c / d, s: -s / d, tx: -(c * tx + s * ty) / d, ty: (s * tx - c * ty) / d }
}

/** 相似変換の拡大率（1 が等倍） */
export const similarityScale = ({ c, s }: Similarity): number => Math.hypot(c, s)
