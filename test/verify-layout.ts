/**
 * 縫い代・わ・区間・要尺の検算。
 *
 * 第1フェーズの `verify.ts` が「写真から実寸に戻せるか」を見るのに対し、
 * こちらは「実寸の輪郭から先」を見る。写真は要らないので実機なしで動く。
 *
 * いちばん大事なのは最後の節で、**学校の配布資料に載っている目安と突き合わせている**。
 * 自分で作った数字どうしを比べても正しさの証明にはならないので、
 * 外から来た数字と合うかどうかを見る。
 *
 *   実行: npm run verify:layout
 */

import { initialPlan, applyToAll, buildSeam, foldGroups, SEAM_INCLUDED_MM } from '../src/lib/seam'
import { splitEdges } from '../src/lib/edges'
import { bounds, signedArea, type Point } from '../src/lib/geom'
import {
  canHalfFold, computeYardage, foldEdgeSides, foldOfSides, foldSidesOf, newPlacement,
  orientedOutline, orientedPair, turnBy, turnOf,
  packedUp, pulledIn, toggleFoldSide, toPurchaseLength,
  type Fabric, type FoldMode, type Placement, type PlacedPart, type Side,
} from '../src/lib/fabric'
import { isSquare, outlineOf, placedPartOf, planOf, squaredTurn, toStored, withTurn } from '../src/lib/store'
import { turnPoly } from '../src/lib/marks'
import { applyHToPolygon } from '../src/lib/homography'
import {
  clampWarp, isWarped, keystoneH, keystoneQuad, NO_WARP, warpPart, WARP_MAX,
} from '../src/lib/warp'

let failures = 0

function ok(label: string, pass: boolean, detail: string) {
  if (!pass) failures++
  console.log(`  ${pass ? 'OK  ' : 'NG  '}${label.padEnd(30)} ${detail}`)
}

function near(label: string, actual: number, expected: number, tolerance: number) {
  ok(label, Math.abs(actual - expected) <= tolerance,
    `${actual.toFixed(1)} (期待 ${expected} ±${tolerance})`)
}

const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
]

/** 台形。左辺が斜めなので、辺の長さが4本とも違う */
const trapezoid: Point[] = [
  { x: 60, y: 0 }, { x: 240, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 },
]

/** へこんだ角のある形。数式で輪郭をずらす方式が壊れるのはここ */
const notched: Point[] = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 },
  { x: 120, y: 300 }, { x: 120, y: 180 }, { x: 80, y: 180 },
  { x: 80, y: 300 }, { x: 0, y: 300 },
]

/** なだらかな曲線だけの形（袖ぐりのつもり）。角がひとつも無い */
const ellipse: Point[] = Array.from({ length: 72 }, (_, i) => {
  const t = (i / 72) * Math.PI * 2
  return { x: 150 + 150 * Math.cos(t), y: 200 + 200 * Math.sin(t) }
})

console.log('縫い代・わ・区間・要尺の検算')

// ══════════════════════════════════════════════════════════
console.log('\n■ 辺の切り分け — 角の数だけに分かれるか')
{
  const r = splitEdges(rect(200, 300))
  ok('長方形は4本', r.groups.length === 4, `${r.groups.length}本`)

  const t = splitEdges(trapezoid)
  ok('台形も4本', t.groups.length === 4, `${t.groups.length}本`)

  const n = splitEdges(notched)
  ok('へこみのある形は8本', n.groups.length === 8, `${n.groups.length}本`)

  // ここが肝心。曲線を何十本もの短い線に割ってしまうと、学生が縫い代を指定できない
  const e = splitEdges(ellipse)
  ok('なだらかな曲線は1本のまま', e.groups.length === 1, `${e.groups.length}本`)

  near('4本の長さの合計 = 周長', r.groups.reduce((s, g) => s + g.lengthMm, 0), 1000, 6)
}

// ══════════════════════════════════════════════════════════
console.log('\n■ 縫い代 — 全周1cmで、縦横とも2cm大きくなるか')
{
  const seam = buildSeam(initialPlan(rect(200, 300), 10))!
  near('幅', seam.widthMm, 220, 2)
  near('丈', seam.heightMm, 320, 2)
  // 角が丸まるぶん、正確な長方形より少しだけ小さい
  ok('面積が妥当', seam.areaMm2 > 220 * 320 * 0.97 && seam.areaMm2 <= 220 * 320,
    `${Math.round(seam.areaMm2)} mm²`)
}

console.log('\n■ 縫い代 0 ＝ わ — その辺だけ大きくならないか')
{
  const plan = initialPlan(rect(200, 300), 10)
  const left = plan.groups.findIndex((g) => g.midpoint.x < 1)
  ok('左辺が見つかる', left >= 0, `${left} 番目`)
  plan.allowancesMm[left] = 0

  const seam = buildSeam(plan)!
  near('幅は片側だけ増える', seam.widthMm, 210, 2)
  near('丈は両側とも増える', seam.heightMm, 320, 2)
  ok('折り山として拾える', foldGroups(plan).length === 1, `${foldGroups(plan).length}本`)
}

console.log('\n■ 一括設定 — 0 の辺を飛ばすか（依頼者の指示）')
{
  const plan = initialPlan(rect(200, 300), 10)
  const left = plan.groups.findIndex((g) => g.midpoint.x < 1)
  plan.allowancesMm[left] = 0

  const { plan: after, changed } = applyToAll(plan, 15)
  ok('変えたのは3本', changed === 3, `${changed}本`)
  ok('わの辺は 0 のまま', after.allowancesMm[left] === 0, `${after.allowancesMm[left]} mm`)
  ok('ほかは15mm', after.allowancesMm.filter((a) => a === 15).length === 3,
    after.allowancesMm.join(' / '))
}

console.log('\n■ 辺ごとに違う縫い代 — 裾だけ4cm（学校の図と同じ形）')
{
  const plan = initialPlan(rect(200, 300), 10)
  const hem = plan.groups.findIndex((g) => g.midpoint.y > 299)
  ok('裾が見つかる', hem >= 0, `${hem} 番目`)
  plan.allowancesMm[hem] = 40

  const seam = buildSeam(plan)!
  // 裾の4cmが横にもはみ出したら、ここが 276 になる。実物の裁ち合わせ図はそうならない
  near('幅は 1cm ずつのまま', seam.widthMm, 220, 2)
  near('丈は上1cm＋裾4cm', seam.heightMm, 350, 2)
}

console.log('\n■ へこんだ角 — 形が壊れないか')
{
  const seam = buildSeam(initialPlan(notched, 10))
  ok('計算できる', seam !== null, seam ? `${seam.cutLineMm.length}点` : '失敗')
  if (seam) {
    near('幅', seam.widthMm, 220, 2)
    near('丈', seam.heightMm, 320, 2)
    const b = bounds(seam.cutLineMm)
    ok('外接の枠に収まる', seam.areaMm2 <= (b.maxX - b.minX) * (b.maxY - b.minY),
      `${Math.round(seam.areaMm2)} mm²`)
  }
}

// ══════════════════════════════════════════════════════════
// ここから生地の側

const part = (id: string, w: number, h: number, hasFoldEdge = false): PlacedPart => ({
  // 実際の型紙と同じく、出来上がり線は裁ち切り線の内側にある
  id, hasFoldEdge, cutLineMm: rect(w, h), finishedLineMm: rect(w, h),
  foldMarksMm: [], centerLineMm: null,
})

const fabric = (widthMm: number, folds: Fabric['sections'][number]['fold'][], hasNap = false): Fabric => ({
  widthMm, hasNap,
  sections: folds.map((fold, i) => ({ id: `s${i + 1}`, fold })),
})

/** 生地幅をきっちり半分に折るやり方（学校で最初に習う基本のたたみ方） */
const halfFabric = (widthMm: number, hasNap = false): Fabric => ({
  widthMm, hasNap,
  sections: [{ id: 's1', fold: 'vLeft', halfFold: true }],
})

