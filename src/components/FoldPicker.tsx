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
 * （きっちり折り切る位置まで引けば、そこに吸い付く）。
 * 片側だけ折るなら折り切る位置は向かい側の生地端で、両側から折るなら真ん中になる。
 * 引きずるほうは、押すことの上位互換ではなく、
 * 「半分に折る」の選択をひとつの動作にまとめるためのもの。
 *
 * 絵は、**大きい裁ち合わせ図とまったく同じ印**で描いてある
 * （依頼者の指示・2026-09-04）。この画面で覚えた印を、
 * 並べる画面でもう一度読み替えることにならないように。
 * 組み立ては `LayoutView` の `sheet` / `turnTo` / `selvagePath` を写したもので、
 * 寸法だけ、この小さい箱で読める大きさに取り直してある（`TURN` のあたり参照）。
 */

import { useEffect, useRef, useState } from 'react'
import {
  foldSidesOf, isVerticalSide, SIDE_NAMES,
  type EdgeAction, type FoldMode, type Side,
} from '../lib/fabric'

type Props = {
  fold: FoldMode
  /** いま「きっちり折る」になっているか。引きずったときの見え方に使う */
  half: boolean
  onEdge: (side: Side, action: EdgeAction) => void
  /** 引きずっている最中に、いま何をしているのかを言葉で出すためのもの */
  onHint: (text: string | null) => void
  /**
   * この図の1辺を引ききったとき、実物では何 mm 折ることになるか
   * （依頼者の指示・2026-09-05「任意の辺を任意の幅で折り返させる」）。
   *
   * 渡されていない画面では、途中の深さは決められない。
   * 「折らない」と「半分」の2つだけになる。
   * 生地の長さがまだ決まっていない（何も置いていない）横わでは、
   * 引ききった先が何 cm なのかを言えないので、そういう場面もここが 0 になる。
   */
  scale?: {
    spanMm: (side: Side) => number
  }
}

/*
  図の座標。1目盛り＝画面の1px にしてある。

  余白は、生地のまわりに置くものだけを置く大きさにしてある。
  折り山のふくらみ（10）と「わ」の字（14）で、四方とも 26。それ以上は取らない。

  いちど、折れる動きの始まり——開いた一枚が生地の外に寝ている姿——が
  丸ごと入る余白（生地の幅ぶん）を取ったことがあるが、
  そうすると 156x142 の箱に 47x66 の絵しか入らず、
  空きばかりの札になってしまった（依頼者の指摘・2026-08-28）。

  いまは逆にしてある。**箱を絵に合わせ、動きのほうを箱に合わせる。**
  開いた一枚は、図に収まるところまでしか開かない（`flipFrames` の `k`）。
  **着地する先は変えていない**ので、「向かい側の生地端まで折る」ことは
  そのまま見て取れる。大事なのはどこへ着くかで、どこから始まるかではない。

  高さ（110）は、となりに並ぶ文字の段の高さに合わせてある。
  どちらかが高いと、低いほうの下に空きが出る。

  生地そのものは縦長（50x58）にしてある。実物の反物は幅より丈のほうが長いので、
  正方形に近い形だと布に見えない。
*/
const VW = 102
const VH = 110
const X0 = 26
const X1 = 76
const Y0 = 26
const Y1 = 84

/** その辺の外側に残っている余白。開いた一枚を、ここまでしか開かせない */
const MARGIN: Record<Side, number> = {
  left: X0, right: VW - X1, top: Y0, bottom: VH - Y1,
}

/** これより浅く引いて離したら、折らなかったことにする */
const OFF_UNDER = 0.12
/**
 * 目盛りに吸い付く近さ（図の目盛り＝画面の1px）。
 *
 * 生地の幅いっぱいで 50 なので、4 は片側 8% ほど。
 * 途中の深さを指で決められるようになった以上、
 * 「半分」を**行き過ぎずに拾える**幅は要るが、
 * 広く取りすぎると、途中で止めたつもりの指が端に持っていかれる。
 *
 * 途中の深さが決められない画面（`scale` が無いとき）では、
 * これまでどおり `SNAP_NEAR` の広い吸い付きのままにする。
 * そこは「折らない」と「半分」しかないので、行き過ぎて困る先が無い
 */
const SNAP_UNITS = 4
/** 途中の深さを決められないときの、きっちり折った先への吸い付き */
const SNAP_NEAR = 0.76

