/**
 * 生地を**上から見た小さな図**。4つの辺を押して「わ」にするかどうかを決める
 * （依頼者の指示・2026-08-28）。
 *
 * もとはプルダウンで「縦わ・片側」などの名前から選ばせていた。
 * その名前は、頭の中でいったん図に直さないと選べない。
 * 辺そのものを押せるなら、その手間が要らない。
 *
 * この図は、教科書の裁ち合わせ図に添えてある小さな折り図と同じ役どころ。
 * 学生が学校で見ている形と一致する。
 *
 * 押す口をこの小さな図に集めてあるのは、大きい裁ち合わせ図が
 * 型紙を指で引きずる場所だから。そこに「押すと生地の構造が変わる」仕掛けを
 * 混ぜると、型紙を動かすつもりの指が折り方を変えてしまう。
 * 折り方が変わると幅も変わり、並べたものが総崩れになる。
 * それに生地は縦に長く、下端は画面の外にあることが多い。
 * この図なら4辺ぜんぶが常に画面の中にある。
 *
 * さわり方は2通りある。**押す**と「わ」が付いたり外れたりする。
 * **辺をつまんで内側へ引きずる**と、引いた深さで折り方まで決まる
 * （浅ければ「型紙に合わせて」、半分まで引けば「きっちり半分」に吸い付く）。
 * 引きずるほうは、押すことの上位互換ではなく、
 * 「半分に折る」の選択をひとつの動作にまとめるためのもの。
 *
 * 絵そのものは、これから直すことになっている（依頼者・2026-08-28）。
 * 辺の描き分けは `creasePath` / `selvagePath` / `cutPath` に分けてあるので、
 * 見た目を変えるときはそこだけ差し替えればよい。
 */

import { useEffect, useRef, useState } from 'react'
import { foldSidesOf, isVerticalSide, type FoldMode, type Side } from '../lib/fabric'

/** 辺をさわり終えたときに起きること */
export type EdgeAction =
  /** 押した。「わ」が付いていなければ付け、付いていれば外す */
  | 'toggle'
  /** 引きずって、折るのをやめた */
  | 'off'
  /** 引きずって、浅く折った＝折る深さは置いた型紙に合わせる */
  | 'partial'
  /** 引きずって、半分まで折った＝きっちり折る */
  | 'half'

type Props = {
  fold: FoldMode
  /** いま「きっちり折る」になっているか。引きずったときの見え方に使う */
  half: boolean
  onEdge: (side: Side, action: EdgeAction) => void
  /** 引きずっている最中に、いま何をしているのかを言葉で出すためのもの */
  onHint: (text: string | null) => void
}

/* 図の座標。押す口を辺の外側へ広く取れるよう、生地のまわりに余白を置いてある */
const VW = 132
const VH = 118
const X0 = 38
const X1 = 94
const Y0 = 27
const Y1 = 91

/** 折り山が外へふくらむ量 */
const SP = 5
/**
 * 押しただけのときに、折り返して見せる深さ（辺から辺までのうちの割合）。
 *
 * 0.42 なのは、折れる動きが始まる位置＝生地の外側に、この深さぶんの余白が
 * 要るため。上下の辺の外側にある余白は 27 目盛りで、辺から辺までは 64 目盛り。
 * これより深くすると、倒れてくる前の一枚が図からはみ出して切れてしまう。
 */
const TAP_DEPTH = 0.42

/** これより浅く引いて離したら、折らなかったことにする */
const OFF_UNDER = 0.12
/** これより深く引いたら、きっちり半分に吸い付く */
const SNAP_OVER = 0.38

const CLOTH = '#fdfcf8'
const CREASE = '#35664e'
const EDGE = '#b6bcb4'

const SIDE_NAMES: Record<Side, string> = {
  left: '左', right: '右', top: '上', bottom: '下',
}

/** 辺の両端の点 */
const ENDS: Record<Side, [number, number, number, number]> = {
  left: [X0, Y0, X0, Y1],
  right: [X1, Y0, X1, Y1],
  top: [X0, Y0, X1, Y0],
  bottom: [X0, Y1, X1, Y1],
}