const run = (f: Fabric, ps: Placement[], list: PlacedPart[]) =>
  computeYardage(f, ps, new Map(list.map((x) => [x.id, x])))

console.log('\n■ 縦わ — 折っても長さは変わらない')
{
  // 「わ」に指定しただけでは折れない。端を 30cm 引いて折る（依頼者の指示・2026-09-05）
  const f: Fabric = {
    widthMm: 1100, hasNap: false,
    sections: [{ id: 's1', fold: 'vLeft', foldDepthMm: { left: 300 } }],
  }
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
  const r = run(f, [p], [part('p1', 300, 400, true)])
  near('有効幅', 1100 - 40, 1060, 0)
  near('折り込む深さ', r.sections[0].foldDepth.left, 300, 0)
  near('描く面の幅', r.sections[0].surfaceWidthMm, 760, 0)
  near('要尺', r.totalMm, 400, 0)
  ok('わなので1枚（開いて左右対称）', r.counts[0].count === 1 && r.counts[0].onFold, '×1 わ')
  ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 「わ」に指定しただけでは、まだ折れていない')
{
  /*
    もとは、折り山に当てた型紙の幅だけひとりでに折り返していた。
    置いた型紙のほうが生地の形を動かすことになるので、依頼者から
    「動作的に気持ち悪い」として外した（2026-09-05）。
    いまは端の札を引くまで、生地は一重のまま
  */
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
  const r = run(fabric(1100, ['vLeft']), [p], [part('p1', 300, 400, true)])
  near('折り込む深さは 0 のまま', r.sections[0].foldDepth.left, 0, 0)
  near('置ける幅も減らない', r.sections[0].surfaceWidthMm, 1060, 0)
  ok('折り返しに収まっていないと知らせる',
    r.problems.some((x) => x.kind === 'pastFold' && x.placementId === 'a'),
    r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 横わ — 折ったぶんだけ余分に使う')
{
  const f: Fabric = {
    widthMm: 1100, hasNap: false,
    sections: [{ id: 's1', fold: 'hBottom', foldDepthMm: { bottom: 300 } }],
  }
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'bottom' })
  const r = run(f, [p], [part('p1', 500, 300, true)])
  near('折り込む深さ', r.sections[0].foldDepth.bottom, 300, 0)
  near('描く面の長さ', r.sections[0].surfaceLengthMm, 300, 0)
  // 30cm の面を作るのに、30cm 折り込むので、生地は 60cm 要る
  near('要尺は面＋折り込み', r.totalMm, 600, 0)
}

console.log('\n■ 二重の帯に丸ごと入れば2枚取れる')
{
  const f: Fabric = {
    widthMm: 1100, hasNap: false,
    sections: [{ id: 's1', fold: 'vLeft', foldDepthMm: { left: 300 } }],
  }
  const ps = [
    newPlacement('a', 'p1', 's1', { snapTo: 'left' }),
    newPlacement('b', 'p2', 's1', { xMm: 50, yMm: 450 }),
  ]
  const r = run(f, ps, [part('p1', 300, 400, true), part('p2', 200, 200)])
  const b = r.counts.find((c) => c.placementId === 'b')!
  ok('二重の中のパーツは2枚', b.count === 2, `×${b.count}`)
  ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 生地幅を半分に折る — 見えている面はすべて二重')
{
  const f = halfFabric(1100)
  const ps = [newPlacement('a', 'p1', 's1', { xMm: 100, yMm: 0 })]
  const r = run(f, ps, [part('p1', 300, 400)])
  near('折り込む深さは有効幅の半分', r.sections[0].foldDepth.left, 530, 0)
  near('置ける幅も半分', r.sections[0].surfaceWidthMm, 530, 0)
  ok('置いた型紙は1つで2枚', r.counts[0].count === 2, `×${r.counts[0].count}`)
  near('要尺は面の長さのまま', r.totalMm, 400, 0)
  ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 折り返す幅を、指で決める')
{
  /*
    辺を引きずって折り返す幅を決められるようにした（依頼者の指示・2026-09-05）。
    折る深さを決めるのは、これ**だけ**である。
    指で決めていない辺は、まだ折れていない
  */
  const hand = (fold: FoldMode, depth: Partial<Record<Side, number>>): Fabric => ({
    widthMm: 1100, hasNap: false,
    sections: [{ id: 's1', fold, foldDepthMm: depth }],
  })

  {
    // 何も当てていない生地を、20cm だけ折り返す
    const r = run(hand('vLeft', { left: 200 }), [], [])
    near('折り込む深さは、決めたとおり', r.sections[0].foldDepth.left, 200, 0)
    near('置ける幅は残り', r.sections[0].surfaceWidthMm, 860, 0)
  }
  {
    // 30cm の型紙を折り山に当てたまま、折り返しだけ 40cm に広げる
    const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
    const r = run(hand('vLeft', { left: 400 }), [p], [part('p1', 300, 400, true)])
    near('型紙より深く折れる', r.sections[0].foldDepth.left, 400, 0)
    ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.kind).join(',') || 'なし')
  }
  {
    // 折り返しより型紙のほうが大きいと、開いても向こう半分が取れない
    const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
    const r = run(hand('vLeft', { left: 200 }), [p], [part('p1', 300, 400, true)])
    ok('折り返しからはみ出したら知らせる',
      r.problems.some((x) => x.kind === 'pastFold' && x.placementId === 'a'),
      r.problems.map((x) => x.kind).join(',') || 'なし')
  }
  {
    // 縦に折れるのは有効幅の半分まで。それ以上はみみがみみを追い越す
    const r = run(hand('vLeft', { left: 900 }), [], [])
    near('半分より深くは折らない', r.sections[0].foldDepth.left, 530, 0)
  }
  {
    // 指で決めた辺があるあいだは、「きっちり半分」は効かない
    const f: Fabric = {
      widthMm: 1100, hasNap: false,
      sections: [{ id: 's1', fold: 'vLeft', halfFold: true, foldDepthMm: { left: 200 } }],
    }
    near('指のほうが強い', run(f, [], []).sections[0].foldDepth.left, 200, 0)
  }
  {
    // 横わは、折り返したぶんだけ生地が余分に要る
    const r = run(hand('hBottom', { bottom: 250 }), [], [])
    near('折り込む深さ', r.sections[0].foldDepth.bottom, 250, 0)
    near('面の長さも、そこまで伸びる', r.sections[0].surfaceLengthMm, 250, 0)
    near('要尺は面＋折り込み', r.totalMm, 500, 0)
  }
  {
    // 前に保存した見積り（この欄が無いもの）は、折っていない状態から始まる
    const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
    const was = run(fabric(1100, ['vLeft']), [p], [part('p1', 300, 400, true)])
    near('決めていなければ、まだ折っていない', was.sections[0].foldDepth.left, 0, 0)
  }
}

console.log('\n■ 二重の上でも「上の一枚だけ裁つ」を選べば1枚')
{
  const f = halfFabric(1100)
  const ps = [newPlacement('a', 'p1', 's1', { xMm: 100, yMm: 0, topOnly: true })]
  const r = run(f, ps, [part('p1', 300, 400)])
  ok('上だけ裁つなら1枚', r.counts[0].count === 1, `×${r.counts[0].count}`)
  ok('2枚にも戻せる置き方だと分かる', r.counts[0].couldBeTwo, `couldBeTwo=${r.counts[0].couldBeTwo}`)
  near('要尺は変わらない', r.totalMm, 400, 0)

  const off = run(f, [newPlacement('a', 'p1', 's1', { xMm: 100, yMm: 0 })], [part('p1', 300, 400)])
  ok('選ばなければ、これまでどおり2枚', off.counts[0].count === 2, `×${off.counts[0].count}`)

  const onFold = run(f, [newPlacement('a', 'p1', 's1', { snapTo: 'left', topOnly: true })],
    [part('p1', 300, 400, true)])
  ok('わに当てた型紙には効かない（もともと1枚）',
    onFold.counts[0].count === 1 && !onFold.counts[0].couldBeTwo,
    `×${onFold.counts[0].count} couldBeTwo=${onFold.counts[0].couldBeTwo}`)
}

console.log('\n■ 半分に折っても、わに当てた型紙は1枚')
{
  const f = halfFabric(1100)
  const ps = [newPlacement('a', 'p1', 's1', { snapTo: 'left' })]
  const r = run(f, ps, [part('p1', 300, 400, true)])
  ok('開いて左右対称の1枚', r.counts[0].count === 1 && r.counts[0].onFold, '×1 わ')
  near('型紙を置いても折りの深さは変わらない', r.sections[0].foldDepth.left, 530, 0)
}

console.log('\n■ ベルトを「わ」で開いて、幅を倍にして裁つ')
{
  // 依頼者の指示（2026-08-27）——ベルトは型紙が出来上がり幅でも、
  // 裁つときは長い辺で折るぶんを見込んで幅を倍にすることがある
  const beltW = 32
  const beltH = 690
  const stored = toStored(rect(beltW, beltH), beltW, beltH, 0)
  // いちばん長い辺（＝ベルトの長い辺）を「わ」にする。ほかは縫い代 1cm
  const plan = planOf(stored)
  let longest = 0
  plan.groups.forEach((g, i) => { if (g.lengthMm > plan.groups[longest].lengthMm) longest = i })
  const belt = { ...stored, allowancesMm: plan.allowancesMm.map((_, i) => (i === longest ? 0 : 10)) }

  const closed = placedPartOf(belt)!
  const opened = placedPartOf({ ...belt, openFold: true })!
  const size = (p: typeof closed) => {
    const b = bounds(p.cutLineMm)
    return { w: b.maxX - b.minX, h: b.maxY - b.minY }
  }
  const a = size(closed)
  const o = size(opened)

  /*
    許容を 3mm 取ってある。
    裁ち切り線は 1mm＝1画素の絵を経由して作っているので、辺ごとに 1mm 前後の丸めが乗る。
    開くと左右にその丸めが出るぶん、閉じたときより誤差が増える。
    ここで見たいのは「倍になっているか」であって、0.1mm の一致ではない。
  */
  // 折り山に当てるなら、わの側には縫い代が付かない
  near('折り山に当てるときの裁ち切り幅', a.w, beltW + 10, 3)
  // 開けば、出来上がり幅が倍になり、その両側に縫い代が付く
  near('開いたときの裁ち切り幅', o.w, beltW * 2 + 20, 3)
  near('長さは変わらない', o.h, a.h, 3)
  ok('折り山に当てるほうは「わ」の辺を持つ', closed.hasFoldEdge, `${closed.hasFoldEdge}`)
  ok('開いたほうは生地の折り山が要らない', !opened.hasFoldEdge, `${opened.hasFoldEdge}`)

  /*
    「わ」の辺に付ける作図の記号（依頼者の指示・2026-08-27）。

    記号は3つの点で持たせてあり、生地の上では裁ち切り線と同じ計算に通す。
    見たいのは「どう置いても、まるいほうが型紙の内側を向いているか」。
    向きを角度で持つとここが裏返しのときに反転するので、点で持たせてある。
    内側の点のほうが、外まわりの真ん中に近ければ内向き。
  */
  ok('折り山に当てるほうは「わ」の記号を持つ',
    closed.foldMarksMm.length === 1, `${closed.foldMarksMm.length} 本`)
  ok('開いたほうは「わ」の記号を出さない',
    opened.foldMarksMm.length === 0, `${opened.foldMarksMm.length} 本`)

  /*
    開いた型紙の中心線（依頼者の質問・2026-08-28）。
    「わ」の線を軸に反転して2倍になっていることが、図から読める状態かを見る。
    線は開いた形のちょうど真ん中を、丈いっぱいに通っているはず。
  */
  {
    const c = opened.centerLineMm
    ok('開いたほうは中心線を持つ', c !== null, c ? 'あり' : 'なし')
    ok('折り山に当てるほうは中心線を持たない',
      closed.centerLineMm === null, closed.centerLineMm ? 'あり' : 'なし')
    if (c) {
      const bb = bounds(opened.finishedLineMm)
      near('中心線は幅のまんなか', (c.a.x + c.b.x) / 2, (bb.minX + bb.maxX) / 2, 2)
      near('中心線は丈いっぱい', Math.abs(c.b.y - c.a.y), bb.maxY - bb.minY, 2)
    }
  }
  {
    const facing = (name: string, pl: Placement) => {
      const { cut, marks } = orientedPair(closed, pl)
      const b = bounds(cut)
      const gx = (b.minX + b.maxX) / 2
      const gy = (b.minY + b.maxY) / 2
      const m = marks[0]
      const mx = (m.a.x + m.b.x) / 2
      const my = (m.a.y + m.b.y) / 2
      const onEdge = Math.hypot(mx - gx, my - gy)
      const inside = Math.hypot(m.inn.x - gx, m.inn.y - gy)
      ok(`${name}でも内側を向く`, inside < onEdge - 1,
        `内 ${inside.toFixed(0)} < 辺 ${onEdge.toFixed(0)}`)
    }
    facing('そのまま', newPlacement('m1', belt.id, 's1'))
    facing('裏返し', newPlacement('m2', belt.id, 's1', { mirrored: true }))
    facing('180度', newPlacement('m3', belt.id, 's1', { rot180: true }))
    facing('地の目を90度', newPlacement('m4', belt.id, 's1', { rot90: true }))
  }

  /*
    「わ」の辺が向いている側（依頼者の指摘・2026-08-31）。

    生地の上で引きずったときに折り山へ吸い付かせるので、
    **どの折り山に当てられるのか**が置いた向きから正しく出ている必要がある。
    ここを間違えると、縦に走る「わ」の辺が上の折り山に吸い付く、という
    実物ではありえない当て方ができてしまう。

    ベルトは長い辺（縦）を「わ」にしてあるので、ふだんは左右のどちらかを向く。
    裏返しと180度で逆の側へ、地の目を90度回すと上下へ移る。
  */
  {
    const sidesOf = (pl: Placement) => foldEdgeSides(closed, pl)
    const vertical = (ss: Side[]) => ss.length === 1 && (ss[0] === 'left' || ss[0] === 'right')
    const plain = sidesOf(newPlacement('e1', belt.id, 's1'))
    ok('「わ」の辺は左右のどちらかを向く', vertical(plain), plain.join('・') || 'なし')
    const mir = sidesOf(newPlacement('e2', belt.id, 's1', { mirrored: true }))
    ok('裏返すと逆の側を向く', vertical(mir) && mir[0] !== plain[0], mir.join('・') || 'なし')
    const half = sidesOf(newPlacement('e3', belt.id, 's1', { rot180: true }))
    ok('180度回すと逆の側を向く', vertical(half) && half[0] !== plain[0], half.join('・') || 'なし')
    const turned = sidesOf(newPlacement('e4', belt.id, 's1', { rot90: true }))
    ok('地の目を90度回すと上下を向く',
      turned.length === 1 && (turned[0] === 'top' || turned[0] === 'bottom'),
      turned.join('・') || 'なし')
    const none = foldEdgeSides(opened, newPlacement('e5', belt.id, 's1'))
    ok('開いた型紙は当てる先を持たない', none.length === 0, none.join('・') || 'なし')
  }
}

console.log('\n■ 縦わ・両側 — 型紙を置かなくても、中央まで折れている')
{
  // 依頼者の指摘（2026-08-27）——「縦わの両側」を選んでも折れていなかった。
  // 両側から折るときは、左右のみみが中央で出会うので、片側ずつは有効幅の4分の1
  const f: Fabric = {
    widthMm: 1100, hasNap: false,
    sections: [{ id: 's1', fold: 'vBoth', halfFold: true }],
  }
  const r = run(f, [], [])
  near('左の折り込み', r.sections[0].foldDepth.left, 265, 0)
  near('右の折り込み', r.sections[0].foldDepth.right, 265, 0)
  near('見えている面は有効幅の半分', r.sections[0].surfaceWidthMm, 530, 0)
  // 出会い目（x=265）の左側に丸ごと収まっていれば、1つで2枚とれる
  const r2 = run(f, [newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 0 })], [part('p1', 260, 400)])
  ok('出会い目の片側に収まれば1つで2枚', r2.counts[0].count === 2, `×${r2.counts[0].count}`)
  // 依頼者の指摘（2026-08-30）——出会い目の上に型紙は載せられない。
  // 上になっている一枚はそこで切れているので、またぐと2つに割れてしまう
  const r3 = run(f, [newPlacement('a', 'p1', 's1', { xMm: 100, yMm: 0 })], [part('p1', 300, 400)])
  ok('出会い目をまたぐと知らせが出る',
    r3.sections[0].problems.some((q) => q.kind === 'acrossMeet'),
    r3.sections[0].problems.map((q) => q.kind).join(' / ') || '（なし）')
  ok('出会い目をまたいだら1枚どまり', r3.counts[0].count === 1, `×${r3.counts[0].count}`)
  near('型紙を置いても折りの深さは変わらない', r2.sections[0].foldDepth.right, 265, 0)
}