const CLOTH = '#fdfcf8'
const CREASE = '#35664e'
const EDGE = '#b6bcb4'
/** 下になっている一枚 */
const CLOTH_UNDER = '#efeee2'
/** みみ */
const SELV = '#8d8a78'
/** 生地の輪郭 */
const OUTLINE = '#b8b6a4'

/*
  折り返りまわりの寸法。大きい裁ち合わせ図の割合（生地幅の 4.1% / 5.2%）を
  そのまま使うと、この箱（生地の幅 50）では 2px にしかならず消える。
  **割合ではなく読める大きさ**に取り直しつつ、
  たがいの比（回り込みの深さ ÷ ずらし幅 ≒ 0.8）は大きい図に合わせてある。
  比さえ保てば、回り込みの形そのものは大きい図と同じになる
*/
/** 折り山の端で、折り山から離れる向きへ走る量（大きい図の TURN） */
const TURN = 5
/** 折り山の線が、身頃の裁ち端より先へ出る量（大きい図の TIP） */
const TIP = 2.3
/** 折り山から離れる向きへ、下の一枚がのぞく量（大きい図の RIM） */
const GROW = 5.4
/** 折り山に沿う向きへ、下の一枚をずらす量（大きい図の UNDER_SHIFT） */
const SHIFT = 6.2
/** みみの帯の幅 */
const SBW = 3
/** みみのピン穴の間隔 */
const PITCH = 5
/** 両わできっちり折ったとき、出会う端どうしのすきま */
const GAP = 2.4

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
  left: [0, 12, 30, 86],
  right: [72, 12, 30, 86],
  top: [33, 0, 36, 42],
  bottom: [33, 68, 36, 42],
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

/** 好きな2点のあいだを、波打つ線でつなぐ */
function wavyPath(ax: number, ay: number, bx: number, by: number, amp = 1.6) {
  const horizontal = ay === by
  const span = horizontal ? bx - ax : by - ay
  const step = span / 6
  let d = `M${ax} ${ay}`
  for (let i = 0; i < 6; i++) {
    const mid = i * step + step / 2
    const to = (i + 1) * step
    const off = i % 2 === 0 ? -amp : amp
    d += horizontal
      ? ` Q${ax + mid} ${ay + off} ${ax + to} ${ay}`
      : ` Q${ax + off} ${ay + mid} ${ax} ${ay + to}`
  }
  return d
}

/** 波の、書き出しの M を除いた部分だけ。輪郭の途中に差し込んで使う */
function wavySeg(ax: number, ay: number, bx: number, by: number, amp: number) {
  const d = wavyPath(ax, ay, bx, by, amp)
  return d.slice(d.indexOf('Q'))
}

type Box = { x0: number; y0: number; x1: number; y1: number }
const boxOf = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 })
const flagsOf = (ss: Side[]): Record<Side, boolean> => ({
  left: ss.includes('left'), right: ss.includes('right'),
  top: ss.includes('top'), bottom: ss.includes('bottom'),
})

/**
 * 折り山の端の、回り込みのひと筆。大きい裁ち合わせ図の `turnTo` と同じもの
 * （制御点の比 0.55 / 0.28 は、依頼者のイラレの図から採った値）。
 *
 * 折り山の上の点では折り山と平行な向き、裁ち端の上の点では裁ち端と平行な向きで
 * 出入りする三次曲線。**上の一枚と下の一枚が、同じ頂点からこれを描く**ので、
 * 2本合わせて半円に見え、生地がそこで回り込んでいることが分かる。
 *
 * 角をまるめるのとは別のことで、こちらだけが「折り返っている」ことを言う。
 * ここを角のまるみで済ませていたため、
 * 「折り返り部分の半円を描くような折り返り描写がちゃんとできていません」と
 * 指摘された（依頼者・2026-09-04。大きい図でも同じ指摘を受けている・2026-08-30）
 */
function turnTo(
  fx: number, fy: number, tx: number, ty: number,
  fromFold: boolean, vertical: boolean,
) {
  let c1x: number, c1y: number, c2x: number, c2y: number
  if (vertical) {
    if (fromFold) {
      c1x = fx; c1y = fy + 0.55 * (ty - fy); c2x = fx + 0.28 * (tx - fx); c2y = ty
    } else {
      c1x = fx + 0.28 * (tx - fx); c1y = fy; c2x = tx; c2y = ty + 0.55 * (fy - ty)
    }
  } else if (fromFold) {
    c1x = fx + 0.55 * (tx - fx); c1y = fy; c2x = tx; c2y = fy + 0.28 * (ty - fy)
  } else {
    c1x = fx; c1y = fy + 0.55 * (ty - fy); c2x = fx + 0.28 * (tx - fx); c2y = ty
  }
  return `C${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`
}

