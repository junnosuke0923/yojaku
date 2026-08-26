/**
 * 色の判定。
 *
 * 緑のマットと白〜茶の型紙は、色相（Hue）で見るとはっきり離れている。
 * 明るさで判定すると影に弱いので、色相と鮮やかさで見る。
 */

export type GreenParams = {
  /** 背景とみなす色相の中心（0〜360度） */
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
 * 写真そのものから背景の緑を推定する。
 *
 * マットは画面のほとんどを占めるので、色のついた画素のうち
 * いちばん多い色相を採れば、たいていマットの緑に当たる。
 * 照明や機種で緑の出かたが変わっても追従できる。
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

  // 緑からかけ離れていたら、推定に失敗したとみなす
  if (bestHue < 60 || bestHue > 210) return fallback
  return bestHue
}
