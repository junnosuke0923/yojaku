/**
 * 写真の中から定規をさがして、四隅を当てる（依頼者の質問・2026-09-01）。
 *
 *   「サンプルのような写真の場合、手動で定規の位置を指定しなくても、
 *     自動で判定して枠を定規に自動で当ててもらうことは可能ですか？」
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
 * ## 確かめた範囲
 *
 * 見本の写真1枚（緑の台・白い型紙3枚・50cm方眼定規1本）でしか確かめていない。
 * 茶色のハトロン紙、木の机、定規が2本写っている、といった写真では
 * どうなるか分かっていない。だから外したときに困らない作りにしてある。
 */

import { traceOuterContour } from './contour'
import { minAreaRect, normalizeWinding, orderQuad, type Quad } from './geom'
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

export type RulerFound = {
  quad: Quad
  /** 写真から測った 長辺÷短辺。学生には出さない（種類の判別は guessRuler がする） */
  ratio: number
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

  const candidates: { quad: Quad; ratio: number; tint: number }[] = []
  for (const c of components) {
    const poly = traceOuterContour(c.mask)
    if (!poly) continue
    const abs = poly.map((p) => ({ x: p.x + c.offsetX, y: p.y + c.offsetY }))
    const rect = minAreaRect(abs)
    if (!rect || rect.short <= 0) continue

    const ratio = rect.long / rect.short
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue
    if (rect.long < longMin) continue
    if (c.area / (rect.long * rect.short) < FILL_MIN) continue

    candidates.push({
      quad: normalizeWinding(orderQuad(rect.quad)),
      ratio,
      tint: tintOf(c, image, green.hueCenter),
    })
  }

  if (candidates.length === 0) return null
  if (candidates.length === 1) return { quad: candidates[0].quad, ratio: candidates[0].ratio }

  // 2つ以上あるときは、いちばん透けているものを採る。差が小さければあきらめる
  const sorted = [...candidates].sort((a, b) => b.tint - a.tint)
  if (sorted[0].tint < sorted[1].tint * LEAD) return null
  return { quad: sorted[0].quad, ratio: sorted[0].ratio }
}
