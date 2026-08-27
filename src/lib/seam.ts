/**
 * 縫い代を足して、裁ち切り線を作る（判断6）。
 *
 * 学生の型紙は出来上がり線で切ってある（2026-08-26 確定）。
 * つまり写真から取れる輪郭は、そのままでは裁断できない形であり、
 * 縫い代を足す工程は省略できない。
 *
 * やり方は「辺のまとまりごとに、その幅ぶんの帯を塗って足す」だけ。
 * 角の処理も、へこみも、幅の違う辺どうしのつなぎ目も、塗って重ねれば勝手に解決する。
 *
 * 縫い代 0 の辺は「わ（折り山）」の意味を持つ（依頼者の指摘）。
 * 折り山には縫い代を付けないという決まりがあるので、この2つは同じことの裏表になる。
 * だからアプリは「どの辺がわですか」と別にたずねなくてよい。
 */

import { traceOuterContour } from './contour'
import { splitEdges, type EdgeGroup, type EdgePath } from './edges'
import { bounds, normalizeWinding, simplify, signedArea, type Polygon } from './geom'
import type { Mask } from './mask'
import { createGrid, fillPolygon } from './raster'

/** 縫い代の既定値(mm)。1cm */
export const DEFAULT_SEAM_MM = 10

/**
 * 「この辺には、もう縫い代が付いている」という印(mm)。
 *
 * 学生が持ってくる型紙は出来上がり線で切ってあるとは限らず、縫い代つきのこともある。
 * そのときは何も足さないが、0 は使えない。0 は「ここは折り山（わ）」という
 * 別の意味に取ってあるからで、混ぜると図が壊れる。
 * 負の値にしておけば、足す量としては 0 と同じに扱われ、意味だけが分かれる。
 */
export const SEAM_INCLUDED_MM = -1

/** 画面に出す刻み(cm)。学校で実際に使う値だけを並べる */
export const SEAM_STEPS_CM = [0, 0.5, 0.7, 1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5]

/** 裁ち切り線の点を間引く強さ(mm) */
const SIMPLIFY_MM = 1.5

export type SeamPlan = {
  path: EdgePath
  groups: EdgeGroup[]
  /** groups と同じ並びの縫い代(mm)。0 は「ここは折り山」 */
  allowancesMm: number[]
}

/** 出来上がり線から、既定の縫い代を全周に付けた計画を作る */
export function initialPlan(outlineMm: Polygon, defaultMm = DEFAULT_SEAM_MM): SeamPlan {
  const outline = normalizeWinding(outlineMm)
  const { path, groups } = splitEdges(outline)
  return { path, groups, allowancesMm: groups.map(() => defaultMm) }
}

/**
 * まとめて縫い代を決める（依頼者の指示）。
 *
 * ただし **0 の辺は飛ばす**。0 は縫い代の広さではなく「ここは折り山」という
 * 別の意味を持たせてあるので、まとめて上書きすると図が壊れる。
 *
 * 返すのは「実際に変えた本数」。画面に出して、何が起きたかを学生に見せるため。
 */
export function applyToAll(plan: SeamPlan, mm: number): { plan: SeamPlan; changed: number } {
  let changed = 0
  const allowancesMm = plan.allowancesMm.map((a) => {
    if (a === 0) return 0
    changed++
    return mm
  })
  return { plan: { ...plan, allowancesMm }, changed }
}

/** 折り山（縫い代 0）にしてある辺のまとまり */
export const foldGroups = (plan: SeamPlan): EdgeGroup[] =>
  plan.groups.filter((_, i) => plan.allowancesMm[i] === 0)

export type SeamResult = {
  /** 裁ち切り線(mm)。左上を原点に寄せてある */
  cutLineMm: Polygon
  /** 出来上がり線(mm)。cutLineMm と同じ原点に合わせてある */
  finishedLineMm: Polygon
  /** 1mm＝1画素の絵。配置の重なり判定にそのまま使える */
  grid: Mask
  /** grid の原点が、出来上がり線の原点からどれだけ外にあるか(mm) */
  padMm: number
  areaMm2: number
  widthMm: number
  heightMm: number
}

/**
 * 縫い代を足して裁ち切り線を得る。
 *
 * 1. 出来上がり線を塗る
 * 2. 辺のまとまりごとに、その幅の帯を塗り足す
 * 3. 出来た絵の輪郭をなぞる ＝ 裁ち切り線
 */
