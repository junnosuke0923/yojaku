/**
 * ゆがみを手で直す画面（依頼者の相談・2026-09-01）。
 *
 * 型紙の**四つ角**をつまんで引くと、形ぜんぶがそれに合わせてゆがむ。
 * なぜ四つ角なのか、なぜ任意の点ではないのかは
 * [src/lib/warp.ts](../lib/warp.ts) の頭に書いてある。
 *
 * ここが「実寸」の画面にあるのは、
 * **実寸は寸法を確かめてもらう場所だから**である。
 * 「この数字が実物と近いか、確かめてください」と頼んでおいて、
 * 近くなかったときの手立てが「撮り直す」しか無いのでは片手落ちだった。
 *
 * ただし**最後の手段**という置きかたにしてある。
 * ゆがみの本当の直し場所は定規の四隅で、そちらを直せば全部いっぺんに直る。
 * だから入口は小さく、ふだんは畳んである。
 *
 * 引いている最中の寸法は、図の**下の帯**に出す
 * （図の中に数字を置かない、という約束事のとおり）。
 * 引く目当ては「実物を測った寸法と合わせる」ことなので、
 * この数字が出ていないと、そもそも何を目指して引けばよいのか分からない。
 */

import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { bounds, dist, type Quad } from '../lib/geom'
import { applyHToPolygon, type Homography } from '../lib/homography'
import type { PatternPart } from '../lib/pipeline'
import { handlesOf, isWarped, NO_WARP, warpFromHandles, warpPart } from '../lib/warp'
import { Icon } from './Icon'

type Props = {
  /** 持ち手を出す型紙。直す前の形（`result` のほう） */
  part: PatternPart
  /** 直す前の寸法。帯に「もと → いま」で出す */
  H: Homography
  onChange: (H: Homography) => void
  /** 何枚めか／全部で何枚か。切り替えの矢印に使う */
  index: number
  count: number
  onIndex: (index: number) => void
  /** 写真ぜんぶに当てるか、この1枚だけか */
  all: boolean
  onAll: (all: boolean) => void
  onClose: () => void
}

/** 持ち手の大きさ（図の短いほうに対する割合） */
const HANDLE = 0.055

const cm = (mm: number) => (mm / 10).toFixed(1)

