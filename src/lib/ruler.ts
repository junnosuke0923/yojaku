/**
 * 方眼定規まわり。
 *
 * 定規は2種類ある。学生がどちらを使っても意識せず進めるように、
 *   1. 見た目の縦横比から「たぶんこちら」を提案する
 *   2. ただし最終的にどちらかは、学生が選んだトグルの値を使う
 * という二段構えにしている。自動判別を鵜呑みにしない理由は 仕様メモ.md の判断1 を参照。
 */

import {
  computeHomography, fitSimilarity, invertSimilarity, similarityScale, similarityToH,
  type Homography,
} from './homography'
import { dist, normalizeWinding, orderQuad, type Point, type Quad } from './geom'

export type RulerId = 'r50' | 'r30'

export type RulerSpec = {
  id: RulerId
  label: string
  /** 長辺の実寸（mm） */
  longMm: number
  /** 短辺の実寸（mm） */
  shortMm: number
}

/**
 * 文化購買事業部の文化オリジナル商品2種。
 *   50cm → https://shop2.bunka.ac.jp/view/item/000000001819
 *   30cm → https://shop2.bunka.ac.jp/view/item/000000001817
 *
 * 長さは製品ページの記載どおり。
 * 幅（shortMm）は依頼者の申告値で、製品ページに記載が無く未確認。
 * この2つの数値がそのまま縮尺になるので、実物を測って確かめたい。
 */
export const RULERS: Record<RulerId, RulerSpec> = {
  r50: { id: 'r50', label: '50cm定規', longMm: 500, shortMm: 50 },
  r30: { id: 'r30', label: '30cm定規', longMm: 300, shortMm: 25 },
}

/** 50cm定規は 10.0、30cm定規は 12.0。その間をとって 11 で分ける。 */
export const RATIO_THRESHOLD = 11

/** 対辺の長さがこれ以上ちがったら「斜めから撮っている」とみなし、自動判別を諦める。 */
const PARALLEL_TOLERANCE = 0.1

/**
 * 実物の縦横比（50cm定規は 10.0、30cm定規は 12.0）から、これ以上離れていたら提案しない。
 *
 * ふだんの画面では長方形のまま定規に合わせてもらうので、
 * 四隅は必ずきれいな長方形になり「台形かどうか」では斜め撮りを見抜けない。
 * そのかわり、斜めから撮ると長辺が縮んで写るので、縦横比そのものが実物から離れる。
 * どちらの定規とも言いがたい比になったら、黙って学生の選択に任せる。
 */
const RATIO_TOLERANCE = 1.2

export type RulerGuess = {
  /** 写真から測った 長辺÷短辺 */
  observedRatio: number
  /** 提案する定規。判断できないときは null */
  suggested: RulerId | null
  /** 提案してよい状態か（真上から撮れているか） */
  confident: boolean
  /** 学生への説明文 */
  reason: string
}

/**
 * タップされた4点から、どちらの定規かを推し量る。
 *
 * 真上から撮れていれば、写真上の縦横比はほぼ実物どおりなので 11 で分けられる。
 * 斜めから撮っていると縦横比そのものが歪むので、提案を出さない。
 */
export function guessRuler(quad: Quad): RulerGuess {
  const q = prepareQuad(quad)
  const e = [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])]

  const pairA = (e[0] + e[2]) / 2
  const pairB = (e[1] + e[3]) / 2
  const long = Math.max(pairA, pairB)
  const short = Math.min(pairA, pairB)
  const observedRatio = short > 0 ? long / short : 0

  // 対辺どうしの長さがそろっているか＝台形に歪んでいないか
  const skewA = Math.abs(e[0] - e[2]) / Math.max(e[0], e[2], 1e-6)
  const skewB = Math.abs(e[1] - e[3]) / Math.max(e[1], e[3], 1e-6)
  const confident = skewA < PARALLEL_TOLERANCE && skewB < PARALLEL_TOLERANCE

  if (!confident) {
    return {
      observedRatio,
      suggested: null,
      confident: false,
      reason: '斜めから撮られているため、形からの判別はできません。定規の種類を選んでください。',
    }
  }

  const suggested: RulerId = observedRatio < RATIO_THRESHOLD ? 'r50' : 'r30'
  const trueRatio = RULERS[suggested].longMm / RULERS[suggested].shortMm
  if (Math.abs(observedRatio - trueRatio) > RATIO_TOLERANCE) {
    return {
      observedRatio,
      suggested: null,
      confident: false,
      reason:
        `縦横比が ${observedRatio.toFixed(1)} で、どちらの定規とも言いがたい形です。` +
        '斜めから撮れているのかもしれません。定規の種類を選んでください。',
    }
  }

  return {
    observedRatio,
    suggested,
    confident: true,
    reason: `縦横比 ${observedRatio.toFixed(1)} なので ${RULERS[suggested].label} と判断しました。`,
  }
}

