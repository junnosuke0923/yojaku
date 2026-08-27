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

import { initialPlan, applyToAll, buildSeam, foldGroups } from '../src/lib/seam'
import { splitEdges } from '../src/lib/edges'
import { bounds, type Point } from '../src/lib/geom'
import {
  computeYardage, newPlacement, orientedPair, toPurchaseLength,
  type Fabric, type Placement, type PlacedPart,
} from '../src/lib/fabric'
import { placedPartOf, planOf, toStored } from '../src/lib/store'

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
  const f = fabric(1100, ['vLeft'])
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'left' })
  const r = run(f, [p], [part('p1', 300, 400, true)])
  near('有効幅', 1100 - 40, 1060, 0)
  near('折り込む深さ', r.sections[0].foldDepth.left, 300, 0)
  near('描く面の幅', r.sections[0].surfaceWidthMm, 760, 0)
  near('要尺', r.totalMm, 400, 0)
  ok('わなので1枚（開いて左右対称）', r.counts[0].count === 1 && r.counts[0].onFold, '×1 わ')
  ok('問題なし', r.problems.length === 0, r.problems.map((x) => x.kind).join(',') || 'なし')
}

console.log('\n■ 横わ — 折ったぶんだけ余分に使う')
{
  const f = fabric(1100, ['hBottom'])
  const p = newPlacement('a', 'p1', 's1', { snapTo: 'bottom' })
  const r = run(f, [p], [part('p1', 500, 300, true)])
  near('折り込む深さ', r.sections[0].foldDepth.bottom, 300, 0)
  near('描く面の長さ', r.sections[0].surfaceLengthMm, 300, 0)
  // 30cm の面を作るのに、30cm 折り込むので、生地は 60cm 要る
  near('要尺は面＋折り込み', r.totalMm, 600, 0)
}

console.log('\n■ 二重の帯に丸ごと入れば2枚取れる')
{
  const f = fabric(1100, ['vLeft'])
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
  const r2 = run(f, [newPlacement('a', 'p1', 's1', { xMm: 100, yMm: 0 })], [part('p1', 300, 400)])
  ok('どこに置いても1つで2枚', r2.counts[0].count === 2, `×${r2.counts[0].count}`)
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

console.log('\n■ 止めるべきものを止めているか')
{
  const napped = fabric(1100, ['vLeft'], true)
  const r1 = run(napped, [newPlacement('a', 'p1', 's1', { snapTo: 'left', rot180: true })],
    [part('p1', 300, 400, true)])
  ok('毛並みありで差し込みを止める',
    r1.problems.some((x) => x.kind === 'napLocked'), r1.problems[0]?.message ?? 'なし')

  const plain = fabric(1100, ['vLeft'])
  const r2 = run(plain, [newPlacement('a', 'p1', 's1', { snapTo: 'left', rot180: true })],
    [part('p1', 300, 400, true)])
  ok('向きなしなら差し込みを許す',
    !r2.problems.some((x) => x.kind === 'napLocked'), '止めない')

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
  const f = fabric(1100, ['vBoth', 'vLeft'])
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

console.log(failures === 0 ? '\nすべて通りました。' : `\n${failures} 件、期待どおりになりませんでした。`)
process.exit(failures === 0 ? 0 : 1)