/**
 * 生地1枚の輪郭。大きい裁ち合わせ図の `sheet` と同じ組み立て。
 * 裁ち端は波、みみと折り山はまっすぐ。折り山の端だけは、角を落とさず回り込ませる。
 *
 * `apex` は、**ずれた側の折り山の端で2枚が集まる頂点**。
 * 上の一枚と下の一枚に同じ値を渡すと、2枚の裁ち端がそこで出会って半円になる
 */
function sheetPath(b: Box, ss: Side[], apex: number) {
  const f = flagsOf(ss)
  const vert = f.left || f.right
  const tipNear = vert ? b.y0 + TIP : b.x0 + TIP
  type C = { i: [number, number]; o: [number, number]; v: boolean }
  const corner = (
    fold: 'l' | 'r' | 't' | 'b' | null,
    at: 'tl' | 'tr' | 'br' | 'bl',
    cx: number, cy: number,
  ): C => {
    if (!fold) return { i: [cx, cy], o: [cx, cy], v: vert }
    if (fold === 'l') {
      return at === 'tl'
        ? { i: [b.x0, tipNear], o: [b.x0 + TURN, b.y0], v: true }
        : { i: [b.x0 + TURN, b.y1], o: [b.x0, apex], v: true }
    }
    if (fold === 'r') {
      return at === 'tr'
        ? { i: [b.x1 - TURN, b.y0], o: [b.x1, tipNear], v: true }
        : { i: [b.x1, apex], o: [b.x1 - TURN, b.y1], v: true }
    }
    if (fold === 't') {
      return at === 'tl'
        ? { i: [b.x0, b.y0 + TURN], o: [tipNear, b.y0], v: false }
        : { i: [apex, b.y0], o: [b.x1, b.y0 + TURN], v: false }
    }
    return at === 'br'
      ? { i: [b.x1, b.y1 - TURN], o: [apex, b.y1], v: false }
      : { i: [tipNear, b.y1], o: [b.x0, b.y1 - TURN], v: false }
  }
  const foldAt = (a: Side, bb: Side): 'l' | 'r' | 't' | 'b' | null =>
    (f[a] ? a[0] : f[bb] ? bb[0] : null) as 'l' | 'r' | 't' | 'b' | null
  const TL = corner(foldAt('left', 'top'), 'tl', b.x0, b.y0)
  const TR = corner(foldAt('right', 'top'), 'tr', b.x1, b.y0)
  const BR = corner(foldAt('right', 'bottom'), 'br', b.x1, b.y1)
  const BL = corner(foldAt('left', 'bottom'), 'bl', b.x0, b.y1)
  // 角をまたぐひと筆。折り山の側から出るのか、裁ち端の側から出るのかで向きが変わる
  const link = (c: C, fromFold: boolean) =>
    c.i[0] === c.o[0] && c.i[1] === c.o[1]
      ? '' : turnTo(c.i[0], c.i[1], c.o[0], c.o[1], fromFold, c.v)
  return [
    `M${TL.o[0]} ${TL.o[1]}`,
    f.top ? `L${TR.i[0]} ${TR.i[1]}` : wavySeg(TL.o[0], b.y0, TR.i[0], b.y0, 1.3),
    link(TR, f.top),
    `L${BR.i[0]} ${BR.i[1]}`,
    link(BR, f.right),
    f.bottom ? `L${BL.i[0]} ${BL.i[1]}` : wavySeg(BR.o[0], b.y1, BL.i[0], b.y1, 1.3),
    link(BL, f.bottom),
    `L${TL.i[0]} ${TL.i[1]}`,
    link(TL, f.left),
    'Z',
  ].join(' ')
}

/**
 * みみ1本ぶんの道。生地の輪郭とまったく同じ形を、内側へ `o` だけ寄せて引く。
 *
 * **横わのときは、みみも折り山の端でいっしょに回り込む。**
 * まっすぐな帯を回り込みの手前で止めていたため、
 * 「横わのすべてで、みみの部分の折り返しの描写がとちゅうで途切れています」と
 * 指摘された（依頼者・2026-09-04。大きい図でも同じ指摘を受けている・2026-08-30
 * 「耳もやはり折り返しの円弧に沿ってカーブしないと自然に見えません」）。
 * 平行曲線ではなく**平行移動**なので、輪郭と同じ `turnTo` に
 * ずらした座標を渡すだけでよい。
 */
