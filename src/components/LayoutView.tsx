/**
 * 生地の上に並べる画面（第4フェーズ）。
 *
 * **並べるのは学生自身**（依頼者の指示）。
 * どう置けば節約できるかを考えるところが、この課題の中身だから。
 * アプリは自動で並べず、はみ出し・重なり・向き違反を赤で知らせるだけにする。
 *
 * 見えている生地は「二つ折りにしたあとの、上に来ている面」。
 * 折り返したところだけ生地が二重で、残りは一重——それが絵で分かるようにしてある
 * （断面図と、めくれた紙のような影）。ここが伝わらないと画面全体が分からなくなる、
 * と依頼者から指摘があった。
 *
 * 置いたパーツは、縫い代の画面と同じく**出来上がり線と縫い代の帯**を描き分ける。
 * 縫い代どうしがどう重なるかを見ながら置きたいため（依頼者の指示）。
 */

import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { isReserve, RESERVE_CHOICES, toReserve } from '../lib/store'
import {
  canHalfFold, computeYardage, FOLD_LABELS, foldSidesOf, isHalfFold, isHorizontalFold,
  newPlacement, orientedPair, PURCHASE_MARGIN_MM, SELVAGE_MM, SNAP_MM,
  type Fabric, type FoldMode, type PlacedPart, type Placement, type Section, type Side,
} from '../lib/fabric'
import { placedPartOf, type PartsState, type StoredPart } from '../lib/store'
import { FoldDiagram } from './FoldDiagram'
import { Heading, Hint, Icon, Note } from './Icon'
import { PatternMarks } from './PatternMarks'
import { Tour } from './Tour'
import type { Polygon } from '../lib/geom'

type Props = {
  state: PartsState
  /**
   * 2つめは「ひと続きの操作」の合図。
   * 同じ合図が続くあいだ、1つ戻るの控えは1回ぶんにまとめられる
   */
  onChange: (state: PartsState, group?: string) => void
  onBack: () => void
}

const FOLD_CHOICES: FoldMode[] = ['none', 'vLeft', 'vBoth', 'hTop', 'hBottom', 'hBoth']

/** 生地が空でも、置き場所が見えるように確保しておく長さ(mm) */
const MIN_VIEW_MM = 400

/** 引きずるたびに増える番号。ひと続きの動きに同じ合図を付けるためだけのもの */
let dragSeq = 0

const SIDE_LABELS: Record<Side, string> = {
  left: '左', right: '右', top: '上', bottom: '下',
}

/** 生地の色。一重のところと、折り返して二重になっているところ */
const CLOTH = '#fdfcf8'
const CLOTH_FOLDED = '#efeee2'
const CREASE = '#35664e'

