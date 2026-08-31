/**
 * 写真の中から定規をさがして、四隅を当てる（依頼者の質問・2026-09-01）。
 *
 *   「サンプルのような写真の場合、手動で定規の位置を指定しなくても、
 *     自動で判定して枠を定規に自動で当ててもらうことは可能ですか？」
 *   「これは多少角度がついて撮影されていた写真からも判断出来そうでしょうか？」
 *
 * できる。ただし**当てるのは提案であって、決定ではない**。
 * 見つからなかったときは黙って今までどおり（まん中に細長い枠）に戻し、
 * 見つかったときも、学生が四隅をつまんで直せる状態は何も変えない。
 * ここが外れると、そのあとの寸法がぜんぶ狂う一点なので、
 * 「たぶんこれ」で通してしまわないようにしてある。
 *
 * ## どうやって定規だと分かるのか
 *
 * 型紙と定規は、どちらも台の上に置かれた「台の色でないもの」なので、
 * かたまりの切り分け（mask.ts）では区別が付かない。そこで3つの条件で絞る。
 *
 * 1. **縦横比**。50cm定規は 10.0、30cm定規は 12.0 と決まっている。
 *    実際に見本の写真で測ると、定規 9.72 に対して、
 *    細長いベルトの型紙は 20.59 だった。ベルトのほうが細長いので、
 *    「いちばん細長いもの」では取り違える。「10 か 12 に近いもの」で見る。
 * 2. **長方形であること**。定規は硬い長方形なので、輪郭が最小外接長方形を
 *    ほぼ埋める。裾や脇のカーブがある型紙は、ここで落ちる。
 * 3. **透けていること**。方眼定規は下の台の色が透けるので、
 *    白い紙の型紙より色が濃く出る。見本の写真では彩度が
 *    定規 0.148 に対し、型紙は 0.026〜0.031 と5倍ちがった。
 *
 * 3 は、絶対の値ではなく**同じ写真の中の他のかたまりとの比べ**で使う。
 * 台の色も紙の色も教室ごとに違うので、決め打ちの閾値は当てにならない。
 * 1 と 2 を通ったものが2つ以上あって、しかも 3 で差が付かないときは、
 * 取り違える危険があるので**あきらめる**。
 *
 * ## 斜めから撮られていたら、すぼまりで気づく
 *
 * 斜めから撮ると、定規の遠い側が近い側より細く写る。この**すぼまり**は
 * 傾きに対してきれいに増える（合成画像で 5度→1.054、10度→1.114、
 * 15度→1.178、20度→1.248、25度→1.329）。角を1点ずつ見つけるのではなく、
 * 長辺にそって細く割り、両側のふち全体を直線に当てはめて出すので、
 * ざらつきにも欠けにも強い。
 *
 * すぼまりが 1.03（傾き3度ほど）を超えたら、長方形ではなく**台形**を返し、
 * アプリ側は「ゆがみに合わせる」計算に切り替える。効き目は大きい——
 * 傾き20度で、型紙の幅のずれが **+11.7% から +2.5% へ**下がった。
 * 逆に真上から撮れているときは、長方形＋相似のほうが正確なので（+0.1% 対 +1.8%）、
 * すぼまっていないうちは長方形のまま渡す。
 *
 * ## 確かめた範囲
 *
 * 実写は見本の写真1枚（緑の台・白い型紙3枚・50cm方眼定規1本）でしか確かめていない。
 * 茶色のハトロン紙、木の机、定規が2本写っている、といった写真では
 * どうなるか分かっていない。だから外したときに困らない作りにしてある。
 */

import { traceOuterContour } from './contour'
import { minAreaRect, normalizeWinding, orderQuad, type Point, type Polygon, type Quad } from './geom'
import { hueDistance, rgbToHsv, type GreenParams } from './hsv'
import { buildObjectMask, closing, connectedComponents, opening, type Component } from './mask'

/** かたまりとして扱う最小の大きさ。pipeline.ts の MIN_AREA_RATIO と同じ */
const MIN_AREA_RATIO = 0.0015