console.log('\n■ 半分に折ると、幅の半分を超える型紙は入らない')
{
  const f = halfFabric(1100)
  const ps = [newPlacement('a', 'p1', 's1')]
  const r = run(f, ps, [part('p1', 600, 300)])
  ok('はみ出しを知らせる', r.problems.some((x) => x.kind === 'tooWide'),
    r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 回すのは回転であって、鏡ではない')
{
  /*
    左右へ90度ずつ回す作りにしたときに直したこと（依頼者の指摘・2026-08-31）。

    もとは90度のところで x と y を入れかえていた。入れかえは対角線を軸にした鏡映で、
    回転ではない。枠の大きさは同じなので要尺の数字には出ないが、
    左右対称でない型紙は**裏返った形**で描かれていた。
    「裏返す」を別に用意して印まで出しているのに、
    回しただけで黙って裏返るのでは筋が通らない。

    鏡になっているかどうかは、多角形の符号つき面積の**符号**で分かる。
    回転では符号は変わらず、鏡映では反転する。
  */
  // 左下を欠いた五角形。左右にも上下にも対称でない
  const poly = [
    { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 },
    { x: 120, y: 400 }, { x: 0, y: 260 },
  ]
  const asym: PlacedPart = {
    id: 'z', hasFoldEdge: false,
    cutLineMm: poly, finishedLineMm: poly,
    foldMarksMm: [], centerLineMm: null,
  }
  const base = signedArea(orientedOutline(asym, newPlacement('r0', 'z', 's1')))
  const sign = (v: number) => (v > 0 ? '+' : '−')
  for (const [label, over] of [
    ['右へ90度', { rot90: true }],
    ['180度', { rot180: true }],
    ['左へ90度（＝270度）', { rot90: true, rot180: true }],
  ] as const) {
    const a = signedArea(orientedOutline(asym, newPlacement('r', 'z', 's1', over)))
    ok(`${label}で裏返らない`, sign(a) === sign(base), `${sign(base)} → ${sign(a)}`)
  }
  const flipped = signedArea(
    orientedOutline(asym, newPlacement('rm', 'z', 's1', { mirrored: true })),
  )
  ok('裏返したときだけ鏡になる', sign(flipped) !== sign(base), `${sign(base)} → ${sign(flipped)}`)

  /*
    角度の足し引き。右へ4回まわせば元へ戻り、左右は打ち消しあう。
    真偽値2つで持っているぶん、ここを間違えると
    「押しても向きが変わらない」「1回押すと2つ飛ぶ」が起きる
  */
  let pl = newPlacement('t', 'z', 's1')
  const seen: number[] = []
  for (let i = 0; i < 4; i++) { pl = { ...pl, ...turnBy(pl, 1) }; seen.push(turnOf(pl)) }
  ok('右へ4回まわすと一周する', seen.join(',') === '90,180,270,0', seen.join('→'))
  let back = newPlacement('t2', 'z', 's1', { rot90: true })
  back = { ...back, ...turnBy(back, -1) }
  ok('左へ1回で戻る', turnOf(back) === 0, `${turnOf(back)}°`)
  let under = newPlacement('t3', 'z', 's1')
  under = { ...under, ...turnBy(under, -1) }
  ok('0度から左へまわすと270度', turnOf(under) === 270, `${turnOf(under)}°`)
}

console.log('\n■ 止めるべきものを止めているか')
{
  const napped = fabric(1100, ['vLeft'], true)
  const r1 = run(napped, [newPlacement('a', 'p1', 's1', { snapTo: 'left', rot180: true })],
    [part('p1', 300, 400, true)])
  ok('毛並みありで上下逆を知らせる',
    r1.problems.some((x) => x.kind === 'napLocked'), r1.problems[0]?.message ?? 'なし')

  const plain = fabric(1100, ['vLeft'])
  const r2 = run(plain, [newPlacement('a', 'p1', 's1', { snapTo: 'left', rot180: true })],
    [part('p1', 300, 400, true)])
  ok('向きなしなら上下逆でも言わない',
    !r2.problems.some((x) => x.kind === 'napLocked'), '言わない')

  /*
    270度は `rot180` が立っているが、差し込みではない（依頼者の指摘・2026-08-31）。
    左右へ90度ずつ回す作りにしたので、270度は「地の目が横」の側にあたる。
    ここを `rot180` だけで見ていると、毛並みのある生地で
    右へ3回まわしただけの型紙に「上下逆です」と出てしまう
  */
  const r2b = run(napped, [newPlacement('a', 'p1', 's1', { rot90: true, rot180: true })],
    [part('p1', 300, 400, false)])
  ok('270度は上下逆ではない',
    !r2b.problems.some((x) => x.kind === 'napLocked'), '言わない')

  // わ の辺（縫い代0）を持つのに折り山から離れている
  const r3 = run(plain, [newPlacement('a', 'p1', 's1', { xMm: 200 })],
    [part('p1', 300, 400, true)])
  ok('わの辺が折り山から離れていたら知らせる',
    r3.problems.some((x) => x.kind === 'offFold'), r3.problems[0]?.message ?? 'なし')

  // 折り山の無い側に当てようとした
  const r4 = run(plain, [newPlacement('a', 'p1', 's1', { snapTo: 'right' })],
    [part('p1', 300, 400, true)])
  ok('折り山の無い側は当てられない',
    r4.problems.some((x) => x.kind === 'noSuchFold'), r4.problems[0]?.message ?? 'なし')

  // 生地幅に入らない
  const narrow = fabric(900, ['none'])
  const r5 = run(narrow, [newPlacement('a', 'p1', 's1')], [part('p1', 1000, 400)])
  ok('幅に入らなければ知らせる',
    r5.problems.some((x) => x.kind === 'tooWide'), r5.problems[0]?.message ?? 'なし')

  // 重なり
  const r6 = run(plain, [
    newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 0 }),
    newPlacement('b', 'p2', 's1', { xMm: 100, yMm: 100 }),
  ], [part('p1', 300, 400), part('p2', 300, 400)])
  ok('重なりを見つける', r6.problems.some((x) => x.kind === 'overlap'), '重なり')
}