/**
 * 4点を「角度順・回り方そろえ・短辺が先頭」に整える。
 * どの隅からタップしても同じ結果になるようにするための下ごしらえ。
 */
export function prepareQuad(quad: Quad): Quad {
  const ordered = normalizeWinding(orderQuad(quad))
  const e01 = dist(ordered[0], ordered[1]) + dist(ordered[2], ordered[3])
  const e12 = dist(ordered[1], ordered[2]) + dist(ordered[3], ordered[0])
  // 先頭の辺が長辺だったら、ひとつずらして短辺を先頭にする
  return (e01 > e12 ? [ordered[1], ordered[2], ordered[3], ordered[0]] : ordered) as Quad
}

export type ScaleResult = {
  /** 写真の座標(px) → 実寸の座標(mm) */
  imageToMm: Homography
  /** 実寸の座標(mm) → 写真の座標(px)。重ね描き用 */
  mmToImage: Homography
  /** おおよその換算率。1px が何mmか */
  mmPerPixel: number
  /** 実寸に直した定規の四隅（mm）。地の目が縦になる */
  rulerMmQuad: Quad
}

/**
 * タップされた定規の4隅と、選ばれた定規の実寸から、換算のしくみを組み立てる。
 *
 * 実寸の座標系は「定規の長辺＝縦（＝地の目）」になるように置く。
 * こうしておくと、あとの要尺計算で改めて回転させる必要がない。
 *
 * ■ ふだんは相似変換を使う（2026-08-26 に変更）
 *
 * もとは射影変換（4点をぴったり通す8自由度の変換）だけを使っていた。
 * 4隅が正確なら誤差ゼロで、斜めから撮っても直せる——理屈のうえでは申し分ない。
 * ところが実際には、指で合わせた4隅は数画素ずれる。そしてこの変換は、
 * そのずれを「そういう遠近だったのだ」と受け取ってしまい、
 * 定規から遠いものほど大きく歪ませる。
 *
 * 合成画像で測ったところ、4隅が ±6画素ずれただけで、
 * 定規から離れた型紙の寸法が平均11%・最悪30%ずれた（`npm run verify` の最後の節）。
 * 実際に依頼者から「定規を片方のスカートに合わせたら、
 * もう片方の形がいびつになる」という報告があり、原因はこれだった。
 *
 * そこで既定を相似変換（回転＋一様な拡大＋平行移動の4自由度）に変えた。
 * 4点8個の値に対して自由度が4しかないので、ずれは打ち消し合う。
 * 同じ ±6画素で誤差 1% 前後に収まる。
 * 縮尺がほぼ長辺（50cm）だけで決まるのも効いている。短辺は5cmしかなく、
 * 数画素のずれがそのまま1割の縮尺違いになるため、そこを当てにしない形が強い。
 *
 * 引きかえに遠近は表せない。真上から撮る前提での割り切りで、
 * 傾き20度で 2%、35度で 5% ほどの片寄りが残る。
 * それでも、4隅がずれたときの射影変換より悪くなることは無かった。
 *
 * `perspective` を真にすると、もとの射影変換に戻す。
 * 4隅を自分で台形に合わせた学生のための逃げ道。
 */
export function buildScale(
  quad: Quad,
  ruler: RulerSpec,
  perspective = false,
): ScaleResult | null {
  const src = prepareQuad(quad)
  const { shortMm: w, longMm: l } = ruler

  // 短辺を先頭にそろえてあるので、この順で対応する
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: l },
    { x: 0, y: l },
  ]

  if (perspective) {
    const imageToMm = computeHomography(src, dst)
    const mmToImage = computeHomography(dst, src)
    if (!imageToMm || !mmToImage) return null
    const longPx = (dist(src[1], src[2]) + dist(src[3], src[0])) / 2
    const mmPerPixel = longPx > 0 ? l / longPx : 0
    if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null
    return { imageToMm, mmToImage, mmPerPixel, rulerMmQuad: dst }
  }

  const fit = fitSimilarity(src, dst)
  const back = fit && invertSimilarity(fit)
  if (!fit || !back) return null

  const mmPerPixel = similarityScale(fit)
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null

  return {
    imageToMm: similarityToH(fit),
    mmToImage: similarityToH(back),
    mmPerPixel,
    rulerMmQuad: dst,
  }
}

/** 定規の四隅の初期位置。画面のまん中に、それらしい細長さで置いておく。 */
export function defaultRulerQuad(width: number, height: number): Quad {
  const cx = width / 2
  const cy = height / 2
  const halfLong = height * 0.3
  const halfShort = Math.min(width * 0.06, halfLong / 6)
  const corners: Point[] = [
    { x: cx - halfShort, y: cy - halfLong },
    { x: cx + halfShort, y: cy - halfLong },
    { x: cx + halfShort, y: cy + halfLong },
    { x: cx - halfShort, y: cy + halfLong },
  ]
  return corners as Quad
}
