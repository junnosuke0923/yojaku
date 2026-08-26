/**
 * 輪郭を「辺のまとまり」に切り分ける。
 *
 * 縫い代は辺ごとに違う（判断6）。そのためには、まず輪郭のどこからどこまでが
 * 1本の辺なのかを決める必要がある。
 *
 * 切り分けの考え方はひとつだけ ——「曲がりの急なところで区切る」。
 * なだらかに曲がっているところは1本の辺として扱う。
 * そうしないと、袖ぐりのような曲線が何十本もの短い線に分かれてしまい、
 * 学生が縫い代を指定できなくなる。
 *
 * 辺に名前は付けない（判断6）。写真から取れるのは輪郭だけで、
 * それが前身頃なのか後身頃なのか、どちらが上なのかは分からないため。
 * 番号だけを振る。番号は形から決まるので間違えようがない。
 */

import { dist, type Point, type Polygon } from './geom'

/** 輪郭を取り直すときの間隔(mm)。細かすぎると曲がりの測定がぶれる */
const SPACING_MM = 3

/** 曲がりを測るときの腕の長さ(mm)。短いと紙のぎざぎざを角と誤る */
const ARM_MM = 12

/** これ以上曲がっていたら角とみなす(度) */
const CORNER_DEG = 30

/** これより短いまとまりは、隣に吸収させる(mm)。指で押せない辺を作らないため */
const MIN_GROUP_MM = 15

export type EdgePath = {
  /** 輪郭を等間隔に取り直した点列(mm)。閉じている（最後の次は最初） */
  points: Polygon
  /** points の間隔(mm) */
  spacingMm: number
}

export type EdgeGroup = {
  /** 画面に出す番号。1から始まる */
  no: number
  /** points の添字。start 以上 end 未満。points は rotate 済みなので、またぎは起きない */
  start: number
  end: number
  lengthMm: number
  /** まとまりの真ん中の点。番号のふきだしを置く場所 */
  midpoint: Point
  /** 真ん中の点での外向きの法線（長さ1）。ふきだしを外へ押し出す向き */
  outward: Point
}

export type EdgeSplit = {
  path: EdgePath
  groups: EdgeGroup[]
}

/**
 * 輪郭を等間隔の点列に取り直す。
 * もとの輪郭は Douglas-Peucker で間引いてあるので点の間隔がばらばらで、
 * そのままでは「曲がり具合」を比べられない。
 */
export function resample(poly: Polygon, spacingMm = SPACING_MM): EdgePath {
  const n = poly.length
  if (n < 3) return { points: [...poly], spacingMm }

  let total = 0
  for (let i = 0; i < n; i++) total += dist(poly[i], poly[(i + 1) % n])
  if (total < spacingMm * 3) return { points: [...poly], spacingMm }

  const count = Math.max(8, Math.round(total / spacingMm))
  const step = total / count
  const points: Polygon = []

  let seg = 0                       // いま何本目の辺を歩いているか
  let walked = 0                    // その辺の始点までの、累計の道のり
  let segLen = dist(poly[0], poly[1 % n])

  for (let k = 0; k < count; k++) {
    const want = k * step           // 始点からの道のり
    // 目標に届くまで辺を乗り換える
    while (seg < n - 1 && walked + segLen < want) {
      walked += segLen
      seg++
      segLen = dist(poly[seg], poly[(seg + 1) % n])
    }
    const t = segLen === 0 ? 0 : Math.min(1, (want - walked) / segLen)
    const a = poly[seg]
    const b = poly[(seg + 1) % n]
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }

  return { points, spacingMm: total / count }
}

/**
 * 等間隔の点列から、角の位置を拾う。
 *
 * 各点で「手前の腕」と「先の腕」の向きの差を測る。
 * 差が大きいところが角。近いところに角が並んだときは、いちばん曲がっている1点だけ残す。
 */
