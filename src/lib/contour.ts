/**
 * 輪郭のなぞり（Moore近傍追跡）。
 *
 * かたまりの左上の画素から出発し、境界の画素を右手で壁を触りながら
 * 一周するように拾っていく。標準的な手法で、外側の輪郭が1本得られる。
 */

import type { Mask } from './mask'
import type { Point, Polygon } from './geom'

/** 時計回りの8方向 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]

const dirIndex = (dx: number, dy: number): number =>
  DIRS.findIndex(([x, y]) => x === dx && y === dy)

export function traceOuterContour(mask: Mask): Polygon | null {
  const { width, height, data } = mask
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x]

  // 出発点：上から順に見て最初に見つかる物体の画素
  let start: Point | null = null
  for (let y = 0; y < height && !start; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 1) { start = { x, y }; break }
    }
  }
  if (!start) return null

  const contour: Polygon = [start]

  // 直前にいた背景の画素。出発点の左は必ず背景（左から走査したため）
  let back: Point = { x: start.x - 1, y: start.y }
  let cur: Point = start

  const limit = width * height * 4
  for (let step = 0; step < limit; step++) {
    const d0 = dirIndex(back.x - cur.x, back.y - cur.y)
    let next: Point | null = null
    let newBack: Point = back

    for (let k = 1; k <= 8; k++) {
      const d = (d0 + k) % 8
      const nx = cur.x + DIRS[d][0]
      const ny = cur.y + DIRS[d][1]
      if (at(nx, ny) === 1) { next = { x: nx, y: ny }; break }
      newBack = { x: nx, y: ny }
    }

    // まわりが全部背景＝1画素だけのかたまり
    if (!next) break

    back = newBack
    cur = next

    // 出発点に戻ってきたら一周おわり
    if (cur.x === start.x && cur.y === start.y) break
    contour.push(cur)
  }

  return contour.length >= 3 ? contour : null
}
