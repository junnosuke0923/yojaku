/**
 * 写真からなぞった輪郭の、丸まった角を立て直す（依頼者の指示・2026-09-03）。
 *
 * 型紙の角は、実物では角である。ところが写真から切り抜いてならすと、
 * 角が数ミリから1センチほどの丸みになる。依頼者はこれを
 * 「こういった細かな丸みは、基本的にはきちんと角として認識するように」と述べた。
 *
 * 見た目だけの話では済まない。縫い代は辺ごとに帯を伸ばして作るので、
 * 辺の向きを角のすぐ隣で測ると、そこはまだ曲がりの途中で、
 * 本当の辺より十度ほど傾いた向きを拾ってしまう。
 * 縫い代の広い辺（裾5cmなど）では、その傾きが縫い代の幅を超えるほどのずれになり、
 * 縫い代の線どうしの交点が裏返って、塗る形がねじれ、角に塗り残し（へこみ）が出る。
 *
 * 向きの測り方だけを直しても、小さなへこみは残った。
 * **角そのものを立て直して初めて消えた。**
 *
 * やり方はひとつだけ ——
 * 丸みの肩を避けて、両側の辺の**まっすぐな部分**の向きを採り、その2本の交点を角とする。
 *
 * 触ってはいけないものに触れないための歯止めを4つ置いてある。
 * 袖ぐりのような本物の曲線や、丸いパーツには手を出さない。
 */

import { splitEdges } from './edges'
import type { Point, Polygon } from './geom'

/** 輪郭を取り直す間隔(mm)。edges.ts と同じにそろえる */
const SPACING_MM = 3

/** 丸みの肩を避けて、辺の向きを採りはじめる距離(mm) */
const SKIP_MM = 12

/** 向きを採るのに使う長さ(mm) */
const SPAN_MM = 24

/** 立て直した角が元の位置からこれ以上離れたら、角ではなく曲線とみなす(mm) */
const MAX_LIFT_MM = 15

/** 向きを採る区間がこれ以上そっていたら、「まっすぐな辺」ではない(mm) */
const STRAIGHT_MM = 1.0

/** これより浅い曲がりは、もともと角ではない（約10度） */
const MIN_TURN = 0.17

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

/**
 * 区間 [i,j] がまっすぐな線に乗っているか。乗っていれば、その向き（長さ1）を返す。
 * 添字は輪郭を一周してよい。
 */
function straightRun(pts: Polygon, i: number, j: number): Point | null {
  const n = pts.length
  const wrap = (k: number) => pts[((k % n) + n) % n]
  const a = wrap(i)
  const b = wrap(j)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  // 端が近すぎると、向きがぶれて当てにならない
  if (len < SPAN_MM * 0.5) return null
  const u = { x: dx / len, y: dy / len }
  for (let k = i; k <= j; k++) {
    const q = wrap(k)
    if (Math.abs(cross(u, { x: q.x - a.x, y: q.y - a.y })) > STRAIGHT_MM) return null
  }
  return u
}

/**
 * 丸まった角を立て直した輪郭を返す。
 * 立て直せる角がひとつも無ければ、渡されたものをそのまま返す（余計なことをしない）。
 */
export function sharpenCorners(outlineMm: Polygon): Polygon {
  if (outlineMm.length < 8) return outlineMm

  // 角の位置は、辺の切り分けがすでに知っている。まとまりの始まり＝角
  const { path, groups } = splitEdges(outlineMm, SPACING_MM)
  if (groups.length < 2) return outlineMm

  const pts = path.points
  const n = pts.length
  const sp = path.spacingMm || SPACING_MM
  const skip = Math.max(1, Math.round(SKIP_MM / sp))
  const span = Math.max(2, Math.round(SPAN_MM / sp))
  // 肩の幅より辺が短いと、隣の角まで巻き込んで消してしまう
  if (n < (skip + span) * 2 + 4) return outlineMm

  const wrap = (k: number) => ((k % n) + n) % n
  /** 落とす点。角のところの丸みの肩 */
  const drop = new Uint8Array(n)
  /** どこに、立て直した角を差し込むか */
  const insert = new Map<number, Point>()

  for (const g of groups) {
    const c = g.start
    const u1 = straightRun(pts, c - skip - span, c - skip)
    const u2 = straightRun(pts, c + skip, c + skip + span)
    if (!u1 || !u2) continue
    if (Math.abs(cross(u1, u2)) < MIN_TURN) continue

    const p1 = pts[wrap(c - skip)]
    const p2 = pts[wrap(c + skip)]
    const det = cross(u1, u2)
    if (Math.abs(det) < 1e-9) continue
    const t = cross({ x: p2.x - p1.x, y: p2.y - p1.y }, u2) / det
    const at = { x: p1.x + u1.x * t, y: p1.y + u1.y * t }
    if (Math.hypot(at.x - pts[c].x, at.y - pts[c].y) > MAX_LIFT_MM) continue

    for (let k = c - skip + 1; k <= c + skip - 1; k++) drop[wrap(k)] = 1
    insert.set(wrap(c - skip + 1), at)
  }

  if (insert.size === 0) return outlineMm

  const out: Polygon = []
  for (let i = 0; i < n; i++) {
    const sharp = insert.get(i)
    if (sharp) out.push(sharp)
    if (!drop[i]) out.push(pts[i])
  }
  return out.length >= 3 ? out : outlineMm
}
