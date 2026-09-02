/**
 * ゆがみを手で直す画面（依頼者の相談・2026-09-01）。
 *
 * つまみ2本——**上下のゆがみ**と**左右のゆがみ**——で台形に直す。
 * プロジェクターの台形補正と同じ考えかたで、
 * なぜ四つ角をつまむやり方をやめたのかは
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
 * ## うすいマス目
 *
 * 依頼者の指摘（2026-09-01）——
 *
 *   「背景に基準となるマス目がうっすらあると補正しやすいように感じました」
 *
 * そのとおりだった。ゆがみは**それ自体では見えない**。
 * 「まっすぐ」がとなりに無いと、脇線が傾いているのか、
 * もともとそういう形なのかが分からない。
 * マス目は絵の飾りではなく、**曲がっていないことが分かっている唯一の線**として置いてある。
 * だから型紙といっしょにゆがませてはいけない——マス目はいつでもまっすぐのまま。
 *
 * 5cm ごとなので、目分量の物差しにもなる。
 * ただし「5cm ごと」と書くのは図の中ではなく下の帯（図の中に文字を置かない約束）。
 *
 * 引いている最中の寸法も、同じ帯に出す。
 * 直す目当ては「実物を測った寸法と合わせる」ことなので、
 * この数字が出ていないと、そもそも何を目指して動かせばよいのか分からない。
 */

import { useMemo } from 'react'
import { bounds } from '../lib/geom'
import { applyHToPolygon } from '../lib/homography'
import type { PatternPart } from '../lib/pipeline'
import {
  isWarped, keystoneH, keystoneQuad, NO_WARP, warpPart, WARP_MAX, type Keystone,
} from '../lib/warp'
import { Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  /** つまみを当てる型紙。直す前の形（`result` のほう） */
  part: PatternPart
  /** いまの直し */
  warp: Keystone
  onChange: (warp: Keystone) => void
  /** 何枚めか／全部で何枚か。切り替えの矢印に使う */
  index: number
  count: number
  onIndex: (index: number) => void
  /** 写真ぜんぶに当てるか、この1枚だけか */
  all: boolean
  onAll: (all: boolean) => void
  onClose: () => void
}

/** うすいマス目の間隔（mm） */
const GRID_MM = 50

/** つまみの目盛りの細かさ。ふり幅を 80 段に割る */
const STEPS = 80

const cm = (mm: number) => (mm / 10).toFixed(1)

const path = (poly: { x: number; y: number }[]) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

/**
 * つまみの両端に置く、台形の小さな絵。
 * どちらへ動かすとどうなるのかを、言葉ではなく形で見せる
 */
function Trapezoid({ narrow }: { narrow: 'top' | 'bottom' | 'left' | 'right' }) {
  const points = {
    top: '5,3 11,3 15,13 1,13',
    bottom: '1,3 15,3 11,13 5,13',
    left: '3,5 13,1 13,15 3,11',
    right: '3,1 13,5 13,11 3,15',
  }[narrow]
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      <polygon points={points} fill="none" stroke="#9aa69e" strokeWidth="1.4"
        strokeLinejoin="round" />
    </svg>
  )
}