export function buildSeam(plan: SeamPlan): SeamResult | null {
  const pts = plan.path.points
  if (pts.length < 3) return null

  const maxAllowance = plan.allowancesMm.reduce((m, a) => Math.max(m, a), 0)
  const pad = Math.ceil(maxAllowance) + 2

  const b = bounds(pts)
  const width = Math.ceil(b.maxX - b.minX) + pad * 2 + 2
  const height = Math.ceil(b.maxY - b.minY) + pad * 2 + 2

  // 絵の中の座標へ移す（左上に pad の余白を取る）
  const toGrid = (p: { x: number; y: number }) => ({
    x: p.x - b.minX + pad,
    y: p.y - b.minY + pad,
  })
  const gridPts = pts.map(toGrid)

  const grid = createGrid(width, height)
  fillPolygon(grid, gridPts)

  const n = gridPts.length

  // 点ごとに「その点から始まる線分の縫い代」を引けるようにしておく
  const perPoint = new Float64Array(n)
  for (let g = 0; g < plan.groups.length; g++) {
    const { start, end } = plan.groups[g]
    // 負の値（縫い代つき）は、足す量としては 0 と同じ
    const mm = Math.max(0, plan.allowancesMm[g])
    for (let i = start; i < end; i++) perPoint[i % n] = mm
  }

  /*
    線分の向きは、**その線分が属する辺の中だけ**を見て決める。

    輪郭は3mm間隔で取り直してあるので、角のちょうど上に点が乗るとはかぎらない。
    角をまたぐ線分が1本できて、その向きは両側の辺の中間になる。
    そのまま法線を取ると、裾のような広い縫い代のとき、
    角のところだけ斜めに大きく張り出したり、逆に角が斜めに削げたりする
    （依頼者の指摘・2026-08-27。裾を4cmにすると実際にそうなった）。

    辺の内側の点だけで向きを測れば、角をまたぐ線分にも
    その辺そのものの向きが入るので、角は実物どおり四角く決まる。
  */
  const lo = new Int32Array(n)
  const hi = new Int32Array(n)
  for (let g = 0; g < plan.groups.length; g++) {
    const { start, end } = plan.groups[g]
    for (let i = start; i < end; i++) {
      // 先頭の1点は角そのもの（＝両方の辺に半分ずつ乗っている）ので、向きの測定からは外す
      lo[i % n] = Math.min(start + 1, end - 1)
      hi[i % n] = end - 1
    }
  }

  // 各線分の、外向きの単位法線と進む向き。
  // 輪郭は正の回り方にそろえてあるので (dy, -dx) が外を向く
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  const ux = new Float64Array(n)
  const uy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const from = Math.max(lo[i], i - 1)
    const to = Math.min(hi[i], i + 2)
    const a = to > from ? gridPts[from] : gridPts[i]
    const b = to > from ? gridPts[to] : gridPts[(i + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    ux[i] = dx / len
    uy[i] = dy / len
    nx[i] = dy / len
    ny[i] = -dx / len
  }

  // 1. 線分ごとに、外へ向かってまっすぐ伸ばした帯を塗る。
  //    端を丸めない。丸めると、裾のような広い縫い代が横にもはみ出してしまう
  //    （4cmの裾が、隣の脇線を4cm押し広げる。実物の裁ち合わせ図はそうならない）
  for (let i = 0; i < n; i++) {
    const mm = perPoint[i]
    if (mm <= 0) continue // 0 ＝ 折り山。何も足さない
    const a = gridPts[i]
    const b = gridPts[(i + 1) % n]
    // 隣の帯とのあいだに髪の毛ほどの隙間が残らないよう、進む向きにわずかに伸ばす
    const ex = ux[i] * 0.5
    const ey = uy[i] * 0.5
    const ox = nx[i] * mm
    const oy = ny[i] * mm
    fillPolygon(grid, [
      { x: a.x - ex, y: a.y - ey },
      { x: b.x + ex, y: b.y + ey },
      { x: b.x + ex + ox, y: b.y + ey + oy },
      { x: a.x - ex + ox, y: a.y - ey + oy },
    ])
  }

  // 2. 角を埋める。外へ張り出す角では、2本の裁ち切り線が交わる点まで塗る。
  //    幅の違う辺どうしの角（脇1cm と 裾4cm）が、実物どおり「横1cm・下4cm」で決まる
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a1 = perPoint[i]
    const a2 = perPoint[j]
    if (a1 <= 0 && a2 <= 0) continue

    // 向きは、角をまたぐ線分そのものではなく、両側の辺のものを使う（上の注記）
    const p = gridPts[j]
    const d1x = ux[i]
    const d1y = uy[i]
    const d2x = ux[j]
    const d2y = uy[j]

    // 外へ張り出す角だけ。へこむ角では帯どうしがもともと重なっているので隙間は出ない
    if (d1x * d2y - d1y * d2x <= 0) continue

    const q1 = { x: p.x + nx[i] * a1, y: p.y + ny[i] * a1 }
    const q2 = { x: p.x + nx[j] * a2, y: p.y + ny[j] * a2 }

    // 2直線 q1+t·d1 と q2+s·d2 の交点
    const det = d1x * -d2y - d1y * -d2x
    let corner: { x: number; y: number } | null = null
    if (Math.abs(det) > 1e-9) {
      const t = ((q2.x - q1.x) * -d2y - (q2.y - q1.y) * -d2x) / det
      const m = { x: q1.x + d1x * t, y: q1.y + d1y * t }
      // 角が鋭いと交点が遠くへ飛ぶ。飛びすぎたら諦めて、角を落とした形にする
      if (Math.hypot(m.x - p.x, m.y - p.y) <= (a1 + a2) * 3 + 2) corner = m
    }

    fillPolygon(grid, corner ? [p, q1, corner, q2] : [p, q1, q2])
  }

  const traced = traceOuterContour(grid)
  if (!traced || traced.length < 3) return null

  const cut = normalizeWinding(simplify(traced, SIMPLIFY_MM))
  const cb = bounds(cut)
  const cutLineMm = cut.map((p) => ({ x: p.x - cb.minX, y: p.y - cb.minY }))

  // 出来上がり線も、裁ち切り線と同じ原点にそろえる。重ねて描けるように
  const finishedLineMm = gridPts.map((p) => ({ x: p.x - cb.minX, y: p.y - cb.minY }))

  return {
    cutLineMm,
    finishedLineMm,
    grid,
    padMm: pad,
    areaMm2: Math.abs(signedArea(cutLineMm)),
    widthMm: cb.maxX - cb.minX,
    heightMm: cb.maxY - cb.minY,
  }
}