/** その辺の外側はどちらか（単位ベクトル） */
const OUT: Record<Side, [number, number]> = {
  left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1],
}

/**
 * 押す口。辺の外側へ大きく張り出させてある。
 * 角では隣どうしがぶつかるので、辺に沿う向きは中ほどだけにして重ならないようにした。
 */
const HIT: Record<Side, [number, number, number, number]> = {
  left: [6, 34, 38, 50],
  right: [88, 34, 38, 50],
  top: [46, 2, 40, 38],
  bottom: [46, 78, 40, 38],
}

/** その辺から向かい側までの長さ。引きずれる幅でもある */
const spanOf = (s: Side) => (isVerticalSide(s) ? X1 - X0 : Y1 - Y0)

/** その辺から深さ d だけ折り返した帯 */
function flapBox(s: Side, d: number) {
  const w = X1 - X0
  const h = Y1 - Y0
  if (s === 'left') return { x: X0, y: Y0, width: d, height: h }
  if (s === 'right') return { x: X1 - d, y: Y0, width: d, height: h }
  if (s === 'top') return { x: X0, y: Y0, width: w, height: d }
  return { x: X0, y: Y1 - d, width: w, height: d }
}

/** 折り山。辺の外側へゆるくふくらませる。ここが「山」になる */
function creasePath(s: Side) {
  const [ax, ay, bx, by] = ENDS[s]
  const [ox, oy] = OUT[s]
  const cx = (ax + bx) / 2 + ox * SP * 2
  const cy = (ay + by) / 2 + oy * SP * 2
  return `M${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`
}

/** 裁ち端。はさみで切った端なので、うっすら波打たせる */
function cutPath(s: Side) {
  const [ax, ay, bx, by] = ENDS[s]
  const horizontal = ay === by
  const span = horizontal ? bx - ax : by - ay
  const step = span / 6
  let d = `M${ax} ${ay}`
  for (let i = 0; i < 6; i++) {
    const mid = i * step + step / 2
    const to = (i + 1) * step
    const off = i % 2 === 0 ? -1.6 : 1.6
    d += horizontal
      ? ` Q${ax + mid} ${ay + off} ${ax + to} ${ay}`
      : ` Q${ax + off} ${ay + mid} ${ax} ${ay + to}`
  }
  return d
}

/**
 * 折り返す動きの、3つの姿。
 *
 * 折り山を軸に裏返す（左右の辺なら `scale(-1,1)`、上下の辺なら `scale(1,-1)`）と、
 * 外側にあった一枚が、山を軸に内側へ倒れてくる形になる。
 *
 * 途中の姿（`mid`）を挟んであるのは、裏返すだけでは**紙が折れたように見えない**
 * ため（依頼者・2026-08-28「折れる動作というのが見て取れない」）。
 * 真横から見ると、折っている途中の紙は立ち上がってこちらに近づく。
 * そこで途中では、軸の向きにはぺたんと潰しつつ（0.06）、
 * 軸と直角の向きには少し大きくし（1.14）、わずかに上へ持ち上げる。
 * 手前に立った紙は大きく見える——それを平面の図で言い換えたもの。
 *
 * 3つとも**同じ並びの変形**で書いてある。並びが違うと、ブラウザは行列に
 * 直してから間を埋めるので、途中の姿が思ったとおりにならない。
 */
type FlipFrames = { from: string; mid: string; to: string }

const xf = (ax: number, ay: number, sx: number, sy: number, ly = 0) =>
  `translate(0,${ly}px) translate(${ax}px,${ay}px) scale(${sx},${sy})`
  + ` translate(${-ax}px,${-ay}px)`

function flipFrames(s: Side): FlipFrames {
  const [ax, ay] = ENDS[s]
  const cx = (X0 + X1) / 2
  const cy = (Y0 + Y1) / 2
  return isVerticalSide(s)
    ? { from: xf(ax, cy, -1, 1), mid: xf(ax, cy, 0.06, 1.14, -3), to: xf(ax, cy, 1, 1) }
    : { from: xf(cx, ay, 1, -1), mid: xf(cx, ay, 1.14, 0.06, -3), to: xf(cx, ay, 1, 1) }
}

