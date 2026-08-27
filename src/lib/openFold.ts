/**
 * 「わ」の辺で開いて、幅を倍にした形を作る（依頼者の指示・2026-08-27）。
 *
 * ベルトがいちばん分かりやすい。型紙はベルトの出来上がり幅で描いてあるが、
 * 裁つときは長い辺で二つに折るぶんを見込んで、幅を倍にして裁つことがある。
 *
 * やり方は二通りあって、どちらも実物として正しい。
 *
 *   ア  生地の折り山に「わ」の辺を当てて、二重のまま裁つ
 *   イ  一重の生地に、開いた形（幅が倍）をそのまま描いて裁つ
 *
 * アはもともとできる。ここで足すのはイのほう。
 * 学生が「わ」にした辺を鏡にして、型紙を左右に開いた形へ作り直す。
 *
 * 「幅を倍にする」を別の設定として持たせることもできたが、そうしなかった。
 * どの辺で折るのかを聞かずに幅だけ倍にすると、型紙のどこが中心なのかが
 * 分からなくなる。「わ」はもともと**その中心の線**を指しているので、
 * 同じことを二度たずねずに済む。
 *
 * 開いたあとは、その辺はもう折り山ではない（生地の折り山に当てる必要がない）。
 * 型紙の中に折り山があるだけで、生地は一重でよい。
 */

import { traceOuterContour } from './contour'
import { bounds, normalizeWinding, simplify, type Point, type Polygon } from './geom'
import { createGrid, fillPolygon } from './raster'

/** 開いたあとの輪郭を、何mm きざみまで間引くか */
const SIMPLIFY_MM = 1.0
/** 絵の外に取る余白(mm) */
const PAD_MM = 2
/**
 * 鏡の線に沿って塗り足す帯の太さ(mm)。
 *
 * もとの形と鏡像はこの線でぴったり接しているが、1mm きざみで塗ると
 * 継ぎ目に髪の毛ほどの隙間が残ることがある。そこに沿って塗っておけば消える。
 * 帯は必ず形の内側に入るので、外へふくらむことはない。
 */
const BRIDGE_MM = 1

/** 点 p を、a と b を通る直線で折り返す */
export function reflectAcross(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return { ...p }
  // a から p までを、線の向きと、それに直交する向きに分ける。直交ぶんだけ反転させる
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  const foot = { x: a.x + dx * t, y: a.y + dy * t }
  return { x: foot.x * 2 - p.x, y: foot.y * 2 - p.y }
}

/**
 * 直線 a-b の、`inside` と同じ側だけを残すように多角形を切る。
 *
 * 鏡に映す前に、必ずこれで切っておく。
 * 裁ち切り線は、折り山の側へ 1mm ほどはみ出して出来上がることがある
 * （縫い代の帯を塗るときに、隣の帯とのすき間を埋めるため少し伸ばしてあるため）。
 * そのまま映すと、はみ出しが左右で足し合わさって、幅が数mm太く出てしまう。
 */
function clipToSide(poly: Polygon, a: Point, b: Point, inside: Point): Polygon {
  const dx = b.x - a.x
  const dy = b.y - a.y
  // 直線のどちら側にいるか。inside と同じ符号なら残す
  const side = (p: Point) => (p.x - a.x) * dy - (p.y - a.y) * dx
  const want = Math.sign(side(inside)) || 1
  const keep = (p: Point) => side(p) * want >= 0

  const out: Polygon = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const kp = keep(p)
    const kq = keep(q)
    if (kp) out.push(p)
    if (kp !== kq) {
      const sp = side(p)
      const sq = side(q)
      const t = sp / (sp - sq)
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return out
}

/**
 * 多角形と、その鏡像とを合わせた輪郭を返す。
 *
 * 解析的に継ぎ合わせるかわりに、1mm＝1画素で塗って輪郭をなぞっている。
 * 縫い代の帯を足すときと同じやり方で、角のつなぎ目を自分で場合分けせずに済む。
 * 座標は入れたときと同じ原点のまま返すので、裁ち切り線と出来上がり線を
 * それぞれ開いても、ずれずに重なる。
 */
export function unionWithMirror(
  poly: Polygon, a: Point, b: Point, inside: Point,
): Polygon | null {
  if (poly.length < 3) return null
  const half = clipToSide(poly, a, b, inside)
  if (half.length < 3) return null
  const mirrored = half.map((p) => reflectAcross(p, a, b))
  const bb = bounds([...half, ...mirrored])
  const width = Math.ceil(bb.maxX - bb.minX) + PAD_MM * 2 + 2
  const height = Math.ceil(bb.maxY - bb.minY) + PAD_MM * 2 + 2
  if (width < 3 || height < 3 || width * height > 40_000_000) return null

  const toGrid = (p: Point): Point => ({
    x: p.x - bb.minX + PAD_MM,
    y: p.y - bb.minY + PAD_MM,
  })
  const grid = createGrid(width, height)
  fillPolygon(grid, half.map(toGrid))
  fillPolygon(grid, mirrored.map(toGrid))

  // 継ぎ目を塗る。
  // 切った断面（＝鏡の線に乗っている点）のあるところだけを塗るので、外へはみ出さない
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len > 1e-6) {
    const ux = dx / len
    const uy = dy / len
    let lo = Infinity
    let hi = -Infinity
    for (const p of half) {
      const off = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux)
      if (off > 0.01) continue
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    if (hi > lo) {
      const at = (t: number, s: number): Point =>
        ({ x: a.x + ux * t - uy * s, y: a.y + uy * t + ux * s })
      fillPolygon(grid, [
        toGrid(at(lo, BRIDGE_MM)), toGrid(at(hi, BRIDGE_MM)),
        toGrid(at(hi, -BRIDGE_MM)), toGrid(at(lo, -BRIDGE_MM)),
      ])
    }
  }

  const traced = traceOuterContour(grid)
  if (!traced || traced.length < 3) return null
  return normalizeWinding(simplify(traced, SIMPLIFY_MM)).map((p) => ({
    x: p.x - PAD_MM + bb.minX,
    y: p.y - PAD_MM + bb.minY,
  }))
}