function findCorners(points: Polygon, spacingMm: number): number[] {
  const n = points.length
  const arm = Math.max(2, Math.round(ARM_MM / spacingMm))
  if (n < arm * 3) return []

  const turn = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = points[(i - arm + n * 2) % n]
    const b = points[i]
    const c = points[(i + arm) % n]
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = a2 - a1
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    turn[i] = Math.abs(d)
  }

  const threshold = (CORNER_DEG * Math.PI) / 180
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    if (turn[i] < threshold) continue
    // 近いところに、もっと曲がっている点があるなら譲る
    let best = true
    for (let k = 1; k <= arm; k++) {
      if (turn[(i + k) % n] > turn[i] || turn[(i - k + n * 2) % n] > turn[i]) { best = false; break }
    }
    if (best) corners.push(i)
  }
  return corners
}

/** 輪郭を辺のまとまりに切り分ける。 */
export function splitEdges(outline: Polygon, spacingMm = SPACING_MM): EdgeSplit {
  const path = resample(outline, spacingMm)
  const pts = path.points
  const n = pts.length
  if (n < 6) {
    return { path, groups: [wholeGroup(path)] }
  }

  const corners = findCorners(pts, path.spacingMm)

  // 角がひとつも無い（円や楕円のようなパーツ）＝ 1本の辺として扱う
  if (corners.length < 2) {
    return { path, groups: [wholeGroup(path)] }
  }

  // 先頭が角になるように並べ替える。こうすると、まとまりが 0 をまたがない
  const shift = corners[0]
  const rotated = [...pts.slice(shift), ...pts.slice(0, shift)]
  const cuts = corners.map((c) => (c - shift + n) % n).sort((a, b) => a - b)

  const rotatedPath: EdgePath = { points: rotated, spacingMm: path.spacingMm }

  // 短すぎるまとまりの区切りを落とす。指で押せない辺を作らないため
  const minPts = Math.max(2, Math.round(MIN_GROUP_MM / path.spacingMm))
  const kept: number[] = [cuts[0]]
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - kept[kept.length - 1] >= minPts) kept.push(cuts[i])
  }
  // 最後のまとまりが短ければ、最後の区切りを落として前へ吸収させる
  if (kept.length > 1 && n - kept[kept.length - 1] < minPts) kept.pop()
  if (kept.length < 2) return { path: rotatedPath, groups: [wholeGroup(rotatedPath)] }

  const groups: EdgeGroup[] = []
  for (let i = 0; i < kept.length; i++) {
    const start = kept[i]
    const end = i + 1 < kept.length ? kept[i + 1] : n
    groups.push(makeGroup(groups.length + 1, rotatedPath, start, end))
  }
  return { path: rotatedPath, groups }
}

function wholeGroup(path: EdgePath): EdgeGroup {
  return makeGroup(1, path, 0, path.points.length)
}

function makeGroup(no: number, path: EdgePath, start: number, end: number): EdgeGroup {
  const pts = path.points
  const n = pts.length
  let lengthMm = 0
  for (let i = start; i < end; i++) lengthMm += dist(pts[i % n], pts[(i + 1) % n])

  const mid = Math.floor((start + end) / 2) % n
  const a = pts[(mid - 1 + n) % n]
  const b = pts[(mid + 1) % n]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1

  return {
    no,
    start,
    end,
    lengthMm,
    midpoint: pts[mid],
    // 外向きは、輪郭の回り方を正（反時計回り）にそろえてから決める。
    // normalizeWinding を通した輪郭なら、進行方向の右手が外側になる。
    outward: { x: dy / len, y: -dx / len },
  }
}

/** 点列のうち、どのまとまりに属するかを引く表を作る。タップ判定に使う */
export function groupIndexOf(groups: EdgeGroup[], i: number): number {
  for (let g = 0; g < groups.length; g++) {
    if (i >= groups[g].start && i < groups[g].end) return g
  }
  return groups.length - 1
}