/**
 * その辺は「きっちり半分に折る」ができるか。
 *
 * 縦の折り（みみからみみへ折る）だけができる。横わは、半分の元になる
 * 長さそのものをこれから求めるところなので、きっちり折りようがない。
 * `canHalfFold` と同じことを、折り方ではなく辺について言っている。
 *
 * ここで「いまの折り方」を見てはいけない。まだ折っていない生地の辺を
 * 引きずり始めたときにも、半分の位置に吸い付いてほしいため
 * （いちばん多いたたみ方がそれなので）。
 */
const canHalfOn = (s: Side) => isVerticalSide(s)

export function FoldPicker({ fold, half, onEdge, onHint }: Props) {
  const sides = foldSidesOf(fold)
  const on = (s: Side) => sides.includes(s)

  const svgRef = useRef<SVGSVGElement>(null)
  /** 引きずっている最中の記録。描き直しに関わらないので ref に置く */
  const drag = useRef<{ side: Side; cx: number; cy: number; moved: boolean } | null>(null)
  /** 引きずっている最中の見え方 */
  const [live, setLive] = useState<{ side: Side; d: number; snap: boolean } | null>(null)
  /**
   * 押して「わ」が付いた辺。付いた瞬間だけ、折れる動きを見せる。
   * 同じ辺を何度押しても動くように、回数も持たせて key に混ぜる
   */
  const [flip, setFlip] = useState<{ side: Side; seq: number } | null>(null)
  const prev = useRef<Side[]>(sides)
  const seq = useRef(0)

  useEffect(() => {
    const added = sides.filter((s) => !prev.current.includes(s))
    prev.current = sides
    // 引きずって折ったときは、指がもう動かしたあとなので重ねて動かさない
    if (added.length === 1 && !drag.current) {
      seq.current += 1
      setFlip({ side: added[0], seq: seq.current })
    }
  }, [sides])

  /** 画面の1px が、この図の何目盛りにあたるか */
  const unit = () => {
    const box = svgRef.current?.getBoundingClientRect()
    return box && box.width > 0 ? VW / box.width : 1
  }

  /** その辺から内側へ、どれだけ入ったところを指しているか */
  const depthAt = (s: Side, clientX: number, clientY: number) => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return 0
    const u = unit()
    const x = (clientX - box.left) * u
    const y = (clientY - box.top) * u
    const raw = { left: x - X0, right: X1 - x, top: y - Y0, bottom: Y1 - y }[s]
    return Math.max(0, Math.min(spanOf(s), raw))
  }

  const hintOf = (s: Side, d: number, snap: boolean) => {
    if (d < spanOf(s) * OFF_UNDER) return `${SIDE_NAMES[s]}は折らない`
    if (snap) return 'きっちり半分に折る'
    return '型紙に合わせて折る'
  }

  const start = (s: Side) => (e: React.PointerEvent) => {
    // 指を捕まえておくと、辺の外へ出ても引きずり続けられる。
    // 捕まえられない場合（合図だけの入力など）でも、引きずり自体は成り立つ
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 捕まえられなくてよい */ }
    drag.current = { side: s, cx: e.clientX, cy: e.clientY, moved: false }
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const far = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
    // 少し動いただけなら、まだ「押した」の範囲。指はまっすぐには止まらない
    if (!d.moved && far < 7) return
    d.moved = true
    const span = spanOf(d.side)
    const raw = depthAt(d.side, e.clientX, e.clientY)
    const snap = canHalfOn(d.side) && raw >= span * SNAP_OVER
    const shown = snap ? span / 2 : raw
    setLive({ side: d.side, d: shown, snap })
    onHint(hintOf(d.side, raw, snap))
  }

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setLive(null)
    onHint(null)
    if (!d) return
    if (!d.moved) { onEdge(d.side, 'toggle'); return }
    const span = spanOf(d.side)
    const raw = depthAt(d.side, e.clientX, e.clientY)
    if (raw < span * OFF_UNDER) onEdge(d.side, 'off')
    else if (canHalfOn(d.side) && raw >= span * SNAP_OVER) onEdge(d.side, 'half')
    else onEdge(d.side, 'partial')
  }

  /**
   * 折り返して重なっている一枚。押したとき・引きずっている最中だけ出す。
   *
   * **生地と同じ色で塗り、下に影を落とす。**
   * はじめは塗らずに線だけにしていたが、同じ色の生地の上に薄い灰色の線を
   * 引いても、動いていることが見て取れなかった（依頼者・2026-08-28）。
   * 色を変えれば目立つが、どの折り方でも生地の色は変えない決まりがある
   * （依頼者の指示・2026-08-27）。そこで**色ではなく影**で浮かせた。
   * 同じ一枚の生地が、台から離れてこちら側へ倒れてくる、というだけの意味になる。
   * 影は動いている間だけのもので、折り終わった図には残らない。
   *
   * 先頭の端は、みみの点々で描く。折り返せば、みみが内側へ入ってくる。
   */
  const sheet = (s: Side, d: number, key: string, animate: boolean) => {
    const box = flapBox(s, d)
    if (box.width <= 0.5 || box.height <= 0.5) return null
    const f = animate ? flipFrames(s) : null
    // 先頭の端＝折り山から遠いほう。ここに、めくれてきたみみが来る
    const lead = {
      left: [box.x + box.width, box.y, box.x + box.width, box.y + box.height],
      right: [box.x, box.y, box.x, box.y + box.height],
      top: [box.x, box.y + box.height, box.x + box.width, box.y + box.height],
      bottom: [box.x, box.y, box.x + box.width, box.y],
    }[s]
    return (
      <g
        key={key}
        className={animate ? 'fp-flip' : undefined}
        style={f
          ? ({
            ['--fp-from']: f.from, ['--fp-mid']: f.mid, ['--fp-to']: f.to,
          } as React.CSSProperties)
          : undefined}
      >
        <rect {...box} fill={CLOTH} stroke={EDGE} strokeWidth={1} filter="url(#fp-lift)" />
        <line x1={lead[0]} y1={lead[1]} x2={lead[2]} y2={lead[3]}
          stroke={EDGE} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="1 5" />
      </g>
    )
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VW} ${VH}`}
      className="h-[140px] w-[156px] shrink-0 touch-none select-none"
      role="group"
      aria-label="生地を上から見た図。辺を押すと「わ」になります"
    >
      <style>{`
        /*
          折れる動き。辺を軸に、外にあった一枚が起き上がって内側へ倒れてくる。

          760ms のうち、倒れるのに 7 割（約 530ms）を使う。
          はじめは 260ms だったが、それでは目が追いつかなかった
          （依頼者・2026-08-28）。手で紙を折るのと同じくらいの速さにしてある。

          倒れ切ったあと、すぐには消さずにいったん止める。
          そこが「折り終わったところ」だと分かるための間で、
          そのあと消えるのは、下の生地と重なって見分けが付かなくなるから
          （二重でも生地の色は変えない決まり）。
        */
        .fp-flip { animation: fp-flip 760ms forwards;
                   transform-box: view-box; transform-origin: 0 0 }
        @keyframes fp-flip {
          0%   { transform: var(--fp-from); opacity: 1;
                 animation-timing-function: cubic-bezier(.45,.05,.75,.35) }
          40%  { transform: var(--fp-mid);  opacity: 1;
                 animation-timing-function: cubic-bezier(.25,.7,.4,1) }
          70%  { transform: var(--fp-to);   opacity: 1 }
          84%  { transform: var(--fp-to);   opacity: 1 }
          100% { transform: var(--fp-to);   opacity: 0 }
        }
        /* 動きを控えめにする設定の人には、動かさずに結果だけ見せる */
        @media (prefers-reduced-motion: reduce) {
          .fp-flip { animation-duration: 1ms }
        }
      `}</style>

      {/*
        浮いている一枚の影。色を変えずに「台から離れている」ことだけを言う。
        折り終われば影ごと消えるので、落ち着いた図には出てこない
      */}
      <defs>
        <filter id="fp-lift" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.6"
            floodColor="#2f3b33" floodOpacity="0.34" />
        </filter>
      </defs>

      {/* 生地の面 */}
      <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={CLOTH} />

      {/* 引きずっている最中の一枚。指の深さにそのまま付いてくる */}
      {live && sheet(live.side, live.d, `live-${live.side}`, false)}

      {/* 押して付いたときの、パタンと折れる一枚 */}
      {flip && !live && sheet(
        flip.side,
        // きっちり折るときは、倒れ切った先がちょうど半分の印に重なるようにする
        spanOf(flip.side) * (half && canHalfOn(flip.side) ? 0.5 : TAP_DEPTH),
        `flip-${flip.side}-${flip.seq}`, true)}

      {/* 辺。「わ」なら太い緑の山、そうでなければ、みみ（点々）か裁ち端（波） */}
      {(['left', 'right', 'top', 'bottom'] as Side[]).map((s) => {
        if (on(s) || live?.side === s) {
          return (
            <path key={`e-${s}`} d={creasePath(s)} stroke={CREASE} strokeWidth={4}
              fill="none" strokeLinecap="round" />
          )
        }
        const [ax, ay, bx, by] = ENDS[s]
        return isVerticalSide(s) ? (
          // みみ。実物のみみに並んでいる、織り機のピン穴
          <line key={`e-${s}`} x1={ax} y1={ay} x2={bx} y2={by}
            stroke={EDGE} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" />
        ) : (
          <path key={`e-${s}`} d={cutPath(s)} stroke={EDGE} strokeWidth={1.4} fill="none" />
        )
      })}

      {/*
        きっちり半分の位置。引きずっている最中だけ出して、
        「ここまで引けば半分」が目で分かるようにする。吸い付く先の目印
      */}
      {live && canHalfOn(live.side) && (() => {
        const s = live.side
        const at = spanOf(s) / 2
        const p = isVerticalSide(s)
          ? { x1: s === 'left' ? X0 + at : X1 - at, y1: Y0 - 4, x2: s === 'left' ? X0 + at : X1 - at, y2: Y1 + 4 }
          : { x1: X0 - 4, y1: s === 'top' ? Y0 + at : Y1 - at, x2: X1 + 4, y2: s === 'top' ? Y0 + at : Y1 - at }
        return (
          <line {...p} stroke={CREASE} strokeWidth={live.snap ? 2 : 1}
            strokeDasharray="3 3" opacity={live.snap ? 0.9 : 0.35} />
        )
      })()}

      {/* 「わ」の字。辺の外側に置く */}
      {sides.map((s) => {
        const [ax, ay, bx, by] = ENDS[s]
        const [ox, oy] = OUT[s]
        return (
          <text
            key={`t-${s}`}
            x={(ax + bx) / 2 + ox * 17}
            y={(ay + by) / 2 + oy * 15 + 5}
            fontSize={14} fontWeight={700} fill={CREASE} textAnchor="middle"
          >わ</text>
        )
      })}

      {/*
        きっちり折ってあることの印。半分の位置にみみの点々を置く。
        みみからみみへきっちり折れば、みみは真ん中に来る。実物どおりに描けばそうなる
      */}
      {half && !live && sides.some(isVerticalSide) && (
        <line x1={(X0 + X1) / 2} y1={Y0} x2={(X0 + X1) / 2} y2={Y1}
          stroke={EDGE} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" />
      )}

      {/* さわる口。見えないが、辺の外側まで広く取ってある */}
      {(['left', 'right', 'top', 'bottom'] as Side[]).map((s) => {
        const [x, y, w, h] = HIT[s]
        return (
          <rect
            key={`h-${s}`}
            x={x} y={y} width={w} height={h}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-pressed={on(s)}
            aria-label={`${SIDE_NAMES[s]}の辺を「わ」にする。内側へ引きずると折る深さも決まります`}
            style={{ cursor: 'pointer' }}
            onPointerDown={start(s)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => { drag.current = null; setLive(null); onHint(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdge(s, 'toggle') }
            }}
          />
        )
      })}
    </svg>
  )
}
