/**
 * 1mm ＝ 1画素の白黒の絵。
 *
 * 縫い代を足すのも、重なりを見るのも、面積を測るのも、
 * このアプリではぜんぶ「絵に塗って重ねる」で済ませる（判断3・判断6）。
 * 多角形どうしの計算は、へこんだ角や自己交差で壊れやすいうえに書く量が多い。
 * 塗るだけなら、角の処理もへこみも交差も勝手に解決する。
 *
 * 要尺は10cm単位で買うものなので、1mm刻みで十分に細かい。
 */

import type { Mask } from './mask'
import type { Point, Polygon } from './geom'

export const createGrid = (width: number, height: number): Mask => ({
  width,
  height,
  data: new Uint8Array(width * height),
})

/**
 * 多角形を塗る（走査線法）。
 * 横1行ずつ、輪郭と交わる場所を求めて、内側だけを塗る。
 */
export function fillPolygon(grid: Mask, poly: Polygon, value = 1): void {
  const n = poly.length
  if (n < 3) return

  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(grid.height - 1, Math.ceil(maxY))

  const xs: number[] = []
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5 // 画素の真ん中で判定すると、境目のちらつきが出ない
    xs.length = 0
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > cy === b.y > cy) continue
      xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)

    const row = y * grid.width
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5))
      const to = Math.min(grid.width - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = from; x <= to; x++) grid.data[row + x] = value
    }
  }
}

/**
 * 線分を太らせて塗る（両端が丸い帯）。
 * 縫い代は「辺を半径ぶん太らせたもの」なので、これを辺に沿って並べれば帯になる。
 */
export function stampCapsule(grid: Mask, a: Point, b: Point, radius: number, value = 1): void {
  if (radius <= 0) return

  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius))
  const x1 = Math.min(grid.width - 1, Math.ceil(Math.max(a.x, b.x) + radius))
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius))
  const y1 = Math.min(grid.height - 1, Math.ceil(Math.max(a.y, b.y) + radius))
  if (x1 < x0 || y1 < y0) return

  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const rSq = radius * radius

  for (let y = y0; y <= y1; y++) {
    const row = y * grid.width
    const py = y + 0.5
    for (let x = x0; x <= x1; x++) {
      if (grid.data[row + x] === value) continue
      const px = x + 0.5
      // 点と線分の距離。線分の外に落ちたら端点までの距離になるよう t を丸める
      let t = lenSq === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / lenSq
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const cx = px - (a.x + dx * t)
      const cy = py - (a.y + dy * t)
      if (cx * cx + cy * cy <= rSq) grid.data[row + x] = value
    }
  }
}

/** 塗られている画素の数。面積(mm²)としてそのまま読める */
export function countFilled(grid: Mask): number {
  let n = 0
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i] !== 0) n++
  return n
}

/**
 * 2つの絵が重なっている画素の数。
 * b を (offsetX, offsetY) だけずらして重ねる。配置の重なり判定に使う。
 */
export function overlapCount(a: Mask, b: Mask, offsetX: number, offsetY: number): number {
  let n = 0
  const x0 = Math.max(0, -offsetX)
  const x1 = Math.min(b.width, a.width - offsetX)
  const y0 = Math.max(0, -offsetY)
  const y1 = Math.min(b.height, a.height - offsetY)
  for (let y = y0; y < y1; y++) {
    const rb = y * b.width
    const ra = (y + offsetY) * a.width + offsetX
    for (let x = x0; x < x1; x++) {
      if (b.data[rb + x] !== 0 && a.data[ra + x] !== 0) n++
    }
  }
  return n
}

/** b を (offsetX, offsetY) だけずらして a に重ね書きする */
export function blit(a: Mask, b: Mask, offsetX: number, offsetY: number, value = 1): void {
  const x0 = Math.max(0, -offsetX)
  const x1 = Math.min(b.width, a.width - offsetX)
  const y0 = Math.max(0, -offsetY)
  const y1 = Math.min(b.height, a.height - offsetY)
  for (let y = y0; y < y1; y++) {
    const rb = y * b.width
    const ra = (y + offsetY) * a.width + offsetX
    for (let x = x0; x < x1; x++) {
      if (b.data[rb + x] !== 0) a.data[ra + x] = value
    }
  }
}