function selvageLine(b: Box, side: 'left' | 'right', o: number, ss: Side[], apex: number) {
  const f = flagsOf(ss)
  const x = side === 'left' ? b.x0 + o : b.x1 - o
  if (!f.top && !f.bottom) return `M${x} ${b.y0} L${x} ${b.y1}`
  const ap = side === 'left' ? b.x0 + TIP + o : apex - o
  const yTop = f.top ? b.y0 + TURN : b.y0
  const yBot = f.bottom ? b.y1 - TURN : b.y1
  return [
    f.top ? `M${ap} ${b.y0} ${turnTo(ap, b.y0, x, yTop, true, false)}` : `M${x} ${yTop}`,
    `L${x} ${yBot}`,
    f.bottom ? turnTo(x, yBot, ap, b.y1, false, false) : '',
  ].join(' ')
}

/**
 * みみ。実物のみみには、織るときの機械のピン穴が点々と並んでいる。
 * 3本（帯・細線・ピン穴）とも同じ道に沿って引くので、
 * 回り込みのところでも粒がその曲線に乗ってくれる
 */
function selvage(b: Box, side: 'left' | 'right', ss: Side[], apex: number, key: string) {
  const mid = selvageLine(b, side, SBW / 2, ss, apex)
  const inner = selvageLine(b, side, SBW, ss, apex)
  return (
    <g key={key} fill="none" stroke={SELV}>
      <path d={mid} strokeWidth={SBW} opacity={0.18} />
      <path d={inner} strokeWidth={0.4} opacity={0.3} />
      <path
        d={mid} strokeWidth={1.2} opacity={0.65} strokeLinecap="round"
        strokeDasharray={`0 ${PITCH}`} strokeDashoffset={-PITCH * 0.6}
      />
    </g>
  )
}

/** 生地1枚ぶん（面・織り目・輪郭・みみ） */
function sheetOf(b: Box, ss: Side[], apex: number, fill: string, key: string) {
  const d = sheetPath(b, ss, apex)
  const f = flagsOf(ss)
  return (
    <g key={key}>
      <path d={d} fill={fill} />
      <path d={d} fill="url(#fp-weave)" />
      <path d={d} fill="none" stroke={OUTLINE} strokeWidth={0.8} />
      {!f.left && selvage(b, 'left', ss, apex, `${key}-l`)}
      {!f.right && selvage(b, 'right', ss, apex, `${key}-r`)}
    </g>
  )
}

/**
 * 生地ぜんたい。大きい裁ち合わせ図とまったく同じ印で描く
 * （依頼者の指示・2026-09-04）。この画面で覚えた印を、
 * 並べる画面でもう一度読み替えることにならないように。
 *
 * 折ってあるところは、**同じ大きさの紙を2枚、少しずらして重ねた形**で描く。
 * 折り山の側で2枚はつながっているので、そちら側の端はそろえたまま、
 * 折り山に沿う向きへ `SHIFT` だけずらす（縦の折りなら下、横の折りなら右）。
 *
 * **きっちり折り切ったときだけ**、折り山から離れる向きへも `GROW` だけ広げる。
 * すると動いた端が向かい側の端に重なった形になり、端が2本並んで見える。
 * これが「きっちり折ってある」ことの印で、今までは点々の線1本で言っていたもの。
 * 途中までしか折らないときは、動いた端は面の途中にあるので広げない。
 *
 * 両わできっちり折ったときは、上の一枚が真ん中で2枚に分かれて出会う。
 * 縦の両わで真ん中に来るのは**みみ**、横の上下わで来るのは**裁ち端**
 */