// ══════════════════════════════════════════════════════════
console.log('\n■ 学校の配布資料と突き合わせる — マーメイドスカート③')
console.log('  目安の式：【上パーツ丈 +6〜10】＋【（下パーツ丈 +20）×2】')
console.log('  上パーツ丈 32cm・下パーツ丈 38cm・生地幅 110cm → 154〜158cm のはず')
{
  // 区間1：縦わ・両側。前スカート上・後スカート上を、左右の折り山に1枚ずつ
  // 区間2：縦わ・片側。下フレアを縦に2枚
  //
  // 折る深さは、学生が端の札を引いて決める（依頼者の指示・2026-09-05）。
  // もとは折り山に当てた型紙の幅だけひとりでに折り返していたが、
  // 置いた型紙が生地の形を動かすのは「動作的に気持ち悪い」として外した
  const f: Fabric = {
    widthMm: 1100, hasNap: false,
    sections: [
      { id: 's1', fold: 'vBoth', foldDepthMm: { left: 265, right: 265 } },
      { id: 's2', fold: 'vLeft', foldDepthMm: { left: 400 } },
    ],
  }
  const parts = [
    part('upperFront', 265, 400, true),
    part('upperBack', 265, 400, true),
    part('lowerA', 400, 580, true),
    part('lowerB', 400, 580, true),
  ]
  const ps = [
    newPlacement('u1', 'upperFront', 's1', { snapTo: 'left' }),
    newPlacement('u2', 'upperBack', 's1', { snapTo: 'right' }),
    newPlacement('l1', 'lowerA', 's2', { snapTo: 'left', yMm: 0 }),
    newPlacement('l2', 'lowerB', 's2', { snapTo: 'left', yMm: 580 }),
  ]
  const r = run(f, ps, parts)

  near('区間1（上）の長さ', r.sections[0].yardageMm, 400, 0)
  near('区間2（下）の長さ', r.sections[1].yardageMm, 1160, 0)
  near('要尺の合計', r.totalMm, 1560, 0)
  ok('配布資料の 154〜158cm に入る',
    r.totalMm >= 1540 && r.totalMm <= 1580, `${(r.totalMm / 10).toFixed(0)} cm`)

  // 区間1 は左右の折り山が中央で接する（＝セミタイトの図と同じ形）
  near('区間1 左の折り込み', r.sections[0].foldDepth.left, 265, 0)
  near('区間1 右の折り込み', r.sections[0].foldDepth.right, 265, 0)
  near('区間1 描く面の幅', r.sections[0].surfaceWidthMm, 530, 0)
  // 左右の帯が中央で出会うので、面は丸ごと二重。1本の帯として扱う
  ok('区間1 は面が丸ごと二重',
    r.sections[0].doubled.length === 1 && Math.abs(r.sections[0].doubled[0].w - 530) < 1,
    `${r.sections[0].doubled.map((d) => `${d.w}mm`).join(' + ')} ／ 面の幅 530mm`)

  ok('4枚とも わ（開いて左右対称の1枚）',
    r.counts.every((c) => c.onFold && c.count === 1), r.counts.map((c) => `×${c.count}`).join(' '))
  ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.message).join(' / ') || 'なし')

  near('買ってくる長さ', r.purchaseMm, 1800, 0)
}