/**
 * 定規とみなす縦横比の幅。
 * 50cm定規が 10.0、30cm定規が 12.0。少し斜めから撮っても入るように広げてある。
 */
const RATIO_MIN = 8
const RATIO_MAX = 14

/** 輪郭が最小外接長方形をどれだけ埋めていれば「長方形」とみなすか */
const FILL_MIN = 0.85

/** 定規の長辺は、写真の長辺に対して少なくともこれくらいは写っている */
const LONG_MIN_RATIO = 0.2

/** 候補が2つ以上あるとき、勝ったほうがこれだけ透けていれば選ぶ。届かなければあきらめる */
const LEAD = 1.4

/**
 * これ以上すぼまっていたら「斜めから撮られた」とみなし、台形で渡す。
 * 1.03 は傾き3度ほど。ここより手前では、長方形＋相似のほうが正確だった
 */
export const TAPER_ON = 1.03

/** 長辺にそって何段に割って、ふちを測るか */
const SLICES = 40

export type RulerFound = {
  /** 解析に渡す四隅。斜めから撮られていれば台形、そうでなければ長方形 */
  quad: Quad
  /**
   * すぼまりを均した長方形。
   * 定規の種類（50cm か 30cm か）は、こちらの縦横比で見分ける。
   * 台形のまま見ると「斜めだから分からない」と言われてしまうが、
   * 縦横比そのものは傾き35度でも 10.0 から 0.25 しかずれない
   */
  rect: Quad
  /** 遠い側と近い側の、幅の比。1.00 なら真上から撮れている */
  taper: number
  /** 斜めから撮られているので、ゆがみに合わせる計算に切り替えるべきか */
  tilted: boolean
}

/** かたまり1つぶんの、色の平均。透けているかどうかを見るのに使う */
function tintOf(c: Component, image: ImageData, hueCenter: number): number {
  const { data, width } = image
  let n = 0
  let sat = 0
  let near = 0
  for (let y = 0; y < c.mask.height; y++) {
    for (let x = 0; x < c.mask.width; x++) {
      if (c.mask.data[y * c.mask.width + x] === 0) continue
      const i = ((y + c.offsetY) * width + (x + c.offsetX)) * 4
      const [h, s] = rgbToHsv(data[i], data[i + 1], data[i + 2])
      sat += s
      if (hueDistance(h, hueCenter) < 40) near++
      n++
    }
  }
  if (n === 0) return 0
  // 「彩度が高い」だけでなく「台と同じ色みで濃い」ことを見たいので、両方を掛ける
  return (sat / n) * (0.5 + near / n)
}

/** 最小二乗で直線を当てはめる。返すのは「位置 t（0〜1）を渡すと値が返る関数」 */
function fitLine(values: Float64Array, from: number, to: number): ((t: number) => number) | null {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let k = from; k < to; k++) {
    if (!Number.isFinite(values[k])) continue
    const x = (k + 0.5) / values.length
    n++; sx += x; sy += values[k]; sxx += x * x; sxy += x * values[k]
  }
  if (n < 4) return null
  const d = n * sxx - sx * sx
  if (Math.abs(d) < 1e-9) return null
  const a = (n * sxy - sx * sy) / d
  const b = (sy - a * sx) / n
  return (t: number) => a * t + b
}

/**
 * 輪郭を「長辺にそって細く割り、両側のふちを直線に当てはめる」やり方で台形にする。
 *
 * 角を1点ずつ見つけようとすると、ざらつきや角の丸みに引きずられて外れる
 * （実際に、輪郭を4点まで間引くやり方では 50px も外した）。
 * ふち全体の点を使えば、1点ずつの誤差はならされる。
 */