function fabricFigure(ss: Side[], half: boolean) {
  const full = boxOf(X0, Y0, X1, Y1)
  const vs = ss.filter(isVerticalSide)
  const hs = ss.filter((s) => !isVerticalSide(s))
  // ずれた側の折り山の端で、上の一枚と下の一枚の裁ち端が集まる頂点
  const apex = vs.length > 0 ? Y1 + TIP : X1 + TIP
  if (ss.length === 0) return sheetOf(full, [], apex, CLOTH, 'fp-one')

  const u = boxOf(full.x0, full.y0, full.x1, full.y1)
  if (vs.length > 0) { u.y0 += SHIFT; u.y1 += SHIFT } else { u.x0 += SHIFT; u.x1 += SHIFT }
  if (half && vs.length === 1) { if (vs[0] === 'left') u.x1 += GROW; else u.x0 -= GROW }
  if (half && hs.length === 1) { if (hs[0] === 'top') u.y1 += GROW; else u.y0 -= GROW }

  let tops: React.ReactNode[]
  if (half && vs.length === 2) {
    const cx = (X0 + X1) / 2
    tops = [
      sheetOf(boxOf(X0, Y0, cx - GAP / 2, Y1), ['left'], apex, CLOTH, 'fp-top-l'),
      sheetOf(boxOf(cx + GAP / 2, Y0, X1, Y1), ['right'], apex, CLOTH, 'fp-top-r'),
    ]
  } else if (half && hs.length === 2) {
    const cy = (Y0 + Y1) / 2
    tops = [
      sheetOf(boxOf(X0, Y0, X1, cy - GAP / 2), ['top'], apex, CLOTH, 'fp-top-t'),
      sheetOf(boxOf(X0, cy + GAP / 2, X1, Y1), ['bottom'], apex, CLOTH, 'fp-top-b'),
    ]
  } else {
    tops = [sheetOf(full, ss, apex, CLOTH, 'fp-top')]
  }
  return <>{sheetOf(u, ss, apex, CLOTH_UNDER, 'fp-under')}{tops}</>
}

/**
 * 折り山の線。ずれた側の端は、2枚の裁ち端が集まる頂点まで伸ばす。
 * その先は生地が半円で回り込むので、線がそこで終わっていても途切れて見えない
 */
function creasePath(s: Side) {
  const apex = isVerticalSide(s) ? Y1 + TIP : X1 + TIP
  return isVerticalSide(s)
    ? `M${s === 'left' ? X0 : X1} ${Y0 + TIP} L${s === 'left' ? X0 : X1} ${apex}`
    : `M${X0 + TIP} ${s === 'top' ? Y0 : Y1} L${apex} ${s === 'top' ? Y0 : Y1}`
}

