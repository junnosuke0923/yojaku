/**
 * 取り込んだ型紙のゆがみを、手で直す（依頼者の相談・2026-09-01）。
 *
 *   「万が一取り込んだ図形のゆがみが気になった際に、実寸のセクションで、
 *     任意の点をひっぱたりすることで手動でもゆがみ補正が出来るようにするのはどう思いますか？
 *     もしその場合、任意の点を触れた方がいいのか、
 *     図全体の四つ角を持つようにしてゆがみ補正した方がいいのか」
 *
 * **四つ角にした。** 理由は3つある。
 *
 * 1. **数がちょうど合う。** 写真のゆがみ（斜めから撮った・定規の枠がずれた）は、
 *    射影変換という8つの数で決まる形をしている。角4つ × 縦横2 ＝ ちょうど8。
 *    四つ角は「ゆがみを直すのにいる分だけ、過不足なく」の持ち手になる。
 *    任意の点を触れるようにすると、直せる以上のことができてしまう——
 *    それは「直す」ではなく「作る」になる。
 * 2. **まっすぐな線が、まっすぐなまま残る。** 型紙の脇線や裾線は直線である。
 *    四つ角の直しは直線を直線のまま運ぶ。任意の点だと、
 *    脇線の途中を1点引いた瞬間に、まっすぐだった線が折れる。
 * 3. **答え合わせができる。** 四つ角なら「実物を測った寸法と合うまで引く」
 *    という確かめ方が成り立つ。任意の点だと、どこが正しいのか誰も言えない。
 *
 * ## 直しは、写真ぜんぶに効かせるのが既定
 *
 * ゆがみの原因は、たいてい写真ぜんぶに共通している——
 * 定規の枠が少しずれていれば、写っている型紙は全部同じだけゆがむ。
 * だから既定は「写真ぜんぶに一括」で、必要なときだけ1枚に絞れる
 * （依頼者の選択・2026-09-01）。
 *
 * ## 持ちかたは、変換そのもの
 *
 * しまってあるのは引いた四つ角ではなく、**変換（`Homography`）**のほう。
 * 四つ角は、変換をその型紙の外接四角に当てれば毎回出せる。
 * こうしておくと、直しの途中で別の型紙に切り替えても持ち手が付いてくる。
 * 四つ角のほうをしまうと、型紙ごとに大きさが違うので使い回せない。
 *
 * ## これで直らないもの
 *
 * 広角レンズの樽型のゆがみは、四つ角では直らない（辺が曲がるため）。
 * ただし実測では、画角106度・樽型 k1=-0.3 でも寸法のずれは1%に届かなかったので、
 * 実害はないとみている（README の「標準画角と広角画角」を参照）。
 */

import { bounds, boundsHeight, boundsWidth, type Polygon, type Quad } from './geom'
import { applyHToPolygon, computeHomography, type Homography } from './homography'
import type { AnalyzeResult, PatternPart } from './pipeline'

/** 何も直していない状態 */
export const NO_WARP: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** 直しが入っているか。1画素ぶんも動いていなければ「入っていない」とみなす */
export function isWarped(H: Homography): boolean {
  for (let i = 0; i < 9; i++) {
    if (Math.abs(H[i] - NO_WARP[i]) > 1e-9) return true
  }
  return false
}

/** その型紙の、直す前の外接四角（左上が原点） */
export const srcRectOf = (widthMm: number, heightMm: number): Quad => [
  { x: 0, y: 0 },
  { x: widthMm, y: 0 },
  { x: widthMm, y: heightMm },
  { x: 0, y: heightMm },
]

/** 画面に出す持ち手＝外接四角を、いまの直しに通したもの */
export function handlesOf(H: Homography, widthMm: number, heightMm: number): Quad | null {
  const out = applyHToPolygon(H, srcRectOf(widthMm, heightMm))
  return out ? (out as Quad) : null
}

/** 持ち手を引いた結果から、直しを組み直す */
export function warpFromHandles(
  widthMm: number, heightMm: number, quad: Quad,
): Homography | null {
  return computeHomography(srcRectOf(widthMm, heightMm), quad)
}

/**
 * 直しを型紙1枚に当てる。左上を原点に寄せ直すのは、
 * 取り込んだ形の持ちかた（`pipeline.ts` の `outlineMm`）に合わせるため
 */
export function warpPart(H: Homography, part: PatternPart): PatternPart | null {
  const out = applyHToPolygon(H, part.outlineMm)
  if (!out) return null
  const b = bounds(out)
  const widthMm = boundsWidth(b)
  const heightMm = boundsHeight(b)
  if (widthMm < 10 || heightMm < 10 || widthMm > 3000 || heightMm > 3000) return null
  const outlineMm: Polygon = out.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))
  return { ...part, outlineMm, widthMm, heightMm }
}

/**
 * 直しを結果ぜんぶに当てる。
 *
 * @param onlyId これを渡すと、その1枚だけに当てる。
 *   渡さなければ写真ぜんぶ（既定）。
 *
 * うまく当てられなかった型紙（つぶれてしまう引き方をされた等）は、
 * **直す前のまま残す**。1枚のために全部を止めるより、
 * 直らなかった1枚がそのまま見えているほうが、何が起きたか分かる
 */
export function applyWarp(
  result: AnalyzeResult, H: Homography, onlyId: string | null,
): AnalyzeResult {
  if (!isWarped(H)) return result
  return {
    ...result,
    parts: result.parts.map((p) => {
      if (onlyId && p.id !== onlyId) return p
      return warpPart(H, p) ?? p
    }),
  }
}