export function LayoutView({ state, onChange, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState(state.sections[0]?.id ?? 's1')

  const fabric: Fabric = useMemo(
    () => ({ widthMm: state.fabricWidthMm, hasNap: state.hasNap, sections: state.sections }),
    [state.fabricWidthMm, state.hasNap, state.sections],
  )

  const partMap = useMemo(() => {
    const m = new Map<string, PlacedPart>()
    for (const p of state.parts) {
      const placed = placedPartOf(p)
      if (placed) m.set(p.id, placed)
    }
    return m
  }, [state.parts])

  const report = useMemo(
    () => computeYardage(fabric, state.placements, partMap),
    [fabric, state.placements, partMap],
  )

  const nameOf = (partId: string) => state.parts.find((p) => p.id === partId)?.name ?? ''
  const selected = state.placements.find((p) => p.id === selectedId) ?? null

  /** この型紙1つで、生地から何枚とれるか。二重の上なら2枚 */
  const countOf = (placementId: string) =>
    report.counts.find((c) => c.placementId === placementId)?.count ?? 1

  const patch = (id: string, over: Partial<Placement>, group?: string) =>
    onChange({
      ...state,
      placements: state.placements.map((p) => (p.id === id ? { ...p, ...over } : p)),
    }, group)

  const place = (partId: string) => {
    const id = `pl${state.placements.length}_${partId}`
    onChange({
      ...state,
      placements: [...state.placements, newPlacement(id, partId, activeSection)],
    })
    setSelectedId(id)
  }

  const remove = (id: string) => {
    onChange({ ...state, placements: state.placements.filter((p) => p.id !== id) })
    setSelectedId(null)
  }

  /**
   * 後で裁つぶんの余白を足して、そのまま生地の上に置く。
   * 置くところまで一気にやるのは、余白は「場所を空けるため」に作るものなので、
   * 一覧に足しただけでは何も起きないため。
   */
  const addReserve = (name: string, widthMm: number, heightMm: number) => {
    const part = toReserve(name, widthMm, heightMm)
    const id = `pl${state.placements.length}_${part.id}`
    onChange({
      ...state,
      parts: [...state.parts, part],
      placements: [...state.placements, newPlacement(id, part.id, activeSection)],
    })
    setSelectedId(id)
  }

  /** 余白そのものを消す。置いてある場所もまとめて消える */
  const dropPart = (partId: string) => {
    onChange({
      ...state,
      parts: state.parts.filter((p) => p.id !== partId),
      placements: state.placements.filter((p) => p.partId !== partId),
    })
    setSelectedId(null)
  }

  const addSection = () => {
    const id = `s${state.sections.length + 1}_${state.sections.length}`
    onChange({ ...state, sections: [...state.sections, { id, fold: 'none', halfFold: false }] })
    setActiveSection(id)
  }

  const dropSection = (id: string) => {
    onChange({
      ...state,
      sections: state.sections.filter((s) => s.id !== id),
      placements: state.placements.filter((p) => p.sectionId !== id),
    })
    setActiveSection(state.sections.find((s) => s.id !== id)?.id ?? '')
  }

  /** そのパーツが、いま何枚ぶん取れているか */
  const takenOf = (partId: string) =>
    state.placements
      .filter((p) => p.partId === partId)
      .reduce((sum, p) => sum + countOf(p.id), 0)

  // 余白は「枚数」の話ではないので、足りない・足りているの数え上げには入れない
  const shortage = state.parts.filter((p) => !isReserve(p) && takenOf(p.id) < p.needed)

  return (
    <section className="flex flex-col gap-3.5 pb-40">
      <Tour id="layout" />
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 self-start text-sm font-bold text-mat-700"
      >
        <Icon name="back" className="h-4 w-4 shrink-0" />
        パーツの一覧へ
      </button>

      {report.problems.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-seam/40 bg-seam/5 px-4 py-3">
          {report.problems.map((pb, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-seam">
              <Icon name="warn" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0" />
              <span className="min-w-0 flex-1">
                {pb.placementId && (
                  <span className="font-bold">
                    {nameOf(state.placements.find((p) => p.id === pb.placementId)?.partId ?? '')}：
                  </span>
                )}
                {pb.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.sections.map((section, i) => (
        <SectionCanvas
          key={section.id}
          index={i}
          section={section}
          report={report.sections[i]}
          state={state}
          partMap={partMap}
          active={activeSection === section.id}
          selectedId={selectedId}
          canDrop={state.sections.length > 1}
          countOf={countOf}
          onActivate={() => setActiveSection(section.id)}
          onSelect={setSelectedId}
          onMove={patch}
          onFold={(fold) =>
            onChange({
              ...state,
              sections: state.sections.map((s) => (s.id === section.id ? { ...s, fold } : s)),
            })
          }
          onHalf={(halfFold) =>
            onChange({
              ...state,
              sections: state.sections.map((s) => (s.id === section.id ? { ...s, halfFold } : s)),
            })
          }
          onDrop={() => dropSection(section.id)}
        />
      ))}

      {/*
        区間は、パーツが入りきらなくなって初めて要る。
        ふだんは1つのままで、学生に「区間」という言葉すら見せない（判断7）。

        めったに押さないボタンが、生地の絵と「置くパーツ」のあいだで
        場所を取っていた（依頼者の指摘・2026-08-27）。
        白いボタンをやめて右寄せの小さな字にし、
        まだ何も置いていないうちは出さないようにしてある。
        言い方も、していること（生地を切り分ける）を先に置いた
      */}
      {(state.placements.length > 0 || state.sections.length > 1) && (
        <button
          type="button"
          onClick={addSection}
          className="flex items-center gap-1 self-end px-1 py-0.5 text-xs text-ink-300 active:text-mat-700"
        >
          <Icon name="scissors" className="h-3.5 w-3.5 shrink-0" />
          ここで切り分けて、折り方を変える
        </button>
      )}

      <Tray
        state={state}
        takenOf={takenOf}
        shortage={shortage}
        onPlace={place}
        onAddReserve={addReserve}
        onDropPart={dropPart}
      />

      {/*
        買ってくる長さは、この画面の**結び**として下に置く（依頼者の指示・2026-08-27）。
        上にあると、まだ何も並べていないうちから結果が目に入って、
        「並べる → 長さが出る」という順に読めない。
        置くパーツのすぐ下なので、1つ置いて目を下ろせば、そのたびに変わるのが見える
      */}
      <Totals report={report} widthMm={state.fabricWidthMm} />

      {selected && (
        <Controls
          placement={selected}
          name={nameOf(selected.partId)}
          count={countOf(selected.id)}
          reserve={isReserve(state.parts.find((p) => p.id === selected.partId) ?? ({} as StoredPart))}
          hasNap={state.hasNap}
          foldSides={foldSidesOf(
            state.sections.find((s) => s.id === selected.sectionId)?.fold ?? 'none',
          )}
          onPatch={(over) => patch(selected.id, over)}
          onRemove={() => remove(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 合計 */

function Totals({
  report, widthMm,
}: {
  report: ReturnType<typeof computeYardage>
  widthMm: number
}) {
  return (
    <div data-tour="totals" className="flex gap-3 rounded-xl border border-ink-100 bg-white px-4 py-4">
      {/* 買う長さは、生地の「丈」を測っている数字。絵でもそう見せる */}
      <Icon name="yardage" className="mt-1 h-9 w-9 shrink-0 text-mat-500" />
      <div className="min-w-0 flex-1">
      <p className="text-xs text-ink-500">買ってくる長さ</p>
      <p className="tnum text-4xl font-bold leading-tight text-mat-600">
        {(report.purchaseMm / 10).toFixed(0)}
        <span className="pl-1 text-lg font-bold text-ink-500">cm</span>
      </p>
      {/* 計算の中身は、式のかたちで一目で見せる。文にすると読ませることになる */}
      {report.totalMm > 0 ? (
        <div className="pt-1">
          <Hint
            icon="scissors"
            summary={
              <span className="tnum">
                並べたぶん {(report.totalMm / 10).toFixed(0)}
                <span className="px-1 text-ink-300">＋</span>
                ゆとり {PURCHASE_MARGIN_MM / 10}
                <span className="px-1 text-ink-300">→ 切り上げ</span>
              </span>
            }
          >
            足している {PURCHASE_MARGIN_MM / 10} cm は、地直しの縮みと裁ち端のぶんです。
            そのうえで 10cm 単位に切り上げています。
          </Hint>
        </div>
      ) : (
        <p className="pt-1 text-xs text-ink-500">上の「置く」から並べてください。</p>
      )}
      <p className="tnum flex items-center gap-1.5 pt-2 text-xs text-ink-300">
        <Icon name="clothWidth" className="h-3.5 w-3.5 shrink-0" />
        {/*
          ここで「置けるのは 106cm」と言ってしまうと、半分に折ったときの
          パネル（53cm）と食い違って見える。耳を除いた幅までにとどめ、
          実際に置ける幅は、折り方が決まっている区間のほうに出す
        */}
        生地幅 {widthMm / 10} cm ／ みみを除くと {(widthMm - SELVAGE_MM * 2) / 10} cm
      </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- 生地の面 */

function SectionCanvas({
  index, section, report, state, partMap, active, selectedId, canDrop, countOf,
  onActivate, onSelect, onMove, onFold, onHalf, onDrop,
}: {
  index: number
  section: Section
  report: ReturnType<typeof computeYardage>['sections'][number] | undefined
  state: PartsState
  partMap: Map<string, PlacedPart>
  active: boolean
  selectedId: string | null
  canDrop: boolean
  countOf: (placementId: string) => number
  onActivate: () => void
  onSelect: (id: string) => void
  onMove: (id: string, over: Partial<Placement>, group?: string) => void
  onFold: (fold: FoldMode) => void
  onHalf: (halfFold: boolean) => void
  onDrop: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<
    { id: string; x0: number; y0: number; px: number; py: number; w: number; group: string } | null
  >(null)

  if (!report) return null

  const W = Math.max(report.surfaceWidthMm, 1)
  /** 実際に使っている長さ。ここから下は、まだ使っていない生地 */
  const used = report.surfaceLengthMm
  const L = Math.max(used, MIN_VIEW_MM)
  const foldSides = foldSidesOf(section.fold)
  const depth = report.foldDepth
  const half = isHalfFold(section)
  /** 折り返した端に落とす影の幅。生地幅に対する割合で決める */
  const shade = W * 0.025
  /** 下になっている一枚が、耳の側からのぞく量 */
  const RIM = W * 0.045
  /** 折り山が枠の外へふくらむ量。ここが「山」そのものになる */
  const SP = W * 0.034
  /** 枠の外に取る余白。ふくらんだ折り山と、端の名前を書くぶん */
  const PAD = W * 0.115
  /** 折り山の内側にできる翳りの幅 */
  const CR = W * 0.09
  const badPlacements = new Set(
    report.problems.flatMap((p) => (p.placementId ? [p.placementId] : [])),
  )
  const gid = `fold-${section.id}`
  const vbW = W + PAD * 2
  const vbH = L + PAD * 2

  /** 画面の1px が何mmか。指の動きを実寸に直すのに使う */
  const mmPerPx = () => {
    const box = svgRef.current?.getBoundingClientRect()
    return box && box.width > 0 ? vbW / box.width : 1
  }

  const startDrag = (e: PointerEvent, p: Placement) => {
    onActivate()
    onSelect(p.id)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const box = report.boxes.find((b) => b.placementId === p.id)
    // ひと続きの引きずりに、1つだけの合図を付ける。
    // 離してもう一度つかんだら別の合図になるので、戻るは1回ずつ効く
    dragSeq += 1
    drag.current = {
      id: p.id, x0: p.xMm, y0: p.yMm, px: e.clientX, py: e.clientY, w: box?.w ?? 0,
      group: `drag${dragSeq}`,
    }
  }

  const moveDrag = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const k = mmPerPx()
    const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM
    /*
      横は生地の幅で止める（依頼者の指摘・2026-08-27）。
      これまで左だけ 0 で止めて右は素通しだったので、
      「左は出られないのに右は出られる」という食い違いになっていた。
      幅そのものが足りない型紙は、止めても右へはみ出したままになる。
      そのときは注意書きが出るので、押し込んで隠してしまわないよう Math.max(0, …) を外側に置く。

      縦は止めない。生地は下へいくらでも伸ばして買えるもので、
      いま使っている長さがそのまま買う長さになる（＝はみ出しという概念がない）
    */
    const maxX = Math.max(0, W - d.w)
    onMove(d.id, {
      xMm: Math.max(0, Math.min(maxX, snap(d.x0 + (e.clientX - d.px) * k))),
      yMm: Math.max(0, snap(d.y0 + (e.clientY - d.py) * k)),
    }, d.group)
  }

  const endDrag = () => { drag.current = null }

  /**
   * 折り返して二重になっている帯。
   * `full` は、折り返した一枚が見えている面を丸ごと覆っている状態
   * （＝生地幅を半分に折ったとき）。このときだけ、耳の側に下の一枚がのぞく。
   */
  const flaps: Array<{ side: Side; x: number; y: number; w: number; h: number; full: boolean }> = []
  /**
   * 両側から折って、みみが中央で出会っているときに、そのあいだへ残す隙間（依頼者の指示・2026-08-27）。
   *
   * ぴったり突き合わせて描くと、二重の帯が1枚の面につながって見えてしまい、
   * 「ここが端どうしの出会うところ」だと分からない。
   * 隙間から下の一枚（明るいほうの色）がのぞくので、そこが境目だと目で分かる。
   * 絵のうえだけの隙間で、計算にはいっさい効かない。
   */
  const MEET = W * 0.013
  const meetV = depth.left > 0 && depth.right > 0 && depth.left + depth.right >= W - 0.5
  const meetH = depth.top > 0 && depth.bottom > 0 && depth.top + depth.bottom >= L - 0.5
  if (depth.left > 0) {
    const w = meetV ? depth.left - MEET * 0.5 : depth.left
    flaps.push({ side: 'left', x: 0, y: 0, w, h: L, full: depth.left >= W - 0.5 })
  }
  if (depth.right > 0) {
    const w = meetV ? depth.right - MEET * 0.5 : depth.right
    flaps.push({ side: 'right', x: W - w, y: 0, w, h: L, full: depth.right >= W - 0.5 })
  }
  if (depth.top > 0) {
    const h = meetH ? depth.top - MEET * 0.5 : depth.top
    flaps.push({ side: 'top', x: 0, y: 0, w: W, h, full: depth.top >= L - 0.5 })
  }
  if (depth.bottom > 0) {
    const h = meetH ? depth.bottom - MEET * 0.5 : depth.bottom
    flaps.push({ side: 'bottom', x: 0, y: L - h, w: W, h, full: depth.bottom >= L - 0.5 })
  }

  /**
   * 帯の名前に「生地が」を付けられるか。
   * 帯が細いところで長い名前を書くと、帯からはみ出して読めなくなる。
   * 一重の帯だけ短くなると別のものに見えるので、全部まとめて決める
   */
  const longLayerLabels = flaps.every(
    (f) => (f.side === 'left' || f.side === 'right' ? f.w : W) > W * 0.34,
  )

  /**
   * 下になっている一枚。折り返しが面を丸ごと覆っているときだけ、
   * 折り山の反対側（耳の側）に少しだけのぞかせる。
   * 実物でも、二つ折りにした耳がぴったり揃うことはまずない。
   * ここがのぞいていることが、「紙が2枚ある」といういちばん強い手がかりになる。
   */
  const under = { x0: 0, y0: 0, x1: W, y1: L }
  for (const f of flaps) {
    if (!f.full) continue
    if (f.side === 'left') under.x1 += RIM
    else if (f.side === 'right') under.x0 -= RIM
    else if (f.side === 'top') under.y1 += RIM
    else under.y0 -= RIM
  }
  const hasUnder = flaps.some((f) => f.full)

  /*
    裁ち端の側へも、少しだけずらしておく（依頼者の指示・2026-08-27）。
    折り山の反対側にのぞかせるだけでは、二重になっている感じが伝わりにくい。
    紙を2枚わずかにずらして重ねたときのように、角がのぞいていれば、
    そこに布が2枚あることが言葉なしで分かる
  */
  const UNDER_SHIFT = RIM * 1.15
  if (hasUnder) {
    if (isHorizontalFold(section.fold)) under.x1 += UNDER_SHIFT
    else under.y1 += UNDER_SHIFT
  }

  /** 折り山ではない縦の端＝耳。二重なら耳も2枚ぶんある */
  const selvages: Side[] = (['left', 'right'] as Side[]).filter((s) => !foldSides.includes(s))

  /** 折り山の側だけ、生地を枠の外へふくらませる。ここが「山」になる */
  const ext: Record<Side, number> = {
    left: foldSides.includes('left') ? SP : 0,
    right: foldSides.includes('right') ? SP : 0,
    top: foldSides.includes('top') ? SP : 0,
    bottom: foldSides.includes('bottom') ? SP : 0,
  }

  /**
   * 回り込みが見える角（＝折り山の、裁ち端の側の角）。
   * ここだけ、まるみを折り山のふくらみの幅（CR）と同じにする。
   * 同じにしておくと、まっすぐな帯と角の帯が、切れ目なくつながる
   */
  const curlSide = flaps.find((f) => f.full)?.side
  const curlCorner: 'tl' | 'tr' | 'br' | 'bl' | null =
    curlSide === 'left' ? 'bl' : curlSide === 'top' ? 'tr'
      : curlSide === 'right' || curlSide === 'bottom' ? 'br' : null

  const pts = (poly: Polygon) => poly.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')

  /**
   * 波打つ裁ち端。はさみで切った端は、定規で引いたようにはまっすぐにならない。
   * うっすら波打たせて、まっすぐな折り山・点々のみみと描き分ける。
   * （開始点へは移動しない。輪郭の途中に差し込んで使う）
   */
  const waveSeg = (from: number, to: number, y: number) => {
    const amp = W * 0.005
    const step = W * 0.05
    const dir = to >= from ? 1 : -1
    const span = Math.abs(to - from)
    let d = ''
    let up = true
    for (let t = 0; t < span - 0.01; t += step) {
      const seg = Math.min(step, span - t)
      const x = from + dir * t
      const nx = from + dir * (t + seg)
      const mx = ((x + nx) / 2).toFixed(1)
      d += ` Q${mx} ${(y + (up ? -amp : amp)).toFixed(1)} ${nx.toFixed(1)} ${y.toFixed(1)}`
      up = !up
    }
    return d
  }

  /**
   * 生地を一枚描く。折り山の側だけ、角にまるみを付ける。
   *
   * 布を二つに折ると、折った縁はどうしてもまるくふくらみ、
   * 裁った縁や耳は角が立つ。上から見たときの、この角の違いが
   * 「どちらが折り山か」を言葉なしで伝えてくれる。
   */
  const sheet = (
    x0: number, y0: number, x1: number, y1: number,
    cutTop = false, cutBottom = false,
  ) => {
    const r = SP * 1.7
    const big = (k: 'tl' | 'tr' | 'br' | 'bl', v: number) => (curlCorner === k ? CR : v)
    const tl = big('tl', ext.left > 0 || ext.top > 0 ? r : 0)
    const tr = big('tr', ext.right > 0 || ext.top > 0 ? r : 0)
    const br = big('br', ext.right > 0 || ext.bottom > 0 ? r : 0)
    const bl = big('bl', ext.left > 0 || ext.bottom > 0 ? r : 0)
    const arc = (rr: number, x: number, y: number) =>
      rr ? `A${rr} ${rr} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}` : ''
    return [
      `M${(x0 + tl).toFixed(1)} ${y0.toFixed(1)}`,
      cutTop ? waveSeg(x0 + tl, x1 - tr, y0) : `H${(x1 - tr).toFixed(1)}`,
      arc(tr, x1, y0 + tr),
      `V${(y1 - br).toFixed(1)}`, arc(br, x1 - br, y1),
      // 下の端も、上と同じく裁ち端。まっすぐ引くと折り山に見える（依頼者の指摘・2026-08-27）
      cutBottom ? waveSeg(x1 - br, x0 + bl, y1) : `H${(x0 + bl).toFixed(1)}`,
      arc(bl, x0, y1 - bl),
      `V${(y0 + tl).toFixed(1)}`, arc(tl, x0 + tl, y0),
      'Z',
    ].join(' ')
  }

  /** 上下の端が、はさみで切った裁ち端かどうか（横わでそちらを折るときだけ違う） */
  const cutTop = !foldSides.includes('top')
  const cutBottom = !foldSides.includes('bottom')

  const topPath = sheet(-ext.left, -ext.top, W + ext.right, L + ext.bottom, cutTop, cutBottom)
  /**
   * 折り山まわりの形。
   *
   * 下の一枚は、上の一枚と同じ形を、みみの側と裁ち端の側へ少しずらして描く。
   * ただし**折り山に近いところでは、ずらす量を 0 に戻す**（依頼者の指摘・2026-08-27）。
   * 折り山では2枚が地続きなので、端まで同じ量ずらしたままだと、
   * そこに切り込みが入っているように見えてしまう。
   * 0 に戻すと2枚の裁ち端がそこで1本に合わさり、布が回り込んで見える。
   *
   * その回り込みを、折り山の緑の線でもなぞる（依頼者の指示・2026-08-27）。
   * 線が角で向こうへ曲がっていくのが、断面図のカールと同じ意味になる。
   * 曲がりきったところで線は消えるので、裁ち端を折り山と言い張ることにはならない。
   *
   * 折り山に沿う向きを u、折り山から離れる向きを v として組み立て、
   * 最後に画面の向きへ移している。折り山が左でも上でも下でも、同じ式で書けるため
   */
  const foldShape = (() => {
    if (!curlSide) return null
    const foldSide = curlSide
    const vertical = foldSide === 'left' || foldSide === 'right'
    /** u は折り山に沿う向き。その向こうの端が、回り込む側 */
    const uMax = vertical ? L : W
    /** v は折り山から離れる向き。その先にみみが2枚重なっている */
    const vMax = vertical ? W : L
    /** 回り込みの半径。折り山のふくらみの帯と同じ幅にそろえてある */
    const R = CR
    /** 2枚が離れきるまでの長さ。角のまるみから続けて離れていく */
    const RAMP = R * 0.9
    const amp = W * 0.005

    const xy = (u: number, v: number) => ({
      x: foldSide === 'left' ? v : foldSide === 'right' ? W - v : u,
      y: foldSide === 'top' ? v : foldSide === 'bottom' ? L - v : u,
    })
    const at = (u: number, v: number) => {
      const p = xy(u, v)
      return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    }
    /** 折り山からどれだけ離れたか。0 なら折り山と地続き、1 で離れきる */
    const away = (v: number) => {
      const t = Math.min(1, Math.max(0, (v + SP - R) / RAMP))
      return t * t * (3 - 2 * t)
    }
    /** 向こうの端の位置。折り山へ近づくほど、上の一枚の端まで戻る */
    const far = (v: number) => {
      // 縦わなら、この端は裁ち端。上の一枚と同じく、うっすら波打たせる
      const wave = vertical ? amp * Math.sin((v / (W * 0.1)) * Math.PI * 2) : 0
      return uMax + away(v) * (UNDER_SHIFT + wave)
    }

    const v0 = -SP + R
    const v1 = vMax + RIM
    const steps = 40

    let under = `M${at(0, v0)} L${at(0, v1)} L${at(far(v1), v1)}`
    for (let i = steps - 1; i >= 0; i--) {
      const v = v0 + ((v1 - v0) * i) / steps
      under += ` L${at(far(v), v)}`
    }
    // 折り山。角のまるみは上の一枚とそろえる
    under += ` Q${at(uMax, -SP)} ${at(uMax - R, -SP)}`
    under += ` L${at(SP * 1.7, -SP)}`
    under += ` Q${at(0, -SP)} ${at(0, v0)} Z`

    /** 折り山の線が、角で向こうへ曲がっていくところ */
    const vEnd = Math.min(v1, v0 + RAMP * 1.2)
    let crease = `M${at(uMax - R, -SP)} Q${at(uMax, -SP)} ${at(far(v0), v0)}`
    for (let i = 1; i <= 16; i++) {
      const v = v0 + (vEnd - v0) * (i / 16)
      crease += ` L${at(far(v), v)}`
    }

    /** 帯を置くための、角のまるみの中心と、そこから続く帯の四隅 */
    const heart = xy(uMax - R, v0)
    const qEnd = xy(uMax, -SP)
    const bandFar = xy(uMax, v0 + R * 1.9)
    const fade0 = xy(uMax, v0)
    const fade1 = xy(uMax, v0 + R * 1.9)
    const g0 = xy(uMax, -SP)
    const g1 = xy(uMax, vEnd)

    return {
      under,
      crease,
      R,
      heart,
      /*
        角の帯を塗る範囲。まるみの中心から見て、角のある四半分だけ。
        まるいので、まん中から外へ向かって色を並べているが、
        そのまま円を塗ると、生地のまん中に的のような輪ができてしまう
      */
      quad: {
        x: Math.min(heart.x, qEnd.x), y: Math.min(heart.y, qEnd.y),
        w: Math.abs(qEnd.x - heart.x), h: Math.abs(qEnd.y - heart.y),
      },
      band: {
        x: Math.min(heart.x, bandFar.x), y: Math.min(heart.y, bandFar.y),
        w: Math.abs(bandFar.x - heart.x) || R, h: Math.abs(bandFar.y - heart.y) || R,
        side: vertical ? ('bottom' as Side) : ('right' as Side),
      },
      fade: { x1: fade0.x, y1: fade0.y, x2: fade1.x, y2: fade1.y },
      creaseFade: { x1: g0.x, y1: g0.y, x2: g1.x, y2: g1.y },
    }
  })()
  const underPath = foldShape?.under ?? ''

  /**
   * みみ。実物のみみには、織るときの機械のピン穴が点々と並んでいる。
   * くし歯だと定規の目盛りに見えてしまうので（依頼者の指摘）、
   * 学生が毎日見ているピン穴のほうで描く。
   */
  const selvageBand = (xEdge: number, inward: 1 | -1) => {
    const bw = W * 0.02
    const dots: number[] = []
    const step = W * 0.042
    for (let y = step * 0.6; y < L - step * 0.3; y += step) dots.push(y)
    return (
      <g>
        <rect x={inward === 1 ? xEdge : xEdge - bw} y={0} width={bw} height={L}
          fill="#8d8a78" opacity={0.1} />
        {dots.map((y) => (
          <circle key={y} cx={xEdge + inward * bw * 0.5} cy={y} r={W * 0.0035}
            fill="#8d8a78" opacity={0.55} />
        ))}
      </g>
    )
  }

  /* ---- ピクトグラム。断面図と同じ「横から見た布」の言葉で統一する ---- */

  /** 折り山：ヘアピン形。断面図の折り返しをそのまま小さくしたもの */
  const iconFold = (cx: number, cy: number, sz: number, side: Side, color: string) => {
    const r = sz * 0.3
    const d = `M${cx + sz * 0.5} ${cy - r} H${cx - sz * 0.5 + r}`
      + ` A${r} ${r} 0 0 0 ${cx - sz * 0.5 + r} ${cy + r} H${cx + sz * 0.5}`
    const rot = { left: 0, right: 180, top: 90, bottom: 270 }[side]
    return (
      <path d={d} fill="none" stroke={color} strokeWidth={sz * 0.18} strokeLinecap="round"
        transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined} />
    )
  }

  /** 重なり：横から見た布 n 枚。1本なら一重、2本なら二重 */
  const iconLayers = (
    cx: number, cy: number, sz: number, n: 1 | 2, color: string, casing = false,
  ) => {
    const ys = n === 2 ? [cy - sz * 0.17, cy + sz * 0.17] : [cy]
    return (
      <g strokeLinecap="round">
        {casing && ys.map((y) => (
          <line key={`c${y}`} x1={cx - sz * 0.5} y1={y} x2={cx + sz * 0.5} y2={y}
            stroke="#ffffff" strokeWidth={sz * 0.42} />
        ))}
        {ys.map((y) => (
          <line key={y} x1={cx - sz * 0.5} y1={y} x2={cx + sz * 0.5} y2={y}
            stroke={color} strokeWidth={sz * 0.18} />
        ))}
      </g>
    )
  }

  /**
   * 裏返し：紙をめくった形。左半分が表、右半分が浮き上がってめくれている。
   * 操作のボタンに付いている mirror の印と同じ意味。
   */
  const iconFlip = (cx: number, cy: number, sz: number, color: string) => (
    <g fill="none" stroke={color} strokeWidth={sz * 0.13} strokeLinejoin="round">
      <path d={`M${cx} ${cy - sz * 0.5} V${cy + sz * 0.5}`} strokeDasharray={`${sz * 0.16} ${sz * 0.13}`} />
      <path d={`M${cx - sz * 0.06} ${cy - sz * 0.42} H${cx - sz * 0.5} V${cy + sz * 0.42} H${cx - sz * 0.06}`} />
      <path d={`M${cx + sz * 0.06} ${cy - sz * 0.42} L${cx + sz * 0.5} ${cy - sz * 0.2}`
        + ` L${cx + sz * 0.5} ${cy + sz * 0.6} L${cx + sz * 0.06} ${cy + sz * 0.42} Z`}
        fill={color} fillOpacity={0.18} />
    </g>
  )

  /** はさみ：裁ち端の印 */
  const iconScissors = (cx: number, cy: number, sz: number, color: string) => (
    <g stroke={color} strokeWidth={sz * 0.13} fill="none" strokeLinecap="round">
      <line x1={cx - sz * 0.2} y1={cy - sz * 0.18} x2={cx + sz * 0.55} y2={cy + sz * 0.24} />
      <line x1={cx - sz * 0.2} y1={cy + sz * 0.18} x2={cx + sz * 0.55} y2={cy - sz * 0.24} />
      <circle cx={cx - sz * 0.36} cy={cy - sz * 0.3} r={sz * 0.17} />
      <circle cx={cx - sz * 0.36} cy={cy + sz * 0.3} r={sz * 0.17} />
    </g>
  )

  return (
    <div className="flex flex-col gap-2">
      {/*
        折り方と、どこまで折るか。もとは折り方だけがこの段で、
        どこまで折るかは下に大きなボタン2つを並べていた。
        ほとんどの人は「半分に折る」しか使わないので、
        幅を取るボタンをやめて、折り方の右のプルダウンにまとめてある
        （依頼者の指示・2026-08-27）
      */}
      <div className="flex items-center gap-1.5">
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-ink-700">
          <Icon name="layout" className="h-4 w-4 shrink-0 text-mat-600" />
          {state.sections.length > 1 ? `${index + 1} つめ` : ''}
        </span>
        <select
          value={section.fold}
          onChange={(e) => onFold(e.target.value as FoldMode)}
          className="min-w-0 rounded-lg border border-ink-100 bg-white px-1.5 py-1.5 text-sm"
        >
          {FOLD_CHOICES.map((f) => (
            <option key={f} value={f}>{FOLD_LABELS[f]}</option>
          ))}
        </select>
        {canHalfFold(section.fold) && (
          <select
            value={half ? 'half' : 'partial'}
            onChange={(e) => onHalf(e.target.value === 'half')}
            className="min-w-0 rounded-lg border border-ink-100 bg-white px-1.5 py-1.5 text-sm"
          >
            <option value="half">{section.fold === 'vBoth' ? '中央まで' : '半分に折る'}</option>
            <option value="partial">型紙に合わせて</option>
          </select>
        )}
        {/* 折ったあとに実際に置ける幅。折り方で変わるので、区間ごとに出す */}
        <span className="tnum ml-auto shrink-0 text-[11px] leading-tight text-ink-300">
          幅 {(W / 10).toFixed(0)} cm
          <br />
          長さ {(report.yardageMm / 10).toFixed(0)} cm
        </span>
        {canDrop && (
          <button
            type="button"
            onClick={onDrop}
            className="flex shrink-0 items-center gap-1 pl-1 text-xs text-ink-300"
          >
            <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
            消す
          </button>
        )}
      </div>

      {/* 平面図に線を引くだけでは、折っていることが伝わらない。横から見た形を添える */}
      <FoldDiagram
        fold={section.fold}
        nearMm={isHorizontalFold(section.fold) ? depth.top : depth.left}
        farMm={isHorizontalFold(section.fold) ? depth.bottom : depth.right}
        spanMm={isHorizontalFold(section.fold) ? L : W}
      />

      {/*
        絵と、その絵についての注意書きを、ひとつの枠の中に入れてある。
        絵の外に置くと「この画面ぜんぶへの説明」に見えてしまい、
        どの絵の話なのかが分からない（依頼者の指示・2026-08-27）
      */}
      <div
        className={`flex flex-col overflow-hidden rounded-xl border-2 bg-table ${
          active ? 'border-mat-500' : 'border-ink-100'
        }`}
      >
        <svg
          ref={svgRef}
          viewBox={`${-PAD} ${-PAD} ${vbW} ${vbH}`}
          data-tour={index === 0 ? 'fabric' : undefined}
          className="w-full select-none"
          style={{ aspectRatio: `${vbW} / ${vbH}`, touchAction: 'none' }}
          onPointerDown={onActivate}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label={`${index + 1}つめの生地`}
        >
          <defs>
            {/*
              織り目。ただ塗りつぶした面は「紙」に見えてしまう。
              うっすら格子を敷くだけで布らしくなる（拡大しても目が細かいまま）
            */}
            <pattern id={`${gid}-weave`} width={W * 0.0062} height={W * 0.0062}
              patternUnits="userSpaceOnUse">
              <path d={`M0 0 H${W * 0.0062}`} stroke="#9d9b86"
                strokeWidth={W * 0.0011} opacity="0.15" />
              <path d={`M0 0 V${W * 0.0062}`} stroke="#9d9b86"
                strokeWidth={W * 0.0011} opacity="0.09" />
            </pattern>

            {/*
              後で裁つぶんの余白。斜線を敷いて「ここはまだ裁たない」と示す。
              型紙と同じ塗りにすると、置いた枚数を数え違える
            */}
            <pattern id={`${gid}-hold`} width={W * 0.026} height={W * 0.026}
              patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={W * 0.026} height={W * 0.026} fill="#f6f2e4" fillOpacity="0.92" />
              <path d={`M0 0 V${W * 0.026}`} stroke="#b6a97e" strokeWidth={W * 0.005} />
            </pattern>

            {/*
              裏返して置いた型紙の「紙の裏」（依頼者の指示・2026-08-27）。
              表と同じ白い紙で描くと、裏返したことが絵から消えてしまう。
              紙をひっくり返すと、鉛筆の線が透けてうっすら見える——
              あの見え方を、細い斜線を反対向きに敷いて表している。
              「あとで裁つ余白」の斜線とは向きも色も変えてあるので、取り違えない
            */}
            <pattern id={`${gid}-back`} width={W * 0.019} height={W * 0.019}
              patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width={W * 0.019} height={W * 0.019} fill="#e9e7e0" />
              <path d={`M0 0 V${W * 0.019}`} stroke="#c2bfb4" strokeWidth={W * 0.0028} />
            </pattern>

            {/* 折り山の明暗は、生地からはみ出さないように切り抜く */}
            <clipPath id={`${gid}-clip`}>
              <path d={topPath} />
            </clipPath>

            {/* 折り返した生地の端から内側へ落ちる影 */}
            <linearGradient id={`${gid}-h`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#3a3f36" stopOpacity="0.16" />
              <stop offset="1" stopColor="#3a3f36" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gid}-v`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a3f36" stopOpacity="0.16" />
              <stop offset="1" stopColor="#3a3f36" stopOpacity="0" />
            </linearGradient>

            {/*
              折り山のふくらみ。丸めた生地を横から見たときの明暗を、そのまま帯に付ける。
              いちばん外が翳り、山のてっぺんが白く光り、内側へ向かってまた翳る。
              平らな塗りでも、この順の明暗があるだけで「丸く折れた縁」に見える
            */}
            {(['left', 'right', 'top', 'bottom'] as Side[]).map((s) => {
              const dir = {
                left: ['0', '0', '1', '0'], right: ['1', '0', '0', '0'],
                top: ['0', '0', '0', '1'], bottom: ['0', '1', '0', '0'],
              }[s]
              return (
                <linearGradient key={s} id={`${gid}-sp-${s}`}
                  x1={dir[0]} y1={dir[1]} x2={dir[2]} y2={dir[3]}>
                  <stop offset="0" stopColor="#aaa792" />
                  <stop offset="0.16" stopColor="#edebdd" />
                  <stop offset="0.32" stopColor="#ffffff" />
                  <stop offset="0.52" stopColor={CLOTH} />
                  <stop offset="0.76" stopColor="#8d8a78" stopOpacity="0.2" />
                  <stop offset="1" stopColor="#8d8a78" stopOpacity="0" />
                </linearGradient>
              )
            })}

            {/*
              回り込みをなぞる緑の線は、曲がりきったところで消す。
              そのまま裁ち端まで引いてしまうと、裁ち端も折り山だと言うことになる
            */}
            {foldShape && (
              <>
                <linearGradient id={`${gid}-curl`} gradientUnits="userSpaceOnUse"
                  x1={foldShape.creaseFade.x1} y1={foldShape.creaseFade.y1}
                  x2={foldShape.creaseFade.x2} y2={foldShape.creaseFade.y2}>
                  <stop offset="0" stopColor={CREASE} />
                  <stop offset="0.5" stopColor={CREASE} />
                  <stop offset="1" stopColor={CREASE} stopOpacity="0" />
                </linearGradient>

                {/*
                  角のところの、山のふくらみ。
                  まっすぐな帯と同じ明暗を、外側から内側へ向かって円形に並べる。
                  まるみの半径を帯の幅（CR）と同じにしてあるので、
                  まっすぐな帯とここで切れ目なくつながる
                */}
                <radialGradient id={`${gid}-sp-corner`} gradientUnits="userSpaceOnUse"
                  cx={foldShape.heart.x} cy={foldShape.heart.y} r={foldShape.R}>
                  <stop offset="0" stopColor="#8d8a78" stopOpacity="0" />
                  <stop offset="0.24" stopColor="#8d8a78" stopOpacity="0.2" />
                  <stop offset="0.48" stopColor={CLOTH} />
                  <stop offset="0.68" stopColor="#ffffff" />
                  <stop offset="0.84" stopColor="#edebdd" />
                  <stop offset="1" stopColor="#aaa792" />
                </radialGradient>
                <clipPath id={`${gid}-curlclip`}>
                  <rect x={foldShape.quad.x} y={foldShape.quad.y}
                    width={foldShape.quad.w} height={foldShape.quad.h} />
                </clipPath>

                {/* 角を曲がったあとの帯。少し進んだところで消す */}
                <linearGradient id={`${gid}-bandfadeg`} gradientUnits="userSpaceOnUse"
                  x1={foldShape.fade.x1} y1={foldShape.fade.y1}
                  x2={foldShape.fade.x2} y2={foldShape.fade.y2}>
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#000000" />
                </linearGradient>
                <mask id={`${gid}-bandfade`} maskUnits="userSpaceOnUse"
                  x={foldShape.band.x} y={foldShape.band.y}
                  width={foldShape.band.w} height={foldShape.band.h}>
                  <rect x={foldShape.band.x} y={foldShape.band.y}
                    width={foldShape.band.w} height={foldShape.band.h}
                    fill={`url(#${gid}-bandfadeg)`} />
                </mask>
              </>
            )}

            {/* 生地が台に落とす影。紙が机の上に置いてあるように見せる */}
            <filter id={`${gid}-drop`} x="-25%" y="-25%" width="160%" height="160%">
              <feDropShadow dx={W * 0.008} dy={W * 0.012} stdDeviation={W * 0.009}
                floodColor="#3a3f36" floodOpacity="0.3" />
            </filter>
            <filter id={`${gid}-drop2`} x="-25%" y="-25%" width="160%" height="160%">
              <feDropShadow dx={W * 0.006} dy={W * 0.008} stdDeviation={W * 0.007}
                floodColor="#3a3f36" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* 下になっている一枚。耳の側に少しだけのぞく */}
          {hasUnder && (
            <>
              <path d={underPath} fill={CLOTH_FOLDED} filter={`url(#${gid}-drop2)`} />
              <path d={underPath} fill={`url(#${gid}-weave)`} />
            </>
          )}

          {/* 上に来ている一枚。ここに型紙を並べる */}
          <path d={topPath} fill={CLOTH}
            filter={hasUnder ? `url(#${gid}-drop)` : `url(#${gid}-drop2)`} />
          <path d={topPath} fill={`url(#${gid}-weave)`} />

          {/*
            折り山そのもの。丸太を横から見たときの明暗を帯にして重ねる。
            「生地がここで向こう側へ折り返している」ことを、この帯とまるい角で見せる。
            型紙より先に描く（型紙は生地の上に乗るので、隠れてよい）
          */}
          <g clipPath={`url(#${gid}-clip)`}>
            {foldSides.map((s) => {
              const horiz = s === 'left' || s === 'right'
              const x = s === 'left' ? -SP : W + SP - CR
              const y = s === 'top' ? -SP : L + SP - CR
              // 回り込む角の手前で止める。その先は、角の帯が続きを描く
              const trim = foldShape && s === curlSide ? foldShape.R : 0
              return (
                <rect
                  key={`sp-${s}`}
                  x={horiz ? x : -SP}
                  y={horiz ? -SP : y}
                  width={horiz ? CR : W + SP * 2 - trim}
                  height={horiz ? L + SP * 2 - trim : CR}
                  fill={`url(#${gid}-sp-${s})`}
                />
              )
            })}

            {/*
              裁ち端の側では、山がそのまま向こうへ回り込む（依頼者の指示・2026-08-27）。
              まっすぐな帯が角で止まっていると、丸い縁がそこで切り落とされたように見えて、
              「折り返っている」ことが伝わらない。角では帯を回し、
              曲がった先で消していく
            */}
            {foldShape && (
              <>
                <g clipPath={`url(#${gid}-curlclip)`}>
                  <rect
                    x={foldShape.quad.x} y={foldShape.quad.y}
                    width={foldShape.quad.w} height={foldShape.quad.h}
                    fill={`url(#${gid}-sp-corner)`}
                  />
                </g>
                <g mask={`url(#${gid}-bandfade)`}>
                  <rect
                    x={foldShape.band.x} y={foldShape.band.y}
                    width={foldShape.band.w} height={foldShape.band.h}
                    fill={`url(#${gid}-sp-${foldShape.band.side})`}
                  />
                </g>
              </>
            )}
          </g>

          {/*
            端の描き分け。折り山・耳・裁ち端は実物ではまったく別のものなので、
            裁ち合わせ図の昔からの描き方に合わせて、線の見た目も変えておく。
            折り山＝なめらかな山、耳＝くし歯、裁ち端＝波線
          */}
          {selvages.map((s) => (
            <g key={`sv-band-${s}`}>
              {/* 上の一枚のみみ */}
              {selvageBand(s === 'left' ? 0 : W, s === 'left' ? 1 : -1)}
              {/*
                下からのぞいている一枚のみみ。点々が2列あること＝布が2枚あること。
                のぞいている側にだけ描く。横わのときは下の一枚が横へは出ないので、
                ここで描くと生地の外に点々だけが浮いてしまう
              */}
              {hasUnder && (s === 'left' ? under.x0 < -0.5 : under.x1 > W + 0.5) &&
                selvageBand(s === 'left' ? under.x0 : under.x1, s === 'left' ? 1 : -1)}
            </g>
          ))}
          {/* 裁ち端の名前。はさみの印を添える */}
          {cutTop && (
            <g>
              {iconScissors(Math.max(W, under.x1) - W * 0.026, -SP - W * 0.036, W * 0.042, '#8a9188')}
              <text x={Math.max(W, under.x1) - W * 0.072} y={-SP - W * 0.036}
                fontSize={W * 0.03} fill="#8a9188" textAnchor="end"
                dominantBaseline="middle">裁ち端</text>
            </g>
          )}

          {/* 折り返して上に乗っているぶん。面の一部だけを覆うときは、端に影を落とす */}
          {flaps.filter((f) => !f.full).map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            // 影は、折り返した生地の「端」から、下の一枚のほうへ伸びる
            const sx = f.side === 'left' ? f.w : f.side === 'right' ? W - f.w - shade : 0
            const sy = f.side === 'top' ? f.h : f.side === 'bottom' ? L - f.h - shade : 0
            const flip = f.side === 'right' || f.side === 'bottom'
            return (
              <g key={f.side}>
                <rect x={f.x} y={f.y} width={f.w} height={f.h} fill={CLOTH_FOLDED}
                  fillOpacity={0.85} />
                <rect
                  x={horiz ? sx : 0}
                  y={horiz ? 0 : sy}
                  width={horiz ? shade : W}
                  height={horiz ? L : shade}
                  fill={`url(#${gid}-${horiz ? 'h' : 'v'})`}
                  transform={
                    flip
                      ? horiz
                        ? `rotate(180 ${sx + shade / 2} ${L / 2})`
                        : `rotate(180 ${W / 2} ${sy + shade / 2})`
                      : undefined
                  }
                />
                {/*
                  折り返した生地の端。ここから先は一重に戻る。
                  縦の折りならこの端は「もとのみみ」なのでピン穴で、
                  横の折りなら「もとの裁ち端」なので波線で描く
                */}
                {horiz ? (
                  <g>
                    <line x1={f.side === 'left' ? f.w : W - f.w} y1={0}
                      x2={f.side === 'left' ? f.w : W - f.w} y2={L}
                      stroke="#b8b6a4" strokeWidth={W * 0.004} />
                    {selvageBand(f.side === 'left' ? f.w : W - f.w, f.side === 'left' ? -1 : 1)}
                  </g>
                ) : (
                  <path
                    d={`M0 ${(f.side === 'top' ? f.h : L - f.h).toFixed(1)}`
                      + waveSeg(0, W, f.side === 'top' ? f.h : L - f.h)}
                    stroke="#b8b6a4" strokeWidth={W * 0.005} fill="none"
                  />
                )}
              </g>
            )
          })}

          {report.boxes.map((box) => {
            const p = state.placements.find((q) => q.id === box.placementId)
            const part = p ? partMap.get(p.partId) : null
            if (!p || !part) return null
            // 縫い代の画面と同じ描き分け。縫い代の重なり具合を見ながら置けるように
            const { cut, finished } = orientedPair(part, p)
            const bad = badPlacements.has(p.id)
            const on = selectedId === p.id
            const twice = countOf(p.id) === 2
            const stored = state.parts.find((x) => x.id === p.partId)
            const reserve = stored ? isReserve(stored) : false
            if (reserve) {
              return (
                <g
                  key={p.id}
                  transform={`translate(${box.x} ${box.y})`}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startDrag(e, p)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                >
                  {(on || bad) && (
                    <polygon
                      points={pts(cut)} fill="none"
                      stroke={bad ? '#b4433a' : '#35664e'}
                      strokeWidth={W * 0.022} strokeOpacity={0.45} strokeLinejoin="round"
                    />
                  )}
                  {/*
                    型紙とはっきり見分ける。斜線＋破線で「まだ裁たない場所」を表す。
                    実線の枠にすると、置いた型紙と同じに見えて数え違えるおそれがある
                  */}
                  <polygon points={pts(cut)} fill={`url(#${gid}-hold)`} />
                  <polygon
                    points={pts(cut)} fill="none"
                    stroke="#8a7f5c" strokeWidth={W * 0.007}
                    strokeDasharray={`${W * 0.022} ${W * 0.016}`} strokeLinejoin="round"
                  />
                  <text
                    x={box.w * 0.5} y={box.h * 0.5 - W * 0.018}
                    fontSize={Math.min(W * 0.042, box.w * 0.17)} fontWeight={700} fill="#6d6448"
                    textAnchor="middle" dominantBaseline="middle"
                    stroke="#ffffff" strokeWidth={W * 0.012} paintOrder="stroke"
                  >
                    {stored?.name}
                  </text>
                  <text
                    x={box.w * 0.5} y={box.h * 0.5 + W * 0.03}
                    fontSize={Math.min(W * 0.03, box.w * 0.12)} fill="#8a7f5c"
                    textAnchor="middle" dominantBaseline="middle"
                    stroke="#ffffff" strokeWidth={W * 0.012} paintOrder="stroke"
                  >
                    あとで裁つ
                  </text>
                </g>
              )
            }
            return (
              <g
                key={p.id}
                transform={`translate(${box.x} ${box.y})`}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => startDrag(e, p)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
              >
                {/*
                  選んでいる印は、縫い代の外側にもう一回り描く。
                  縫い代の線そのものを緑にすると、青い帯＝縫い代 という約束が崩れる
                */}
                {(on || bad) && (
                  <polygon
                    points={pts(cut)}
                    fill="none"
                    stroke={bad ? '#b4433a' : '#35664e'}
                    strokeWidth={W * 0.022}
                    strokeOpacity={0.45}
                    strokeLinejoin="round"
                  />
                )}
                {/* 足した縫い代のぶん。透かして、隣と重なっていないか見えるようにする */}
                <polygon
                  points={pts(cut)}
                  fill="#3f6fa8"
                  fillOpacity={0.28}
                  stroke="#3f6fa8"
                  strokeWidth={W * 0.005}
                  strokeLinejoin="round"
                />
                {/*
                  もとの型紙（出来上がり線）。
                  裏返して置いたものは、紙の裏を上に向けている状態なので、
                  白い表ではなく、うっすら斜線の入った裏の色で描く（依頼者の指示・2026-08-27）
                */}
                <polygon
                  points={pts(finished)}
                  fill={p.mirrored ? `url(#${gid}-back)` : '#FAF7F0'}
                  fillOpacity={p.mirrored ? 1 : 0.94}
                  stroke="#2b332d"
                  strokeWidth={W * 0.005}
                  strokeLinejoin="round"
                />
                <PatternMarks
                  poly={finished}
                  hasNap={state.hasNap}
                  name={state.parts.find((x) => x.id === p.partId)?.name}
                  direction={p.rot90 ? 'h' : 'v'}
                  fontScale={0.1}
                  paper={p.mirrored ? '#e9e7e0' : undefined}
                />
                {/* 裏返してあることを、絵と言葉の両方で言う。形だけでは気づけない */}
                {p.mirrored && box.w > W * 0.22 && box.h > W * 0.12 && (
                  <g>
                    {iconFlip(box.w * 0.5 - W * 0.075, W * 0.055, W * 0.044, '#5c665f')}
                    <text
                      x={box.w * 0.5 + W * 0.012} y={W * 0.055}
                      fontSize={W * 0.036} fontWeight={700} fill="#5c665f"
                      textAnchor="middle" dominantBaseline="middle"
                      stroke="#e9e7e0" strokeWidth={W * 0.012} paintOrder="stroke"
                    >
                      裏返し
                    </text>
                  </g>
                )}
                {/* 二重のところに置いた型紙は、1つで2枚とれる */}
                {twice && (
                  <g>
                    <circle cx={box.w * 0.5} cy={box.h - W * 0.055} r={W * 0.042} fill={CREASE} />
                    <text x={box.w * 0.5} y={box.h - W * 0.055} fontSize={W * 0.044}
                      fontWeight={700} fill="#ffffff" textAnchor="middle" dominantBaseline="middle">
                      ×2
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* 二重の印しもパーツの上に出す。先に描くと型紙の下に隠れてしまう */}
          {flaps.map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            /*
              ただ「二重」とだけ書くと、置いた型紙が2枚という意味に読めてしまう
              （依頼者から実際にそう質問された・2026-08-27）。
              数えているのは布の枚数なので、主語を書いておく。
              帯が細くて文字がはみ出すときだけ短いほうにする
            */
            const label = longLayerLabels
              ? (f.full ? '生地がぜんぶ二重' : '生地が二重') : '二重'
            const tx = horiz ? (f.side === 'left' ? f.w / 2 : W - f.w / 2) : W * 0.5
            const ty = horiz ? L * 0.045 : f.side === 'top' ? f.h / 2 : L - f.h / 2
            return (
              <g key={`t-${f.side}`}>
                {iconLayers(tx - label.length * W * 0.021 - W * 0.038, ty, W * 0.046, 2, CREASE, true)}
                <text
                  x={tx} y={ty}
                  fontSize={W * 0.04} fontWeight={700} fill={CREASE}
                  textAnchor="middle" dominantBaseline="middle"
                  stroke="#ffffff" strokeWidth={W * 0.013} paintOrder="stroke"
                >
                  {label}
                </text>
              </g>
            )
          })}

          {/* 一重のところにも印しを。二重との対比で、意味がはっきりする */}
          {flaps.length > 0 && !flaps.some((f) => f.full) && (() => {
            const vert = flaps.some((f) => f.side === 'left' || f.side === 'right')
            const tx = vert ? (depth.left + (W - depth.right)) / 2 : W * 0.5
            const ty = vert ? L * 0.045 : (depth.top + (L - depth.bottom)) / 2
            const room = vert ? W - depth.left - depth.right : L - depth.top - depth.bottom
            if (room < (vert ? W : L) * 0.3) return null
            // 二重の帯と同じ書き方にする。片方だけ主語が付いていると、違うものに見える
            const label = longLayerLabels ? '生地が一重' : '一重'
            return (
              <g>
                {iconLayers(tx - label.length * W * 0.019 - W * 0.04, ty, W * 0.046, 1, '#7d867e', true)}
                <text x={tx} y={ty} fontSize={W * 0.036} fontWeight={600} fill="#7d867e"
                  textAnchor="middle" dominantBaseline="middle"
                  stroke="#ffffff" strokeWidth={W * 0.012} paintOrder="stroke">{label}</text>
              </g>
            )
          })()}

          {/*
            みみの名前。回転させた横書きは読みづらいので縦書きにし、
            上に「布が何枚重なっているか」のピクトグラムを添える。
            横棒2本＝二重（断面図と同じ見方）。「（2枚）」と文字で書くより伝わる
          */}
          {selvages.map((s) => {
            const x = s === 'left'
              ? -(hasUnder ? RIM : 0) - PAD * 0.4
              : (hasUnder ? W + RIM : W) + PAD * 0.4
            const size = W * 0.036
            return (
              <g key={`sv-${s}`}>
                {iconLayers(x, L * 0.5 - size * 1.9, W * 0.052, hasUnder ? 2 : 1, '#8a9188')}
                <text x={x} y={L * 0.5 + size * 0.3} fontSize={size} fill="#8a9188"
                  textAnchor="middle">
                  <tspan x={x}>み</tspan>
                  <tspan x={x} dy={size * 1.05}>み</tspan>
                </text>
              </g>
            )
          })}

          {/*
            折り山の頂きをなぞる線と、その名前。パーツより後ろに描く。
            わ の辺を当てたパーツが折り山の真上に来るので、先に描くと隠れてしまう。
            名前は枠の外に置く。生地の上は型紙のためにあけておきたい
          */}
          {foldSides.map((side) => {
            const horiz = side === 'left' || side === 'right'
            // 山の頂き。角のまるみのぶんだけ手前で止める
            const r = SP * 1.6
            const apex = {
              left: [-SP, r, -SP, L - r], right: [W + SP, r, W + SP, L - r],
              top: [r, -SP, W - r, -SP], bottom: [r, L + SP, W - r, L + SP],
            }[side]
            const lx = {
              left: -SP - PAD * 0.42, right: W + SP + PAD * 0.42,
              top: W * 0.5, bottom: W * 0.5,
            }[side]
            const ly = {
              left: L * 0.5, right: L * 0.5,
              top: -SP - PAD * 0.36, bottom: L + SP + PAD * 0.36,
            }[side]
            return (
              <g key={side}>
                <line x1={apex[0]} y1={apex[1]} x2={apex[2]} y2={apex[3]}
                  stroke={CREASE} strokeWidth={W * 0.007} strokeLinecap="round" />
                {/* 裁ち端の側では、山がそのまま向こうへ回り込む。そこまで線でなぞる */}
                {foldShape && side === curlSide && (
                  <path d={foldShape.crease} fill="none" stroke={`url(#${gid}-curl)`}
                    strokeWidth={W * 0.007} strokeLinecap="round" />
                )}
                {horiz ? (
                  <g>
                    {iconFold(lx, ly - W * 0.105, W * 0.056, side, CREASE)}
                    <text x={lx} y={ly - W * 0.032} fontSize={W * 0.052} fontWeight={700}
                      fill={CREASE} textAnchor="middle" dominantBaseline="middle">わ</text>
                    <text x={lx} y={ly + W * 0.038} fontSize={W * 0.029} fill={CREASE}
                      textAnchor="middle">
                      {[...'折り山'].map((c, i) => (
                        <tspan key={i} x={lx} dy={i === 0 ? 0 : W * 0.033}>{c}</tspan>
                      ))}
                    </text>
                  </g>
                ) : (
                  <g>
                    {iconFold(lx - W * 0.105, ly, W * 0.056, side, CREASE)}
                    <text x={lx + W * 0.02} y={ly} fontSize={W * 0.042} fontWeight={700}
                      fill={CREASE} textAnchor="middle" dominantBaseline="middle">
                      わ（折り山）
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* いま使っているところの終わり。ここまでが買う長さに効く */}
          {used > 0 && used < L && (
            <g>
              <rect x={0} y={used} width={W} height={L - used} fill="#f4f5f1" fillOpacity={0.85} />
              <line x1={0} y1={used} x2={W} y2={used}
                stroke="#9aa69e" strokeWidth={W * 0.005}
                strokeDasharray={`${W * 0.03} ${W * 0.02}`} />
              <text x={W * 0.5} y={used + L * 0.035} fontSize={W * 0.038}
                fill="#5c665f" textAnchor="middle">
                ここまで {(used / 10).toFixed(0)} cm
              </text>
            </g>
          )}
        </svg>

        {/*
          絵の下に長い説明を積むと、読む前に手が止まる（依頼者・2026-08-27）。
          ひと言だけ出して、折り方のこまかい話は「？」の中に畳んでおく
        */}
        <div className="px-3 pb-1">
        <Hint
          icon="fold"
          summary={half
            ? <>見えている面は<b className="text-mat-600">ぜんぶ二重</b>。型紙1つで2枚とれます</>
            : flaps.length > 0
              ? <>濃いところが<b className="text-mat-600">二重</b>、白いところが一重です</>
              : <>折らずに<b className="text-ink-700">一重</b>で使っています</>}
        >
          {half && section.fold === 'vBoth' ? (
            <>
              生地幅 {(report.foldDepth.left * 4 + SELVAGE_MM * 2) / 10} cm を、
              両側のみみが中央で出会うまで折っています。
              折り山が左右に1本ずつあるので、「わ」の辺を持つ型紙を、左右どちらにも当てられます。
            </>
          ) : half ? (
            <>
              生地幅 {(report.foldDepth.left * 2 + SELVAGE_MM * 2) / 10} cm を、きっちり半分に折っています。
              折り山の反対の端にはみみが2枚重なっていて、下の一枚が少しのぞいています。
            </>
          ) : flaps.length > 0 ? (
            <>
              「わに当てる」を使った型紙の幅のぶんだけ、生地を折り返しています。
              折り返したところに置いた型紙は、1つで2枚とれます。
            </>
          ) : (
            <>「わに当てる」を使った型紙を置くと、その幅のぶんだけ生地を折り返します。</>
          )}
        </Hint>
        </div>
      </div>

      {/*
        「いちばん長い型紙より生地が長いのはなぜか」と聞かれた（依頼者・2026-08-27）。
        長さは型紙の丈ではなく、いちばん下まで届いた型紙の「下端の位置」で決まる
      */}
      {report.boxes.length > 0 && (
        <Hint
          icon="yardage"
          summary={<>長さ <b className="text-ink-700">{(used / 10).toFixed(0)} cm</b> ＝ いちばん下の型紙の、下の端まで</>}
        >
          型紙の丈ではありません。上に空きがあるぶんもそのまま長さになるので、
          すき間を詰めて上へ寄せるほど短くなります。
        </Hint>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- パーツ置き場 */

function Tray({
  state, takenOf, shortage, onPlace, onAddReserve, onDropPart,
}: {
  state: PartsState
  takenOf: (partId: string) => number
  shortage: { id: string }[]
  onPlace: (partId: string) => void
  onAddReserve: (name: string, widthMm: number, heightMm: number) => void
  onDropPart: (partId: string) => void
}) {
  const row = (p: StoredPart) => {
    const taken = takenOf(p.id)
    const done = taken >= p.needed
    const reserve = isReserve(p)
    return (
      <li
        key={p.id}
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
          reserve ? 'border-dashed border-hold-400 bg-hold-50' : 'border-ink-100 bg-white'
        }`}
      >
        <Icon
          name={reserve ? 'hold' : 'part'}
          className={`h-4 w-4 shrink-0 ${reserve ? 'text-hold-600' : 'text-mat-600'}`}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">
          {p.name}
          {reserve && (
            <span className="ml-1.5 tnum text-xs font-normal text-hold-600">
              {(p.widthMm / 10).toFixed(0)} × {(p.heightMm / 10).toFixed(0)} cm
            </span>
          )}
        </span>
        {reserve ? (
          <button
            type="button"
            onClick={() => onDropPart(p.id)}
            aria-label={`${p.name}の余白を消す`}
            className="rounded-lg border border-ink-100 bg-white p-1.5 text-ink-500"
          >
            <Icon name="trash" className="h-4 w-4" />
          </button>
        ) : (
          <span className={`tnum text-xs ${done ? 'text-mat-600' : 'text-seam'}`}>
            {taken} / {p.needed} 枚
          </span>
        )}
        <button
          type="button"
          onClick={() => onPlace(p.id)}
          className="rounded-lg bg-mat-500 px-3 py-1.5 text-sm font-bold text-white active:bg-mat-600"
        >
          置く
        </button>
      </li>
    )
  }

  const patterns = state.parts.filter((p) => !isReserve(p))
  const reserves = state.parts.filter(isReserve)

  return (
    <div data-tour="tray" className="flex flex-col gap-2">
      <Heading icon="part">置くパーツ</Heading>
      <ul className="flex flex-col gap-2">{patterns.map(row)}</ul>
      {shortage.length > 0 && (
        <Hint summary={<>数えているのは<b className="text-ink-700">できあがりの枚数</b></>}>
          二重のところに置いた型紙は1つで2枚（型紙に ×2 と出ます）。
          折り山に当てたパーツは、開いて左右対称の1枚です。
        </Hint>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <Heading icon="hold">後で裁つぶんの余白</Heading>
        {reserves.length > 0 && <ul className="flex flex-col gap-2">{reserves.map(row)}</ul>}
        <ReserveAdder onAdd={onAddReserve} />
      </div>
    </div>
  )
}

/* ------------------------------------------------- 後で裁つぶんの余白を足す */

/**
 * ベルトや見返しのように、仮縫いのあとに裁つものの場所を空けておく（依頼者の指示）。
 *
 * 型紙をきちんと置く必要はない。
 * 「このくらいの長方形を空けたまま、ほかを裁つ」ができればよい。
 * だから形は取らず、裁ち切りの寸法だけを入れてもらう。
 */
function ReserveAdder({
  onAdd,
}: {
  onAdd: (name: string, widthMm: number, heightMm: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(RESERVE_CHOICES[0])
  const [widthCm, setWidthCm] = useState('9')
  const [heightCm, setHeightCm] = useState('72')

  const w = Number(widthCm)
  const h = Number(heightCm)
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-hold-400 bg-hold-50 px-4 py-2 text-sm font-bold text-hold-700"
      >
        <Icon name="plus" className="h-4 w-4 shrink-0" />
        <Icon name="hold" className="h-4 w-4 shrink-0" />
        余白を空けておく
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-hold-400 bg-hold-50 px-4 py-3">
      <Hint icon="hold" summary={<>いまは裁たずに<b className="text-ink-700">場所だけ空けておきます</b></>}>
        仮縫いのあとで寸法が変わるものは、ここで大きさだけ決めておきます。
        ベルトなら「ベルト幅×2＋縫い代」の幅で、「ウエスト寸法＋縫い代」以上の長さ。
        きっちりでなくてかまいません。
      </Hint>

      <div className="flex flex-wrap gap-1.5">
        {RESERVE_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setName(c)}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
              name === c
                ? 'bg-hold-600 text-white'
                : 'border border-hold-400 bg-white text-hold-700'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold text-ink-500">
          幅（cm）
          <input
            type="number" inputMode="decimal" min="1" step="0.5"
            value={widthCm}
            onChange={(e) => setWidthCm(e.target.value)}
            className="tnum w-24 rounded-lg border border-ink-100 bg-white px-3 py-2 text-base font-bold text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-ink-500">
          丈（cm）
          <input
            type="number" inputMode="decimal" min="1" step="0.5"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="tnum w-24 rounded-lg border border-ink-100 bg-white px-3 py-2 text-base font-bold text-ink-900"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ok}
          onClick={() => {
            onAdd(name, Math.round(w * 10), Math.round(h * 10))
            setOpen(false)
          }}
          className="rounded-lg bg-hold-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          生地に置く
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-ink-100 bg-white px-4 py-2 text-sm font-bold text-ink-500"
        >
          やめる
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- 選んだパーツの操作 */

function Controls({
  placement, name, count, reserve, hasNap, foldSides, onPatch, onRemove, onClose,
}: {
  placement: Placement
  name: string
  count: number
  /** 後で裁つぶんの余白か。ただの長方形なので、選べることが少ない */
  reserve: boolean
  hasNap: boolean
  foldSides: Side[]
  onPatch: (over: Partial<Placement>) => void
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <div className="safe-b fixed inset-x-0 bottom-0 z-10 border-t border-ink-100 bg-white px-4 pt-3 shadow-[0_-6px_20px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-md flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-900">{name}</span>
          {reserve ? (
            <span className="rounded-md bg-hold-50 px-2 py-0.5 text-xs font-bold text-hold-700">
              あとで裁つぶん
            </span>
          ) : (
            <span className="tnum rounded-md bg-mat-50 px-2 py-0.5 text-xs font-bold text-mat-600">
              この1つで {count} 枚
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto flex items-center gap-1 px-2 text-xs text-seam"
          >
            <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
            生地から外す
          </button>
          <button type="button" onClick={onClose} className="px-2 text-xs text-ink-300">
            閉じる
          </button>
        </div>

        {/* 操作は全部、結果の形を絵にしてある。言葉より先に、どうなるかが見える */}
        <div className="flex flex-wrap gap-1.5">
          {!reserve && foldSides.map((s) => (
            <Chip
              key={s}
              on={placement.snapTo === s}
              onClick={() => onPatch({ snapTo: placement.snapTo === s ? null : s })}
            >
              <Icon name="fold" />
              わに当てる（{SIDE_LABELS[s]}）
            </Chip>
          ))}
          {!reserve && (
            <>
              <Chip
                on={placement.rot180}
                disabled={hasNap}
                onClick={() => onPatch({ rot180: !placement.rot180 })}
              >
                <Icon name="nest" />
                差し込む（180°）
              </Chip>
              <Chip
                on={placement.mirrored}
                onClick={() => onPatch({ mirrored: !placement.mirrored })}
              >
                <Icon name="mirror" />
                裏返す
              </Chip>
            </>
          )}
          <Chip on={placement.rot90} onClick={() => onPatch({ rot90: !placement.rot90 })}>
            <Icon name="grainSide" />
            横向き（地の目を変える）
          </Chip>
        </div>

        {reserve && (
          <Note icon="hold">
            これは型紙ではなく、<span className="font-bold text-ink-700">空けておく場所</span>です。
            仮縫いのあとで寸法が決まってから、ここを裁ちます。
          </Note>
        )}
        {!reserve && hasNap && (
          <Note icon="nap">向きのある生地なので、差し込み（180°）は使えません。</Note>
        )}
        {placement.rot90 && (
          <Note icon="warn" tone="warn">
            地の目を変えています。伸び方も落ち方も変わるので、ふつうはしません。
          </Note>
        )}
      </div>
    </div>
  )
}

function Chip({
  on, disabled, onClick, children,
}: {
  on: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
        disabled
          ? 'border border-ink-100 text-ink-300'
          : on
            ? 'bg-mat-500 text-white'
            : 'border border-ink-100 text-ink-700'
      }`}
    >
      {children}
    </button>
  )
}
