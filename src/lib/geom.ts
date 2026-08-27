/**
 * 幾何の基本部品。
 * 画像の座標（px）でも実寸の座標（mm）でも同じ関数を使う。
 */

export type Point = { x: number; y: number }
export type Polygon = Point[]
export type Quad = [Point, Point, Point, Point]

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
export const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** 多角形の符号付き面積。正負で回り方（時計回り／反時計回り）が分かる。 */
export function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function centroid(poly: Polygon): Point {
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export function bounds(poly: Polygon): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export const boundsWidth = (b: Bounds) => b.maxX - b.minX
export const boundsHeight = (b: Bounds) => b.maxY - b.minY

export function perimeter(poly: Polygon): number {
  let s = 0
  for (let i = 0, n = poly.length; i < n; i++) s += dist(poly[i], poly[(i + 1) % n])
  return s
}

/** 点が多角形の内側にあるか（交差数判定）。 */
export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const hit = a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    if (hit) inside = !inside
  }
  return inside
}

/** 凸包（Andrew's monotone chain）。最小外接長方形の下ごしらえに使う。 */
export function convexHull(pts: Polygon): Polygon {
  if (pts.length < 3) return [...pts]
  const s = [...pts].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const half = (input: Polygon): Polygon => {
    const out: Polygon = []
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(s), ...half(s.reverse())]
}

/**
 * 4点を「重心まわりの角度順」に並べ替える。
 * 学生がどの隅からタップしても、隣り合う点が隣り合う辺になるようにする。
 */
export function orderQuad(pts: Point[]): Quad {
  const c = centroid(pts)
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x),
  )
  return sorted as Quad
}

/** 多角形の回り方をそろえる（符号付き面積を正にする）。鏡像反転を防ぐため。 */
export function normalizeWinding<T extends Polygon>(poly: T): T {
  return (signedArea(poly) < 0 ? [...poly].reverse() : poly) as T
}

/** Douglas-Peucker による点の間引き。輪郭の点数を数千から数百へ落とす。 */
export function simplify(poly: Polygon, epsilon: number): Polygon {
  if (poly.length < 3) return [...poly]

  const keep = new Uint8Array(poly.length)
  keep[0] = 1
  keep[poly.length - 1] = 1

  const stack: [number, number][] = [[0, poly.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    if (last <= first + 1) continue

    const a = poly[first], b = poly[last]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)

    let far = -1, farDist = -1
    for (let i = first + 1; i < last; i++) {
      const p = poly[i]
      const d = len === 0
        ? dist(p, a)
        : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
      if (d > farDist) { farDist = d; far = i }
    }

    if (farDist > epsilon) {
      keep[far] = 1
      stack.push([first, far], [far, last])
    }
  }

  const out: Polygon = []
  for (let i = 0; i < poly.length; i++) if (keep[i]) out.push(poly[i])
  return out
}

/**
 * 最小外接長方形（回転キャリパー法）。
 * 凸包の各辺を軸にとって、いちばん面積の小さい長方形を選ぶ。
 * 定規の自動検出を将来入れるときの土台。
 */
export function minAreaRect(pts: Polygon): { quad: Quad; long: number; short: number; angle: number } | null {
  const hull = convexHull(pts)
  if (hull.length < 3) return null

  let best: { quad: Quad; long: number; short: number; angle: number; area: number } | null = null

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const cos = Math.cos(-ang), sin = Math.sin(-ang)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of hull) {
      const rx = p.x * cos - p.y * sin
      const ry = p.x * sin + p.y * cos
      if (rx < minX) minX = rx
      if (rx > maxX) maxX = rx
      if (ry < minY) minY = ry
      if (ry > maxY) maxY = ry
    }

    const w = maxX - minX, h = maxY - minY
    const area = w * h
    if (best && area >= best.area) continue

    const back = (rx: number, ry: number): Point => ({
      x: rx * Math.cos(ang) - ry * Math.sin(ang),
      y: rx * Math.sin(ang) + ry * Math.cos(ang),
    })

    best = {
      quad: [back(minX, minY), back(maxX, minY), back(maxX, maxY), back(minX, maxY)],
      long: Math.max(w, h),
      short: Math.min(w, h),
      angle: ang,
      area,
    }
  }

  if (!best) return null
  const { quad, long, short, angle } = best
  return { quad, long, short, angle }
}

/**
 * a と b を通る**無限に伸びる直線**を、枠の中に入る部分だけ切り出す。
 *
 * 「わ」の辺で開いた型紙の中心線を引くのに使う。
 * 折り山だった辺は型紙の一部しか通っていないことがあるので、
 * そのまま引くと線が途中で終わってしまう。枠いっぱいまで伸ばしてから引く。
 */
export function clipLineToBox(a: Point, b: Point, box: Bounds): [Point, Point] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = -Infinity
  let t1 = Infinity
  // p * t <= q の形にそろえて、4辺ぶん順に狭めていく
  const slab = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!slab(-dx, a.x - box.minX)) return null
  if (!slab(dx, box.maxX - a.x)) return null
  if (!slab(-dy, a.y - box.minY)) return null
  if (!slab(dy, box.maxY - a.y)) return null
  if (!(t1 > t0)) return null
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ]
}