console.log('\n■ 買ってくる長さ — 上乗せして10cm単位に切り上げる（暫定値）')
{
  near('0cm のときは 0', toPurchaseLength(0), 0, 0)
  near('156cm → 180cm', toPurchaseLength(1560), 1800, 0)
  near('180cm → 200cm', toPurchaseLength(1800), 2000, 0)
  near('181cm → 210cm', toPurchaseLength(1810), 2100, 0)
}

console.log('\n■ 辺を押して「わ」を決める（依頼者の指示・2026-08-28）')
{
  const t = (from: FoldMode, side: Side, want: FoldMode) =>
    ok(`${from} + ${side}`, toggleFoldSide(from, side) === want,
      `${toggleFoldSide(from, side)}（期待 ${want}）`)

  // 片わは上下左右どこでも作れる。右も左と対等
  t('none', 'left', 'vLeft')
  t('none', 'right', 'vRight')
  t('none', 'top', 'hTop')
  t('none', 'bottom', 'hBottom')

  // 同じ向きどうしは重ねられる
  t('vLeft', 'right', 'vBoth')
  t('vRight', 'left', 'vBoth')
  t('hTop', 'bottom', 'hBoth')

  // もう一度押すと外れる
  t('vLeft', 'left', 'none')
  t('vBoth', 'left', 'vRight')
  t('vBoth', 'right', 'vLeft')

  // 縦と横は同時に持てない。最後に押した辺が勝つ
  t('vLeft', 'top', 'hTop')
  t('vBoth', 'bottom', 'hBottom')
  t('hBoth', 'right', 'vRight')

  // 辺の組と折り方は、行き来しても同じものに戻る
  const modes: FoldMode[] = ['none', 'vLeft', 'vRight', 'vBoth', 'hTop', 'hBottom', 'hBoth']
  ok('折り方 ⇄ 辺の組は往復できる',
    modes.every((m) => foldOfSides(foldSidesOf(m)) === m), modes.join(' '))
}

console.log('\n■ 右の「わ」で、きっちり半分に折る')
{
  const fabricOf = (fold: FoldMode): Fabric => ({
    widthMm: 1100, hasNap: false, sections: [{ id: 's1', fold, halfFold: true }],
  })
  const l = computeYardage(fabricOf('vLeft'), [], new Map())
  const r = computeYardage(fabricOf('vRight'), [], new Map())
  near('左で折ったときの面の幅', l.sections[0].surfaceWidthMm, 530, 0)
  near('右で折ったときの面の幅', r.sections[0].surfaceWidthMm, 530, 0)
  near('右で折ると折り込みは右に出る', r.sections[0].foldDepth.right, 530, 0)
  near('右で折ると左には出ない', r.sections[0].foldDepth.left, 0, 0)
}

