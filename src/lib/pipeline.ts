/**
 * 解析のひとつながりの流れ。
 *
 *   写真 → 緑の判定 → かたまりの切り分け → 輪郭のなぞり → 実寸(mm)への換算
 *
 * ここは「順番に呼ぶだけ」に保ち、個々の処理は lib の各ファイルに閉じ込めてある。
 * 仕様が変わったとき、差し替える場所がはっきりするようにするため。
 */

import { applyH, applyHToPolygon } from './homography'
import {
  bounds, boundsHeight, boundsWidth, centroid, perimeter,
  simplify, signedArea, type Polygon, type Quad,
} from './geom'
import { buildObjectMask, closing, connectedComponents, opening, type Component, type Mask } from './mask'
import { traceOuterContour } from './contour'
import { removeRulerOverhang } from './rulerStrip'
import { buildScale, guessRuler, type RulerGuess, type RulerSpec, type ScaleResult } from './ruler'
import type { GreenParams } from './hsv'

/** かたまりとして扱う最小の大きさ（画面全体に対する割合） */
const MIN_AREA_RATIO = 0.0015
/** 輪郭の点を間引く強さ（px）。大きいほど角ばる */
const SIMPLIFY_EPSILON = 1.2
/** かたまりのうちこの割合以上が定規の帯なら、それは定規そのものとみなす */
const RULER_COVERAGE = 0.8

export type PatternPart = {
  id: string
  name: string
  /** 実寸の輪郭（mm）。左上を原点に寄せてある */
  outlineMm: Polygon
  /** 写真の上での輪郭（px）。重ね描きに使う */
  outlinePx: Polygon
  /** 最大幅（mm）。地の目に対して横 */
  widthMm: number
  /** 最大丈（mm）。地の目に対して縦 */
  heightMm: number
  areaMm2: number
  perimeterMm: number
}

export type AnalyzeOptions = {
  imageData: ImageData
  rulerQuad: Quad
  ruler: RulerSpec
  green: GreenParams
  /**
   * 4隅を台形に合わせたか（斜めから撮ったときの逃げ道）。
   * ふだんは偽で、指のずれに強い相似変換を使う。詳しくは buildScale を参照
   */
  perspective?: boolean
}

export type AnalyzeResult = {
  parts: PatternPart[]
  scale: ScaleResult
  guess: RulerGuess
  /** 緑の判定結果を目で確かめるための白黒画像 */
  maskPreview: ImageData
  /** 見つかったが小さすぎて捨てたかたまりの数 */
  discarded: number
  /** 定規が型紙からはみ出していて取り除いた画素数。0 なら収まっていた */
  rulerOverhangPx: number
}

export type AnalyzeError = { error: string }

export function analyze(opts: AnalyzeOptions): AnalyzeResult | AnalyzeError {
  const { imageData, rulerQuad, ruler, green } = opts

  const scale = buildScale(rulerQuad, ruler, opts.perspective)
  if (!scale) {
    return { error: '定規の4隅が一直線に近すぎます。四隅を四角形になるように置き直してください。' }
  }

  // 緑でない画素を拾い、ざらつきを消し、細かい穴を埋める
  let mask = buildObjectMask(imageData, green)
  mask = opening(mask, 1)
  mask = closing(mask, 2)

  // 定規は赤みがかった半透明なので、緑の上に出た部分まで型紙として写ってしまう。
  // タップされた四隅を手がかりに、そこだけを取り除く。
  const overhang = removeRulerOverhang(mask, scale, ruler)
  mask = overhang.mask

  const minArea = Math.floor(imageData.width * imageData.height * MIN_AREA_RATIO)
  const { components, discarded } = connectedComponents(mask, minArea)

  const parts: PatternPart[] = []
  for (const comp of components) {
    // 定規そのものを型紙と取り違えないようにする。
    // 「重心が定規の中」では駄目。定規は型紙の地の目線の上に載るので、
    // 細長いパーツだと型紙の重心まで定規の中に入り、型紙ごと捨ててしまう。
    if (rulerCoverage(comp, scale, ruler) > RULER_COVERAGE) continue

    const traced = traceOuterContour(comp.mask)
    if (!traced) continue

    // 切り出した範囲の座標なので、元画像の座標へ戻す
    const raw = traced.map((p) => ({ x: p.x + comp.offsetX, y: p.y + comp.offsetY }))
    const outlinePx = simplify(raw, SIMPLIFY_EPSILON)
    if (outlinePx.length < 3) continue

    const mm = applyHToPolygon(scale.imageToMm, outlinePx)
    if (!mm) continue

    const b = bounds(mm)
    const outlineMm = mm.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))

    const widthMm = boundsWidth(b)
    const heightMm = boundsHeight(b)
    // 実寸に直したとき不自然に大きい／小さいものは、判定の失敗とみなす
    if (widthMm < 10 || heightMm < 10 || widthMm > 3000 || heightMm > 3000) continue

    parts.push({
      id: `part-${parts.length + 1}`,
      name: `パーツ${parts.length + 1}`,
      outlineMm,
      outlinePx,
      widthMm,
      heightMm,
      areaMm2: Math.abs(signedArea(outlineMm)),
      perimeterMm: perimeter(outlineMm),
    })
  }

  parts.sort((a, b) => b.areaMm2 - a.areaMm2)
  parts.forEach((p, i) => { p.id = `part-${i + 1}`; p.name = `パーツ${i + 1}` })

  return {
    parts,
    scale,
    guess: guessRuler(rulerQuad),
    maskPreview: renderMask(mask),
    discarded,
    rulerOverhangPx: overhang.removedPx,
  }
}

/**
 * かたまりのうち、定規の帯の内側にある画素の割合。
 * 1に近ければ「これは型紙ではなく定規そのもの」。
 * 全画素を見る必要はないので、3画素おきに数える。
 */
function rulerCoverage(comp: Component, scale: ScaleResult, ruler: RulerSpec): number {
  const { mask } = comp
  let total = 0
  let inside = 0
  for (let y = 0; y < mask.height; y += 3) {
    const row = y * mask.width
    for (let x = 0; x < mask.width; x += 3) {
      if (mask.data[row + x] === 0) continue
      total++
      const m = applyH(scale.imageToMm, { x: x + comp.offsetX, y: y + comp.offsetY })
      if (!m) continue
      if (m.x >= -2 && m.x <= ruler.shortMm + 2 && m.y >= -2 && m.y <= ruler.longMm + 2) inside++
    }
  }
  return total === 0 ? 0 : inside / total
}

/** マスクを白黒画像にする。緑と判定された場所が濃い緑、型紙が白。 */
function renderMask(mask: Mask): ImageData {
  const out = new ImageData(mask.width, mask.height)
  for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
    const isObject = mask.data[p] === 1
    out.data[i] = isObject ? 255 : 35
    out.data[i + 1] = isObject ? 255 : 102
    out.data[i + 2] = isObject ? 255 : 78
    out.data[i + 3] = 255
  }
  return out
}

/** 実寸の輪郭の重心（デバッグ表示用） */
export const partCentroid = (part: PatternPart) => centroid(part.outlineMm)

/**
 * 緑の調整をしながら見るための、速い下書き。
 * ざらつき取りやかたまりの切り分けは省き、色の判定だけを画像にして返す。
 */
export function previewGreenMask(imageData: ImageData, green: GreenParams): ImageData {
  return renderMask(buildObjectMask(imageData, green))
}
