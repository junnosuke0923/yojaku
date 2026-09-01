/**
 * 取り込んだ型紙のゆがみを、手で直す（依頼者の相談・2026-09-01）。
 *
 * ## はじめは四つ角をつまむやり方だった。やめた
 *
 * 数のうえでは四つ角がちょうどよかった——写真のゆがみは射影変換という
 * 8つの数で決まり、角4つ × 縦横2 ＝ ちょうど8。過不足がない。
 * けれど**使えなかった**。依頼者の指摘（2026-09-01）:
 *
 *   「手動によるゆがみの調整が、かなり大きく動いてしまい調整がとてもやりづらい」
 *   「例えば角をつかむのではなく、プロジェクターの台形補正のように、
 *     上下の補正と左右の補正の組み合わせによって調整することは可能ですか？」
 *
 * 動きすぎるのには理由がある。射影変換は**割り算**を含んでいて、
 * 角を1つ動かすと、その割り算の分母が形ぜんぶに効く。
 * つまんだ角が指ぶんしか動いていなくても、反対側の角はその何倍も飛ぶ。
 * しかも指の動き 1px が、そのまま直しの量になる。細かく合わせようがない。
 *
 * ## いまは、つまみ2本
 *
 * プロジェクターの台形補正と同じ考えかたにした。
 *
 *   上下のゆがみ … 上の辺と下の辺の、幅のちがい
 *   左右のゆがみ … 左の辺と右の辺の、丈のちがい
 *
 * これは射影変換の中の**割り算のところそのもの**である。
 * 変換の分母は `1 + kx·u + ky·v`（u, v は型紙のまん中からの位置）で、
 * `ky` を動かせば上下が、`kx` を動かせば左右が台形になる。
 * つまり四つ角でできたことのうち、**ゆがみだけ**を取り出したことになる。
 * 残り（回す・伸ばす・ずらす）は、もともと別の道具の仕事だった——
 * 回すのは縫い代の画面のつまみ、伸ばすのは定規、ずらすのは並べる画面。
 *
 * つまみにしたおかげで、動きの細かさをこちらで決められる。
 * ふり幅を ±{@link WARP_MAX} に抑えてあるので、
 * つまみを端から端まで動かしても、傾き30度ぶんほどにしかならない。
 * 指を大きく動かして、直しは少しだけ——これが欲しかった手ざわりである。
 *
 * まっすぐな線がまっすぐなまま動くのは、四つ角のときと変わらない。
 * 型紙の脇線や裾線は直線なので、これは譲れないところだった。
 *
 * ## 型紙ごとに、同じだけ台形にする
 *
 * u, v はその型紙のまん中からの位置を、その型紙の大きさで割ったものなので、
 * **どの型紙も同じだけ台形になる**（大きい型紙が大きく動く、とはならない）。
 *
 * 四つ角のときは、写真という1枚の平面にかかる変換として扱っていた。
 * そのほうが写真としては正しいのだが、取り込んだ型紙は
 * それぞれ自分の左上を原点に持ち直してあって（`pipeline.ts` の `outlineMm`）、
 * **写真の中のどこにあったかは、もう残っていない**。
 * 正しく計算する材料が無いのに正しいふりをするより、
 * 「つまみのぶんだけ、どれも同じように直る」と決めてあるほうが、
 * 見たとおりに動くぶん扱いやすい。
 *
 * ## 直しは、写真ぜんぶに効かせるのが既定
 *
 * ゆがみの原因は、たいてい写真ぜんぶに共通している——
 * 定規の枠が少しずれていれば、写っている型紙は全部同じだけゆがむ。
 * だから既定は「写真ぜんぶに一括」で、必要なときだけ1枚に絞れる
 * （依頼者の選択・2026-09-01）。
 *
 * ## これで直らないもの
 *
 * 広角レンズの樽型のゆがみは、台形では直らない（辺が曲がるため）。
 * ただし実測では、画角106度・樽型 k1=-0.3 でも寸法のずれは1%に届かなかったので、
 * 実害はないとみている（README の「標準画角と広角画角」を参照）。
 */