/** 「わ」の字に添える、折り山の印。大きい図の札と同じヘアピン */
function hairpin(cx: number, cy: number, sz: number, s: Side) {
  const r = sz * 0.3
  const d = `M${cx + sz / 2} ${cy - r} H${cx - sz / 2 + r}`
    + ` A${r} ${r} 0 0 0 ${cx - sz / 2 + r} ${cy + r}`
    + ` H${cx + sz / 2}`
  const rot = { left: 0, right: 180, top: 90, bottom: 270 }[s]
  return (
    <path
      d={d} fill="none" stroke={CREASE} strokeWidth={sz * 0.18} strokeLinecap="round"
      transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
    />
  )
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
 *
 * 始まりの開き具合（`k`）は、外側に残っている余白で決まる。
 * 目いっぱい開くと図からはみ出して切れるので、収まるところまでにしてある。
 * **着地する先は k に左右されない。**「向かい側の生地端まで折る」ことは、
 * どれだけ開いた姿から始めても同じように見て取れる。
 */
type FlipFrames = { from: string; mid: string; to: string }

const xf = (ax: number, ay: number, sx: number, sy: number, ly = 0) =>
  `translate(0,${ly}px) translate(${ax}px,${ay}px) scale(${sx},${sy})`
  + ` translate(${-ax}px,${-ay}px)`

function flipFrames(s: Side, depth: number): FlipFrames {
  const [ax, ay] = ENDS[s]
  const cx = (X0 + X1) / 2
  const cy = (Y0 + Y1) / 2
  // 2 は影のぶん。ここを詰めると、浮いた一枚の影が箱の縁で切れる
  const k = Math.min(1, Math.max(0.25, (MARGIN[s] - 2) / Math.max(depth, 1)))
  return isVerticalSide(s)
    ? { from: xf(ax, cy, -k, 1), mid: xf(ax, cy, 0.06, 1.14, -3), to: xf(ax, cy, 1, 1) }
    : { from: xf(cx, ay, 1, -k), mid: xf(cx, ay, 1.14, 0.06, -3), to: xf(cx, ay, 1, 1) }
}

/**
 * その辺は「きっちり半分に折る」ができるか。
 *
 * どの辺でもできる（依頼者の指示・2026-08-30）。縦わならみみからみみへ、
 * 横わなら裁ち端から裁ち端へ、きっちり半分に折る。
 * 横わをきっちり折ると、置いた型紙が届く長さの倍だけ生地を使うことになる。
 * `canHalfFold` と同じことを、折り方ではなく辺について言っている。
 *
 * ここで「いまの折り方」を見てはいけない。まだ折っていない生地の辺を
 * 引きずり始めたときにも、折り切る位置に吸い付いてほしいため
 * （いちばん多いたたみ方がそれなので）。
 */
const canHalfOn = (_s: Side) => true

export function FoldPicker({ fold, half, onEdge, onHint, scale }: Props) {
  const sides = foldSidesOf(fold)
  const on = (s: Side) => sides.includes(s)

  /** その辺と向かい合う、もう1本の折り山があるか＝両側から折るか */
  const bothOn = (s: Side) =>
    sides.some((t) => isVerticalSide(t) === isVerticalSide(s) && t !== s)

  /**
   * その辺で折り切ったとき、折り返した一枚の先頭がどこまで来るか。
   *
   * **向かい側の生地端まで行く**（依頼者の指摘・2026-08-28）。
   * 縦わなら、みみからみみへ折るのだから、動いたみみは向かい側のみみの上に重なる。
   * 横わも同じで、動いた裁ち端が向かい側の裁ち端の上に重なる。
   * 途中で止まるのは、折りかけて手を離した形であって、折った形ではない。
   *
   * 両側から折るときだけ真ん中まで。左右（上下）の端が中央で出会う形になる。
   *
   * この図は**折りたたんだあとの面**を描いている（折り山が辺に来ているのがその印）。
   * だから「半分」は図の真ん中ではなく、図の端である。
   */
  const snugDepth = (s: Side) => (bothOn(s) ? spanOf(s) / 2 : spanOf(s))

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
    // 折り切った先より深くは折れない。両側から折るなら、そこは真ん中
    return Math.max(0, Math.min(snugDepth(s), raw))
  }

  /** 途中の深さまで決められる画面か。実物の寸法が分かっているときだけ */
  const free = (s: Side) => (scale ? scale.spanMm(s) > 0 : false)

  /** きっちり折る位置に吸い付いたか */
  const snapped = (s: Side, raw: number) => {
    if (!canHalfOn(s)) return false
    return free(s)
      ? raw >= snugDepth(s) - SNAP_UNITS
      : raw >= snugDepth(s) * SNAP_NEAR
  }

  /** 指で決めた深さ。図の目盛りから実物の mm へ直し、5mm きざみに丸める */
  const mmAt = (s: Side, raw: number) => {
    const span = scale ? scale.spanMm(s) : 0
    const mm = (raw / spanOf(s)) * span
    return Math.round(mm / 5) * 5
  }

  const hintOf = (s: Side, d: number, snap: boolean) => {
    if (d < spanOf(s) * OFF_UNDER) return `${SIDE_NAMES[s]}は折らない`
    // 言い方は、下のプルダウンと揃えてある
    if (snap) return bothOn(s) ? '両端が出会うまで折る' : '半分に折る'
    // 折り返す幅は、指を離すと図には残らない。引いている今だけ数で言う
    if (free(s)) return `折り返し ${(mmAt(s, d) / 10).toFixed(1)}cm`
    // 実寸が分からない図（まだ何も置いていない横わ）では、何 cm かを言えない
    return `${SIDE_NAMES[s]}はまだ折らない`
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
    const raw = depthAt(d.side, e.clientX, e.clientY)
    const snap = snapped(d.side, raw)
    const shown = snap ? snugDepth(d.side) : raw
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
    else if (snapped(d.side, raw)) onEdge(d.side, 'half')
    // 実寸が分からない辺は、折り切ったのでなければ、まだ折っていない状態にする
    else if (!free(d.side)) onEdge(d.side, { depthMm: 0 })
    else onEdge(d.side, { depthMm: mmAt(d.side, raw) })
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
    const f = animate ? flipFrames(s, d) : null
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
        {/*
          先頭の端は、動いている当のものを描く。
          縦に折るなら動くのはみみ（点々）、横に折るなら動くのは裁ち端（波）。
          落ち着いたあとの辺の描き方と揃っていないと、同じ端に見えない
        */}
        {isVerticalSide(s) ? (
          <line x1={lead[0]} y1={lead[1]} x2={lead[2]} y2={lead[3]}
            stroke={EDGE} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="1 5" />
        ) : (
          <path d={wavyPath(lead[0], lead[1], lead[2], lead[3])}
            stroke={EDGE} strokeWidth={1.8} fill="none" />
        )}
      </g>
    )
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VW} ${VH}`}
      className="h-[110px] w-[102px] shrink-0 touch-none select-none"
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
        {/* 織り目。生地であることを、色ではなく面の質で言う */}
        <pattern id="fp-weave" width={2} height={2} patternUnits="userSpaceOnUse">
          <path d="M0 0 H2 M0 1 H2" stroke="#000" strokeWidth={0.25} opacity={0.05} />
          <path d="M0 0 V2 M1 0 V2" stroke="#000" strokeWidth={0.25} opacity={0.035} />
        </pattern>
      </defs>

      {/* 生地。折ってあるところは、ずらして重ねた2枚で描く */}
      {fabricFigure(sides, half)}

      {/* 引きずっている最中の一枚。指の深さにそのまま付いてくる */}
      {live && sheet(live.side, live.d, `live-${live.side}`, false)}

      {/* 押して付いたときの、パタンと折れる一枚 */}
      {/*
        押して「わ」を付けるのは「この線で生地を折る」という動作そのものなので、
        倒れ切った先は折り切った位置＝向かい側の生地端になる（`snugDepth`）。
        どれだけ折ったままにしておくかは、そのあと型紙を置くか引きずるかで決まる
      */}
      {flip && !live && sheet(
        flip.side, snugDepth(flip.side), `flip-${flip.side}-${flip.seq}`, true)}

      {/*
        折り山。みみと裁ち端は生地そのものが持っているので、ここでは足さない
        （`fabricFigure` が輪郭といっしょに引いている）
      */}
      {(['left', 'right', 'top', 'bottom'] as Side[])
        .filter((s) => on(s) || live?.side === s)
        .map((s) => (
          <path key={`e-${s}`} d={creasePath(s)} stroke={CREASE} strokeWidth={1.8}
            fill="none" strokeLinecap="round" />
        ))}

      {/*
        きっちり折り切ったときに、動いたみみが来る位置。引きずっている最中だけ出して、
        「ここまで引けばきっちり」が目で分かるようにする。吸い付く先の目印。
        片わならそれは向かい側の生地端で、両わなら真ん中になる
      */}
      {/*
        引きずっている最中に出る、吸い付く先の目盛り。いまは「半分」の1本だけ。
        吸い付いているあいだは濃くなるので、指を離す前にそれと分かる
      */}
      {live && canHalfOn(live.side) && (() => {
        const s = live.side
        const lineAt = (at: number, near: boolean, key: string) => {
          const p = isVerticalSide(s)
            ? { x1: s === 'left' ? X0 + at : X1 - at, y1: Y0 - 4, x2: s === 'left' ? X0 + at : X1 - at, y2: Y1 + 4 }
            : { x1: X0 - 4, y1: s === 'top' ? Y0 + at : Y1 - at, x2: X1 + 4, y2: s === 'top' ? Y0 + at : Y1 - at }
          return (
            <line key={key} {...p} stroke={CREASE} strokeWidth={near ? 2 : 1}
              strokeDasharray="3 3" opacity={near ? 0.9 : 0.35} />
          )
        }
        return lineAt(snugDepth(s), live.snap, 'snug')
      })()}

      {/* 「わ」の字と、⊂ の印。大きい図の折り山の札の上2行と同じ */}
      {sides.map((s) => {
        const [ax, ay, bx, by] = ENDS[s]
        const [ox, oy] = OUT[s]
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        // 縦わは上下に積み、横わは横に並べる。どちらも図の外の余白に収まる置き方
        const [hx, hy] = isVerticalSide(s) ? [mx + ox * 11, my - 8] : [mx - 12, my + oy * 11]
        const [tx, ty] = isVerticalSide(s) ? [mx + ox * 12, my + 10] : [mx + 7, my + oy * 11 + 5]
        return (
          <g key={`t-${s}`}>
            {hairpin(hx, hy, 8, s)}
            <text
              x={tx} y={ty}
              fontSize={13} fontWeight={700} fill={CREASE} textAnchor="middle"
            >わ</text>
          </g>
        )
      })}

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