console.log('\n■ 横わで、きっちり半分に折る（依頼者の指示・2026-08-30）')
{
  const fabricOf = (fold: FoldMode): Fabric => ({
    widthMm: 1100, hasNap: false, sections: [{ id: 's1', fold, halfFold: true }],
  })
  // 上の「わ」に、丈 400mm の型紙を当てる。折り返した面の長さがそのまま 400mm
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'top' })
  const t = run(fabricOf('hTop'), [p], [part('p1', 300, 400, true)])
  near('面の長さ', t.sections[0].surfaceLengthMm, 400, 0)
  near('折り込みは上に出る', t.sections[0].foldDepth.top, 400, 0)
  near('下には出ない', t.sections[0].foldDepth.bottom, 0, 0)
  near('要尺は面の長さの倍', t.totalMm, 800, 0)
  near('折っても幅は減らない', t.sections[0].surfaceWidthMm, 1060, 0)
  ok('面は丸ごと二重',
    t.sections[0].doubled.length === 1
    && Math.abs(t.sections[0].doubled[0].h - 400) < 1
    && Math.abs(t.sections[0].doubled[0].w - 1060) < 1,
    t.sections[0].doubled.map((d) => `${d.w}×${d.h}mm`).join(' + '))
  ok('問題なし', t.problems.length === 0, t.problems.map((x) => x.message).join(' / ') || 'なし')

  // 下の「わ」でも同じことが起きる
  const pb = newPlacement('b', 'p1', 's1', { snapTo: 'bottom' })
  const b = run(fabricOf('hBottom'), [pb], [part('p1', 300, 400, true)])
  near('下で折ると折り込みは下に出る', b.sections[0].foldDepth.bottom, 400, 0)
  near('下で折っても要尺は倍', b.totalMm, 800, 0)

  // 上下から折ると、裁ち端が中央で出会う。上から折り返した一枚は面の半分までしか
  // 来ないので、そこに丈 400mm の型紙を当てるには面が 800mm 要る
  // （依頼者の指摘・2026-08-30。以前は面 400mm・要尺 800mm としていたが、
  //   それだと折り返し1枚に収まらない型紙を「裁てる」ことにしてしまっていた）
  const pbo = newPlacement('c', 'p1', 's1', { snapTo: 'top' })
  const bo = run(fabricOf('hBoth'), [pbo], [part('p1', 300, 400, true)])
  near('折り返しは型紙と同じ深さになる', bo.sections[0].foldDepth.top, 400, 0)
  near('下は何も当てていないので折り返さない', bo.sections[0].foldDepth.bottom, 0, 0)
  near('面は型紙どおり', bo.sections[0].surfaceLengthMm, 400, 0)
  near('要尺は面の倍', bo.totalMm, 800, 0)
  ok('面は丸ごと二重（帯1本）',
    bo.sections[0].doubled.length === 1 && Math.abs(bo.sections[0].doubled[0].h - 400) < 1,
    bo.sections[0].doubled.map((d) => `${d.w}×${d.h}mm`).join(' + '))
  ok('折り山の型紙は出会い目をまたがない', bo.sections[0].problems.length === 0,
    bo.sections[0].problems.map((q) => q.kind).join(' / ') || '（なし）')
  ok('下の折り山が効いていない', bo.sections[0].meetYMm === null, `${bo.sections[0].meetYMm}`)

  // 上下それぞれに「わ」で裁つ型紙を当てると、出会い目は真ん中ではなく
  // 大きいほうへ寄る（依頼者の指示・2026-08-30「折り返ってきて2枚が
  // 重なっている幅を自動で調整できるようにしなければならない」）
  const two = run(fabricOf('hBoth'), [
    newPlacement('c', 'p1', 's1', { snapTo: 'top' }),
    newPlacement('f', 'p3', 's1', { snapTo: 'bottom' }),
  ], [part('p1', 300, 400, true), part('p3', 300, 200, true)])
  near('上の折り返しは上の型紙に合う', two.sections[0].foldDepth.top, 400, 0)
  near('下の折り返しは下の型紙に合う', two.sections[0].foldDepth.bottom, 200, 0)
  near('面は2つぶん', two.sections[0].surfaceLengthMm, 600, 0)
  near('要尺は面の倍', two.totalMm, 1200, 0)
  ok('出会い目は真ん中ではなく 400mm のところ',
    two.sections[0].meetYMm !== null && Math.abs(two.sections[0].meetYMm - 400) < 1,
    `${two.sections[0].meetYMm}`)
  ok('どちらの型紙もまたいでいない', two.sections[0].problems.length === 0,
    two.sections[0].problems.map((q) => q.kind).join(' / ') || '（なし）')

  // 依頼者の指摘（2026-08-30）——上下から折ったときも、裁ち端どうしが出会う
  // ところ（y=200）の上には型紙を載せられない。上の一枚がそこで切れているため
  // 面の長さは上の型紙で決まって 800mm、出会い目は y=400 に来る
  const withSide = (yMm: number, h: number) => run(fabricOf('hBoth'), [
    newPlacement('c', 'p1', 's1', { snapTo: 'top' }),
    newPlacement('d', 'p2', 's1', { xMm: 400, yMm }),
  ], [part('p1', 300, 400, true), part('p2', 300, h)])
  const across = withSide(300, 250)
  ok('横わ・上下でも出会い目をまたぐと知らせが出る',
    across.sections[0].problems.some((q) => q.kind === 'acrossMeet'),
    across.sections[0].problems.map((q) => q.kind).join(' / ') || '（なし）')
  const beside = withSide(0, 190)
  ok('片側に収まれば知らせは出ない', beside.sections[0].problems.length === 0,
    beside.sections[0].problems.map((q) => q.kind).join(' / ') || '（なし）')
  ok('片側に収まれば1つで2枚',
    beside.counts.find((c) => c.placementId === 'd')?.count === 2,
    `×${beside.counts.find((c) => c.placementId === 'd')?.count}`)

  // どの折り方でも「きっちり折る」を選べる（＝プルダウンが出る）
  ok('きっちり折れないのは「折らない」だけ',
    (['vLeft', 'vRight', 'vBoth', 'hTop', 'hBottom', 'hBoth'] as FoldMode[]).every(canHalfFold)
    && !canHalfFold('none'),
    'none 以外はすべて可')
}

/*
  パーツをまわす（依頼者の指示・2026-09-01）。

  ここで守らせたいのは「まわしても、それまでに決めたことが壊れない」こと。
  縫い代を辺ごとに決めたあとに向きを直したくなるのが、そもそもの使いどころなので、
  まわしたら縫い代の指定が飛んだ、では意味がない。
*/
function turnChecks() {
  console.log('')
  console.log('■ パーツをまわす')

  // 400 × 700 の長方形。縦横がはっきり違うので、90 度で入れかわるのが分かる
  const rect: Point[] = [
    { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 700 }, { x: 0, y: 700 },
  ]
  const base = toStored(rect, 400, 700, 0)

  ok('まわす前は 0 度', base.turnDeg === 0, `${base.turnDeg} 度`)

  {
    const t = withTurn(base, 90)
    near('90度で幅が入れかわる (mm)', t.widthMm, 700, 0.01)
    near('90度で丈が入れかわる (mm)', t.heightMm, 400, 0.01)
  }
  {
    // 180 度は、もとの flipped: true と同じ。形も大きさも変わらない
    const t = withTurn(base, 180)
    near('180度でも大きさは同じ (mm)', t.widthMm, 400, 0.01)
    ok('180度でも面積は同じ',
      Math.abs(Math.abs(signedArea(outlineOf(t))) - Math.abs(signedArea(rect))) < 0.5,
      `${Math.abs(signedArea(outlineOf(t))).toFixed(0)} mm2`)
  }
  {
    // 斜めのままだと外まわりの四角が大きくなる＝まっすぐに直すと数字が小さくなる
    const t = withTurn(base, 20)
    ok('斜めだと外まわりが大きくなる', t.widthMm > 400 && t.heightMm > 700,
      `${t.widthMm.toFixed(0)} x ${t.heightMm.toFixed(0)} mm`)
    near('まっすぐに戻せば元どおり (mm)', withTurn(t, 0).widthMm, 400, 0.01)
  }

  // 何度まわしても形そのものは変わらない（面積で見る）
  const area0 = Math.abs(signedArea(rect))
  ok('まわしても形は変わらない',
    [7, 33, 90, 137, 180, 271, 355].every(
      (d) => Math.abs(Math.abs(signedArea(turnPoly(rect, d))) - area0) < 0.5),
    `${area0.toFixed(0)} mm2`)

  // 辺ごとに決めた縫い代が、まわしても同じ辺に残る
  {
    const withSeam = { ...base, allowancesMm: [10, 0, 25, 15] }
    const before = planOf(withSeam)
    const after = planOf(withTurn(withSeam, 90))
    ok('まわしても縫い代の並びは同じ',
      before.groups.length === after.groups.length
      && before.allowancesMm.every((a, i) => a === after.allowancesMm[i]),
      after.allowancesMm.join(' / '))
    ok('まわしても「わ」の辺は同じ番号',
      before.allowancesMm.indexOf(0) === after.allowancesMm.indexOf(0),
      `${after.allowancesMm.indexOf(0)} 番`)
    // 縫い代を足した裁ち切り線も、ちゃんと組み上がる
    ok('まわしても裁ち切り線が引ける', !!placedPartOf(withTurn(withSeam, 33)), 'あり')
  }

  // 「直角に戻す」は、いちばん近い直角へ。0 へ引き戻さない
  ok('直角に戻すのは、いちばん近い直角へ',
    squaredTurn(88) === 90 && squaredTurn(-2) === 0 && squaredTurn(178) === 180,
    '88→90 / -2→0 / 178→180')
  ok('まっすぐなら戻り道は出さない',
    isSquare(0) && isSquare(90) && isSquare(-180) && !isSquare(2),
    '0・90・-180 は直角、2 は斜め')
}

turnChecks()


