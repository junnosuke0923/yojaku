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
import { cutSizeOf, isReserve, RESERVE_CHOICES, toReserve } from '../lib/store'
import { cm } from '../lib/format'
import {
  canHalfFold, computeYardage, foldEdgeSides, FOLD_LABELS, FOLD_MARK_REF_MM, foldOfSides,
  foldSidesOf, turnBy, turnOf,
  isHalfFold, isHorizontalFold, isVerticalSide, newPlacement, orientedPair,
  PURCHASE_MARGIN_MM, SELVAGE_MM, SNAP_MM, toggleFoldSide,
  type Fabric, type FoldMark, type FoldMode, type PlacedPart, type Placement,
  type Section, type Side,
} from '../lib/fabric'
import { defaultName, MAX_SAVES, putSave, type Save } from '../lib/saves'
import { FoldPicker, type EdgeAction } from './FoldPicker'
import { placedPartOf, type PartsState, type StoredPart } from '../lib/store'
import { FoldDiagram } from './FoldDiagram'
import { Heading, Hint, Icon, Note } from './Icon'
import { PatternMarks } from './PatternMarks'
import { Tour } from './Tour'
import type { Point, Polygon } from '../lib/geom'

type Props = {
  state: PartsState
  /**
   * 2つめは「ひと続きの操作」の合図。
   * 同じ合図が続くあいだ、1つ戻るの控えは1回ぶんにまとめられる
   */
  onChange: (state: PartsState, group?: string) => void
  onBack: () => void
  /** しまうときの名前。開いたものを直したときは、その名前が入っている */
  saveName: string
  onSaveName: (name: string) => void
  /** しまい終わったら、一覧を持っている側へ知らせる */
  onSaved: (saves: Save[]) => void
}


/** 生地が空でも、置き場所が見えるように確保しておく長さ(mm) */
const MIN_VIEW_MM = 400

/**
 * 二本指でひろげられる上限。
 *
 * 6倍まで寄れば、110cm 幅の生地が電話の画面で 18cm ぶんになる。
 * 縫い代どうしの重なりを見ながら 1cm きざみで詰めるには、このくらい要る。
 * これ以上寄れても、どこを見ているのか分からなくなるだけ
 */
const MAX_ZOOM = 6

/** 上と下からはみ出さないように収める */
const clampTo = (v: number, lo: number, hi: number) =>
  hi <= lo ? lo : v < lo ? lo : v > hi ? hi : v

/** 引きずるたびに増える番号。ひと続きの動きに同じ合図を付けるためだけのもの */
let dragSeq = 0

/**
 * 出会い目をまたがせない。
 *
 * 両側から折って端どうしが出会うところは、面としては丈ごと二重でも、
 * **上になっている一枚がそこで切れている**。またいで裁つと、
 * 下の一枚からは1枚とれても、上の一枚は2つに割れて使えない。
 * だから注意書きで済ませず、**引きずっているあいだから越えられないようにする**
 * （依頼者の指示・2026-08-30「隙間が空いている部分の上には
 * 乗せられないようにしてください」）。
 *
 * またいだら、はみ出しの少ないほうの側へ寄せる。そちらに入らなければ反対側へ。
 * どちらにも入らない大きさのときだけ、そのままにして知らせに任せる
 * （黙って動かない型紙は、故障に見えるため）。
 *
 * @param v    置こうとしている位置（左端／上端）
 * @param size その向きの大きさ
 * @param meet 出会い目。出会っていなければ null
 * @param max  その向きに置ける終わり。長さの方向は伸ばして買えるので Infinity
 */
const keepOffMeet = (v: number, size: number, meet: number | null, max: number) => {
  if (meet === null || size <= 0) return v
  if (v + size <= meet + 0.01 || v >= meet - 0.01) return v
  const after = meet
  const before = meet - size
  const fitsAfter = after + size <= max + 0.01
  const fitsBefore = before >= -0.01
  const nearerAfter = meet - v < v + size - meet
  if (nearerAfter && fitsAfter) return after
  if (!nearerAfter && fitsBefore) return before
  if (fitsAfter) return after
  if (fitsBefore) return before
  return v
}

const SIDE_LABELS: Record<Side, string> = {
  left: '左', right: '右', top: '上', bottom: '下',
}

/** 生地の色。一重のところと、折り返して二重になっているところ */
const CLOTH = '#fdfcf8'
const CLOTH_FOLDED = '#efeee2'
const CREASE = '#35664e'

/**
 * みみの色。生地と同じように、**下になっている一枚のみみは少しだけ暗い**
 * （依頼者の指示・2026-08-30）。
 *
 * 生地の面は `CLOTH` と `CLOTH_FOLDED` で描き分けているのに、
 * みみだけ2枚とも同じ色だったため、どちらが上でどちらが下なのかが
 * みみのところで途切れていた。重なりの関係は、面でもみみでも同じように言う。
 */
const SELVAGE = { line: '#8d8a78', band: 0.1, dot: 0.55 }
const SELVAGE_UNDER = { line: '#6b6857', band: 0.14, dot: 0.62 }