export function WarpEditor({
  part, H, onChange, index, count, onIndex, all, onAll, onClose,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [grab, setGrab] = useState<number | null>(null)

  /** いまの持ち手（＝外接四角を、いまの直しに通したもの） */
  const quad = handlesOf(H, part.widthMm, part.heightMm)
  /*
    絵に描くのは、**寄せ直す前**の形。
    `warpPart` は左上を原点へ寄せ直すが、寄せる量は形の外まわりから出しているので、
    持ち手（外接四角を通したもの）の寄せる量とは一致しない。
    絵の中では両方を同じ座標で描き、寄せ直しは数字を出すときだけにする
  */
  const line = useMemo(
    () => applyHToPolygon(H, part.outlineMm) ?? part.outlineMm, [H, part],
  )
  /** 直したあとの寸法。帯に出すためだけに使う */
  const size = useMemo(() => warpPart(H, part) ?? part, [H, part])

  const view = useMemo(() => {
    const b = bounds(quad ? [...line, ...quad] : line)
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.16 + 10
    return {
      x: b.minX - pad, y: b.minY - pad,
      w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2,
      unit: Math.min(b.maxX - b.minX, b.maxY - b.minY),
    }
  }, [line, quad])

  /**
   * 画面の指の位置を、図の中の座標（mm）に直す。
   *
   * 枠の左上からの割合で割り算してはいけない。
   * 図には高さの上限があるので、縦長の型紙では**絵が枠の中で横に寄せて置かれる**。
   * 割合で割ると、その余白のぶんだけ指の位置がずれる
   * （四つ角をつまんでも、どの角にも届かなかった）。
   * ブラウザが実際に使っている変換（`getScreenCTM`）で戻せば、
   * 余白があっても寄せて置かれていても、そのまま合う
   */
  const atSvg = (e: PointerEvent) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const down = (e: PointerEvent) => {
    const p = atSvg(e)
    if (!p || !quad) return
    let near = -1
    let best = view.unit * 0.18
    quad.forEach((q, i) => {
      const d = dist(q, p)
      if (d < best) { best = d; near = i }
    })
    if (near < 0) return
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 合成の指では投げる */ }
    setGrab(near)
  }

  const move = (e: PointerEvent) => {
    if (grab === null || !quad) return
    const p = atSvg(e)
    if (!p) return
    const next = quad.map((q, i) => (i === grab ? p : q)) as Quad
    const H2 = warpFromHandles(part.widthMm, part.heightMm, next)
    // つぶれる引き方（角を裏返す等）は、計算が立たないので黙って見送る
    if (H2 && warpPart(H2, part)) onChange(H2)
  }

  const up = () => setGrab(null)

  const warped = isWarped(H)
  const hs = view.unit * HANDLE

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border-2 border-mat-500 bg-mat-50 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-sm font-bold text-mat-700"
        >
          <Icon name="back" className="h-4 w-4 shrink-0" />
          閉じる
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-700">
          {part.name}
        </span>
        {count > 1 && (
          <span className="flex overflow-hidden rounded-lg border border-ink-100 bg-white">
            <button
              type="button"
              onClick={() => onIndex((index - 1 + count) % count)}
              className="px-2.5 py-1.5 text-ink-500"
              aria-label="前のパーツ"
            >
              <Icon name="back" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onIndex((index + 1) % count)}
              className="px-2.5 py-1.5 text-ink-500"
              aria-label="次のパーツ"
            >
              <Icon name="back" className="h-4 w-4 rotate-180" />
            </button>
          </span>
        )}
      </div>

      <div className="rounded-xl bg-white">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block h-auto w-full"
          style={{ maxHeight: '22rem', touchAction: 'none' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <path
            d={line.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'}
            fill="#faf8f2" stroke="#2b332d" strokeWidth={view.unit * 0.008}
          />
          {quad && (
            <>
              <path
                d={quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'}
                fill="none" stroke="#35664e" strokeWidth={view.unit * 0.008}
                strokeDasharray={`${view.unit * 0.035} ${view.unit * 0.03}`}
              />
              {quad.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x} cy={p.y} r={grab === i ? hs * 1.25 : hs}
                  fill="#ffffff" stroke="#35664e" strokeWidth={view.unit * 0.011}
                />
              ))}
            </>
          )}
        </svg>
      </div>

      {/*
        引いている目当ての数字。図の中には置かない（図から切り離せるように）。
        「もと → いま」で並べるのは、どれだけ動かしたのかが分かるようにするため
      */}
      <div className="tnum flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-xs text-ink-500">
        <span className="flex items-center gap-1">
          <Icon name="grain" className="h-3.5 w-3.5 shrink-0 text-mat-600" />
          丈 {warped && <span className="text-ink-300">{cm(part.heightMm)} →</span>}
          <b className="text-ink-700">{cm(size.heightMm)} cm</b>
        </span>
        <span className="flex items-center gap-1">
          <Icon name="grainSide" className="h-3.5 w-3.5 shrink-0 text-mat-600" />
          幅 {warped && <span className="text-ink-300">{cm(part.widthMm)} →</span>}
          <b className="text-ink-700">{cm(size.widthMm)} cm</b>
        </span>
      </div>

      <p className="px-0.5 text-xs leading-relaxed text-ink-500">
        <b className="text-ink-700">四つ角をつまんで、実物を測った寸法に合うまで引きます。</b>
        <br />
        まっすぐな線は、まっすぐなまま動きます。
      </p>

      {/*
        当てる先。ゆがみの原因はたいてい写真ぜんぶに共通なので、既定は「ぜんぶ」
        （依頼者の選択・2026-09-01）。1枚だけ紙が反っていた、という場合のために
        絞り込みも残してある
      */}
      <div className="flex overflow-hidden rounded-xl border border-ink-100 bg-white">
        {[
          { on: true, label: '写真ぜんぶに当てる' },
          { on: false, label: 'このパーツだけ' },
        ].map((c) => (
          <button
            key={String(c.on)}
            type="button"
            onClick={() => onAll(c.on)}
            aria-pressed={all === c.on}
            className={`flex-1 px-2 py-2 text-xs font-bold ${
              all === c.on ? 'bg-mat-500 text-white' : 'text-ink-500'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {warped && (
        <button
          type="button"
          onClick={() => onChange(NO_WARP)}
          className="flex items-center justify-center gap-1.5 self-start text-xs font-bold text-mat-700"
        >
          <Icon name="undo" className="h-4 w-4 shrink-0" />
          直す前に戻す
        </button>
      )}
    </div>
  )
}
