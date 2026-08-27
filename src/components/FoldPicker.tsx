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
 * 押す口をこの小さな図に集めて、下の大きな裁ち合わせ図には置いていない。
 * 大きいほうは型紙を指で引きずる場所なので、そこに
 * 「押すと生地の構造が変わる」仕掛けを混ぜると、
 * 型紙を動かすつもりの指が折り方を変えてしまう。折り方が変わると幅も変わり、
 * 並べたものが総崩れになるので、事故の代償が大きい。
 * それに生地は縦に長く、下端は画面の外にあることが多い。
 * この図なら4辺ぜんぶが常に画面の中にある。
 */

import { foldSidesOf, isVerticalSide, type FoldMode, type Side } from '../lib/fabric'

type Props = {
  fold: FoldMode
  onToggle: (side: Side) => void
}

/* 図の座標。押す口を辺の外側へ広く取れるよう、生地のまわりに余白を置いてある */
const VW = 132
const VH = 118
const X0 = 38
const X1 = 94
const Y0 = 27
const Y1 = 91

/** 折り山が外へふくらむ量。大きい図の `SP` と同じ考え方 */
const SP = 5
/*
  折り返して二重になっているぶんを、色の違う帯で描くことはしない。
  同じ生地なのだから、どの折り方でも同じ色で描く決まりになっている
  （依頼者の指示・2026-08-27。大きい裁ち合わせ図でも同じ）。
  二重であることは、下の断面図が言う。
*/
const CLOTH = '#fdfcf8'
const CREASE = '#35664e'
const EDGE = '#b6bcb4'

/** 辺の両端の点。左辺なら上から下へ、というように時計回りに取る */
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

export function FoldPicker({ fold, onToggle }: Props) {
  const sides = foldSidesOf(fold)
  const on = (s: Side) => sides.includes(s)

  /** 折り山。辺の外側へゆるくふくらませる。ここが「山」になる */
  const crease = (s: Side) => {
    const [ax, ay, bx, by] = ENDS[s]
    const [ox, oy] = OUT[s]
    const cx = (ax + bx) / 2 + ox * SP * 2
    const cy = (ay + by) / 2 + oy * SP * 2
    return `M${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`
  }

  /** 裁ち端。はさみで切った端なので、うっすら波打たせる */
  const wave = (s: Side) => {
    const [ax, ay, bx, by] = ENDS[s]
    const horizontal = ay === by
    const span = horizontal ? bx - ax : by - ay
    const step = span / 6
    let d = `M${ax} ${ay}`
    for (let i = 0; i < 6; i++) {
      const t0 = i * step
      const t1 = t0 + step
      const mid = (t0 + t1) / 2
      const off = i % 2 === 0 ? -1.6 : 1.6
      d += horizontal
        ? ` Q${ax + mid} ${ay + off} ${ax + t1} ${ay}`
        : ` Q${ax + off} ${ay + mid} ${ax} ${ay + t1}`
    }
    return d
  }

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className="h-[118px] w-[132px] shrink-0 touch-manipulation"
      role="group"
      aria-label="生地を上から見た図。辺を押すと「わ」になります"
    >
      {/* 生地の面 */}
      <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={CLOTH} />

      {/* 辺。「わ」なら太い緑の山、そうでなければ、みみ（点々）か裁ち端（波） */}
      {(['left', 'right', 'top', 'bottom'] as Side[]).map((s) => {
        if (on(s)) {
          return (
            <path key={`e-${s}`} d={crease(s)} stroke={CREASE} strokeWidth={4}
              fill="none" strokeLinecap="round" />
          )
        }
        const [ax, ay, bx, by] = ENDS[s]
        return isVerticalSide(s) ? (
          // みみ。実物のみみに並んでいる、織り機のピン穴
          <line key={`e-${s}`} x1={ax} y1={ay} x2={bx} y2={by}
            stroke={EDGE} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" />
        ) : (
          <path key={`e-${s}`} d={wave(s)} stroke={EDGE} strokeWidth={1.4} fill="none" />
        )
      })}

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

      {/* 押す口。見えないが、辺の外側まで広く取ってある */}
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
            aria-label={`${{ left: '左', right: '右', top: '上', bottom: '下' }[s]}の辺を「わ」にする`}
            style={{ cursor: 'pointer' }}
            onPointerDown={() => onToggle(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(s) }
            }}
          />
        )
      })}
    </svg>
  )
}
