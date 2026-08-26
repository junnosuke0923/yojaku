/**
 * 定規が型紙からはみ出した部分を、マスクから取り除く。
 *
 * 方眼定規は完全な透明ではなく、赤みがかった半透明。
 * そのため「緑でない場所＝型紙」という判定では、
 * 定規のうち緑マットの上に出ている部分まで型紙として拾ってしまう。
 *
 * はみ出し方は二通りある。
 *
 *   長さ方向  定規のほうが長い。ポケット・カフス・衿で必ず起きる
 *   幅方向    定規（幅5cm）のほうが太い。ベルト・見返し・バイアス布で必ず起きる
 *
 * 定規の四隅は学生がタップして教えてくれているので、帯の中の座標は分かる。
 * ただし帯の中は定規に隠れていて、下が紙か背景かは見えない。
 * そこで、見えているところから推し量る。
 *
 * ■ 長さ方向のはみ出し
 *   帯を横切って「両側とも紙かどうか」を1mmずつ調べる。
 *     両側とも紙   → 紙の上に載っている。残す
 *     両側とも背景 → 紙から外れている。消す
 *
 * ■ 幅方向のはみ出し（2026-08-26 追加）
 *   帯の**両端の外側**、定規に隠れていないところで型紙の幅を測る。
 *   両端で測れて、その位置がほぼ同じなら、型紙の縁は定規の下を
 *   まっすぐ通っているとみなし、両端の値をつないだ線から外を消す。
 *
 *   ベルトのように「定規より長く、定規より細い」パーツはこれで正しく出る。
 *   両端が測れないとき（型紙が定規より短い）は、この推定はしない。
 *
 * 迷ったら残す、を通している。消しすぎて寸法が小さく出るほうが
 * 「買う生地が足りない」に直結して危ないため。
 * 推定した縁からも、さらに数mmの余裕を残してから消している。
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

/** 帯の端から、どれだけ外へ出たところで型紙の幅を測るか（mm） */
const PROBE_MM = 10
/** 幅を測るとき、帯の外側まで何mm見るか */
const PROBE_REACH_MM = 60
/** 推定した縁から、これだけ余裕を残してから消す（mm） */
const KEEP_MARGIN_MM = 3
/** 両端で測った縁の位置がこれ以上ちがえば、まっすぐではないとみて諦める（mm） */
const PROBE_AGREE_MM = 15

export type OverhangResult = {
  mask: Mask
  /** 消した画素数。0 なら定規は型紙に収まっていた */
  removedPx: number
}

/** 帯を横切る1本ぶんの判定。keep は残す、all は全部消す、clip は左右を詰める */
type Slice =
  | { kind: 'keep' }
  | { kind: 'all' }
  | { kind: 'clip'; uMin: number; uMax: number }

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

  /**
   * 帯の外（定規に隠れていないところ）で、型紙が帯の幅方向にどこからどこまで
   * あるかを測る。帯にかかっている紙のかたまりのうち、いちばん太いものを返す。
   * 紙が無ければ null。
   */
  const probeWidth = (v: number): { lo: number; hi: number } | null => {
    let best: { lo: number; hi: number } | null = null
    let start: number | null = null
    const end = w + PROBE_REACH_MM
    for (let u = -PROBE_REACH_MM; u <= end; u++) {
      const paper = at(u, v) === 1
      if (paper && start === null) start = u
      if (start !== null && (!paper || u === end)) {
        const lo = start
        const hi = paper ? u : u - 1
        // 帯にかかっているものだけを見る。離れたところにある別のパーツは無視する
        if (hi >= 0 && lo <= w && (!best || hi - lo > best.hi - best.lo)) {
          best = { lo, hi }
        }
        start = null
      }
    }
    return best
  }

  // 定規の両端の外側で、型紙の幅を測っておく。
  // 両方測れて、かつ位置がほぼそろっているときだけ、下をつなぐ推定に使う。
  const head = probeWidth(-PROBE_MM)
  const tail = probeWidth(l + PROBE_MM)
  const straight =
    head !== null &&
    tail !== null &&
    Math.abs(head.lo - tail.lo) <= PROBE_AGREE_MM &&
    Math.abs(head.hi - tail.hi) <= PROBE_AGREE_MM
      ? { head, tail }
      : null

  /** 定規の下での、型紙の縁の位置。straight のときだけ使える */
  const edgeAt = (v: number): { lo: number; hi: number } => {
    const { head: a, tail: b } = straight!
    const t = Math.min(1, Math.max(0, (v + PROBE_MM) / (l + PROBE_MM * 2)))
    return {
      lo: a.lo + (b.lo - a.lo) * t - KEEP_MARGIN_MM,
      hi: a.hi + (b.hi - a.hi) * t + KEEP_MARGIN_MM,
    }
  }

  /** 帯の片側の、すぐ外に紙があるか */
  const sideHasPaper = (v: number, u0: number): boolean => {
    for (const dv of [-1, 0, 1]) {
      for (const off of OUTSIDE_MM) {
        if (at(u0 < 0 ? -off : w + off, v + dv) === 1) return true
      }
    }
    return false
  }

  // 長さ方向を1mmずつ見て、その1本をどうするか決める
  const v0 = -PAD_MM
  const bands = Math.ceil((l + PAD_MM * 2) / STEP_MM) + 1
  const slices: Slice[] = new Array(bands)
  let touched = 0

  for (let i = 0; i < bands; i++) {
    const v = v0 + i * STEP_MM

    if (straight) {
      // 縁の位置が分かっているので、そこから外を詰める。
      // 帯より広ければ何も消さないので、定規が型紙にすっかり収まっている
      // ふつうの場合はこれまでどおり素通りする
      const e = edgeAt(v)
      if (e.lo <= -PAD_MM && e.hi >= w + PAD_MM) {
        slices[i] = { kind: 'keep' }
      } else {
        slices[i] = { kind: 'clip', uMin: e.lo, uMax: e.hi }
        touched++
      }
      continue
    }

    const paperNearby = sideHasPaper(v, -1) || sideHasPaper(v, 1)
    if (paperNearby) {
      slices[i] = { kind: 'keep' }
    } else {
      slices[i] = { kind: 'all' }
      touched++
    }
  }

  if (touched === 0) return { mask, removedPx: 0 }

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
      const s = slices[Math.round((m.y - v0) / STEP_MM)]
      if (!s || s.kind === 'keep') continue
      if (s.kind === 'clip' && m.x >= s.uMin && m.x <= s.uMax) continue
      out[row + x] = 0
      removedPx++
    }
  }

  return { mask: { width, height, data: out }, removedPx }
}