export function LayoutView({ state, onChange, onBack, saveName, onSaveName, onSaved }: Props) {
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

  /**
   * 取り込んだ型紙が、実物の何センチとして入っているか（依頼者の指示・2026-08-31）。
   *
   * 定規の読み取りが少しでもずれていると、取り込んだ型紙は本物より大きいか小さいかになる。
   * それに気づかないまま並べても、出た要尺には意味がない。
   * 型紙の上に数字を出しっぱなしにはせず、選んだときの板の中でだけ確かめられるようにする。
   *
   * 型紙そのもの（出来上がり線）と、縫い代まで入れた裁ち切りを両方返す。
   * 実物に定規を当てて比べられるのは前者のほう。
   */
  const sizeOf = (partId: string) => {
    const part = state.parts.find((p) => p.id === partId)
    if (!part) return null
    return { w: part.widthMm, h: part.heightMm, cut: cutSizeOf(part) }
  }
  const selected = state.placements.find((p) => p.id === selectedId) ?? null

  /** この型紙1つで、生地から何枚とれるか。二重の上なら2枚 */
  const countOf = (placementId: string) =>
    report.counts.find((c) => c.placementId === placementId)?.count ?? 1

  /**
   * 回したあとの「わに当てる」先を付け直す（依頼者の指摘・2026-08-31）。
   *
   * どの折り山に当てられるかは「わ」の辺が向いている向きで決まるので、
   * 型紙を回せば当然変わる。ところが当てた先だけが古いまま残っていたので、
   * **「わ」が右を向いているのに左の折り山に当たっている**という、
   * 実物では起こりえない図が描かれていた。
   *
   * 回したあとに向きが合わなくなったら、合う折り山へ付け替える。
   * 合う折り山がひとつも無ければ外す。そのときは
   * 「折り山に当ててください」が出るので、置き直す入口になる
   */
  const resnap = (p: Placement): Placement => {
    if (!p.snapTo) return p
    const sides = foldSidesOf(
      state.sections.find((sc) => sc.id === p.sectionId)?.fold ?? 'none',
    )
    const fit = snapTargetsOf(partMap.get(p.partId), { ...p, snapTo: null }, sides)
    return fit.includes(p.snapTo) ? p : { ...p, snapTo: fit[0] ?? null }
  }

  const patch = (id: string, over: Partial<Placement>, group?: string) =>
    onChange({
      ...state,
      placements: state.placements.map((p) => (p.id === id ? resnap({ ...p, ...over }) : p)),
    }, group)

  const place = (partId: string) => {
    const id = `pl${state.placements.length}_${partId}`
    /*
      「わ」の辺を持つ型紙は、置いた瞬間から折り山に当てておく
      （依頼者の指摘・2026-08-31）。置いただけの状態は左上（＝縦わなら折り山そのもの）
      なので、見た目は当たっているのに「折り山に当ててください」と出ていた。
      当てる先が無いとき（まだ折っていない、向きが合わない）は当てない。
      そのときは、これまでどおり注意書きが出て、折り方を決める入口になる
    */
    const fresh = newPlacement(id, partId, activeSection)
    const part = partMap.get(partId)
    const sides = foldSidesOf(
      state.sections.find((sc) => sc.id === activeSection)?.fold ?? 'none',
    )
    const snapTo = part
      ? foldEdgeSides(part, fresh).find((sd) => sides.includes(sd)) ?? null
      : null
    onChange({
      ...state,
      placements: [...state.placements, { ...fresh, snapTo }],
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
          onFold={(fold, halfFold) => {
            /*
              折り山を移したら、そこに当てていた型紙も付け替える
              （依頼者の指示・2026-08-28）。実物でも、折る側を変えたら
              型紙はその折り山に当て直す。

              左から右へ移す手つきは「右を押して両側にし、左を押して外す」。
              その2手目で左の折り山が消えるので、そこに当てていた型紙を
              残っている右の折り山へ移す。付け替えないと
              「その側に折り山がありません」が出て、置き直しからやり直しになる。

              同じ向きの折り山がもう1本も残っていないとき（縦から横へ変えたときなど）は、
              当てる先が無いので当てるのをやめる。図の上では、
              押した辺と両立しない指定がその場で外れる、という同じ動きに見える
            */
            const to = foldSidesOf(fold)
            onChange({
              ...state,
              sections: state.sections.map((s) =>
                s.id === section.id
                  ? { ...s, fold, ...(halfFold === undefined ? {} : { halfFold }) }
                  : s,
              ),
              placements: state.placements.map((pl) => {
                if (pl.sectionId !== section.id) return pl
                const was = pl.snapTo
                if (was && to.includes(was)) return pl
                /*
                  まだどこにも当てていない「わ」つきの型紙は、
                  折り山ができた時点で当てる（依頼者の指摘・2026-08-31）。
                  「置く → 折り方を決める」の順で触ると、
                  折り方を決めたのに「折り山に当ててください」が出たままになり、
                  結局ボタンを押しに行くことになっていた
                */
                if (!was) {
                  const part = partMap.get(pl.partId)
                  const want = part
                    ? foldEdgeSides(part, pl).find((sd) => to.includes(sd)) ?? null
                    : null
                  return want ? { ...pl, snapTo: want } : pl
                }
                const same = to.filter((t) => isVerticalSide(t) === isVerticalSide(was))
                return { ...pl, snapTo: same.length === 1 ? same[0] : null }
              }),
            })
          }}
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

      {/*
        出た見積もりを、名前を付けてしまっておく（依頼者の指示・2026-08-28）。
        結果のすぐ下に置く。数字を見たその場でしまえないと、
        わざわざ探しに行くことになって、結局しまわなくなる
      */}
      <SaveBox
        report={report}
        state={state}
        name={saveName}
        onName={onSaveName}
        onSaved={onSaved}
      />

      {selected && (
        <Controls
          key={selected.id}
          placement={selected}
          name={nameOf(selected.partId)}
          size={sizeOf(selected.partId)}
          count={countOf(selected.id)}
          reserve={isReserve(state.parts.find((p) => p.id === selected.partId) ?? ({} as StoredPart))}
          hasNap={state.hasNap}
          snapTargets={snapTargetsOf(
            partMap.get(selected.partId),
            selected,
            foldSidesOf(state.sections.find((s) => s.id === selected.sectionId)?.fold ?? 'none'),
          )}
          onPatch={(over) => patch(selected.id, over)}
          onRemove={() => remove(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}

/**
 * 地の目線を脇へどける量（依頼者の質問・2026-08-28）。
 *
 * 「わ」で開いた型紙には、真ん中に一点鎖線の中心線が通る。
 * 地の目線もふつうは真ん中なので、2本が平行だとぴったり重なって読めなくなる。
 * 平行なときだけ、型紙の幅（横の地の目なら丈）の 2 割ほど脇へどける。
 * 直角に交わるときは、線が1点で交わるだけなので、どけなくてよい。
 */
function grainShiftOf(
  center: { a: Point; b: Point } | null, rot90: boolean, w: number, h: number,
): number {
  if (!center) return 0
  const centerVertical = Math.abs(center.b.x - center.a.x) < Math.abs(center.b.y - center.a.y)
  const grainVertical = !rot90
  if (centerVertical !== grainVertical) return 0
  return (grainVertical ? w : h) * 0.2
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
      {/*
        この数字が概算であること（依頼者の指示・2026-08-28）。
        **結果の真下**に置く。ここを離すと、数字だけを書き写して
        そのぶんきっかり買いに行く人が出る。
        ひと言だけ出して、理由は「？」の中に畳んでおく
      */}
      <div className="pt-0.5">
        <Hint icon="warn" summary={<>この数字は<b className="text-ink-700">概算</b>です</>}>
          型紙の形は写真から読み取っているので、実物とは数ミリの差が出ます。
          地直しの縮み、柄合わせ、裁つときのくせでも変わります。
          買う長さの目安として使って、心配なときは少し多めに見てください。
        </Hint>
      </div>
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

/* --------------------------------------------------------- しまっておく */

/**
 * 出した見積もりに名前を付けて、この端末の中にしまう（依頼者の指示・2026-08-28）。
 *
 * 同じ名前でしまうと書きかわる。「新しくしまう」「上書きする」を
 * 別のボタンに分けるより、**同じ名前＝同じもの**と読めるほうが迷わない。
 * 開いたものを直してもう一度しまうと、名前がそのまま入っているので上書きになる。
 *
 * 何も並べていないうちは出さない。しまう中身がまだ無いため。
 */
function SaveBox({
  report, state, name, onName, onSaved,
}: {
  report: ReturnType<typeof computeYardage>
  state: PartsState
  name: string
  onName: (name: string) => void
  onSaved: (saves: Save[]) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const [bad, setBad] = useState(false)

  if (report.purchaseMm <= 0) return null

  const doSave = () => {
    const label = name.trim() || defaultName()
    const r = putSave(
      label,
      {
        purchaseMm: report.purchaseMm,
        totalMm: report.totalMm,
        fabricWidthMm: state.fabricWidthMm,
        partCount: state.parts.length,
        placementCount: state.placements.length,
      },
      state,
    )
    if (!r.ok) {
      setBad(true)
      setNote(
        r.reason === 'full'
          ? `しまえるのは ${MAX_SAVES} 件までです。最初の画面で、いらないものを消してください`
          : '端末の置き場所がいっぱいです。最初の画面で、いらないものを消してください',
      )
      return
    }
    setBad(false)
    onName(label)
    onSaved(r.saves)
    setNote(
      r.overwrote
        ? `「${label}」を書きかえました`
        : `「${label}」にしまいました。次に開いたとき、最初の画面から呼び出せます`,
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon name="save" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="shrink-0 text-sm font-bold text-ink-700">しまっておく</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => { onName(e.target.value); setNote(null) }}
          placeholder={defaultName()}
          aria-label="しまう名前"
          className="min-w-0 flex-1 rounded-lg border border-ink-100 px-3 py-2 text-base"
        />
        <button
          type="button"
          onClick={doSave}
          className="shrink-0 rounded-lg bg-mat-500 px-4 py-2 text-sm font-bold text-white active:bg-mat-600"
        >
          しまう
        </button>
      </div>
      {note && <Note icon={bad ? 'warn' : 'check'} tone={bad ? 'warn' : 'good'}>{note}</Note>}
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
  /** 折り方を変える。「きっちり折るか」も同時に決まるときは、いっしょに渡す */
  onFold: (fold: FoldMode, halfFold?: boolean) => void
  onHalf: (halfFold: boolean) => void
  onDrop: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<
    {
      id: string; x0: number; y0: number; px: number; py: number
      w: number; h: number; group: string
      /** この型紙の「わ」の辺が向いていて、なおかつこの区間に実在する折り山 */
      targets: Side[]
      /** つかんだ時点での下端の折り山の位置(mm)。引きずっているあいだ動かさない */
      bottomY: number
    } | null
  >(null)
  /** 辺を引きずっている最中に出す、いま何をしているのかのひと言 */
  const [hint, setHint] = useState<string | null>(null)

  /*
    二本指でひろげる・つまむ ための覚え書き（使うのはずっと下の節）。
    React の決まりで、途中で帰る `return` より先に置いておく必要があるため、
    ここだけ離れたところに書いてある
  */
  /** いまの倍率と、見ている窓の左上 */
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 })
  /** いま触れている指の位置。二本目が来たら、型紙を動かすのをやめてつまむほうへ移る */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  /** つまみはじめの指の間隔・倍率・つまんだ点 */
  const pinch = useRef<{ d0: number; k0: number; ox: number; oy: number } | null>(null)
  /** 型紙ではないところをつかんで、図をずらしているとき */
  const pan = useRef<{ px: number; py: number; zx: number; zy: number } | null>(null)

  if (!report) return null

  const W = Math.max(report.surfaceWidthMm, 1)
  /** 実際に使っている長さ。ここから下は、まだ使っていない生地 */
  const used = report.surfaceLengthMm
  /**
   * 図に描く生地の長さ。
   *
   * ふだんは、まだ何も置いていなくても生地に見えるように、少しだけ長めに描く。
   * ただし**下の辺が折り山になっているときは、使っている長さがそのまま生地の下端**。
   * 折り山は「そこで生地が折り返っている場所」なので、その先に生地は無い。
   * 長めに描くと、下の折り山に当てたはずの型紙が折り山から離れて浮いて見えてしまう
   */
  const L = report.foldDepth.bottom > 0 ? used : Math.max(used, MIN_VIEW_MM)
  const foldSides = foldSidesOf(section.fold)
  const half = isHalfFold(section)
  /**
   * 折り山へ吸い付く範囲(mm)。
   *
   * 指はきざみ（1cm）より太いので、置きたいところにぴったり止めるのは難しい。
   * 生地幅にひもづけてあるのは、細い生地でも太い生地でも
   * **画面の上で同じ幅**に見えるようにするため。1cm きざみの5つぶんほど。
   */
  const GRAB_MM = Math.max(SNAP_MM * 3, W * 0.05)
  /**
   * 折り込む深さ。ふだんは計算結果をそのまま使う。
   *
   * 横わをきっちり半分に折るときだけ、図のうえで手を入れる。
   * このときの深さは「面の長さ」そのものだが、まだ何も置いていないと長さが 0 で、
   * 折ったはずの図が一重のまま出てしまう。空の生地にも折り目が要るので、
   * 図に描いてある高さ（`L`）を折った形で見せる。計算にはいっさい効かない
   */
  const depth: Record<Side, number> = (() => {
    const d = report.foldDepth
    if (!half || !isHorizontalFold(section.fold)) return d
    // 両端が出会うまで折るときの深さは、当てた型紙で決まる。
    // 半分ずつに割って描いてよいのは、まだ何も当てていないときだけ
    if (section.fold === 'hBoth') {
      return d.top + d.bottom > 0.5 ? d : { ...d, top: L / 2, bottom: L / 2 }
    }
    if (section.fold === 'hBottom') return { ...d, bottom: L }
    return { ...d, top: L }
  })()
  /** 折り返した端に落とす影の幅。生地幅に対する割合で決める */
  const shade = W * 0.025
  /** 下になっている一枚が、耳の側からのぞく量 */
  const RIM = W * 0.045
  /** 枠の外に取る余白。ふくらんだ折り山と、端の名前を書くぶん */
  const PAD = W * 0.115
  /** 折り山の内側にできる翳りの幅 */
  const CR = W * 0.06
  /** みみの帯の幅 */
  const SEL_BW = W * 0.022

  /** 折り山ではない縦の端＝耳。二重なら耳も2枚ぶんある */
  const selvages: Side[] = (['left', 'right'] as Side[]).filter((s) => !foldSides.includes(s))
  /**
   * 生地の外形の左右。**型紙を置ける面 `[0, W]` の外側に、みみのぶんを足す**
   * （依頼者の指示・2026-08-30「耳は裁断の時に使わないので、
   * 耳の上にはパターンは乗らないでください」）。
   *
   * 計算のうえでは、生地幅からみみを引いたものが置ける幅（`usableWidthMm`）で、
   * 図の `W` はその置ける幅そのもの。それなのに、みみの帯を `[0, W]` の内側へ
   * 描いていたため、端に寄せた型紙がみみの上に乗っているように見えていた。
   * みみを面の外へ出すと、図に描いてある生地がちょうど生地幅ぜんぶになり、
   * 「みみは使わない」ことが絵のうえでも本当になる。
   *
   * 折り山の側にみみは無いので、そちらへは足さない。
   */
  const bx0 = selvages.includes('left') ? -SEL_BW : 0
  const bx1 = selvages.includes('right') ? W + SEL_BW : W
  const bodyW = bx1 - bx0
  /** 生地の左右の真ん中。図の上の文字はここへそろえる */
  const bxMid = (bx0 + bx1) * 0.5
  const badPlacements = new Set(
    report.problems.flatMap((p) => (p.placementId ? [p.placementId] : [])),
  )
  /**
   * 辺をさわり終えたときの処理（依頼者の指示・2026-08-28）。
   *
   * 押しただけなら「わ」が付いたり外れたりするだけ。
   * 内側へ引きずったときは、引いた深さで「きっちり折るか」まで決まる。
   * 半分の位置に吸い付くので、いちばん多いたたみ方はそこで止めれば出る。
   */
  const applyEdge = (side: Side, action: EdgeAction) => {
    if (action === 'toggle') { onFold(toggleFoldSide(section.fold, side)); return }
    if (action === 'off') {
      const left = new Set(foldSidesOf(section.fold))
      left.delete(side)
      onFold(foldOfSides(left))
      return
    }
    // まだ「わ」でなければ付ける。縦と横は両立しないので、通し方は押したときと同じ
    const next = foldSidesOf(section.fold).includes(side)
      ? section.fold
      : toggleFoldSide(section.fold, side)
    onFold(next, action === 'half')
  }

  /**
   * 大きい裁ち合わせ図の、端の札（「わ」「みみ」）も押せるようにする
   * （依頼者の指示・2026-08-28）。上の小さな図と同じことができる第二の入口。
   *
   * 札は生地の枠の外の余白にあり、型紙とは重ならないので、
   * 型紙を引きずるつもりの指が折り方を変えてしまう心配がない。
   * 生地の面そのものは押せるようにしていない。そこは型紙のための場所である。
   */
  const edgeTag = (
    side: Side, cx: number, cy: number, w: number, h: number, body: ReactNode,
  ) => (
    <g
      key={`tag-${side}`}
      role="button"
      tabIndex={0}
      aria-label={`${SIDE_LABELS[side]}の端を「わ」にする`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onActivate()
        onFold(toggleFoldSide(section.fold, side))
      }}
    >
      {/* 押せることが分かるだけの、ごく薄い下地 */}
      <rect
        x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={W * 0.02}
        fill="#ffffff" fillOpacity={0.5}
        stroke={CREASE} strokeOpacity={0.16} strokeWidth={W * 0.004}
      />
      {body}
    </g>
  )

  const gid = `fold-${section.id}`
  const vbW = bodyW + PAD * 2
  const vbH = L + PAD * 2

  /** 画面の1px が何mmか。指の動きを実寸に直すのに使う */
  const mmPerPx = () => {
    const box = svgRef.current?.getBoundingClientRect()
    return box && box.width > 0 ? viewW / box.width : 1
  }

  /* ------------------------------------------------- 二本指でひろげる・つまむ */

  /**
   * 図そのものを拡大縮小する（依頼者の指示・2026-08-31
   * 「配置の際に二本指で配置図部分を拡縮出来るようにしたい」）。
   *
   * 生地は幅110cm・丈2mといった大きさで、それを電話の画面に丸ごと収めている。
   * 1cm きざみで型紙を突き合わせたいのに、画面の上では1cm が3画素にもならない。
   * 指で置くには、寄って見られる必要がある。
   *
   * **枠そのものは変えず、見る窓（viewBox）だけを動かす。**
   * 絵の大きさも指の動きの換算（`mmPerPx`）も、すべてこの窓から出しているので、
   * 拡大したまま型紙を引きずっても、指と型紙はずれない。
   *
   * 図の外へは出られないようにしてある。
   * 迷子になると、戻る道が「もとの大きさ」しかなくなるため。
   */
  const viewW = vbW / zoom.k
  const viewH = vbH / zoom.k
  /**
   * 名前や印の大きさ。**寄っても画面の上では同じ大きさのまま**にする。
   *
   * 線（型紙の枠・地の目線・折り山）は生地の上に実際にあるものなので、
   * 寄れば大きくなってよい。名前や印は読むために添えてあるだけで、
   * 生地の上にある物ではない。いっしょに大きくすると、
   * 寄って合わせようとしている当の型紙を、名前が覆いかくしてしまう
   */
  const lbl = (v: number) => v / zoom.k
  // 生地が長くなると枠も伸びるので、しまってある値は毎回ここで枠の中へ入れ直す
  const zx = clampTo(zoom.x, 0, vbW - viewW)
  const zy = clampTo(zoom.y, 0, vbH - viewH)

  const rectOf = () => {
    const r = svgRef.current?.getBoundingClientRect()
    return r && r.width > 0 && r.height > 0 ? r : null
  }
  /** 画面の点を、図の左上からのずれに直す */
  const spotOf = (cx: number, cy: number) => {
    const r = rectOf()
    if (!r) return { x: zx, y: zy }
    return {
      x: zx + ((cx - r.left) / r.width) * viewW,
      y: zy + ((cy - r.top) / r.height) * viewH,
    }
  }
  /** 倍率と、窓の左上を決める。つまんだ点が指のあいだに残るように置く */
  const zoomAround = (k: number, cx: number, cy: number, ox: number, oy: number) => {
    const r = rectOf()
    if (!r) return
    const kk = clampTo(k, 1, MAX_ZOOM)
    const w = vbW / kk
    const h = vbH / kk
    setZoom({
      k: kk,
      x: clampTo(ox - ((cx - r.left) / r.width) * w, 0, vbW - w),
      y: clampTo(oy - ((cy - r.top) / r.height) * h, 0, vbH - h),
    })
  }

  const canvasDown = (e: PointerEvent) => {
    onActivate()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // 二本目が触れた。型紙を動かすのはやめて、つまむほうへ移る
      drag.current = null
      pan.current = null
      const [a, b] = [...pointers.current.values()]
      const mid = spotOf((a.x + b.x) / 2, (a.y + b.y) / 2)
      pinch.current = {
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        k0: zoom.k, ox: mid.x, oy: mid.y,
      }
    } else if (pointers.current.size === 1 && !drag.current) {
      // 型紙ではないところをつかんだので、図そのものをずらす
      pan.current = { px: e.clientX, py: e.clientY, zx, zy }
    }
  }

  const canvasMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    const g = pinch.current
    if (g && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d >= 1) zoomAround(g.k0 * (d / g.d0), (a.x + b.x) / 2, (a.y + b.y) / 2, g.ox, g.oy)
      return
    }
    const q = pan.current
    if (q) {
      const r = rectOf()
      if (!r) return
      setZoom({
        k: zoom.k,
        x: clampTo(q.zx - ((e.clientX - q.px) / r.width) * viewW, 0, vbW - viewW),
        y: clampTo(q.zy - ((e.clientY - q.py) / r.height) * viewH, 0, vbH - viewH),
      })
      return
    }
    moveDrag(e)
  }

  const canvasUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) pan.current = null
    endDrag()
  }

  const startDrag = (e: PointerEvent, p: Placement) => {
    onActivate()
    onSelect(p.id)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const box = report.boxes.find((b) => b.placementId === p.id)
    const part = partMap.get(p.partId)
    // ひと続きの引きずりに、1つだけの合図を付ける。
    // 離してもう一度つかんだら別の合図になるので、戻るは1回ずつ効く
    dragSeq += 1
    drag.current = {
      id: p.id,
      /*
        つかんだ位置は、置いてある値ではなく**いま図に出ている位置**から取る。
        折り山に当ててある向きは、位置を折り山から決めているので、
        `xMm` には当てる前の古い値が残っていることがある。
        そこから引きずると、指を置いた瞬間に型紙が飛ぶ
      */
      x0: box?.x ?? p.xMm, y0: box?.y ?? p.yMm, px: e.clientX, py: e.clientY,
      w: box?.w ?? 0, h: box?.h ?? 0, group: `drag${dragSeq}`,
      targets: part ? foldEdgeSides(part, p).filter((sd) => foldSides.includes(sd)) : [],
      bottomY: L,
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
    const x = Math.max(0, Math.min(maxX, snap(d.x0 + (e.clientX - d.px) * k)))
    const y = Math.max(0, snap(d.y0 + (e.clientY - d.py) * k))

    /*
      「わ」の辺を折り山のそばまで持っていったら、そのまま吸い付ける
      （依頼者の指摘・2026-08-31。それまでは下のボタンを押さないと
      「当てた」ことにならず、引きずって合わせただけでは当たっていなかった）。

      当てる先は、その型紙の「わ」の辺が向いている側だけに絞る。
      縦に走る「わ」の辺が上の折り山に当たることはないので、
      近いというだけで吸い付かせると、ありえない当て方ができてしまう。

      離すほうも同じ規則で決める。吸い付く範囲から出れば、そのまま当たっていない状態に戻る。
      ボタンを押して外しに行かなくてよい。
    */
    let snapTo: Side | null = null
    if (d.targets.length > 0) {
      let near = Infinity
      for (const sd of d.targets) {
        const gap = sd === 'left' ? x
          : sd === 'right' ? Math.abs(x - (W - d.w))
          : sd === 'top' ? y
          : Math.abs(y + d.h - d.bottomY)
        if (gap <= GRAB_MM && gap < near) { near = gap; snapTo = sd }
      }
      setHint(snapTo
        ? `「わ」を${SIDE_LABELS[snapTo]}の折り山に当てました`
        : '折り山から離しました')
    }

    onMove(d.id, {
      xMm: keepOffMeet(x, d.w, report.meetXMm, W),
      yMm: keepOffMeet(y, d.h, report.meetYMm, Infinity),
      ...(d.targets.length > 0 ? { snapTo } : {}),
    }, d.group)
  }

  const endDrag = () => {
    if (drag.current?.targets.length) setHint(null)
    drag.current = null
  }


  /**
   * 折り返して二重になっている帯。
   * `full` は、折り返した一枚が見えている面を丸ごと覆っている状態
   * （＝生地幅を半分に折ったとき）。このときだけ、耳の側に下の一枚がのぞく。
   */
  /**
   * 選んだのに、深さがゼロで何もしていない折り山。
   * 両側から折ったのに片方しか使っていないとき、その片方がここに出る
   */
  const idleFold = foldSides.length === 2
    ? foldSides.find((sd) => report.foldDepth[sd] <= 0.5) ?? null
    : null

  const flaps: Array<{ side: Side; x: number; y: number; w: number; h: number; full: boolean }> = []
  /**
   * 両側から折って、みみが中央で出会っているときに、そのあいだへ残す隙間（依頼者の指示・2026-08-27）。
   *
   * ぴったり突き合わせて描くと、二重の帯が1枚の面につながって見えてしまい、
   * 「ここが端どうしの出会うところ」だと分からない。
   * 隙間から下の一枚（明るいほうの色）がのぞくので、そこが境目だと目で分かる。
   * 絵のうえだけの隙間で、計算にはいっさい効かない。
   *
   * 縦わ（みみとみみが出会う）と横わ（裁ち端どうしが出会う）で、要る幅が違う。
   *
   * 縦わは **みみ2本＋そのあいだのわずかな隙間**。ここで出会っているのは
   * 左右のみみそのものなので、2本の帯が折り返しの上にはみ出さずに収まり、
   * なおかつ**みみとみみのあいだが少しだけ空く**ようにする
   * （依頼者のイラレの図・2026-08-30。実物は突き合わせでも、
   * 図としてはわずかに開けておくほうが、2本あることが分かる）
   */
  const SEL_GAP = SEL_BW * 0.85
  const MEET_V = SEL_BW * 2 + SEL_GAP
  const MEET_H = W * 0.013
  const meetV = depth.left > 0 && depth.right > 0 && depth.left + depth.right >= W - 0.5
  const meetH = depth.top > 0 && depth.bottom > 0 && depth.top + depth.bottom >= L - 0.5
  if (depth.left > 0) {
    const w = meetV ? depth.left - MEET_V * 0.5 : depth.left
    flaps.push({ side: 'left', x: 0, y: 0, w, h: L, full: depth.left >= W - 0.5 })
  }
  if (depth.right > 0) {
    const w = meetV ? depth.right - MEET_V * 0.5 : depth.right
    flaps.push({ side: 'right', x: W - w, y: 0, w, h: L, full: depth.right >= W - 0.5 })
  }
  if (depth.top > 0) {
    const h = meetH ? depth.top - MEET_H * 0.5 : depth.top
    flaps.push({ side: 'top', x: 0, y: 0, w: W, h, full: depth.top >= L - 0.5 })
  }
  if (depth.bottom > 0) {
    const h = meetH ? depth.bottom - MEET_H * 0.5 : depth.bottom
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
   * 下になっている一枚（依頼者のイラレの図の形・2026-08-30）。
   *
   * 二重になっているところは、**同じ大きさの紙を2枚、少しずらして重ねた形**で描く。
   * 折り山の側で2枚はつながっているので、そちら側の端はそろえたまま、
   *
   * - 折り山から**離れる向き**へ `RIM` だけ広げる（みみの側に、下の一枚がのぞく）
   * - 折り山に**沿う向き**へ `UNDER_SHIFT` だけずらす（裁ち端の側に、下の一枚がのぞく）
   *
   * ずらす向きは、縦の折りなら**下**、横の折りなら**右**（依頼者の差しかえ図・生地折り方_02）。
   * 台に落ちる影も右下へ出しているので、ずれの向きと光の向きがそろう。
   * 折り山の反対側にのぞかせるだけでは、重なっている感じが伝わらない。
   * 紙を2枚わずかにずらして重ねたときのように角がのぞいていれば、
   * そこに布が2枚あることが言葉なしで分かる（依頼者の指示・2026-08-27／2026-08-30）。
   */
  const UNDER_SHIFT = RIM * 1.15
  /*
    面が丸ごと二重になっているときだけ、下の一枚をずらして描く。
    端に少し折り返しただけのときに2枚目を描くと、生地全体が二重だと読めてしまう。

    なりかたは2通りある。**両方とも下の一枚が要る**（依頼者の指摘・2026-08-30）。

    - 片側から折り切って、折り返した一枚が面を丸ごと覆う（`full`）
    - 両側から折って、みみ（裁ち端）が中央で出会う（`meetV` / `meetH`）

    後者を数え落としていたため、両側わの図にだけ下の一枚が出ていなかった。
    依頼者のイラレの図（生地折り方_02 の1ページ目・3ページ目）では、
    両側わにも下の一枚が入っている。折り山が2本あるぶん耳の側へ広げる余地はないので、
    **折り山に沿ってずらすだけ**（縦わ・両側なら下へ、横わ・上下なら右へ）。
  */
  const hasUnder = flaps.some((f) => f.full) || meetV || meetH
  const foldVertical = foldSides.includes('left') || foldSides.includes('right')
  const under = { x0: bx0, y0: 0, x1: bx1, y1: L }
  if (hasUnder) {
    if (foldVertical) {
      under.y0 += UNDER_SHIFT
      under.y1 += UNDER_SHIFT
      if (foldSides.includes('left') && !foldSides.includes('right')) under.x1 += RIM
      if (foldSides.includes('right') && !foldSides.includes('left')) under.x0 -= RIM
    } else {
      under.x0 += UNDER_SHIFT
      under.x1 += UNDER_SHIFT
      if (foldSides.includes('top') && !foldSides.includes('bottom')) under.y1 += RIM
      if (foldSides.includes('bottom') && !foldSides.includes('top')) under.y0 -= RIM
    }
  }

  /**
   * 折り山の端で、生地がぐるっと回り込むところの寸法
   * （依頼者のイラレの図から実測・2026-08-30。数値は生地幅に対する割合）。
   *
   * `TURN` … 折り山から離れる向きへの走り。回り込みの半円の大きさを決める
   * `TIP`  … 折り山の線が、身頃の裁ち端より先へ出る量
   *
   * ずれた側の折り山の端では、上の一枚と下の一枚の裁ち端が
   * **まったく同じ1点（頂点）に集まる**。2本とも折り山の線に接する向きで
   * その点を出入りするので、合わせて半円に見える。ここが「折り返っている」ことの証。
   */
  const TURN = W * 0.041
  const TIP = W * 0.019

  const pts = (poly: Polygon) => poly.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')

  /**
   * 波打つ裁ち端。はさみで切った端は、定規で引いたようにはまっすぐにならない。
   * うっすら波打たせて、まっすぐな折り山・点々のみみと描き分ける。
   * （開始点へは移動しない。輪郭の途中に差し込んで使う）
   */
  const waveSeg = (from: number, to: number, y: number) => {
    const amp = W * 0.005
    const dir = to >= from ? 1 : -1
    const span = Math.abs(to - from)
    if (span < 0.01) return ''
    // 半端な切れ端が残ると、そこだけ折れて棘のように見える。
    // 山の数を丸めてから幅を割り直し、端まで同じ大きさの波でそろえる
    const n = Math.max(1, Math.round(span / (W * 0.05)))
    const step = span / n
    let d = ''
    for (let i = 0; i < n; i += 1) {
      const x = from + dir * step * i
      const nx = from + dir * step * (i + 1)
      const mx = ((x + nx) / 2).toFixed(1)
      d += ` Q${mx} ${(y + (i % 2 === 0 ? -amp : amp)).toFixed(1)} ${nx.toFixed(1)} ${y.toFixed(1)}`
    }
    return d
  }

  /**
   * 折り山の端の、回り込みのひと筆（依頼者のイラレの図の形・2026-08-30）。
   *
   * 折り山の上の点では折り山と平行な向き、裁ち端の上の点では裁ち端と平行な向きで
   * 出入りする三次曲線。上の一枚と下の一枚が同じ頂点からこれを描くので、
   * 2本合わせて半円に見え、生地が回り込んでいることが分かる。
   * 制御点の比はイラレの実データから採った。
   */
  const turnTo = (
    fx: number, fy: number, tx: number, ty: number,
    fromFold: boolean, vertical: boolean,
  ) => {
    let c1x: number, c1y: number, c2x: number, c2y: number
    if (vertical) {
      if (fromFold) {
        c1x = fx; c1y = fy + 0.55 * (ty - fy); c2x = fx + 0.28 * (tx - fx); c2y = ty
      } else {
        c1x = fx + 0.28 * (tx - fx); c1y = fy; c2x = tx; c2y = ty + 0.55 * (fy - ty)
      }
    } else {
      if (fromFold) {
        c1x = fx + 0.55 * (tx - fx); c1y = fy; c2x = tx; c2y = fy + 0.28 * (ty - fy)
      } else {
        c1x = fx; c1y = fy + 0.55 * (ty - fy); c2x = fx + 0.28 * (tx - fx); c2y = ty
      }
    }
    const n = (v: number) => v.toFixed(1)
    return `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(tx)} ${n(ty)}`
  }

  /**
   * 生地を一枚描く（依頼者のイラレの図の形・2026-08-30）。
   *
   * 生地は上から見た平らな一枚。裁ち端は波打たせ、みみと折り山はまっすぐに引く。
   * 折り山の端だけは角を落とさず、`turnTo` で回り込ませる。
   *
   * `leadApex` は、**ずれた側の折り山の端で2枚が集まる頂点**の座標
   * （縦の折りなら y、横の折りなら x）。上の一枚と下の一枚に同じ値を渡すと、
   * 2枚の裁ち端がそこで出会って半円になる。ここを別々にすると、
   * 「折り返っている箇所が全く描写されていない」ことになる（依頼者の指摘・2026-08-30）。
   */
  const sheet = (
    x0: number, y0: number, x1: number, y1: number,
    cutTop = false, cutBottom = false, leadApex?: number,
    sides: Side[] = foldSides,
  ) => {
    const fL = sides.includes('left')
    const fR = sides.includes('right')
    const fT = sides.includes('top')
    const fB = sides.includes('bottom')
    const vert = fL || fR
    // 折り山の線の両端。ずれる向き（縦わなら下、横わなら右）へ TIP だけ先へ出る
    // 折り山の線は、ずれる向き（縦わなら下、横わなら右）へ TIP だけ送る。
    // 手前の端はその一枚のもの、ずれる側の端は2枚で分けあう頂点
    const tipNear = vert ? y0 + TIP : x0 + TIP
    const tipFar = leadApex ?? (vert ? y1 + TIP : x1 + TIP)
    const n = (v: number) => v.toFixed(1)

    // 角ごとに「前の辺の終わり」と「次の辺の始まり」を出す。折り山に接する角だけ離れる
    const corner = (
      cx: number, cy: number, fold: 'l' | 'r' | 't' | 'b' | null,
      at: 'tl' | 'tr' | 'br' | 'bl',
    ) => {
      if (!fold) return { in: [cx, cy], out: [cx, cy], v: vert }
      if (fold === 'l') return at === 'tl'
        ? { in: [x0, tipNear], out: [x0 + TURN, y0], v: true }
        : { in: [x0 + TURN, y1], out: [x0, tipFar], v: true }
      if (fold === 'r') return at === 'tr'
        ? { in: [x1 - TURN, y0], out: [x1, tipNear], v: true }
        : { in: [x1, tipFar], out: [x1 - TURN, y1], v: true }
      if (fold === 't') return at === 'tl'
        ? { in: [x0, y0 + TURN], out: [tipNear, y0], v: false }
        : { in: [tipFar, y0], out: [x1, y0 + TURN], v: false }
      return at === 'br'
        ? { in: [x1, y1 - TURN], out: [tipFar, y1], v: false }
        : { in: [tipNear, y1], out: [x0, y1 - TURN], v: false }
    }
    const TL = corner(x0, y0, fL ? 'l' : fT ? 't' : null, 'tl')
    const TR = corner(x1, y0, fR ? 'r' : fT ? 't' : null, 'tr')
    const BR = corner(x1, y1, fR ? 'r' : fB ? 'b' : null, 'br')
    const BL = corner(x0, y1, fL ? 'l' : fB ? 'b' : null, 'bl')

    // 角をまたぐひと筆。折り山の側から出るのか、裁ち端の側から出るのかで向きが変わる
    const link = (c: { in: number[]; out: number[]; v: boolean }, fromFold: boolean) =>
      c.in[0] === c.out[0] && c.in[1] === c.out[1]
        ? ''
        : turnTo(c.in[0], c.in[1], c.out[0], c.out[1], fromFold, c.v)

    return [
      `M${n(TL.out[0])} ${n(TL.out[1])}`,
      cutTop ? waveSeg(TL.out[0], TR.in[0], y0) : `L${n(TR.in[0])} ${n(TR.in[1])}`,
      link(TR, fT),
      `L${n(BR.in[0])} ${n(BR.in[1])}`,
      link(BR, fR),
      // 下の端も、上と同じく裁ち端。まっすぐ引くと折り山に見える（依頼者の指摘・2026-08-27）
      cutBottom ? waveSeg(BR.out[0], BL.in[0], y1) : `L${n(BL.in[0])} ${n(BL.in[1])}`,
      link(BL, fB),
      `L${n(TL.in[0])} ${n(TL.in[1])}`,
      link(TL, fL),
      'Z',
    ].join(' ')
  }

  /**
   * 折り山ぎわの明暗。筒は描かないが、折った縁がわずかに起き上がって
   * 光をひろう感じは残しておきたい（依頼者の指示「色や陰影はそのまま」・2026-08-30）。
   * 生地の**内側**へ向かって、縁で翳り→白く光り→生地の色へ、と流す。
   * 上の一枚と下の一枚で切り抜きを変えて2回重ねるので、ここで一度だけ組み立てておく
   */
  const crestBands = () => foldSides.map((s) => {
    const horiz = s === 'left' || s === 'right'
    const x = s === 'left' ? 0 : W - CR
    const y = s === 'top' ? 0 : L - CR
    const over = RIM * 3
    return (
      <rect
        key={`sp-${s}`}
        x={horiz ? x : bx0 - over}
        y={horiz ? -over : y}
        width={horiz ? CR : bodyW + over * 2}
        height={horiz ? L + over * 2 : CR}
        fill={`url(#${gid}-sp-${s})`}
      />
    )
  })

  /** 上下の端が、はさみで切った裁ち端かどうか（横わでそちらを折るときだけ違う） */
  const cutTop = !foldSides.includes('top')
  const cutBottom = !foldSides.includes('bottom')

  /**
   * ずれた側の折り山の端で、上の一枚と下の一枚の裁ち端が集まる頂点。
   * 上の一枚の身頃より `TIP` だけ先へ出たところに置き、両方の一枚に同じ値を渡す
   */
  const leadApex = foldVertical ? L + TIP : bx1 + TIP
  /**
   * 上に来ている一枚。
   *
   * **両側から折って端どうしが出会うときは、上の一枚は「2枚」である**
   * （依頼者のイラレの図・生地折り方_02 の1ページ目・3ページ目。
   * どちらも上の面は2つの長方形に分かれていて、あいだが空いている）。
   *
   * ひと続きの一枚として描いていたため、隙間の上端・下端で裁ち端の波が
   * つながってしまい、1枚の布に見えていた（依頼者の指摘・2026-08-30）。
   * 2つに割って描くと、波もそこで切れ、隙間からは下の一枚がのぞく。
   * 下の一枚はずらして敷いてあるので、隙間の中に**下の一枚の裁ち端**が現れる。
   * これがイラレの図にもある短い波（1ページ目のパス8・9）で、
   * 「ここは向こうまで抜けている」ことの証になる。
   */
  const topPath = (() => {
    if (meetV) {
      // 縦わ。出会っているのは左右のみみなので、生地の端はみみの帯のぶんだけ内側
      const eL = depth.left - MEET_V * 0.5 + SEL_BW
      const eR = W - depth.right + MEET_V * 0.5 - SEL_BW
      return `${sheet(bx0, 0, eL, L, cutTop, cutBottom, leadApex, ['left'])} `
        + sheet(eR, 0, bx1, L, cutTop, cutBottom, leadApex, ['right'])
    }
    if (meetH) {
      // 横わ。出会っているのは裁ち端どうし。割った側も波で描く
      const eT = depth.top - MEET_H * 0.5
      const eB = L - depth.bottom + MEET_H * 0.5
      return `${sheet(bx0, 0, bx1, eT, cutTop, true, leadApex, ['top'])} `
        + sheet(bx0, eB, bx1, L, true, cutBottom, leadApex, ['bottom'])
    }
    return sheet(bx0, 0, bx1, L, cutTop, cutBottom, leadApex)
  })()
  /**
   * 下になっている一枚の形。上の一枚とまったく同じ描き方で、
   * 位置と大きさだけを `under` の箱に置きかえる。
   * 2枚が「同じ布を折っただけのもの」に見えるためには、
   * 端の描き分け（波・まっすぐ・角のまるみ）もそろっていなければならない
   */
  const underPath = hasUnder
    ? sheet(under.x0, under.y0, under.x1, under.y1, cutTop, cutBottom, leadApex)
    : null

  /**
   * みみ。実物のみみには、織るときの機械のピン穴が点々と並んでいる。
   * くし歯だと定規の目盛りに見えてしまうので（依頼者の指摘）、
   * 学生が毎日見ているピン穴のほうで描く。
   */
  const SEL_PITCH = W * 0.042
  /**
   * みみの帯を、折り山を回り込んだ先まで引くための、じゅうぶんな長さ。
   * 実際にどこで止まるかは、その一枚の形で切り抜いて決める
   */
  const SEL_FROM = -RIM * 4
  const SEL_TO = L + RIM * 4

  /**
   * みみの線1本ぶんの道。生地の輪郭とまったく同じ形を、
   * 内側へ `o` だけ寄せて引く。
   *
   * **横わのときは、みみも折り山の端でいっしょに回り込む**
   * （依頼者の指摘・2026-08-30「耳もやはり折り返しの円弧に沿って
   * カーブしないと自然に見えません」）。まっすぐな帯を引いて
   * 一枚の形で切り抜いていたため、みみが回り込みのところで
   * ぶつ切りになっていた。
   *
   * イラレの図でも、みみの3本（帯の縁とピン穴2列）はそれぞれ
   * 輪郭の回り込みを内側へ平行移動した形になっている
   * （生地折り方_02 の3ページ目・パス 23／25／28）。
   * 平行曲線ではなく**平行移動**なので、`sheet()` と同じ `turnTo()` に
   * ずらした座標を渡すだけでよい。
   */
  const selvagePath = (
    b: { x0: number; y0: number; x1: number; y1: number },
    side: 'left' | 'right', o: number,
  ) => {
    const n = (v: number) => v.toFixed(1)
    const left = side === 'left'
    const x = left ? b.x0 + o : b.x1 - o
    const fT = foldSides.includes('top')
    const fB = foldSides.includes('bottom')
    // 縦わ・折らないときは回り込みが無い。長めに引いて、一枚の形で切り抜く
    if (!fT && !fB) return `M${n(x)} ${n(SEL_FROM)} L${n(x)} ${n(SEL_TO)}`
    // 回り込みの頂点。ずれる向き（右）の端が leadApex、反対の端は身頃より TIP 先
    const apex = left ? b.x0 + TIP + o : leadApex - o
    const yTop = fT ? b.y0 + TURN : SEL_FROM
    const yBot = fB ? b.y1 - TURN : SEL_TO
    return [
      fT ? `M${n(apex)} ${n(b.y0)} ${turnTo(apex, b.y0, x, yTop, true, false)}`
        : `M${n(x)} ${n(yTop)}`,
      `L${n(x)} ${n(yBot)}`,
      fB ? turnTo(x, yBot, apex, b.y1, false, false) : '',
    ].join(' ')
  }

  /**
   * みみ。実物のみみには、織るときの機械のピン穴が点々と並んでいる。
   * くし歯だと定規の目盛りに見えてしまうので（依頼者の指摘）、
   * 学生が毎日見ているピン穴のほうで描く。
   *
   * 3本とも同じ道に沿って引く。ピン穴は破線の丸い端で出しているので、
   * 回り込みのところでも粒が曲線に乗ってくれる（イラレの図と同じやり方）。
   */
  const selvageMarks = (
    mid: string, inner: string, tone: typeof SELVAGE, key?: string,
  ) => (
    <g key={key} fill="none" stroke={tone.line}>
      <path d={mid} strokeWidth={SEL_BW} opacity={tone.band} />
      <path d={inner} strokeWidth={W * 0.0028} opacity={0.3} />
      <path d={mid} strokeWidth={W * 0.007} opacity={tone.dot} strokeLinecap="round"
        strokeDasharray={`0 ${SEL_PITCH}`} strokeDashoffset={-SEL_PITCH * 0.6} />
    </g>
  )

  /** 生地のみみ。その一枚の箱と、どちらの端かで決まる */
  const selvageOn = (
    b: { x0: number; y0: number; x1: number; y1: number },
    side: 'left' | 'right', tone: typeof SELVAGE, key?: string,
  ) => selvageMarks(selvagePath(b, side, SEL_BW / 2), selvagePath(b, side, SEL_BW), tone, key)

  /**
   * 折り返して上に乗っている一枚のみみ。面の内側なので回り込みは無い。
   *
   * 帯は、折り返した生地の端から**外側**（折り山から離れる向き）へ引く。
   * 内側へ引くと、その折り返しに当てて置いた型紙の上にみみが乗ってしまう。
   * みみは裁断に使わないので、型紙とは重ならない（依頼者の指示・2026-08-30）
   */
  const selvageStraight = (xEdge: number, outward: 1 | -1) => {
    const line = (o: number) => {
      const x = (xEdge + outward * o).toFixed(1)
      return `M${x} 0 L${x} ${L.toFixed(1)}`
    }
    return selvageMarks(line(SEL_BW / 2), line(SEL_BW), SELVAGE)
  }

  /**
   * 「わ」の辺に付ける作図の記号（依頼者の指示・2026-08-27）。
   *
   * ◎ を半分にした形——同じ中心の半円を二重に、辺の上へ伏せて描く。
   * 縫い代の画面に出しているものと同じ形で、学校の作図の決まりごと。
   * **裁ち合わせ図では、どの辺を折り山に当てているかが図の要**なので、
   * こちらにも同じ印を出す。
   *
   * ふくらむ向きは、型紙の内側の点との向きから決める。
   * こうしておくと、回して置いても裏返して置いても、いつも内側へふくらむ。
   */
  const foldMarks = (marks: FoldMark[]) =>
    marks.map((m, i) => {
      const cx = (m.a.x + m.b.x) * 0.5
      const cy = (m.a.y + m.b.y) * 0.5
      // 短い辺に大きく描くとはみ出して別の形に見えるので、辺の長さでも抑える
      const R = Math.min(W * 0.032, m.lengthMm * 0.3)
      if (R < W * 0.008) return null
      const ux = (m.b.x - m.a.x) / (FOLD_MARK_REF_MM * 2)
      const uy = (m.b.y - m.a.y) / (FOLD_MARK_REF_MM * 2)
      // 外積の向きが、そのまま SVG の弧のまわり方（sweep）になる
      const cross =
        (m.b.x - m.a.x) * (m.inn.y - m.a.y) - (m.b.y - m.a.y) * (m.inn.x - m.a.x)
      const sweep = cross < 0 ? 1 : 0
      const half = (rr: number) =>
        `M${(cx - ux * rr).toFixed(1)} ${(cy - uy * rr).toFixed(1)}`
        + ` A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 ${sweep}`
        + ` ${(cx + ux * rr).toFixed(1)} ${(cy + uy * rr).toFixed(1)}`
      return (
        <g key={`wa-${i}`} fill="none" stroke="#2b332d" strokeWidth={W * 0.005}>
          <path d={half(R)} />
          <path d={half(R * 0.48)} />
        </g>
      )
    })

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
   * みみの重なり：横から見たみみ n 枚。
   *
   * 数え方は `iconLayers` と同じ（棒の数＝枚数）だが、**印はみみの点々で描く**。
   * ただの横棒1本にしておくと「生地が一重」の印とまったく同じ絵になり、
   * みみの枚数の話なのか布の重なりの話なのか読み分けられない
   * （依頼者の指摘・2026-08-31「これは生地が一重の時の記号と同じです」）。
   *
   * 点々＝みみ、は生地の絵でもアイコンでも通してある約束なので、それに合わせる。
   */
  const iconSelvageLayers = (
    cx: number, cy: number, sz: number, n: 1 | 2, color: string,
  ) => {
    const ys = n === 2 ? [cy - sz * 0.22, cy + sz * 0.22] : [cy]
    return (
      <g>
        {ys.map((y) => (
          <g key={y}>
            {/*
              みみの帯。太さは図のみみ（`SEL_BW` ＝ 生地幅の 2.2%）に合わせてある。
              前は細い線に小さな粒で、印だと分かる前に見えなかった
              （依頼者の指摘・2026-08-31「耳のマークは細いからか、見えにくいですね」）
            */}
            <line x1={cx - sz * 0.5} y1={y} x2={cx + sz * 0.5} y2={y}
              stroke={color} strokeWidth={sz * 0.30} opacity={0.34} strokeLinecap="round" />
            {/*
              ピン穴。生地の絵では破線の丸い端で出しているが、
              この大きさだと端の粒が出たり出なかったりして左右で数が揃わないので、
              ここは粒そのものを置く。粒と間隔の比も図のみみと同じにしてある
            */}
            {[-1.5, -0.5, 0.5, 1.5].map((i) => (
              <circle key={i} cx={cx + i * sz * 0.28} cy={y} r={sz * 0.065} fill={color} />
            ))}
          </g>
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

  /**
   * 地の目が横：左右向きの矢印。図に引いてある地の目線と同じ言葉。
   * 「本来の縦地ではなく、横を向いている」ことを、型紙の上でひと目で言う
   */
  const iconGrainSide = (cx: number, cy: number, sz: number, color: string) => {
    const h = sz * 0.5
    const a = sz * 0.2
    const head = (x: number, dir: 1 | -1) =>
      `M${x} ${cy} L${x - a * dir} ${cy - a * 0.62} L${x - a * dir} ${cy + a * 0.62} Z`
    return (
      <g stroke={color} fill={color}>
        <line x1={cx - h} y1={cy} x2={cx + h} y2={cy} strokeWidth={sz * 0.1} />
        <path d={head(cx + h, 1)} stroke="none" />
        <path d={head(cx - h, -1)} stroke="none" />
      </g>
    )
  }

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
        折り方は、名前を並べたプルダウンではなく
        **生地を上から見た小さな図の辺を押して**決める（依頼者の指示・2026-08-28）。
        「縦わ・片側」という名前は、頭の中でいったん図に直さないと選べない。
        辺を押すなら、その手間が要らない。
        ただし名前そのものにも意味がある（学校で使う言葉なので）ので、
        図のとなりに結果を文字で出して、押して決めて名前で覚える順にしてある。
      */}
      <div className="flex items-start gap-2 rounded-xl border border-ink-100 bg-white px-2 py-1.5">
        <FoldPicker
          fold={section.fold}
          half={half}
          onHint={setHint}
          onEdge={(side, action) => { onActivate(); applyEdge(side, action) }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
          <span className="flex items-center gap-1.5 text-sm font-bold text-ink-700">
            <Icon name="layout" className="h-4 w-4 shrink-0 text-mat-600" />
            {state.sections.length > 1 ? `${index + 1} つめ・` : ''}
            {FOLD_LABELS[section.fold]}
          </span>
          {/* 引きずっている最中は、いま何をしているのかをここに出す */}
          <span className={`text-xs leading-relaxed ${hint ? 'font-bold text-mat-700' : 'text-ink-300'}`}>
            {hint ?? '辺を押すか、内側へ引きずります'}
          </span>
          {canHalfFold(section.fold) && (
            <select
              value={half ? 'half' : 'partial'}
              onChange={(e) => onHalf(e.target.value === 'half')}
              className="min-w-0 rounded-lg border border-ink-100 bg-white px-1.5 py-1.5 text-sm"
            >
              <option value="half">
                {section.fold === 'vBoth' || section.fold === 'hBoth'
                  ? '両端が出会うまで折る' : '半分に折る'}
              </option>
              <option value="partial">型紙に合わせて折る</option>
            </select>
          )}
          {/* 折ったあとに実際に置ける幅。折り方で変わるので、区間ごとに出す */}
          <span className="tnum flex items-center gap-2 text-[11px] leading-tight text-ink-300">
            <span>幅 {(W / 10).toFixed(0)} cm</span>
            <span>長さ {(report.yardageMm / 10).toFixed(0)} cm</span>
            {canDrop && (
              <button
                type="button"
                onClick={onDrop}
                className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-300"
              >
                <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
                消す
              </button>
            )}
          </span>
        </div>
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
        className={`relative flex flex-col overflow-hidden rounded-xl border-2 bg-table ${
          active ? 'border-mat-500' : 'border-ink-100'
        }`}
      >
        {/*
          寄っているあいだだけ、戻る道を絵の上に出しておく。
          二本指でつまんで戻せはするが、端まで寄せてしまうと戻しにくい。
          いま何倍かも書いておく——寄っていることに気づかないまま
          「型紙が大きくなった」と誤解されないように
        */}
        {zoom.k > 1.01 && (
          <button
            type="button"
            onClick={() => setZoom({ k: 1, x: 0, y: 0 })}
            className="tnum absolute right-2 top-2 z-10 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-bold text-ink-700 shadow-sm active:bg-mat-50"
          >
            {zoom.k.toFixed(1)}倍 ／ もとの大きさへ
          </button>
        )}
        <svg
          ref={svgRef}
          viewBox={`${bx0 - PAD + zx} ${-PAD + zy} ${viewW} ${viewH}`}
          data-tour={index === 0 ? 'fabric' : undefined}
          className="w-full select-none"
          style={{ aspectRatio: `${vbW} / ${vbH}`, touchAction: 'none' }}
          onPointerDown={canvasDown}
          onPointerMove={canvasMove}
          onPointerUp={canvasUp}
          onPointerCancel={canvasUp}
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

            {/*
              折り山の明暗は、生地からはみ出さないように切り抜く。
              上の一枚と下の一枚で切り抜きを分けてあるのが大事なところ。

              ひとつにまとめて上から塗ると、明暗が回り込みの継ぎ目を塗りつぶしてしまい、
              せっかくの半円のアールが消えて、ただの丸い角に見える
              （依頼者の指摘・2026-08-27）。
              下の一枚 →（明暗）→ 上の一枚 →（明暗）の順に重ねると、
              上の一枚の落とす影が下の一枚の上に出て、2枚の境目が残る
            */}
            <clipPath id={`${gid}-clip`}>
              <path d={topPath} />
            </clipPath>
            <clipPath id={`${gid}-clip-under`}>
              <path d={underPath ?? topPath} />
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

          {/*
            下になっている一枚。上の一枚と同じ紙を、少しずらして敷いてある。
            みみの帯も明暗も、上の一枚を描く前にここで済ませておく。
            そうすれば、隠れるところは上の一枚が自然に覆ってくれる
          */}
          {underPath && (
            <>
              <path d={underPath} fill={CLOTH_FOLDED} filter={`url(#${gid}-drop2)`} />
              <path d={underPath} fill={`url(#${gid}-weave)`} />
              <g clipPath={`url(#${gid}-clip-under)`}>
                {crestBands()}
                {/* 下の一枚のみみ。点々が2列あること＝布が2枚あること */}
                {selvages.map((s) => (
                  selvageOn(under, s as 'left' | 'right', SELVAGE_UNDER, `usv-${s}`)
                ))}
              </g>
            </>
          )}

          {/* 上に来ている一枚。ここに型紙を並べる */}
          <path d={topPath} fill={CLOTH}
            filter={underPath ? `url(#${gid}-drop)` : `url(#${gid}-drop2)`} />
          <path d={topPath} fill={`url(#${gid}-weave)`} />

          {/*
            端の描き分け。折り山・耳・裁ち端は実物ではまったく別のものなので、
            裁ち合わせ図の昔からの描き方に合わせて、線の見た目も変えておく。
            折り山＝角のまるみと明暗、耳＝帯とピン穴、裁ち端＝波線。
            型紙より先に描く（型紙は生地の上に乗るので、隠れてよい）
          */}
          <g clipPath={`url(#${gid}-clip)`}>
            {crestBands()}
            {/*
              上の一枚のみみ。横わのときは、みみは折り山を回り込んで向こうへ続いている。
              途中で途切れていると、そこで生地が終わっているように見えてしまう
              （依頼者の指摘・2026-08-30）。長めに引いておいて、その一枚の形で切り抜く
            */}
            {selvages.map((s) => (
              selvageOn({ x0: bx0, y0: 0, x1: bx1, y1: L }, s as 'left' | 'right', SELVAGE, `sv-${s}`)
            ))}
          </g>
          {/* 裁ち端の名前。はさみの印を添える */}
          {cutTop && (
            <g>
              {iconScissors(Math.max(bx1, under.x1) - W * 0.026,
                Math.min(0, under.y0) - W * 0.042, W * 0.042, '#8a9188')}
              <text x={Math.max(bx1, under.x1) - W * 0.072} y={Math.min(0, under.y0) - W * 0.042}
                fontSize={W * 0.03} fill="#8a9188" textAnchor="end"
                dominantBaseline="middle">裁ち端</text>
            </g>
          )}

          {/*
            折り返して上に乗っているぶん。面の一部だけを覆うときは、端に影を落とす。

            色は変えない（依頼者の指示・2026-08-27）。
            折り方によって二重のところの色が違うと、同じ生地に見えなくなる。
            二重であることは、ずらして描いた下の一枚・回り込み・端の線・
            「生地が二重」の文字のほうで伝える
          */}
          {flaps.filter((f) => !f.full).map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            // 影は、折り返した生地の「端」から、下の一枚のほうへ伸びる
            const sx = f.side === 'left' ? f.w : f.side === 'right' ? W - f.w - shade : 0
            const sy = f.side === 'top' ? f.h : f.side === 'bottom' ? L - f.h - shade : 0
            const flip = f.side === 'right' || f.side === 'bottom'
            /*
              みみとみみが出会っているところに影を落とすと、みみの帯が影で暗くなり、
              他の折り方より濃く見える。隙間そのものが下の一枚の色で塗ってあるので、
              ここでは影は要らない（依頼者の指摘・2026-08-30）
            */
            const shadeless = (meetV && horiz) || (meetH && !horiz)
            return (
              <g key={f.side}>
                {!shadeless && <rect
                  x={horiz ? sx : bx0}
                  y={horiz ? 0 : sy}
                  width={horiz ? shade : bodyW}
                  height={horiz ? L : shade}
                  fill={`url(#${gid}-${horiz ? 'h' : 'v'})`}
                  transform={
                    flip
                      ? horiz
                        ? `rotate(180 ${sx + shade / 2} ${L / 2})`
                        : `rotate(180 ${bxMid} ${sy + shade / 2})`
                      : undefined
                  }
                />}
                {/*
                  折り返した生地の端。ここから先は一重に戻る。
                  縦の折りならこの端は「もとのみみ」なのでピン穴で、
                  横の折りなら「もとの裁ち端」なので波線で描く
                */}
                {horiz ? (
                  <g>
                    {/*
                      生地そのものの端は、みみの帯の**外側**にある。
                      線をここに引かないと、隙間の縁がぼやけて抜けて見えない
                      （イラレの図でも、隙間の両縁だけ太い線で引いてある）
                    */}
                    <line
                      x1={f.side === 'left' ? f.w + SEL_BW : W - f.w - SEL_BW} y1={0}
                      x2={f.side === 'left' ? f.w + SEL_BW : W - f.w - SEL_BW} y2={L}
                      stroke="#b8b6a4" strokeWidth={W * 0.004} />
                    {selvageStraight(f.side === 'left' ? f.w : W - f.w, f.side === 'left' ? 1 : -1)}
                  </g>
                ) : (
                  <path
                    d={`M${bx0.toFixed(1)} ${(f.side === 'top' ? f.h : L - f.h).toFixed(1)}`
                      + waveSeg(bx0, bx1, f.side === 'top' ? f.h : L - f.h)}
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
            const { cut, finished, marks, center } = orientedPair(part, p)
            // 中心線と地の目線が重なるときだけ、地の目線を脇へどける
            const bad = badPlacements.has(p.id)
            const on = selectedId === p.id
            const twice = countOf(p.id) === 2
            const stored = state.parts.find((x) => x.id === p.partId)
            const reserve = stored ? isReserve(stored) : false
            /*
              ふつうと違う置き方をしていることを、型紙の上で言う印。
              型紙の左上に積むので、名前はそのぶん下へどける
            */
            const badges: Array<{ k: string; text: string; color: string; flip: boolean }> = []
            if (p.rot90) badges.push({ k: 'grain', text: '地の目が横', color: '#8a6a2e', flip: false })
            if (p.mirrored) badges.push({ k: 'flip', text: '裏返し', color: '#5c665f', flip: true })
            const showBadges = badges.length > 0 && box.w > W * 0.3 && box.h > W * 0.12
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
                    x={box.w * 0.5} y={box.h * 0.5 - lbl(W * 0.018)}
                    fontSize={lbl(Math.min(W * 0.042, box.w * 0.17))} fontWeight={700} fill="#6d6448"
                    textAnchor="middle" dominantBaseline="middle"
                    stroke="#ffffff" strokeWidth={lbl(W * 0.012)} paintOrder="stroke"
                  >
                    {stored?.name}
                  </text>
                  <text
                    x={box.w * 0.5} y={box.h * 0.5 + lbl(W * 0.03)}
                    fontSize={lbl(Math.min(W * 0.03, box.w * 0.12))} fill="#8a7f5c"
                    textAnchor="middle" dominantBaseline="middle"
                    stroke="#ffffff" strokeWidth={lbl(W * 0.012)} paintOrder="stroke"
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
                  fontShrink={zoom.k}
                  paper={p.mirrored ? '#e9e7e0' : undefined}
                  shift={grainShiftOf(center, p.rot90 === true, box.w, box.h)}
                  labelShift={showBadges ? lbl(badges.length * W * 0.055) : 0}
                />
                {/* 「わ」の辺の印。地の目線より後に描いて、隠れないようにする */}
                {foldMarks(marks)}
                {/*
                  「わ」で開いて裁つ型紙の中心線（依頼者の質問・2026-08-28）。
                  一点鎖線。作図で中心線・折り線を表す決まった引き方で、
                  これがあって初めて「左右に開いた1枚」だと読める
                */}
                {center && (
                  <path
                    d={`M${center.a.x.toFixed(1)} ${center.a.y.toFixed(1)}`
                      + ` L${center.b.x.toFixed(1)} ${center.b.y.toFixed(1)}`}
                    fill="none"
                    stroke="#2b332d"
                    strokeWidth={W * 0.004}
                    strokeDasharray={`${W * 0.03} ${W * 0.012} ${W * 0.005} ${W * 0.012}`}
                  />
                )}
                {/*
                  ふつうと違う置き方をしていることは、絵と言葉の両方で言う。
                  形だけでは気づけないため。ふたつ重なることがあるので、上から順に積む。

                  **地の目が横向きになっている型紙には、その旨をここに出す**
                  （依頼者の指示・2026-08-30）。サーキュラースカートのように
                  生地幅に入りきらないものは、横地で裁つことが実際にある。
                  だから「できません」と止めるのではなく、
                  そうなっていることが図の上で分かるようにしておく
                */}
                {showBadges && (() => {
                  const fs = lbl(W * 0.034)
                  const isz = lbl(W * 0.044)
                  /*
                    印は型紙の**左上の角**に、左そろえで積む。
                    型紙の名前と地の目線は真ん中にあるので、真ん中へ書くと重なって読めない
                  */
                  return badges.map((b, i) => {
                    const cy = lbl(W * 0.05 + i * W * 0.055)
                    const x0 = lbl(W * 0.022)
                    return (
                      <g key={b.k}>
                        {b.flip
                          ? iconFlip(x0 + isz * 0.5, cy, isz * 0.96, b.color)
                          : iconGrainSide(x0 + isz * 0.5, cy, isz, b.color)}
                        <text
                          x={x0 + isz + lbl(W * 0.014) + b.text.length * fs * 0.5} y={cy}
                          fontSize={fs} fontWeight={700} fill={b.color}
                          textAnchor="middle" dominantBaseline="middle"
                          stroke="#ffffff" strokeWidth={lbl(W * 0.013)} paintOrder="stroke"
                        >
                          {b.text}
                        </text>
                      </g>
                    )
                  })
                })()}
                {/*
                  二重のところに置いた型紙は、1つで2枚とれる。
                  印は**右下の角**に置く。真ん中に置くと、型紙の名前とぶつかる
                */}
                {twice && (
                  <g>
                    <circle cx={box.w - lbl(W * 0.058)} cy={box.h - lbl(W * 0.055)}
                      r={lbl(W * 0.042)} fill={CREASE} />
                    <text x={box.w - lbl(W * 0.058)} y={box.h - lbl(W * 0.055)} fontSize={lbl(W * 0.044)}
                      fontWeight={700} fill="#ffffff" textAnchor="middle" dominantBaseline="middle">
                      ×2
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/*
            二重の印しもパーツの上に出す。先に描くと型紙の下に隠れてしまう。
            両側から折って面が丸ごと二重になるときは、同じことを二度書かない
            （両方の折り返しが面の真ん中に同じ文字を重ねてしまう）
          */}
          {(flaps.some((f) => f.full) ? flaps.filter((f) => f.full).slice(0, 1) : flaps).map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            /*
              ただ「二重」とだけ書くと、置いた型紙が2枚という意味に読めてしまう
              （依頼者から実際にそう質問された・2026-08-27）。
              数えているのは布の枚数なので、主語を書いておく。
              帯が細くて文字がはみ出すときだけ短いほうにする
            */
            const label = longLayerLabels
              ? (f.full ? '生地がぜんぶ二重' : '生地が二重') : '二重'
            /*
              札は**帯のはじまり**に寄せる（依頼者の指摘・2026-08-31
              「横わのとき、札と型紙の名前や地の目線が重なって読めない」）。

              縦の帯（左右の折り返し）は上下に長いので、はじまりは上端。
              横の帯（上下の折り返し）は左右に長いので、はじまりは左端。
              帯のまんなかは、型紙の名前と地の目線が必ず通るところなので空けておく。
              もとは横の帯だけ、そのまんなかに置いていた
            */
            const isz = W * 0.046
            const mid = horiz ? (f.side === 'left' ? f.w / 2 : W - f.w / 2) : 0
            /*
              横の帯では、上下も帯のまんなかから折り山ぎわへ寄せる。
              帯の高さは当てた型紙の丈そのものなので、帯のまんなか＝型紙のまんなかで、
              そこには名前と、横に寝た地の目の矢が必ず通っている。
              札を折り山ぎわの角へ追い出すと、どちらも読めるようになる
            */
            const nearFold = Math.min(f.h * 0.5, W * 0.045)
            /*
              面が丸ごと二重のときだけは、折り山ぎわではなく上端に置く。
              このとき帯は生地そのものなので、どこに置いても言っていることは同じ。
              折り山ぎわに置くと、生地いっぱいに広がった型紙の名前とぶつかる
            */
            const ty = horiz
              ? L * 0.045
              : f.full ? Math.min(L * 0.5, W * 0.045)
              : f.side === 'top' ? nearFold : L - nearFold
            const icx = horiz
              ? mid - label.length * W * 0.021 - W * 0.038
              : W * 0.02 + isz * 0.5
            const tx = horiz ? mid : icx + isz * 0.5 + W * 0.018
            return (
              <g key={`t-${f.side}`}>
                {iconLayers(icx, ty, isz, 2, CREASE, true)}
                <text
                  x={tx} y={ty}
                  fontSize={W * 0.04} fontWeight={700} fill={CREASE}
                  textAnchor={horiz ? 'middle' : 'start'} dominantBaseline="middle"
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
            const room = vert ? W - depth.left - depth.right : L - depth.top - depth.bottom
            if (room < (vert ? W : L) * 0.3) return null
            // 二重の札と同じで、横に寝た帯では上端へ寄せる
            const ty = vert
              ? L * 0.045
              : depth.top + Math.min(room * 0.5, W * 0.045)
            // 二重の帯と同じ書き方にする。片方だけ主語が付いていると、違うものに見える
            const label = longLayerLabels ? '生地が一重' : '一重'
            // 置きどころも二重の札と同じ決まり。縦に長ければ上端、横に長ければ左端
            const isz = W * 0.046
            const mid = (depth.left + (W - depth.right)) / 2
            const icx = vert ? mid - label.length * W * 0.019 - W * 0.04 : W * 0.02 + isz * 0.5
            const tx = vert ? mid : icx + isz * 0.5 + W * 0.016
            return (
              <g>
                {iconLayers(icx, ty, isz, 1, '#7d867e', true)}
                <text x={tx} y={ty} fontSize={W * 0.036} fontWeight={600} fill="#7d867e"
                  textAnchor={vert ? 'middle' : 'start'} dominantBaseline="middle"
                  stroke="#ffffff" strokeWidth={W * 0.012} paintOrder="stroke">{label}</text>
              </g>
            )
          })()}

          {/*
            みみの名前。回転させた横書きは読みづらいので縦書きにし、
            上に「みみが何枚重なっているか」のピクトグラムを添える。
            点々の帯2本＝みみ2枚（断面図と同じ見方）。「（2枚）」と文字で書くより伝わる。

            ここは面の重なりの印（`iconLayers`）ではなく、
            みみ専用の印（`iconSelvageLayers`）を使う。理由はその関数のところに書いた
          */}
          {selvages.map((s) => {
            // 下の一枚がいちばん外へ出ているところより、さらに外に書く。
            // 横わでは回り込んだぶん右へ出ているので、それも数に入れる
            const x = s === 'left'
              ? Math.min(bx0, under.x0) - PAD * 0.4
              : Math.max(bx1, under.x1) + PAD * 0.4
            const size = W * 0.036
            // 押すとこちら側が「わ」になる。上の小さな図で押すのと同じこと
            return edgeTag(s, x, L * 0.5, W * 0.13, W * 0.32, (
              <>
                {iconSelvageLayers(x, L * 0.5 - size * 2.1, W * 0.082, hasUnder ? 2 : 1, '#7f857d')}
                <text x={x} y={L * 0.5 + size * 0.3} fontSize={size} fill="#8a9188"
                  textAnchor="middle">
                  <tspan x={x}>み</tspan>
                  <tspan x={x} dy={size * 1.05}>み</tspan>
                </text>
              </>
            ))
          })}

          {/*
            折り山の頂きをなぞる線と、その名前。パーツより後ろに描く。
            わ の辺を当てたパーツが折り山の真上に来るので、先に描くと隠れてしまう。
            名前は枠の外に置く。生地の上は型紙のためにあけておきたい
          */}
          {foldSides.map((side) => {
            const horiz = side === 'left' || side === 'right'
            /*
              折り山の線は、生地の端そのもの。角のまるみのぶんだけ手前で止める。
              下の一枚がそちらへずれているときは、そのぶんだけ先まで伸ばす。
              線の先が下の一枚に届いていないと、そこで生地が切れて見える
              （依頼者の指摘・2026-08-30）
            */
            /*
              折り山の線。ずれた側の端は、2枚の裁ち端が集まる頂点まで伸ばす。
              そこから先は半円で回り込むので、線がそこで終わっていて途切れて見えない
            */
            const apex = {
              left: [0, TIP, 0, leadApex],
              right: [W, TIP, W, leadApex],
              top: [bx0 + TIP, 0, leadApex, 0],
              bottom: [bx0 + TIP, L, leadApex, L],
            }[side]
            const lx = {
              left: -PAD * 0.42, right: W + PAD * 0.42,
              top: bxMid, bottom: bxMid,
            }[side]
            const ly = {
              left: L * 0.5, right: L * 0.5,
              top: -PAD * 0.36, bottom: L + PAD * 0.36,
            }[side]
            /*
              横わ（上下が折り山）の札は、ヘアピンの印と「わ（折り山）」の文字を
              横に並べる。印と文字が重なっていたので、間を取り直した
              （依頼者の指摘・2026-08-30）。
              印 0.056 ＋ すき間 0.026 ＋ 文字 6字ぶん 0.24 ＝ 0.322 を、
              札の幅 0.36 の中に収める
            */
            const tag = horiz
              ? { w: W * 0.16, h: W * 0.34 }
              : { w: W * 0.36, h: W * 0.16 }
            return (
              <g key={side}>
                <line x1={apex[0]} y1={apex[1]} x2={apex[2]} y2={apex[3]}
                  stroke={CREASE} strokeWidth={W * 0.007} strokeLinecap="round" />
                {/* 押すと「わ」が外れる。折り山の札そのものが、その口になっている */}
                {edgeTag(side, lx, ly, tag.w, tag.h, horiz ? (
                  <>
                    {iconFold(lx, ly - W * 0.105, W * 0.056, side, CREASE)}
                    <text x={lx} y={ly - W * 0.032} fontSize={W * 0.052} fontWeight={700}
                      fill={CREASE} textAnchor="middle" dominantBaseline="middle">わ</text>
                    <text x={lx} y={ly + W * 0.038} fontSize={W * 0.029} fill={CREASE}
                      textAnchor="middle">
                      {[...'折り山'].map((c, i) => (
                        <tspan key={i} x={lx} dy={i === 0 ? 0 : W * 0.033}>{c}</tspan>
                      ))}
                    </text>
                  </>
                ) : (
                  <>
                    {iconFold(lx - W * 0.132, ly, W * 0.056, side, CREASE)}
                    <text x={lx + W * 0.042} y={ly} fontSize={W * 0.04} fontWeight={700}
                      fill={CREASE} textAnchor="middle" dominantBaseline="middle">
                      わ（折り山）
                    </text>
                  </>
                ))}
              </g>
            )
          })}

          {/* いま使っているところの終わり。ここまでが買う長さに効く */}
          {used > 0 && used < L && (
            <g>
              <rect x={bx0} y={used} width={bodyW} height={L - used}
                fill="#f4f5f1" fillOpacity={0.85} />
              <line x1={bx0} y1={used} x2={bx1} y2={used}
                stroke="#9aa69e" strokeWidth={W * 0.005}
                strokeDasharray={`${W * 0.03} ${W * 0.02}`} />
              {/*
                線の**下**に置く（依頼者の指摘・2026-08-31）。
                これまでは文字の足を線に合わせていたので、
                字のほとんどが線の上——つまり型紙の側——にはみ出して、
                いちばん下に置いた型紙の裾と重なって読めなくなっていた。
                残りが浅いときは、その帯の中に収まるところまで戻す
              */}
              <text x={bxMid} y={used + Math.min((L - used) * 0.5, W * 0.05)}
                fontSize={W * 0.038} fill="#5c665f"
                textAnchor="middle" dominantBaseline="middle"
                stroke="#f4f5f1" strokeWidth={W * 0.011} paintOrder="stroke">
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
          summary={hasUnder
            ? <>見えている面は<b className="text-mat-600">ぜんぶ二重</b>。型紙1つで2枚とれます</>
            : flaps.length > 0
              ? <>濃いところが<b className="text-mat-600">二重</b>、白いところが一重です</>
              : <>折らずに<b className="text-ink-700">一重</b>で使っています</>}
        >
          {half && section.fold === 'vBoth' ? (
            <>
              生地幅 {((report.foldDepth.left + report.foldDepth.right) * 2 + SELVAGE_MM * 2) / 10} cm を、
              両側のみみが出会うまで折っています。
              折り山が左右に1本ずつあるので、「わ」の辺を持つ型紙を、左右どちらにも当てられます。
              折り返す深さは、当てた型紙に合わせて左右べつべつに決まるので、
              出会うところは真ん中とはかぎりません。
            </>
          ) : half && section.fold === 'hBoth' ? (
            <>
              上下の裁ち端が出会うまで折っています。
              折り山が上下に1本ずつあるので、「わ」の辺を持つ型紙を、どちらにも当てられます。
              折り返す深さは、当てた型紙に合わせて上下べつべつに決まるので、
              出会うところは真ん中とはかぎりません。
              買う長さは、見えている面の長さ {(report.surfaceLengthMm / 10).toFixed(0)} cm の倍になります。
            </>
          ) : half && isHorizontalFold(section.fold) ? (
            <>
              生地を長さの方向に、きっちり半分に折っています。
              買う長さは、見えている面の長さ {(report.surfaceLengthMm / 10).toFixed(0)} cm の倍になります。
              折り山の反対の端には裁ち端が2枚重なっていて、下の一枚が少しのぞいています。
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
        {/*
          両側から折ったのに、片方の折り山に何も当てていないとき。
          その側は深さがゼロになり、折っていないのと同じ結果になる
          （依頼者の指摘・2026-08-30「上側の輪の部分だけを使っていった場合、
          下輪の意味がなくなってきてしまう」）。
          道具の不具合ではなく折り方の性質なので、隠さずそのまま伝える。
          学生が「なぜ上下にしたのに得しないのか」を自分で納得できる形にする
        */}
        {idleFold && (
          <Note icon="fold">
            <b className="text-ink-700">{SIDE_LABELS[idleFold]}の折り山</b>には、
            まだ何も当てていません。いまのところ、{SIDE_LABELS[idleFold]}は折らなくても同じです。
            両側から折るのが効くのは、どちらの折り山にも「わ」の辺を持つ型紙を当てるときです。
          </Note>
        )}
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
        <br />
        <b className="text-ink-700">写真から形をうまく拾えなかった型紙も、ここで置けます。</b>
        実物にメジャーを当てて、いちばん広いところの幅と、いちばん長いところの丈を
        「その他」で入れてください。形は長方形になりますが、要尺の見積もりとしては足ります。
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

/**
 * 「わに当てる」を出してよい辺（依頼者の指摘・2026-08-31）。
 *
 * 折り山がある辺すべてに札を出していたので、
 * **「わ」の辺が左を向いている型紙に「わに当てる（右）」が出ていた**。
 * 押しても向きが合わないので、生地の右端に寄るだけで折り山には当たらない。
 * 指で引きずって当てるときは向きを見て吸い付くようにしてあるのに、
 * 札のほうだけが野放しになっていた。同じ決まりに揃える。
 *
 * いま当てている辺だけは、外せるように必ず残す。
 * 当てたあとで型紙を回すと向きが変わるので、
 * 絞り込んだだけだと札が消えて、当てっぱなしから抜けられなくなる
 */
function snapTargetsOf(part: PlacedPart | undefined, p: Placement, foldSides: Side[]): Side[] {
  const fit = part ? foldEdgeSides(part, p).filter((sd) => foldSides.includes(sd)) : []
  const now = p.snapTo
  return now && foldSides.includes(now) && !fit.includes(now) ? [...fit, now] : fit
}

/* ------------------------------------------------------- 選んだパーツの操作 */

function Controls({
  placement, name, size, count, reserve, hasNap, snapTargets, onPatch, onRemove, onClose,
}: {
  placement: Placement
  name: string
  /** 取り込んだ大きさ(mm)。`cut` は縫い代まで入れた裁ち切り */
  size: { w: number; h: number; cut: { widthMm: number; heightMm: number } | null } | null
  count: number
  /** 後で裁つぶんの余白か。ただの長方形なので、選べることが少ない */
  reserve: boolean
  hasNap: boolean
  /** 「わに当てる」を出す辺。その型紙の「わ」が向いている辺だけに絞ってある */
  snapTargets: Side[]
  onPatch: (over: Partial<Placement>) => void
  onRemove: () => void
  onClose: () => void
}) {
  /** いま回している角度（0・90・180・270） */
  const turn = turnOf(placement)
  /*
    出たことに気づけるようにする（依頼者の指摘・2026-08-30
    「メニューの背景色が白なので、表示されたことに気づきにくい」
    「薄い緑にするとか、背景に色をつけるのはどうなんでしょうか」）。

    いちど動きと縁だけで直したが、それでは足りなかった。
    画面の地の色（`--color-chalk`）がほとんど白なので、
    白い板を白い紙の上に置いていたことになる。
    **地の色そのものを薄い緑（`--color-mat-50`）に変える。**

    - 地を薄い緑にして、下の画面と別の板だとひと目で分かるようにする
    - 上の縁を「わ」と同じ濃い緑の太線にする
    - 下からすっと立ち上がる（`panel-up`。選び直すたびに出しなおす）
    - 影を濃くして、生地の上に重なっている板だと分かるようにする
    - つまみの横棒を置く。ここが下から出てきたものだと、形でも言う

    地に色が付いたので、その上に乗るものの色も入れ替える（依頼者の指摘
    「現在のボタンや文字の背景色が必要か不要か、その辺も考える必要がある」）。

    - 押していないボタンは**白地**にする。緑の板の上に置いた札に見える。
      地と同じ色のままだと、押せるものだと分からなくなる
    - 「この1つで◯枚」の札も白地にする。もとは薄い緑だったので、
      板と同じ色になって消えてしまう
    - 「あとで裁つぶん」の札は生成りのままでよい。緑の上でむしろ目立つ
    - つまみの横棒は薄い緑の上では見えないので、一段濃い緑にする
    - 説明文は地の色を持たないので、そのまま
  */
  return (
    <div className="safe-b fixed inset-x-0 bottom-0 z-10 border-t-2 border-mat-500 bg-mat-50 px-4 pt-2 shadow-[0_-12px_32px_rgba(43,51,45,0.22)] panel-up">
      <div className="mx-auto flex max-w-md flex-col gap-2">
        <div className="mx-auto h-1 w-10 rounded-full bg-mat-300" />
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-900">{name}</span>
          {reserve ? (
            <span className="rounded-md bg-hold-50 px-2 py-0.5 text-xs font-bold text-hold-700">
              あとで裁つぶん
            </span>
          ) : (
            <span className="tnum rounded-md bg-white px-2 py-0.5 text-xs font-bold text-mat-600">
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

        {/*
          取り込んだ大きさ。実物に定規を当てて突き合わせるためのもの
          （依頼者の指示・2026-08-31「きちんと寸法が合っているもので取り込まれている
          ということを確認できる安心材料として、数値が見られた方がいい」）。
          型紙の上に出しっぱなしにはしない、というのも同じ指示。
        */}
        {size && (
          <p className="tnum -mt-1 text-[11px] leading-snug text-ink-500">
            {reserve ? '大きさ' : '型紙'}{' '}
            <b className="font-bold text-ink-700">{cm(size.w)} × {cm(size.h)} cm</b>
            {!reserve && size.cut && (
              <span className="text-ink-300">
                {' '}／ 裁ち切り {cm(size.cut.widthMm)} × {cm(size.cut.heightMm)} cm
              </span>
            )}
          </p>
        )}

        {/* 操作は全部、結果の形を絵にしてある。言葉より先に、どうなるかが見える */}
        <div className="flex flex-wrap gap-1.5">
          {!reserve && snapTargets.map((s) => (
            <Chip
              key={s}
              on={placement.snapTo === s}
              onClick={() => onPatch({ snapTo: placement.snapTo === s ? null : s })}
            >
              <Icon name="fold" />
              わに当てる（{SIDE_LABELS[s]}）
            </Chip>
          ))}
          {/*
            回すのは、左右へ90度ずつの1組にまとめてある
            （依頼者の指摘・2026-08-31「任意で左右方向に90°ずつ回転出来るボタンが
            あればそれで済むし、分かりやすい」）。

            もとは「差し込む（180°）」と「横向き（地の目を変える）」という
            2つの入り／切りだった。中身は同じ4通りの向きなのに、
            目当ての向きにするのにどちらを押せばよいのかが読めず、
            2つ押して初めて 270 度になる、というのも表からは分からなかった。

            いまの角度をまんなかに出しておく。押した結果がどうなったかを、
            図を見に行かなくても確かめられるようにするため
          */}
          <div className="flex items-center gap-0.5 rounded-lg border border-mat-100 bg-white px-1 py-1">
            <button
              type="button"
              aria-label="左へ90度回す"
              onClick={() => onPatch(turnBy(placement, -1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-ink-700 active:bg-mat-50"
            >
              <Icon name="turnLeft" className="h-4 w-4 shrink-0" />
              左へ90°
            </button>
            <span className="tnum w-9 shrink-0 text-center text-xs font-bold text-mat-600">
              {turn}°
            </span>
            <button
              type="button"
              aria-label="右へ90度回す"
              onClick={() => onPatch(turnBy(placement, 1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-ink-700 active:bg-mat-50"
            >
              右へ90°
              <Icon name="turnRight" className="h-4 w-4 shrink-0" />
            </button>
          </div>
          {!reserve && (
            <Chip
              on={placement.mirrored}
              onClick={() => onPatch({ mirrored: !placement.mirrored })}
            >
              <Icon name="mirror" />
              裏返す
            </Chip>
          )}
        </div>

        {reserve && (
          <Note icon="hold">
            これは型紙ではなく、<span className="font-bold text-ink-700">空けておく場所</span>です。
            仮縫いのあとで寸法が決まってから、ここを裁ちます。
          </Note>
        )}
        {/*
          いまの向きが、実物の言葉で何にあたるか。
          札の名前を「回す」に寄せたぶん、意味はここで言う。
          0度のときは何も言わない——ふつうの置き方に注意書きは要らない
        */}
        {turn === 180 && (
          hasNap ? (
            <Note icon="nap" tone="warn">
              <span className="font-bold">上下逆（差し込み）</span>にしています。
              この生地は<span className="font-bold">向きがある</span>ので、
              上下逆にすると毛並みや柄の向きがそろいません。
            </Note>
          ) : (
            <Note icon="nest">
              <span className="font-bold text-ink-700">上下逆（差し込み）</span>にしています。
              向きのない生地では、こうして互い違いに入れると生地が節約できます。
            </Note>
          )
        )}
        {/*
          「ダメ」とは言わない（依頼者の指示・2026-08-30）。
          サーキュラースカートのように、生地幅に縦地で入りきらないものは
          横地で裁つことが実際にある。止めるのではなく、
          そうなっていることが分かるようにしておく。図の型紙の上にも同じ印が出る
        */}
        {placement.rot90 && (
          <Note icon="grainSide">
            <span className="font-bold text-ink-700">地の目が横</span>になっています。
            生地の幅に縦地で入りきらないときは、こう置くことがあります。
            伸び方も落ち方も変わるので、そのつもりで。図の型紙にも印が出ます。
          </Note>
        )}
      </div>
    </div>
  )
}

/*
  入り／切りの札。押せない状態は持たせていない——
  「実物でありうることは止めない」（依頼者の指示・2026-08-30）ので、
  灰色にして押せなくするかわりに、注意書きで知らせている
*/
function Chip({
  on, onClick, children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
        on ? 'bg-mat-500 text-white' : 'border border-mat-100 bg-white text-ink-700'
      }`}
    >
      {children}
    </button>
  )
}