/*
  ゆがみの手直し（src/lib/warp.ts）。

  ここで守らせたいのは3つ。
  つまみ2本が台形だけを作ること（回りも伸びもしない）、
  まっすぐな辺がまっすぐなまま残ること、
  そしてつまみを端まで振り切っても形がつぶれないこと。
  「動きすぎて使えない」を直したのがこの作りなので、
  効きすぎていないことも一緒に見ている。
*/
function warpChecks() {
  console.log('')
  console.log('■ ゆがみを台形で直す')

  // 400 × 700 の長方形の、右の辺のまん中に出っぱりを付けたもの。
  // 上下の辺はまっすぐなので、まっすぐなまま残るかを見られる
  const poly: Point[] = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 },
    { x: 440, y: 350 }, { x: 400, y: 700 }, { x: 200, y: 700 }, { x: 0, y: 700 },
  ]
  const part = { id: 'a', name: 'A', outlineMm: poly, outlinePx: poly, rawPx: poly,
    widthMm: 440, heightMm: 700, areaMm2: 0, perimeterMm: 0 }

  ok('つまみが真ん中なら「直していない」', !isWarped(NO_WARP), '素通し')

  {
    const same = warpPart(NO_WARP, part)
    near('素通しなら大きさは変わらない (mm)', same?.widthMm ?? 0, 440, 0.01)
  }

  // ky が正なら下が細くなる（つまみを「下が細い」側へ倒したとき）
  const k = { kx: 0, ky: 0.2 }
  const q = keystoneQuad(part.widthMm, part.heightMm, k)

  {
    // 上が広く、下が細い台形になっているか
    const top = q[1].x - q[0].x
    const bottom = q[2].x - q[3].x
    ok('上下のつまみは、上下の幅を変える', top > bottom * 1.05,
      `上 ${top.toFixed(0)} / 下 ${bottom.toFixed(0)} mm`)
    near('左右の丈は、そのぶんでは変わらない', q[3].y - q[0].y, q[2].y - q[1].y, 0.01)
  }

  const H = keystoneH(part.widthMm, part.heightMm, k)

  {
    // まん中の1点は動かない。だからつまんでも型紙が画面から逃げない
    const c = { x: part.widthMm / 2, y: part.heightMm / 2 }
    const moved = H ? applyHToPolygon(H, [c]) : null
    const off = moved ? Math.hypot(moved[0].x - c.x, moved[0].y - c.y) : Infinity
    ok('まん中の1点は動かない', off < 0.01, `ずれ ${off.toFixed(4)} mm`)
  }
  const warped = warpPart(k, part)
  ok('動かしたら形が変わる', !!warped && Math.abs(warped.widthMm - 440) > 1,
    warped ? `${warped.widthMm.toFixed(0)} x ${warped.heightMm.toFixed(0)} mm` : 'なし')

  {
    // 上の辺は 3 点（0,0）(200,0)(400,0) が一直線。動かしたあとも一直線であること
    const line = H ? applyHToPolygon(H, [poly[0], poly[1], poly[2]]) : null
    const off = line
      ? Math.abs((line[1].x - line[0].x) * (line[2].y - line[0].y)
        - (line[1].y - line[0].y) * (line[2].x - line[0].x))
        / Math.hypot(line[2].x - line[0].x, line[2].y - line[0].y)
      : Infinity
    ok('まっすぐな辺は、まっすぐなまま', off < 0.01, `そり ${off.toFixed(4)} mm`)
  }

  {
    // 大きい型紙も小さい型紙も、同じだけ台形になる（割合で見て同じ）。
    // 四つ角のころは平面ぜんぶに掛かる変換だったので、原点に近いほど動かなかった。
    // つまみは型紙ごとの大きさで測っているので、そこが変わっている
    const small = { ...part, id: 'b', outlineMm: poly.map((p) => ({ x: p.x / 4, y: p.y / 4 })),
      widthMm: 110, heightMm: 175 }
    const a = warpPart(k, part)
    const b = warpPart(k, small)
    const ra = a ? a.widthMm / part.widthMm : 0
    const rb = b ? b.widthMm / small.widthMm : 0
    ok('大きさが違っても、同じだけ台形になる', Math.abs(ra - rb) < 0.005,
      `大 ${(ra * 100).toFixed(1)}% / 小 ${(rb * 100).toFixed(1)}%`)
  }

  {
    // つまみを端まで振り切っても、形はつぶれない（分母が正のまま）
    const worst: string[] = []
    for (const kx of [-WARP_MAX, 0, WARP_MAX]) {
      for (const ky of [-WARP_MAX, 0, WARP_MAX]) {
        if (!warpPart({ kx, ky }, part)) worst.push(`${kx},${ky}`)
      }
    }
    ok('端まで振り切ってもつぶれない', worst.length === 0,
      worst.length === 0 ? '9 通りすべて通った' : worst.join(' / '))
  }

  {
    // ふり幅の外を渡されても、中に収める
    const c = clampWarp({ kx: 9, ky: -9 })
    ok('ふり幅の外は、中に収める', c.kx === WARP_MAX && c.ky === -WARP_MAX,
      `${c.kx} / ${c.ky}`)
  }

  {
    // 効きすぎていないこと。端まで振り切って、幅の比が 1.5 ほどに収まる
    const e = keystoneQuad(part.widthMm, part.heightMm, { kx: 0, ky: WARP_MAX })
    const ratio = (e[1].x - e[0].x) / (e[2].x - e[3].x)
    ok('端まで振り切っても効きすぎない', ratio > 1.3 && ratio < 1.7,
      `上下の幅の比 ${ratio.toFixed(2)}`)
  }
}

/* ------------------------------------------------------------------ *
 * 理屈のうえでの最短と、上の空きを詰める
 * ------------------------------------------------------------------ */