export function WarpEditor({
  part, warp, onChange, index, count, onIndex, all, onAll, onClose,
}: Props) {
  /*
    絵に描くのは、**寄せ直す前**の形。
    `warpPart` は左上を原点へ寄せ直すが、寄せる量は形の外まわりから出しているので、
    外接四角を通したもののほうとは一致しない。
    絵の中では両方を同じ座標で描き、寄せ直しは数字を出すときだけにする
  */
  const line = useMemo(() => {
    const H = keystoneH(part.widthMm, part.heightMm, warp)
    return (H && applyHToPolygon(H, part.outlineMm)) ?? part.outlineMm
  }, [warp, part])
  const quad = useMemo(
    () => keystoneQuad(part.widthMm, part.heightMm, warp), [warp, part],
  )
  /** 直したあとの寸法。帯に出すためだけに使う */
  const size = useMemo(() => warpPart(warp, part) ?? part, [warp, part])

  const view = useMemo(() => {
    const b = bounds([...line, ...quad])
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.14 + 10
    return {
      x: b.minX - pad, y: b.minY - pad,
      w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2,
      unit: Math.min(b.maxX - b.minX, b.maxY - b.minY),
    }
  }, [line, quad])

  /*
    マス目は、型紙といっしょにゆがませない。
    まっすぐだと分かっている線が1組あるからこそ、ゆがみが見える
  */
  const grid = useMemo(() => {
    const at = (from: number, to: number) => {
      const out: number[] = []
      for (let v = Math.ceil(from / GRID_MM) * GRID_MM; v <= to; v += GRID_MM) out.push(v)
      return out
    }
    return {
      xs: at(view.x, view.x + view.w),
      ys: at(view.y, view.y + view.h),
    }
  }, [view])

  const warped = isWarped(warp)
  const hair = view.w * 0.0022

  /** つまみの数字に添える、どちら側かの言葉 */
  const SIDE_WORD: Record<'top' | 'bottom' | 'left' | 'right', string> = {
    top: '上', bottom: '下', left: '左', right: '右',
  }

  /** つまみ1本ぶん。値は段数（整数）でやりとりする */
  const slider = (
    label: string, value: number,
    lo: 'top' | 'left', hi: 'bottom' | 'right',
    onValue: (k: number) => void,
  ) => (
    <label className="flex flex-col gap-0.5">
      {/*
        どれだけ動かしたのかを、つまみの行そのものに出す
        （学生の点検・2026-09-02「台の色を調整するつまみには『125°』と出るのに、
        こちらには出ないので、どれだけ動かしたのか分からない」）。
        すぐ上の「丈 59.5 → 60.4」でも読めるのだが、
        つまみから離れているので結び付かなかった。
        出すのは向きと割合——「上が 6% 広い」なら、手つきと一対一で対応する
      */}
      <span className="flex items-center gap-2 px-0.5">
        <span className="text-xs font-bold text-ink-700">{label}</span>
        <span className="tnum text-[11px] text-ink-300">
          {Math.abs(value) < WARP_MAX * 0.02
            ? '直していません'
            : `${SIDE_WORD[value > 0 ? hi : lo]}が ${Math.round(Math.abs(value) * 100)}% 広い`}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Trapezoid narrow={lo} />
        <input
          type="range"
          min={-STEPS / 2}
          max={STEPS / 2}
          step={1}
          value={Math.round((value / WARP_MAX) * (STEPS / 2))}
          onChange={(e) => onValue((Number(e.target.value) / (STEPS / 2)) * WARP_MAX)}
          className="range-mid min-w-0 flex-1"
        />
        <Trapezoid narrow={hi} />
      </span>
    </label>
  )

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

      {/*
        当てる先は、**見出しのすぐ下**に置く（学生の点検・2026-09-02）。

        ゆがみの原因はたいてい写真ぜんぶに共通なので、既定は「ぜんぶ」のまま
        （依頼者の選択・2026-09-01）。動き自体は正しいのだが、
        この切り替えがパネルのいちばん下——スクロールしないと見えないところ——
        にあり、見出しには「パーツ1」と出ていた。
        そのため1枚だけ直しているつもりでつまみを動かし、
        ほかの数字まで一緒に変わって驚く、ということが起きていた。
        いま何に当たっているのかを、動かす前に見えるところへ出す
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

      <div className="rounded-xl bg-white">
        <svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block h-auto w-full"
          style={{ maxHeight: '20rem' }}
        >
          {/*
            型紙の地色を先に敷き、そのうえにマス目を通す。
            マス目の下に隠れてしまうと、いちばん見たい脇線のそばで比べられない
          */}
          <path d={path(line)} fill="#faf8f2" stroke="none" />

          {/* うすいマス目。5cm ごと、10cm ごとだけ少し濃い */}
          {grid.xs.map((x) => (
            <line key={`x${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h}
              stroke={x % (GRID_MM * 2) === 0 ? '#cdd6cd' : '#e3e8e2'} strokeWidth={hair} />
          ))}
          {grid.ys.map((y) => (
            <line key={`y${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y}
              stroke={y % (GRID_MM * 2) === 0 ? '#cdd6cd' : '#e3e8e2'} strokeWidth={hair} />
          ))}

          {/* 台形になっている枠。型紙の輪郭が丸いときでも、傾きが読めるように */}
          <path
            d={path(quad)}
            fill="none" stroke="#35664e" strokeWidth={view.unit * 0.006}
            strokeDasharray={`${view.unit * 0.035} ${view.unit * 0.03}`}
          />
          <path d={path(line)} fill="none" stroke="#2b332d" strokeWidth={view.unit * 0.008} />
        </svg>
      </div>

      {/*
        目当ての数字と、マス目の読みかた。図の中には置かない（図から切り離せるように）。
        「もと → いま」で並べるのは、どれだけ動いたのかが分かるようにするため
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
        <span className="text-ink-300">
          <T id="ruler.warp.grid" vars={{ cm: GRID_MM / 10 }} />
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-2.5 py-2">
        {slider('上下のゆがみ', warp.ky, 'top', 'bottom',
          (ky) => onChange({ ...warp, ky }))}
        {slider('左右のゆがみ', warp.kx, 'left', 'right',
          (kx) => onChange({ ...warp, kx }))}
      </div>

      <p className="px-0.5 text-xs leading-relaxed text-ink-500">
        <T id="ruler.warp.body" />
      </p>

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