function trapezoidOf(points: Polygon, angle: number): { quad: Quad; taper: number } | null {
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const rot = points.map((p) => ({ u: p.x * cos - p.y * sin, v: p.x * sin + p.y * cos }))

  let u0 = Infinity
  let u1 = -Infinity
  for (const p of rot) {
    if (p.u < u0) u0 = p.u
    if (p.u > u1) u1 = p.u
  }
  const len = u1 - u0
  if (len <= 0) return null

  const lo = new Float64Array(SLICES).fill(Infinity)
  const hi = new Float64Array(SLICES).fill(-Infinity)
  for (const p of rot) {
    const k = Math.min(SLICES - 1, Math.max(0, Math.floor(((p.u - u0) / len) * SLICES)))
    if (p.v < lo[k]) lo[k] = p.v
    if (p.v > hi[k]) hi[k] = p.v
  }

  // 端の1割は、角の丸みや切れ際の影響が出るので使わない
  const from = Math.round(SLICES * 0.1)
  const to = Math.round(SLICES * 0.9)
  const fLo = fitLine(lo, from, to)
  const fHi = fitLine(hi, from, to)
  if (!fLo || !fHi) return null

  const wA = fHi(0) - fLo(0)
  const wB = fHi(1) - fLo(1)
  if (wA <= 0 || wB <= 0) return null

  const back = (u: number, v: number): Point => ({
    x: u * Math.cos(angle) - v * Math.sin(angle),
    y: u * Math.sin(angle) + v * Math.cos(angle),
  })
  const quad = [back(u0, fLo(0)), back(u1, fLo(1)), back(u1, fHi(1)), back(u0, fHi(0))] as Quad
  return {
    quad: normalizeWinding(orderQuad(quad)),
    taper: Math.max(wA, wB) / Math.min(wA, wB),
  }
}

/** 最小外接長方形の「長辺の向き」。minAreaRect の angle は最初の辺の向きなので取り直す */
function longAxisOf(quad: Quad): number {
  const e0 = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y)
  const e1 = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y)
  return e0 >= e1
    ? Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x)
    : Math.atan2(quad[2].y - quad[1].y, quad[2].x - quad[1].x)
}

/**
 * 写真から定規らしい長方形をさがす。見つからなければ null。
 *
 * `green` は、その写真から推し量った台の色。撮った直後に呼ぶので、
 * 学生が台の色を手で直す前の値になる。直したあとに呼び直してはいない——
 * 台の色を直す画面は定規より後ろにあり、そこまで来たときには
 * 四隅はもう合っているため。
 */
export function findRulerQuad(image: ImageData, green: GreenParams): RulerFound | null {
  const { width, height } = image
  let mask = buildObjectMask(image, green)
  mask = opening(mask, 1)
  mask = closing(mask, 2)

  const { components } = connectedComponents(mask, Math.round(width * height * MIN_AREA_RATIO))
  const longMin = Math.max(width, height) * LONG_MIN_RATIO

  const candidates: (RulerFound & { tint: number })[] = []
  for (const c of components) {
    const poly = traceOuterContour(c.mask)
    if (!poly) continue
    const abs = poly.map((p) => ({ x: p.x + c.offsetX, y: p.y + c.offsetY }))
    const rect = minAreaRect(abs)
    if (!rect || rect.short <= 0) continue

    if (rect.long / rect.short < RATIO_MIN || rect.long / rect.short > RATIO_MAX) continue
    if (rect.long < longMin) continue
    if (c.area / (rect.long * rect.short) < FILL_MIN) continue

    const square = normalizeWinding(orderQuad(rect.quad))
    const trapezoid = trapezoidOf(abs, longAxisOf(rect.quad))
    const taper = trapezoid?.taper ?? 1
    const tilted = taper >= TAPER_ON
    candidates.push({
      quad: tilted && trapezoid ? trapezoid.quad : square,
      rect: square,
      taper,
      tilted,
      tint: tintOf(c, image, green.hueCenter),
    })
  }

  if (candidates.length === 0) return null
  // 2つ以上あるときは、いちばん透けているものを採る。差が小さければあきらめる
  const sorted = [...candidates].sort((a, b) => b.tint - a.tint)
  if (sorted.length > 1 && sorted[0].tint < sorted[1].tint * LEAD) return null
  const { quad, rect, taper, tilted } = sorted[0]
  return { quad, rect, taper, tilted }
}