function packChecks() {
  console.log('\n■ 理屈のうえでの最短')
  {
    // 有効幅 106cm に 50×40 を2つ、縦に離して置く
    const f = fabric(1100, ['none'])
    const ps = [
      newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 0 }),
      newPlacement('b', 'p1', 's1', { xMm: 0, yMm: 1000 }),
    ]
    const r = run(f, ps, [part('p1', 500, 400)])
    near('並べたぶん', r.totalMm, 1400, 0)
    // 面積 400000mm² ÷ 有効幅 1060mm ＝ 377mm。ただし丈 400mm より短くはできない
    near('最短は、丈のあるパーツより短くしない', r.minTotalMm, 400, 0.5)
    ok('最短が、並べたぶんを超えない', r.minTotalMm <= r.totalMm + 0.001,
      `最短 ${r.minTotalMm.toFixed(1)} ≦ 並べたぶん ${r.totalMm.toFixed(1)}`)
  }
  {
    const r = run(fabric(1100, ['none']), [], [])
    ok('何も置いていなければ 0', r.minTotalMm === 0, `${r.minTotalMm}`)
  }
  {
    // 横わできっちり半分に折ると、折り込むぶんも面の長さについて動く。最短も同じ割合で縮む
    const f: Fabric = {
      widthMm: 1100, hasNap: false,
      sections: [{ id: 's1', fold: 'hBottom', halfFold: true }],
    }
    const ps = [newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 600 })]
    const r = run(f, ps, [part('p1', 500, 400)])
    near('並べたぶんは面＋折り込み', r.totalMm, 2000, 0)
    near('最短も倍になる', r.minTotalMm, 800, 0.5)
    ok('横わでも、最短が並べたぶんを超えない', r.minTotalMm <= r.totalMm + 0.001,
      `最短 ${r.minTotalMm.toFixed(1)} ≦ 並べたぶん ${r.totalMm.toFixed(1)}`)
  }

  console.log('\n■ 上の空きを詰める')
  {
    const f = fabric(1100, ['none'])
    const ps = [
      newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 300 }),
      newPlacement('b', 'p1', 's1', { xMm: 600, yMm: 900 }),
      newPlacement('c', 'p1', 's1', { xMm: 0, yMm: 1500 }),
    ]
    const list = [part('p1', 400, 400)]
    const r = run(f, ps, list)
    const packed = packedUp(r.sections, ps)
    ok('詰めるものがあれば、一式が返る', packed !== null, packed ? '返った' : 'null')
    const after = run(f, packed ?? ps, list)
    near('詰めたあとの長さ', after.totalMm, 800, 0)
    ok('左右の位置は動かさない',
      (packed ?? []).every((p, i) => p.xMm === ps[i].xMm),
      (packed ?? []).map((p) => p.xMm).join(' / '))
    ok('重なりは作らない', after.problems.filter((x) => x.kind === 'overlap').length === 0,
      after.problems.map((x) => x.kind).join(',') || 'なし')
    ok('もう一度押しても動かない', packedUp(after.sections, packed ?? []) === null, '2回目は null')
  }
  {
    // 横に並んでいるものは、上へ上がっても互いに邪魔をしない
    const f = fabric(1100, ['none'])
    const ps = [
      newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 500 }),
      newPlacement('b', 'p1', 's1', { xMm: 500, yMm: 900 }),
    ]
    const list = [part('p1', 400, 400)]
    const packed = packedUp(run(f, ps, list).sections, ps)
    const after = run(f, packed ?? ps, list)
    near('横に並ぶものは、どちらも上端まで', after.totalMm, 400, 0)
  }
  {
    // 折り山に当てたものは動かさない（当てた側から位置が決まっているため）
    const f = fabric(1100, ['hBottom'])
    const ps = [newPlacement('a', 'p1', 's1', { snapTo: 'bottom' })]
    const list = [part('p1', 500, 300, true)]
    const packed = packedUp(run(f, ps, list).sections, ps)
    ok('折り山に当てたものは動かさない', packed === null, packed ? '動いた' : '動かなかった')
  }

  console.log('\n■ はみ出したぶんを生地の中へ')
  {
    // 有効幅 106cm。50cm 幅の型紙を x=800mm に置くと、右へ 240mm はみ出す
    const f = fabric(1100, ['none'])
    const ps = [
      newPlacement('a', 'p1', 's1', { xMm: 800, yMm: 0 }),
      newPlacement('b', 'p1', 's1', { xMm: 0, yMm: 500 }),
    ]
    const list = [part('p1', 500, 400)]
    const r = run(f, ps, list)
    ok('まずは、はみ出している', r.problems.some((x) => x.kind === 'tooWide'),
      r.problems.map((x) => x.kind).join(',') || 'なし')
    const inn = pulledIn(r.sections, ps)
    ok('戻すものがあれば、一式が返る', inn !== null, inn ? '返った' : 'null')
    const after = run(f, inn ?? ps, list)
    ok('はみ出しが消える', !after.problems.some((x) => x.kind === 'tooWide'),
      after.problems.map((x) => x.kind).join(',') || 'なし')
    near('右端いっぱいまで寄せる', (inn ?? [])[0].xMm, 560, 0.5)
    ok('入っているものは動かさない', (inn ?? [])[1].xMm === 0, `${(inn ?? [])[1].xMm}`)
    ok('入る場所があれば、上下は動かさない',
      (inn ?? []).every((q, i) => q.yMm === ps[i].yMm),
      (inn ?? []).map((q) => q.yMm).join(' / '))
    ok('重なりも作らない', !after.problems.some((x) => x.kind === 'overlap'),
      after.problems.map((x) => x.kind).join(',') || 'なし')
    ok('もう一度押しても動かない', pulledIn(after.sections, inn ?? []) === null, '2回目は null')
  }
  {
    // 生地幅より大きいものは、動かしても入らない。そのままにする
    const f = fabric(1100, ['none'])
    const ps = [newPlacement('a', 'p1', 's1', { xMm: 0, yMm: 0 })]
    const r = run(f, ps, [part('p1', 1200, 300)])
    ok('幅より大きいものは動かさない', pulledIn(r.sections, ps) === null, '動かなかった')
  }
}


/*
  「わ」に指定した辺は、そこに突き当たる線がどんな角度で来ていても、
  わの線より外へ飛び出さない（依頼者の指示・2026-09-03）。

  折り山の向こう側は同じ型紙の鏡像なので、そこへ紙をはみ出させることはできない。
  縫い代は「辺ごとに外へ帯を伸ばす」やり方で作っており、帯はその辺自身に直角な向きで
  終わるため、わに斜めからぶつかると放っておけば必ず飛び出す。
  ここでは、辺という辺をひとつずつ「わ」にして、全部の角度を調べる。
*/
function foldFlushChecks() {
  console.log('\n■ 「わ」の辺は、どの角度から来る線もその線でまっすぐ切りそろえる')

  const shapes: Array<{ name: string; poly: Point[] }> = [
    { name: '鋭角と鈍角', poly: [{ x: 0, y: 0 }, { x: 200, y: 60 }, { x: 220, y: 360 }, { x: 0, y: 400 }] },
    { name: '直角', poly: rect(200, 400) },
    { name: '大きく斜め', poly: [{ x: 0, y: 0 }, { x: 240, y: 150 }, { x: 200, y: 330 }, { x: 0, y: 400 }] },
  ]

  for (const s of shapes) {
    for (const mm of [10, 40]) {
      const base = initialPlan(s.poly, mm)
      let worst = 0
      let worstNo = 0
      for (let gi = 0; gi < base.groups.length; gi++) {
        const plan = { ...base, allowancesMm: base.allowancesMm.map((a, i) => (i === gi ? 0 : a)) }
        const r = buildSeam(plan)
        if (!r) { worst = 999; break }
        const out = outsideFold(r.cutLineMm, r.finishedLineMm, base.groups[gi], mm)
        if (out > worst) { worst = out; worstNo = base.groups[gi].no }
      }
      ok(`${s.name}・縫い代${mm / 10}cm`, worst <= 1.0,
        worst <= 1.0 ? 'どの辺をわにしても、はみ出しは 1mm 未満' : `辺${worstNo} で ${worst.toFixed(1)}mm はみ出した`)
    }
  }

  {
    // 「縫い代つき」の辺は折り山ではない。足す量は同じ 0 でも、切りそろえる線は無い
    const base = initialPlan([{ x: 0, y: 0 }, { x: 200, y: 60 }, { x: 220, y: 360 }, { x: 0, y: 400 }], 40)
    const g = base.groups[0]
    const asFold = buildSeam({ ...base, allowancesMm: base.allowancesMm.map((a, i) => (i === 0 ? 0 : a)) })
    const asIncluded = buildSeam({ ...base, allowancesMm: base.allowancesMm.map((a, i) => (i === 0 ? SEAM_INCLUDED_MM : a)) })
    const a = asFold ? outsideFold(asFold.cutLineMm, asFold.finishedLineMm, g, 40) : 999
    const b = asIncluded ? outsideFold(asIncluded.cutLineMm, asIncluded.finishedLineMm, g, 40) : 0
    ok('「縫い代つき」の辺は切りそろえない', a <= 1.0 && b > 2,
      `わ ${a.toFixed(1)}mm / 縫い代つき ${b.toFixed(1)}mm`)
  }
}

/**
 * 裁ち切り線が「わ」の線より外へどれだけ出ているか(mm)。
 *
 * わの線は、その辺の両端をまっすぐ結んだ線。なぞりが波打っている辺もあるので、
 * その辺自身がいちばん外に出ている量を基準（0）にして測る。
 * 見るのは、その辺の前後にある裁ち切り線だけ。離れたところの角は別の辺の話になる。
 */
function outsideFold(cut: Point[], finished: Point[], g: { start: number; end: number }, seamMm: number): number {
  const n = finished.length
  const p0 = finished[g.start % n]
  const p1 = finished[g.end % n]
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  if (len < 1e-6) return 0
  const tx = (p1.x - p0.x) / len
  const ty = (p1.y - p0.y) / len
  const outward = (q: Point) => (q.x - p0.x) * ty - (q.y - p0.y) * tx
  const along = (q: Point) => (q.x - p0.x) * tx + (q.y - p0.y) * ty

  let base = 0
  for (let i = g.start; i <= g.end; i++) base = Math.max(base, outward(finished[i % n]))

  const reach = seamMm * 3 + 2
  let worst = 0
  for (const q of cut) {
    const t = along(q)
    if (t < -reach || t > len + reach) continue
    worst = Math.max(worst, outward(q) - base)
  }
  return worst
}

packChecks()
warpChecks()
foldFlushChecks()
console.log(failures === 0 ? '\nすべて通りました。' : `\n${failures} 件、期待どおりになりませんでした。`)
process.exit(failures === 0 ? 0 : 1)