import { bounds, boundsHeight, boundsWidth, type Polygon, type Quad } from './geom'
import { applyHToPolygon, computeHomography, type Homography } from './homography'
import type { AnalyzeResult, PatternPart } from './pipeline'

/**
 * 台形の直し。2つの数で決まる。
 *
 * `kx` … 左右のゆがみ。正なら右が細くなる
 * `ky` … 上下のゆがみ。正なら下が細くなる
 */
export type Keystone = { kx: number; ky: number }

/** 何も直していない状態 */
export const NO_WARP: Keystone = { kx: 0, ky: 0 }

/**
 * つまみのふり幅。端まで動かして、傾き30度ぶんほど。
 *
 * 0.4 だと、遠い辺と近い辺の幅の比は 1.2/0.8 ＝ 1.5 になる。
 * 定規の判定が「斜めから撮られた」と見なす境目が比 1.03（傾き3度）で、
 * 1.5 は傾き30度ほどにあたる。手直しが要るような写真は、
 * たいていその手前にあるので、ここまであれば足りる。
 * 広く取りすぎるとつまみが利きすぎて、元の「動きすぎる」に戻ってしまう
 */
export const WARP_MAX = 0.4

/** 素通しの変換（何も直さない） */
const IDENTITY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** 直しが入っているか */
export function isWarped(k: Keystone): boolean {
  return Math.abs(k.kx) > 1e-9 || Math.abs(k.ky) > 1e-9
}

/** ふり幅の中に収める */
export const clampWarp = (k: Keystone): Keystone => ({
  kx: Math.min(Math.max(k.kx, -WARP_MAX), WARP_MAX),
  ky: Math.min(Math.max(k.ky, -WARP_MAX), WARP_MAX),
})

/** その型紙の、直す前の外接四角（左上が原点） */
export const srcRectOf = (widthMm: number, heightMm: number): Quad => [
  { x: 0, y: 0 },
  { x: widthMm, y: 0 },
  { x: widthMm, y: heightMm },
  { x: 0, y: heightMm },
]

/**
 * 外接四角を台形にする。
 *
 * まん中（u = v = 0）は動かない。だから、つまみを動かしても
 * 型紙が画面の中で飛んでいかない
 */
export function keystoneQuad(widthMm: number, heightMm: number, k: Keystone): Quad {
  const { kx, ky } = clampWarp(k)
  return srcRectOf(widthMm, heightMm).map((p) => {
    const u = p.x / widthMm - 0.5
    const v = p.y / heightMm - 0.5
    const d = 1 + kx * u + ky * v
    return { x: (u / d + 0.5) * widthMm, y: (v / d + 0.5) * heightMm }
  }) as Quad
}

/** つまみ2本から、変換を組み立てる */
export function keystoneH(
  widthMm: number, heightMm: number, k: Keystone,
): Homography | null {
  if (!isWarped(k)) return IDENTITY
  return computeHomography(srcRectOf(widthMm, heightMm), keystoneQuad(widthMm, heightMm, k))
}

/**
 * 直しを型紙1枚に当てる。左上を原点に寄せ直すのは、
 * 取り込んだ形の持ちかた（`pipeline.ts` の `outlineMm`）に合わせるため
 */
export function warpPart(k: Keystone, part: PatternPart): PatternPart | null {
  const H = keystoneH(part.widthMm, part.heightMm, k)
  if (!H) return null
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
 * うまく当てられなかった型紙は、**直す前のまま残す**。
 * 1枚のために全部を止めるより、
 * 直らなかった1枚がそのまま見えているほうが、何が起きたか分かる
 */
export function applyWarp(
  result: AnalyzeResult, k: Keystone, onlyId: string | null,
): AnalyzeResult {
  if (!isWarped(k)) return result
  return {
    ...result,
    parts: result.parts.map((p) => {
      if (onlyId && p.id !== onlyId) return p
      return warpPart(k, p) ?? p
    }),
  }
}
