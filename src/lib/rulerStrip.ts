/**
 * 定規が型紙からはみ出した部分を、マスクから取り除く。
 *
 * 方眼定規は完全な透明ではなく、赤みがかった半透明。
 * そのため「緑でない場所＝型紙」という判定では、
 * 定規のうち緑マットの上に出ている部分まで型紙として拾ってしまう。
 * 地の目に沿わせて置く以上、はみ出すのは長手方向。
 * ポケット・カフス・衿のような、定規より短いパーツで必ず起きる。
 *
 * 定規の四隅は学生がタップして教えてくれているので、
 * 「定規の帯を横切って、両側とも紙かどうか」を長さ方向に1mmずつ調べればよい。
 *
 *   両側とも紙   → 紙の上に定規が載っている。そのまま残す
 *   片側だけ紙   → 端のあたり。迷うので残す（多めに出るほうが安全）
 *   両側とも背景 → 紙から外れている。ここを消す
 *
 * 迷ったら残す、としているのは、消しすぎて寸法が小さく出るほうが
 * 「買う生地が足りない」に直結して危ないため。
 */

import { applyH } from './homography'
import type { Mask } from './mask'
import type { RulerSpec, ScaleResult } from './ruler'

/** 帯の外側、どれだけ離れたところを見るか（mm） */
const OUTSIDE_MM = [4, 8]
/** タップのずれを見込んで、帯を少し広めに扱う（mm） */
const PAD_MM = 2
/** 長さ方向に何mmきざみで判定するか */
const STEP_MM = 1

export type OverhangResult = {
  mask: Mask
  /** 消した画素数。0 なら定規は型紙に収まっていた */
  removedPx: number
}

export function removeRulerOverhang(
  mask: Mask,
  scale: ScaleResult,
  ruler: RulerSpec,
): OverhangResult {
  const { width, height, data } = mask
  const { shortMm: w, longMm: l } = ruler

  const at = (u: number, v: number): number => {
    const p = applyH(scale.mmToImage, { x: u, y: v })
    if (!p) return 0
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    return data[y * width + x]
  }

  // 長さ方向を1mmずつ見て、消してよい帯を印づける
  const v0 = -PAD_MM
  const bands = Math.ceil((l + PAD_MM * 2) / STEP_MM) + 1
  const erase = new Uint8Array(bands)
  let eraseCount = 0

  for (let i = 0; i < bands; i++) {
    const v = v0 + i * STEP_MM
    let paperNearby = false
    for (const dv of [-1, 0, 1]) {
      for (const off of OUTSIDE_MM) {
        if (at(-off, v + dv) === 1 || at(w + off, v + dv) === 1) { paperNearby = true; break }
      }
      if (paperNearby) break
    }
    if (!paperNearby) { erase[i] = 1; eraseCount++ }
  }

  if (eraseCount === 0) return { mask, removedPx: 0 }

  // 消す範囲だけを走るために、帯を囲む長方形を写真の座標で求める
  const cornersMm = [
    { x: -PAD_MM, y: v0 }, { x: w + PAD_MM, y: v0 },
    { x: w + PAD_MM, y: l + PAD_MM }, { x: -PAD_MM, y: l + PAD_MM },
  ]
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (const c of cornersMm) {
    const p = applyH(scale.mmToImage, c)
    if (!p) return { mask, removedPx: 0 }
    minX = Math.min(minX, Math.floor(p.x)); maxX = Math.max(maxX, Math.ceil(p.x))
    minY = Math.min(minY, Math.floor(p.y)); maxY = Math.max(maxY, Math.ceil(p.y))
  }
  minX = Math.max(0, minX); minY = Math.max(0, minY)
  maxX = Math.min(width - 1, maxX); maxY = Math.min(height - 1, maxY)
  if (maxX < minX || maxY < minY) return { mask, removedPx: 0 }

  const out = new Uint8Array(data)
  let removedPx = 0

  for (let y = minY; y <= maxY; y++) {
    const row = y * width
    for (let x = minX; x <= maxX; x++) {
      if (out[row + x] === 0) continue
      const m = applyH(scale.imageToMm, { x, y })
      if (!m) continue
      if (m.x < -PAD_MM || m.x > w + PAD_MM) continue
      if (m.y < v0 || m.y > l + PAD_MM) continue
      const i = Math.round((m.y - v0) / STEP_MM)
      if (i < 0 || i >= bands || erase[i] === 0) continue
      out[row + x] = 0
      removedPx++
    }
  }

  return { mask: { width, height, data: out }, removedPx }
}
