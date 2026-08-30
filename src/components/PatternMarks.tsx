/**
 * 型紙の上に載せる印し。地の目線とパーツ名。
 *
 * 矢印の向きが生地の設定で変わるのが要点。
 *   向きなし … 上下の両矢印。180度まわして差し込める、という意味になる
 *   向きあり … 下向きの一方向。まわせないので、そのぶん生地を長く買うことになる
 *
 * 大きさは図そのものの大きさに対する割合で決める。
 * 一覧の小さな絵でも、縫い代の画面の大きな図でも、同じ見え方になるように。
 */

import type { Polygon } from '../lib/geom'
import { bounds } from '../lib/geom'
import { grainLine, grainLineH, labelSpot } from '../lib/marks'

const INK = '#2b332d'
/** 型紙の紙の色。文字の後ろに敷いて、地の目線が字を貫かないようにする */
const PAPER = '#FAF7F0'

type Props = {
  /** 印しを載せる形（出来上がり線、または裁ち切り線） */
  poly: Polygon
  /** 生地に上下の向きがあるか。矢印の頭の数が変わる */
  hasNap: boolean
  /** パーツ名。小さすぎる絵では省いてよいので、省くときは渡さない */
  name?: string
  /** 名前の大きさの上限。図に対する割合。実際はこれと「入る幅」の小さいほうを使う */
  fontScale?: number
  /**
   * 地の目の向き。ふつうは縦。
   * 生地の上で90度回して置いたパーツだけ横になる（地の目を変えたということ）。
   */
  direction?: 'v' | 'h'
  /**
   * 名前を下へどける量。裁ち合わせ図では、型紙の左上に
   * 「地の目が横」「裏返し」の印が積まれることがあり、
   * 名前がそこへ重なると両方とも読めなくなる
   */
  labelShift?: number
  /** 印しの色。生地の上では白っぽい下地に載るので、変えたいことがある */
  color?: string
  /**
   * 下地の紙の色。名前の後ろに敷いて、地の目線が字を貫かないようにするもの。
   * 裏返して置いた型紙のように、紙の色を変えて描くときは、こちらも合わせる
   */
  paper?: string
  /**
   * 地の目線を、横へずらす量（依頼者の質問・2026-08-28）。
   *
   * 「わ」で開いた型紙には、真ん中に一点鎖線の中心線が通る。
   * 地の目線もふつうは真ん中を通るので、そのままだと2本が重なって
   * どちらがどちらだか読めなくなる。重なるときだけ、地の目線を脇へどける。
   * 向きは地の目線と直角。縦の地の目なら左右へ、横なら上下へずれる
   */
  shift?: number
}

export function PatternMarks({
  poly, hasNap, name, fontScale = 0.075, direction = 'v', color = INK, paper = PAPER,
  shift = 0, labelShift = 0,
}: Props) {
  const b = bounds(poly)
  const s = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  const stroke = s * 0.007
  const head = s * 0.032
  const wing = s * 0.019

  const spot = name ? labelSpot(poly) : null
  // 日本語は1文字がほぼ1文字ぶんの幅なので、字数で割れば入る大きさが出る
  const fs = spot && name
    ? Math.min(s * fontScale, (spot.width * 0.8) / Math.max(name.length, 1))
    : 0

  const label = spot && name && (
    <text
      x={spot.x}
      y={spot.y + labelShift}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={fs}
      fontWeight={700}
      fill={color}
      stroke={paper}
      strokeWidth={fs * 0.3}
      paintOrder="stroke"
    >
      {name}
    </text>
  )

  if (direction === 'h') {
    const g0 = grainLineH(poly)
    if (!g0) return label ? <g aria-hidden="true">{label}</g> : null
    const g = { ...g0, y: g0.y + shift }
    // 右向きは必ず描く。左向きは、向きのない生地のときだけ
    const arrow = (x: number, dir: 1 | -1) =>
      `M${x} ${g.y} L${x - head * dir} ${g.y - wing} L${x - head * dir} ${g.y + wing} Z`
    return (
      <g aria-hidden="true">
        <line x1={g.x1} y1={g.y} x2={g.x2} y2={g.y} stroke={color} strokeWidth={stroke} />
        <path d={arrow(g.x2, 1)} fill={color} />
        {!hasNap && <path d={arrow(g.x1, -1)} fill={color} />}
        {label}
      </g>
    )
  }

  const g0 = grainLine(poly)
  if (!g0) return label ? <g aria-hidden="true">{label}</g> : null
  const g = { ...g0, x: g0.x + shift }
  const arrow = (y: number, dir: 1 | -1) =>
    `M${g.x} ${y} L${g.x - wing} ${y - head * dir} L${g.x + wing} ${y - head * dir} Z`

  return (
    <g aria-hidden="true">
      <line x1={g.x} y1={g.y1} x2={g.x} y2={g.y2} stroke={color} strokeWidth={stroke} />
      {/* 下向きは必ず描く。上向きは、向きのない生地のときだけ */}
      <path d={arrow(g.y2, 1)} fill={color} />
      {!hasNap && <path d={arrow(g.y1, -1)} fill={color} />}
      {label}
    </g>
  )
}
