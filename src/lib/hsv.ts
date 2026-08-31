/**
 * 色の判定。
 *
 * 台（マットや布）と白〜茶の型紙は、色相（Hue）で見るとはっきり離れている。
 * 明るさで判定すると影に弱いので、色相と鮮やかさで見る。
 *
 * 型の名前に `Green` と付いているのは、はじめ裁断室の緑のマットだけを
 * 相手にしていたころの名残り。いまは**台の色は緑でなくてよい**（2026-08-31）。
 */

export type GreenParams = {
  /** 台（背景）とみなす色相の中心（0〜360度） */
  hueCenter: number
  /** 中心からの許容幅（度） */
  hueTolerance: number
  /** これより鮮やかさが低い画素は「色がない」とみなし、背景から外す */
  minSaturation: number
  /** これより暗い画素は影とみなし、背景から外す */
  minValue: number
}

export const DEFAULT_GREEN: GreenParams = {
  hueCenter: 130,
  hueTolerance: 38,
  minSaturation: 0.16,
  minValue: 0.12,
}

/** RGB(0〜255) を HSV に。h は度、s と v は 0〜1。 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  return [h, max === 0 ? 0 : d / max, max]
}

/** 色相は円環なので、差は「回り込み」を考える。 */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * 写真そのものから台（背景）の色を推定する。
 *
 * 台は画面のほとんどを占めるので、色のついた画素のうち
 * いちばん多い色相を採れば、たいてい台の色に当たる。
 * 照明や機種で色の出かたが変わっても追従できる。
 *
 * **緑に限らない**（依頼者の指示・2026-08-31）。
 * 以前は 60〜210 度（黄緑〜水色）から外れた山を「推定に失敗した」とみなし、
 * 緑に戻していた。裁断室の緑のマットしか想定していなかったためである。
 * だが実際には緑のマットが使えるとはかぎらず、
 * 紺の布・赤い風呂敷・オレンジの下敷きのような暖色の台も使いたい。
 * そこで色相の縛りをやめ、**写真でいちばん多い色**をそのまま台の色とする。
 *
 * 色のついた画素がほとんど無いとき（白い机・木目の机に白い型紙、など）は、
 * 山が立たないので `fallback` を返す。この場合はそもそも色では分けられないので、
 * 無地の色つきの布か紙を1枚敷いてもらうほかない。
 */
export function estimateHueCenter(data: Uint8ClampedArray, fallback = DEFAULT_GREEN.hueCenter): number {
  const bins = new Float64Array(360)
  // 全画素を見る必要はない。間引いて十分。
  const step = 4 * Math.max(1, Math.floor(data.length / 4 / 60000))

  for (let i = 0; i < data.length; i += step) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2])
    if (s < 0.15 || v < 0.12) continue
    bins[Math.floor(h) % 360] += s
  }

  // ±5度でならしてから山を探す（1度きざみだと雑音に負ける）
  let bestHue = -1
  let bestScore = 0
  for (let h = 0; h < 360; h++) {
    let score = 0
    for (let d = -5; d <= 5; d++) score += bins[(h + d + 360) % 360]
    if (score > bestScore) { bestScore = score; bestHue = h }
  }

  // 色のついた画素がほとんど無ければ、山は立たない
  if (bestHue < 0 || bestScore <= 0) return fallback
  return bestHue
}
