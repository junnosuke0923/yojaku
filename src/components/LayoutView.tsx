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

import {
  useEffect, useMemo, useRef, useState,
  type PointerEvent, type ReactNode, type RefObject,
} from 'react'
import { cutSizeOf, isReserve, RESERVE_CHOICES, toReserve } from '../lib/store'
import { cm } from '../lib/format'
import {
  computeYardage, foldEdgeSides, FOLD_LABELS, FOLD_MARK_REF_MM,
  foldFromEdge, foldScaleOf, foldSidesOf, freeSpotFor, sizeOf as partSizeOf, turnBy, turnOf,
  isHalfFold, isHorizontalFold, isVerticalSide, newPlacement, orientedPair,
  PURCHASE_MARGIN_MM, PURCHASE_ROUND_MM, SELVAGE_MM, SNAP_MM,
  packedUp, pulledIn,
  type EdgeAction, type Fabric, type FoldMark, type FoldMode, type PlacedPart,
  type Placement, type Problem, type Section, type Side,
} from '../lib/fabric'
import { defaultName, MAX_SAVES, putSave, type Save } from '../lib/saves'
import { renderLayoutImage, saveImage, type Sheet } from '../lib/exportImage'
import { FoldSetup } from './FoldSetup'
import { applyFoldChange, placedPartOf, type PartsState, type StoredPart } from '../lib/store'
import { FoldDiagram } from './FoldDiagram'
import { Hint, Icon, Note } from './Icon'
import { PatternMarks } from './PatternMarks'
import { T } from './TextTools'
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
  /**
   * 1つ戻す。消したあとの知らせの中に、その口そのものを置くため。
   *
   * 「上の『1つ戻る』で戻せます」と書いてあっても、
   * 読んで探しに行くまでに知らせが消えてしまった
   * （学生の点検・2026-09-02・2巡目）。
   * 読ませるのではなく、**その場で押せるようにする**
   */
  onUndo: () => void
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

/**
 * 「押した」と「引きずった」の境目（画面の点）。
 *
 * 指を置いたまま止めていても、この距離ぶんは必ず揺れる。
 * ここを超えて初めて引きずったと見なす
 */
const TAP_SLOP = 6

/**
 * 生地の絵の高さの上限（依頼者の指摘・2026-09-04）。
 *
 * 絵の高さは生地の丈そのままなので、型紙を置くほど絵が縦に伸びる。
 * 下端の手元（棚）は画面に貼り付いているので隠れはしないが、
 * **絵と手元が一度に目に入らない**と、押した札がどこへ出たのか分からない。
 *
 * ふつうの丈（スカート1着ぶん）では、この上限に当たらない。
 * 当たるのは丈の長いもの（コートなど）だけで、そのときは絵ごと小さくなる。
 * 縮めた先で突き合わせるために、二本指で寄る操作をすでに入れてある
 */
const SHEET_MAX_H = 'min(58vh, 580px)'

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

/** 画像づくりの見切り。これを超えたら、やめて理由を出す */
const DRAW_LIMIT_MS = 20000

/** 生地の色。一重のところと、折り返して二重になっているところ */
const CLOTH = '#fdfcf8'
const CLOTH_FOLDED = '#efeee2'
const CREASE = '#35664e'
/** まちがっているところの色（`--color-seam` と同じ赤） */
const ALERT = '#b4433a'

/**
 * まちがっている型紙の**上に重ねて出す**、短い言い方（依頼者の指示・2026-09-04）。
 *
 * 赤い枠と、絵の外の赤い注意書きは前から出ていたが、
 * 「気づきにくい」と指摘された。理由は3つあった——
 * (1) 赤い枠が、選んでいる緑の枠と**同じ太さ・同じ濃さ・同じ形**で、色だけが違った。
 * (2) 赤い注意書きが**絵より上**にあり、生地の下のほうを触っていると画面の外にいた。
 * (3) 「わの辺」の話なのに、型紙まるごとが赤くなるだけだった。
 *
 * そこで、何がまずいのかを**その型紙の上に赤字で直接書く**。
 * 長い説明（どうすれば直るか）は絵の外の一覧に残してあるので、
 * ここは「何が起きているか」だけを一息で読める長さにする。
 *
 * 図を画像に書き出すときの注記は図の外へ出す決まりだが、
 * これは**その場で直してもらうための表示**なので、逆に上へ重ねてよい
 */
const ALERT_TEXT: Record<Problem['kind'], string> = {
  offFold: 'わの位置が正しくありません',
  noSuchFold: 'この折り方に、その折り山はありません',
  tooWide: '生地の幅からはみ出しています',
  tooDeep: '折り返しが深すぎます',
  overlap: '型紙が重なっています',
  acrossMeet: '出会い目をまたいでいます',
  napLocked: '毛並みの向きがそろいません',
  pastFold: '折り返しからはみ出しています',
}

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

export function LayoutView({
  state, onChange, onBack, saveName, onSaveName, onSaved, onUndo,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /**
   * 選んだ型紙の操作板を開いているか（依頼者の指摘・2026-09-04）。
   *
   * もとは、つかんだ瞬間に板が開いていた。板は画面の下端に出るので、
   * **引きずるたびに手元（下の棚）が隠れる**。次の型紙を出すには、
   * まず板を閉じることになっていた。
   *
   * 引きずるのと、選んで細かく決めるのは別の用事なので、分ける。
   * **動かしたら開かない。動かさずに離した（＝押した）ときだけ開く。**
   */
  const [panelOpen, setPanelOpen] = useState(false)
  /**
   * 手元（画面の下端の棚）を開いているか。
   *
   * たためるようにしてある（依頼者の要望・2026-09-04）。
   * 生地の下のほうへ型紙を置くときは、棚がその場所にかぶさるため。
   * たたんでも細い帯は残す——消えてしまうと、戻し方が分からなくなる。
   *
   * 0＝たたむ、1＝横一列、2以上＝札を折り返して何段ぶん見せるか
   * （依頼者の要望・2026-09-05）。帯を上へ引いて決める
   */
  const [dockRows, setDockRows] = useState(1)
  /**
   * 「あとで裁つぶん」の用紙を開いているか（依頼者の指示・2026-09-05）。
   *
   * もとは本文に見出しと一覧を出していたが、生地の絵の**下**にあるので、
   * 生地が長いほど下へ遠ざかった。型紙の一覧を下端の棚へ移した
   * （2026-09-04）ときとまったく同じ問題が、こちらに残っていた。
   *
   * 棚の札の列の最後に「＋ あとで裁つぶん」の札を置き、
   * 押すと、この用紙が棚と入れ替わって下から出る
   * （型紙を押したときに操作板が出るのと同じ入れ替わり方）
   */
  const [reserveOpen, setReserveOpen] = useState(false)
  /**
   * いま出したばかりの型紙。少しのあいだ光らせる。
   *
   * 押した札と、生地の上に出てきたものを結びつけるための合図
   * （依頼者の指摘・2026-09-04「形が似ていると置き間違える」）
   */
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1600)
    return () => clearTimeout(t)
  }, [flashId])
  const [activeSection, setActiveSection] = useState(state.sections[0]?.id ?? 's1')
  /** 生地を1つ消した直後か。しばらく置いてから、ひとりでに引っ込む */
  const [dropped, setDropped] = useState(false)
  useEffect(() => {
    if (!dropped) return
    const t = setTimeout(() => setDropped(false), 6000)
    return () => clearTimeout(t)
  }, [dropped])
  /** 画像に書き出すとき、この中から生地の絵（svg[data-sheet]）を拾う */
  const rootRef = useRef<HTMLElement>(null)

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
  /** 生地の上に置いたもの1つの名前。重なりの知らせで、両方の名前を出すのに使う */
  const nameOfPlacement = (placementId: string | undefined) =>
    nameOf(state.placements.find((p) => p.id === placementId)?.partId ?? '')

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
   * 二重のところに丸ごと入っていて、1枚と2枚のどちらにもできる置き方か。
   *
   * 半分に折った生地では見えている面が丸ごと二重なので、
   * **置けば必ず2枚**になる。1枚しか要らないパーツは 0 枚か 2 枚しか選べず、
   * 「要る数より多く置いています」がどうやっても消えなかった
   * （学生の点検・2026-09-02・2巡目。ここで3〜4分止まっている）
   */
  const twoLayerOf = (placementId: string) =>
    report.counts.find((c) => c.placementId === placementId)?.couldBeTwo ?? false

  /**
   * 二重のところがあるのに、この型紙は1枚しか取れていないか。
   *
   * 90度まわすと ×2 が消える、という報告があった（学生の点検・2026-09-02）。
   * 動きとしては正しい——二重の帯に丸ごと入っていれば2枚、
   * まわしてはみ出せば1枚——だが、その理由が画面のどこにも出ていなかった。
   * 折り山に当てている型紙は、開けば左右対称の1枚なので、この話には入れない
   */
  const couldBeTwoOf = (p: Placement) => {
    const c = report.counts.find((x) => x.placementId === p.id)
    const sr = report.sections.find((s) => s.id === p.sectionId)
    return !!c && c.count === 1 && !c.onFold && (sr?.doubled.length ?? 0) > 0
  }

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

  /**
   * 型紙を1つ、ぶつからない場所へ出す。**置き場所を決めて返すだけ。**
   *
   * 1つずつ押したときと「ぜんぶ出す」で、まったく同じ道を通すために分けてある。
   * すでに置いてあるものは `list` で渡す——まとめて出すときは、
   * まだ画面に反映されていない途中の並びを見ながら次の場所を決めるため
   */
  const nextPlacement = (list: Placement[], partId: string, rest?: number): Placement => {
    // 消したあとに置き直すと番号がぶつかることがあるので、空いている番号まで送る
    let n = list.length
    while (list.some((q) => q.id === `pl${n}_${partId}`)) n += 1
    const id = `pl${n}_${partId}`
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
    /*
      ぶつからない場所へ出す（学生の点検・2026-09-02）。
      もとはどれも左上の角へ出していたので、2つめを押した瞬間に
      1つめと丸ごと重なり、押しただけで「重なっています」が出ていた。
      詰めて並べてあげるのではなく、ぶつからない場所へ出すだけ。
      どこへ動かすかは、これまでどおり本人が指で決める
    */
    const rep = list === state.placements ? report : computeYardage(fabric, list, partMap)
    const sr = rep.sections.find((sc) => sc.id === activeSection)
    const at = part && sr
      ? freeSpotFor(partSizeOf(part, { ...fresh, snapTo }), sr, {
        x: snapTo === 'left' ? 0
          : snapTo === 'right' ? sr.surfaceWidthMm - partSizeOf(part, { ...fresh, snapTo }).w
            : undefined,
        y: snapTo === 'top' ? 0 : undefined,
      })
      : { xMm: 0, yMm: 0 }
    const made: Placement = { ...fresh, snapTo, ...at }
    /*
      要る枚数を超えてしまうときは、**上の一枚だけを裁つ**印を付けて出す
      （学生の点検・2026-09-02・2巡目。ここで3〜4分止まっている）。

      半分に折った生地では、見えている面が丸ごと二重なので、置けば必ず2枚とれる。
      1枚しか要らない型紙は、置いた瞬間に「1 多い」になり、
      動かしても回しても消せない——という行き止まりになっていた。
      実物の裁断でも、1枚でよいものは下の層を避けて上だけ裁つ。
      その手つきを最初から当てておく。あとから2枚に変えることもできる
    */
    if (rest !== undefined && rest > 0) {
      const after = computeYardage(fabric, [...list, made], partMap)
      const got = after.counts.find((c) => c.placementId === made.id)?.count ?? 1
      if (got > rest) return { ...made, topOnly: true }
    }
    return made
  }

  /*
    出したあと、その型紙を選んだ状態にはしない（依頼者の指摘・2026-09-04）。
    選ぶと操作板が下から出てきて、手元の棚をふさいでしまう。
    代わりに、出てきたものをしばらく光らせて「これが出た」とだけ言う
  */
  const place = (partId: string) => {
    const part = state.parts.find((p) => p.id === partId)
    const rest = part && !isReserve(part) ? part.needed - takenOf(partId) : undefined
    /*
      **要る枚数より多くは置けない**（依頼者の指示・2026-09-05
      「前のセクションで型紙の枚数を設定したら、
        その枚数しか型紙を置けないようにしたい」）。

      もとは何度でも押せたので、いくらでも同じ型紙を出せてしまった。
      置いたぶんはそのまま要尺に効くので、押し間違いがそのまま
      「生地を余分に買う」という数字になっていた。

      数えるのは置いた**数**ではなく、そこから取れる**枚数**。
      二重のところに置いた1つは2枚ぶんなので、
      1つ置いただけで足りてしまうことがある（`takenOf` を見よ）。
      逆に、置いたものを一重のところへ動かせば足りなくなり、また出せるようになる。

      棚の札のほうも押せなくしてあるが、ここでも止める。
      数え方が変わったときに、片方だけ直して素通りするのを防ぐため
    */
    if (rest !== undefined && rest <= 0) return
    const made = nextPlacement(state.placements, partId, rest)
    onChange({ ...state, placements: [...state.placements, made] })
    setFlashId(made.id)
  }

  /**
   * 要る枚数ぶんを、まとめて生地へ出す（依頼者の指示・2026-09-04）。
   *
   * 裁ち合わせの実物では、型紙はもう手元に全部そろっている。
   * 1枚ずつ「取ってくる」のはこの道具の都合でしかないので、
   * 一息で出しきって、**並べ替えだけを学生の仕事にする**。
   *
   * 出すたびに取れる枚数が変わる（二重のところに置けば1つで2枚）ので、
   * 1つ足すごとに数え直す。足りていれば、そのパーツは飛ばす
   */
  const placeAll = () => {
    let list = state.placements
    for (const part of state.parts) {
      if (isReserve(part)) continue
      // 数え直しながら足すので、万一いつまでも足りないときのために回数で止める
      for (let guard = 0; guard < 40; guard += 1) {
        const rep = computeYardage(fabric, list, partMap)
        const taken = list
          .filter((q) => q.partId === part.id)
          .reduce((s, q) => s + (rep.counts.find((c) => c.placementId === q.id)?.count ?? 1), 0)
        if (taken >= part.needed) break
        list = [...list, nextPlacement(list, part.id, part.needed - taken)]
      }
    }
    if (list === state.placements) return
    onChange({ ...state, placements: list })
    setFlashId(list[list.length - 1]?.id ?? null)
  }

  const remove = (id: string) => {
    onChange({ ...state, placements: state.placements.filter((p) => p.id !== id) })
    setSelectedId(null)
    setPanelOpen(false)
  }

  /**
   * 後で裁つぶんの余白を足して、そのまま生地の上に置く。
   * 置くところまで一気にやるのは、余白は「場所を空けるため」に作るものなので、
   * 一覧に足しただけでは何も起きないため。
   */
  const addReserve = (name: string, widthMm: number, heightMm: number) => {
    const part = toReserve(name, widthMm, heightMm)
    const id = `pl${state.placements.length}_${part.id}`
    /*
      余白も、置いてある型紙にぶつからない場所へ出す
      （学生の点検・2026-09-02・2巡目「置いたら、すでにあるパーツの上に重なった」）。
      型紙のほうは 2026-09-02 の1巡目でこう直したのに、
      余白だけ左上の角へ出したままになっていた。
      余白は長方形そのものなので、入れてもらった寸法をそのまま当たり判定に使う
    */
    const sr = report.sections.find((sc) => sc.id === activeSection)
    const at = sr
      ? freeSpotFor({ w: widthMm, h: heightMm }, sr)
      : { xMm: 0, yMm: 0 }
    onChange({
      ...state,
      parts: [...state.parts, part],
      placements: [...state.placements, newPlacement(id, part.id, activeSection, at)],
    })
    setFlashId(id)
  }

  /** 余白そのものを消す。置いてある場所もまとめて消える */
  const dropPart = (partId: string) => {
    onChange({
      ...state,
      parts: state.parts.filter((p) => p.id !== partId),
      placements: state.placements.filter((p) => p.partId !== partId),
    })
    setSelectedId(null)
    setPanelOpen(false)
  }

  const addSection = () => {
    const id = `s${state.sections.length + 1}_${state.sections.length}`
    onChange({ ...state, sections: [...state.sections, { id, fold: 'none', halfFold: false }] })
    setActiveSection(id)
  }

  /*
    生地を1つ消すのに、確認はたずねない（学生の点検・2026-09-02）。
    このアプリは「1つ戻る」で戻せることを軸にしているので、
    確認を足すと押す回数だけが増える。
    ただし**戻せることに気づいたのが後だった**という報告があったので、
    消した直後に、その場でそう言う
  */
  const dropSection = (id: string) => {
    onChange({
      ...state,
      sections: state.sections.filter((s) => s.id !== id),
      placements: state.placements.filter((p) => p.sectionId !== id),
    })
    setActiveSection(state.sections.find((s) => s.id !== id)?.id ?? '')
    setDropped(true)
  }

  /**
   * 上の空きを、まとめて詰める（依頼者の判断・2026-09-02）。
   *
   * 学生はスマホで型紙を1つずつ引きずって上へ寄せている。
   * 10個を超えると、それだけでかなりの手間になる。
   *
   * ただし**並べるのは学生自身**という軸は崩さない。
   * ここでするのは「上へ落とす」だけで、**左右の位置と前後の順は一切変えない**。
   * どのパーツをどこへ置くかは、これまでどおり本人が決めたままになる。
   *
   * 上にあるものから順に、ぶつかるまで上げていく。
   * 折り山に当てているものは、当てた側から位置が決まっているので動かさない
   */
  const packUp = () => {
    const next = packedUp(report.sections, state.placements)
    if (next) onChange({ ...state, placements: next })
  }

  /** はみ出したものを、生地の幅の中へ横に寄せる */
  const pullIn = () => {
    const next = pulledIn(report.sections, state.placements)
    if (next) onChange({ ...state, placements: next })
  }

  /**
   * 出た見積もりを、そのまま資料に貼れる字にする（依頼者の案・2026-09-02）。
   *
   * 持ち出す先が画像1枚しかなかった。画像は見せるには良いが、
   * 報告書に数字として載せるには打ち直しが要る。
   * 画像と同じことを字でも出しておけば、そのまま貼れる。
   *
   * 中身は画面に出ているものだけにそろえてある。
   * ここにしか無い数字を作ると、画面と資料が食い違う
   */
  const summaryText = () => {
    const L: string[] = []
    const folds = state.sections
      .map((s, i) => (state.sections.length > 1 ? `${i + 1}つめ・` : '')
        + FOLD_LABELS[s.fold] + (isHalfFold(s) ? '・半分に折る' : ''))
      .join(' ／ ')
    L.push('■ 生地')
    L.push(`生地幅 ${state.fabricWidthMm / 10} cm`
      + `（みみを除くと ${(state.fabricWidthMm - SELVAGE_MM * 2) / 10} cm）`)
    L.push(`折り方 ${folds}`)
    L.push(`上下の向き ${state.hasNap ? 'あり' : 'なし'}`)
    L.push('')
    L.push('■ 買ってくる長さ')
    L.push(`${(report.purchaseMm / 10).toFixed(0)} cm`)
    L.push(`並べたぶん ${(report.totalMm / 10).toFixed(1)} cm ＋ ゆとり ${PURCHASE_MARGIN_MM / 10} cm`
      + ` → ${PURCHASE_ROUND_MM / 10} cm 単位に切り上げ`)
    L.push(`理屈のうえでの最短 ${(report.minTotalMm / 10).toFixed(1)} cm`)
    L.push('')
    L.push('■ パーツ（取れた枚数 / 要る枚数、縫い代まで入れた大きさ）')
    for (const p of state.parts) {
      const s = sizeOf(p.id)
      const size = s?.cut ? `${cm(s.cut.widthMm)} × ${cm(s.cut.heightMm)} cm` : '—'
      /*
        「上だけ裁つ」は、裁つときの指示そのもの。
        図にも印を出しているので、字のほうにも同じことを残しておく。
        これが抜けると、この一覧だけを見た人が二重のまま2枚裁ってしまう
      */
      const top = state.placements.some(
        (pl) => pl.partId === p.id && twoLayerOf(pl.id) && countOf(pl.id) === 1,
      )
      L.push(`${p.name}  ${takenOf(p.id)} / ${p.needed} 枚  ${size}`
        + (top ? '  ※上の一枚だけ裁つ' : '')
        + (isReserve(p) ? '  ※あとで裁つ' : ''))
    }
    if (report.problems.length > 0) {
      L.push('')
      L.push('■ まだ直っていないところ')
      for (const pb of report.problems) L.push(pb.message)
    }
    L.push('')
    L.push(`${today()} 要尺シミュレーターで作成（この数字は概算です）`)
    return L.join(String.fromCharCode(10))
  }

  /** そのパーツが、いま何枚ぶん取れているか */
  const takenOf = (partId: string) =>
    state.placements
      .filter((p) => p.partId === partId)
      .reduce((sum, p) => sum + countOf(p.id), 0)

  // 余白は「枚数」の話ではないので、足りない・足りているの数え上げには入れない
  const shortage = state.parts.filter((p) => !isReserve(p) && takenOf(p.id) < p.needed)
  /** 要る数より多く置いている型紙。間違いではないので、赤くはしない */
  const overPlaced = state.parts.filter((p) => !isReserve(p) && takenOf(p.id) > p.needed)

  /*
    余白は足した時点で生地に置かれている（学生の点検・2026-09-02・2巡目）。
    だから棚に札を出すのは、**生地から外したものだけ**。
    置きなおす口として並べる——これは文字どおり「まだ置いていないもの」なので、
    棚の意味とも食い違わない
  */
  const looseReserves = state.parts.filter((p) => isReserve(p) && takenOf(p.id) === 0)
  /*
    本物の型紙と、あとで裁つ用の場所を、同じ名前で両方置いている
    （学生の点検・2026-09-02）。仮縫いのあとで寸法が変わるものは
    わざと両方置くこともあるので**止めない**。二重に数えていないか、と聞くだけ
  */
  const dupReserves = state.parts.filter(
    (r) => isReserve(r) && state.parts.some((p) => !isReserve(p) && p.name === r.name),
  )

  return (
    <section
      ref={rootRef}
      /*
        下端に出るもの（手元の棚、または選んだ型紙の操作板）の高さぶん、
        本文の下に場所を空ける。たたんでいるときは帯のぶんだけでよい
      */
      className={`flex flex-col gap-3.5 ${
        reserveOpen ? 'pb-64'
          : selected && panelOpen ? 'pb-40'
            : dockRows > 0 ? 'pb-36' : 'pb-20'
      }`}
    >
      <Tour id="layout" />
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 self-start text-sm font-bold text-mat-700"
      >
        <Icon name="back" className="h-4 w-4 shrink-0" />
        {/*
          行き先は生地の設定（学生の点検・2026-09-02）。
          もとは「パーツの一覧へ」と書いてあったが、生地の画面を分けたときから
          1つ戻る先は生地になっていて、名前だけが古いまま残っていた
        */}
        生地の設定へ
      </button>

      {dropped && (
        <Note icon="check" tone="good">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <T id="layout.drop.note" strong="font-bold" />
            <button
              type="button"
              onClick={() => { onUndo(); setDropped(false) }}
              className="tap flex shrink-0 items-center gap-1 rounded-lg border border-mat-300 bg-white px-2.5 py-1 text-xs font-bold text-mat-700 active:bg-mat-50"
            >
              <Icon name="undo" className="h-3.5 w-3.5 shrink-0" />
              1つ戻す
            </button>
          </span>
        </Note>
      )}

      {report.problems.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-seam/40 bg-seam/5 px-4 py-3">
          {report.problems.map((pb, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-seam">
              <Icon name="warn" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0" />
              <span className="min-w-0 flex-1">
                {pb.kind === 'overlap' && pb.otherPlacementId ? (
                  <T
                    id="layout.overlap.pair"
                    vars={{ a: nameOfPlacement(pb.placementId), b: nameOfPlacement(pb.otherPlacementId) }}
                    strong="font-bold"
                  />
                ) : (
                  <>
                    {pb.placementId && (
                      <span className="font-bold">{nameOfPlacement(pb.placementId)}：</span>
                    )}
                    {pb.message}
                  </>
                )}
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
          flashId={flashId}
          canDrop={state.sections.length > 1}
          countOf={countOf}
          topOnlyOf={(id) => twoLayerOf(id) && countOf(id) === 1}
          onActivate={() => setActiveSection(section.id)}
          onSelect={(id) => { setSelectedId(id); setPanelOpen(false) }}
          /* 型紙の板を開くときは、余白の用紙は閉じておく。閉じたあとに出戻らせない */
          onOpen={(id) => { setSelectedId(id); setPanelOpen(true); setReserveOpen(false) }}
          onMove={patch}
          onFold={(fold, halfFold, depth, group) =>
            onChange(applyFoldChange(state, section.id, fold, halfFold, depth), group)}
          onHalf={(halfFold) =>
            onChange({
              ...state,
              sections: state.sections.map((s) => (s.id === section.id ? { ...s, halfFold } : s)),
            })
          }
          onDrop={() => dropSection(section.id)}
          purchaseMm={state.sections.length === 1 ? report.purchaseMm : undefined}
        />
      ))}

      {/*
        区間は、パーツが入りきらなくなって初めて要る。
        ふだんは1つのままで、学生に「区間」という言葉すら見せない（判断7）。

        めったに押さないボタンが、生地の絵のすぐ下で場所を取っていた
        （依頼者の指摘・2026-08-27）。
        白いボタンをやめて右寄せの小さな字にし、
        まだ何も置いていないうちは出さないようにしてある。
        言い方も、していること（生地を切り分ける）を先に置いた
      */}
      {(state.placements.length > 0 || state.sections.length > 1) && (
        <div className="flex items-center justify-end gap-3 px-1">
          {/*
            詰めるのは、切り分けるよりずっとよく使う。
            同じ薄さの字にすると押す前に見つけてもらえないので、
            こちらだけ濃くしてある
          */}
          {/*
            生地幅を狭めて戻ってくると、はみ出したものがそのまま残っていた
            （学生の点検・2026-09-02・2巡目）。
            横に寄せるだけの機械的な作業なので、まとめて引き受ける。
            はみ出しているときだけ出す
          */}
          {report.problems.some((pb) => pb.kind === 'tooWide') && (
            <button
              type="button"
              onClick={pullIn}
              className="mr-auto flex items-center gap-1 rounded-lg border border-seam/50 bg-white px-2.5 py-1.5 text-xs font-bold text-seam active:bg-seam/5"
            >
              <Icon name="clothWidth" className="h-3.5 w-3.5 shrink-0" />
              生地の中へ戻す
            </button>
          )}
          {state.placements.length > 1 && (
            <button
              type="button"
              onClick={packUp}
              className="flex items-center gap-1 rounded-lg border border-mat-300 bg-white px-2.5 py-1.5 text-xs font-bold text-mat-700 active:bg-mat-50"
            >
              <Icon name="packUp" className="h-3.5 w-3.5 shrink-0" />
              上の空きを詰める
            </button>
          )}
          <button
            type="button"
            onClick={addSection}
            className="flex items-center gap-1 py-0.5 text-xs text-ink-300 active:text-mat-700"
          >
            <Icon name="scissors" className="h-3.5 w-3.5 shrink-0" />
            ここから下を、別の折り方にする
          </button>
        </div>
      )}

      {/*
        枚数についての注意書き。
        型紙の一覧を下端の手元へ移したので（依頼者の指示・2026-09-04）、
        一覧に添えていたこの2つは**結果のすぐ手前**へ動かした。
        「足りないまま／多いまま出た長さです」と読める場所になる
      */}
      {shortage.length > 0 && (
        <Hint summary={<T id="layout.count.summary" />}>
          <T id="layout.count.body" />
        </Hint>
      )}
      {overPlaced.length > 0 && (
        <Hint summary={<T id="layout.count.over.summary" />}>
          <T id="layout.count.over.body" />
        </Hint>
      )}
      {/*
        同じ名前で型紙と余白を両方置いている、という知らせ。
        「あとで裁つぶん」の一覧は下端の棚へ移した（依頼者の指示・2026-09-05）ので、
        この一行も枚数の注意と同じ**結果のすぐ手前**へ動かした。
        「二重に数えたまま出た長さです」と読める場所になる
      */}
      {dupReserves.map((r) => (
        <p key={r.id} className="flex gap-2 text-xs leading-relaxed text-ink-500">
          <Icon name="warn" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0 text-seam" />
          <span className="min-w-0 flex-1">
            <T id="layout.reserve.dup" vars={{ name: r.name }} />
          </span>
        </p>
      ))}

      {/*
        買ってくる長さは、この画面の**結び**として下に置く（依頼者の指示・2026-08-27）。
        上にあると、まだ何も並べていないうちから結果が目に入って、
        「並べる → 長さが出る」という順に読めない。
        並べているあいだ変わっていく数字は、絵の中の「並べたぶん」で見える。
        ここは、そこから渡された結びの数字
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

      {/*
        出来た配置図を、画像にして端末へ出す（依頼者の指示・2026-09-01）。
        「しまっておく」の下に置く。どちらも出来あがったものの持ち出し方だが、
        しまうのはアプリの中、画像はアプリの外へ、という順にしてある
      */}
      <ImageBox
        rootRef={rootRef}
        report={report}
        widthMm={state.fabricWidthMm}
        sections={state.sections}
        summaryText={summaryText}
        onBeforeDraw={() => { setSelectedId(null); setPanelOpen(false) }}
      />

      {/*
        画面の下端は、いつも「いま押せるもの」だけにする。
        ふだんは手元（生地に置くものの棚）、
        型紙を押して細かく決めているあいだは、その操作板に入れ替わる。
        「あとで裁つぶん」を足すあいだは、その用紙に入れ替わる。
        2つ重ねると、下の棚が板に隠れて押せなくなる
      */}
      {!(selected && panelOpen) && !reserveOpen && (
        <Dock
          state={state}
          partMap={partMap}
          takenOf={takenOf}
          reserves={looseReserves}
          rows={dockRows}
          onRows={setDockRows}
          /*
            置いたら1段ぶんに戻す。棚を高くしているあいだは生地の絵が隠れているので、
            そのままでは置いた先を確かめられない
          */
          onPlace={(id) => { place(id); if (dockRows > 1) setDockRows(1) }}
          onPlaceAll={placeAll}
          onDropPart={dropPart}
          onAddReserve={() => setReserveOpen(true)}
        />
      )}

      {!(selected && panelOpen) && reserveOpen && (
        <ReservePanel
          onAdd={(name, w, h) => { addReserve(name, w, h); setReserveOpen(false) }}
          onClose={() => setReserveOpen(false)}
        />
      )}

      {selected && panelOpen && (
        <Controls
          key={selected.id}
          placement={selected}
          name={nameOf(selected.partId)}
          size={sizeOf(selected.partId)}
          count={countOf(selected.id)}
          couldBeTwo={couldBeTwoOf(selected)}
          twoLayer={twoLayerOf(selected.id)}
          reserve={isReserve(state.parts.find((p) => p.id === selected.partId) ?? ({} as StoredPart))}
          hasNap={state.hasNap}
          snapTargets={snapTargetsOf(
            partMap.get(selected.partId),
            selected,
            foldSidesOf(state.sections.find((s) => s.id === selected.sectionId)?.fold ?? 'none'),
          )}
          onPatch={(over) => patch(selected.id, over)}
          onRemove={() => remove(selected.id)}
          onClose={() => setPanelOpen(false)}
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
  /*
    ありえない置き方は「重なり」だけではない（学生の点検・2026-09-02・2巡目）。
    幅からはみ出しているときにも同じ注意が要るのに、
    ここが overlap しか見ていなかったので、はみ出しのときだけ
    大きな数字がそのまま書き写せてしまっていた
  */
  const overlapping = report.problems.some((pb) => pb.kind === 'overlap')
  const tooWide = report.problems.some((pb) => pb.kind === 'tooWide')
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
        重なったままでも長さは出る（学生の点検・2026-09-02）。
        ありえない置き方なのに大きな数字だけが目に入るので、
        そのまま書き写して提出できてしまう。
        止めはせず、**数字のすぐ下**で、まだ書き写せる数字ではないと言う
      */}
      {(overlapping || tooWide) && (
        <p className="flex gap-1.5 pt-1 text-xs leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0" />
          <span className="min-w-0 flex-1">
            <T id={overlapping ? 'layout.overlap.total' : 'layout.toowide.total'} />
          </span>
        </p>
      )}
      {/*
        この数字が概算であること（依頼者の指示・2026-08-28）。
        **結果の真下**に置く。ここを離すと、数字だけを書き写して
        そのぶんきっかり買いに行く人が出る。
        ひと言だけ出して、理由は「？」の中に畳んでおく
      */}
      <div className="pt-0.5">
        <Hint icon="warn" summary={<T id="layout.rough.summary" />}>
          <T id="photo.rough.body" />
        </Hint>
      </div>
      {/* 計算の中身は、式のかたちで一目で見せる。文にすると読ませることになる */}
      {report.totalMm > 0 ? (
        <div className="pt-1">
          <Hint
            icon="scissors"
            summary={
              <span className="tnum">
                {/*
                  ここだけ小数第1位まで出す（学生の点検・2026-09-02）。
                  もとは整数に丸めていたので「130 ＋ 20 → 切り上げ」と書いてあるのに
                  出ている数字が 160 になり、式のとおりに計算しても合わなかった
                */}
                並べたぶん {(report.totalMm / 10).toFixed(1)} cm
                <span className="px-1 text-ink-300">＋</span>
                ゆとり {PURCHASE_MARGIN_MM / 10} cm
                <span className="px-1 text-ink-300">→ 切り上げ</span>
              </span>
            }
          >
            <T id="layout.margin.note" vars={{ cm: PURCHASE_MARGIN_MM / 10 }} />
          </Hint>
          {/*
            理屈のうえでの最短（依頼者の案・2026-09-02）。
            要尺で伝えたいのは数字そのものではなく「詰め方しだいで変わる」ほう。
            並べたぶんのすぐ下に置いて、同じ目の高さで見比べられるようにする。
            **何%なら良いという目安は書かない**（依頼者の判断）
          */}
          <div className="pt-1">
            <Hint
              icon="packUp"
              summary={
                <T
                  id="layout.min.summary"
                  vars={{ cm: (report.minTotalMm / 10).toFixed(1) }}
                  strong="font-bold text-mat-700"
                />
              }
            >
              <T id="layout.min.body" />
            </Hint>
          </div>
        </div>
      ) : (
        <p className="pt-1 text-xs text-ink-500"><T id="layout.empty.note" /></p>
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

/* --------------------------------------------------- 画像にして持ち出す */

/**
 * 出来あがった裁ち合わせ図を、1枚の画像にして端末へ出す（依頼者の指示・2026-09-01）。
 *
 * 使い道は2つと聞いている——スマホに残して裁つときに見る、
 * パソコンに保存して授業資料に貼る。だから
 * **指で使う端末では共有の口、パソコンではそのまま取り込み**に分けてある
 * （lib/exportImage.ts の saveImage）。
 *
 * 生地幅と買う長さは、図にかからないよう下端の帯にまとめてある。
 * 資料に貼るとき数字が要らないことがある、と言われているので、
 * 帯ごと切り落とせる形にした。
 *
 * 何も並べていないうちは出さない。書き出す中身がまだ無いため。
 */
function ImageBox({
  rootRef, report, widthMm, sections, summaryText, onBeforeDraw,
}: {
  rootRef: RefObject<HTMLElement | null>
  report: ReturnType<typeof computeYardage>
  widthMm: number
  sections: Section[]
  /** 同じ中身を、資料に貼れる字にしたもの */
  summaryText: () => string
  /** 書き出す前にやっておくこと（選んである型紙の囲みを消す） */
  onBeforeDraw: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  /**
   * コピーできなかったときに、字そのものを出す先。
   *
   * 端末や設定によっては、字を写し取る口を使わせてもらえないことがある。
   * そこで終わりにすると持ち出す道が無くなるので、
   * **枠に出して、手で選んでもらう**逃げ道を残す
   */
  const [shown, setShown] = useState<string | null>(null)
  /**
   * 画像づくりが、終わりも失敗もしないまま帰ってこないことがある
   * （学生の点検・2026-09-02・2巡目。46秒待っても「書き出しています…」のままで、
   *  エラーも出ず、やめる方法も無く、ページを開き直すしかなかった）。
   *
   * 原因が端末側にあるのかこちらにあるのかは、まだ分かっていない。
   * ただ**終わらないときに何も言われず、やめられない**こと自体が困るので、
   * 原因の切り分けを待たずに、見切りと、やめる口を先に付ける。
   *
   * 途中でやめたあとに古い処理が帰ってきても知らせを書きかえないよう、
   * 何回目の書き出しかを持っておいて、いまのものだけを受け取る
   */
  const runId = useRef(0)

  const stop = () => {
    runId.current += 1
    setBusy(false)
    setBad(false)
    setNote('画像づくりをやめました')
  }

  const copy = async () => {
    const text = summaryText()
    setShown(null)
    try {
      await navigator.clipboard.writeText(text)
      setBad(false)
      setNote('一覧をコピーしました。資料にそのまま貼れます')
    } catch {
      setBad(true)
      setNote('コピーできませんでした。下の枠の字を選んで、手でコピーしてください')
      setShown(text)
    }
  }

  if (report.purchaseMm <= 0) return null

  const run = async () => {
    const my = ++runId.current
    setBusy(true)
    setNote(null)
    try {
      // 選んである型紙には緑の囲みが出ている。画像には残さない
      onBeforeDraw()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

      const found = rootRef.current?.querySelectorAll<SVGSVGElement>('svg[data-sheet]')
      const sheets: Sheet[] = [...(found ?? [])].map((svg, i) => ({
        svg,
        viewBox: svg.dataset.viewbox ?? svg.getAttribute('viewBox') ?? '0 0 100 100',
        label: sections.length > 1
          ? `${i + 1} つめ・${FOLD_LABELS[sections[i]?.fold ?? 'none']}`
          : undefined,
      }))
      if (sheets.length === 0) throw new Error('empty')

      const caption =
        `生地幅 ${widthMm / 10} cm ／ 買ってくる長さ ${(report.purchaseMm / 10).toFixed(0)} cm`
      const blob = await Promise.race([
        renderLayoutImage(sheets, caption),
        new Promise<never>((_, no) =>
          setTimeout(() => no(new Error('slow')), DRAW_LIMIT_MS)),
      ])
      const how = await saveImage(blob, `裁ち合わせ図-${today()}.png`)
      if (runId.current !== my) return
      setBad(false)
      if (how === 'downloaded') setNote('画像を保存しました')
      else if (how === 'shared') setNote('画像を渡しました')
    } catch (e) {
      if (runId.current !== my) return
      setBad(true)
      setNote(e instanceof Error && e.message === 'slow'
        ? `${DRAW_LIMIT_MS / 1000} 秒たっても画像ができませんでした。`
          + '図を小さくするか、読み込み直してから、もう一度お試しください'
        : '画像にできませんでした。読み込み直してから、もう一度試してください')
    } finally {
      if (runId.current === my) setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon name="photo" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="shrink-0 text-sm font-bold text-ink-700">資料に持ち出す</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-mat-500 px-4 py-2.5 text-sm font-bold text-white active:bg-mat-600 disabled:opacity-50"
        >
          <Icon name="photo" className="h-4 w-4 shrink-0" />
          {/* 「書き出す」は聞き慣れない言い方だった（学生の点検・2巡目） */}
          {busy ? '画像を作っています…' : '配置図を画像にして保存'}
        </button>
        {busy && (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 rounded-lg border border-ink-100 bg-white px-4 py-2.5 text-sm font-bold text-ink-500 active:bg-table"
          >
            やめる
          </button>
        )}
      </div>
      <Hint
        icon="photo"
        summary={<T id="layout.band.summary" />}
      >
        <T id="layout.band.body" />
      </Hint>
      {/*
        同じ中身を字でも出す（依頼者の案・2026-09-02）。
        画像は見せるためのもので、報告書に数字として載せるには打ち直しが要る。
        画像のすぐ下に置いて、どちらも同じものの持ち出し方だと分かるようにしてある
      */}
      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center justify-center gap-2 rounded-lg border border-mat-300 bg-white px-4 py-2.5 text-sm font-bold text-mat-700 active:bg-mat-50"
      >
        <Icon name="list" className="h-4 w-4 shrink-0" />
        一覧を文字でコピー
      </button>
      {shown !== null && (
        <textarea
          readOnly
          value={shown}
          rows={10}
          aria-label="持ち出す一覧"
          className="w-full rounded-lg border border-ink-100 p-2 text-xs leading-relaxed"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {note && <Note icon={bad ? 'warn' : 'check'} tone={bad ? 'warn' : 'good'}>{note}</Note>}
    </div>
  )
}

/** 書き出した画像の名前に付ける日付 */
function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ------------------------------------------------------------- 生地の面 */

function SectionCanvas({
  index, section, report, state, partMap, active, selectedId, flashId, canDrop,
  countOf, topOnlyOf,
  onActivate, onSelect, onOpen, onMove, onFold, onHalf, onDrop, purchaseMm,
}: {
  index: number
  section: Section
  report: ReturnType<typeof computeYardage>['sections'][number] | undefined
  state: PartsState
  partMap: Map<string, PlacedPart>
  active: boolean
  selectedId: string | null
  /** いま出したばかりの型紙。しばらく光らせる */
  flashId: string | null
  canDrop: boolean
  countOf: (placementId: string) => number
  /**
   * 二重のところに置いてあるのに、上の一枚だけを裁つと決めてあるか。
   *
   * 図には必ず出す。ここに印が無いと、この図を見て裁つ人は
   * **二重のまま2枚とも裁ってしまう**。裁つときの指示そのものなので、
   * 画像に書き出したものにも同じ印が残る
   */
  topOnlyOf: (placementId: string) => boolean
  onActivate: () => void
  /** つかんだ（＝これから動かすかもしれない）。印を付けるだけで、板は開かない */
  onSelect: (id: string) => void
  /** 動かさずに離した＝押した。細かく決める板を開く */
  onOpen: (id: string) => void
  onMove: (id: string, over: Partial<Placement>, group?: string) => void
  /**
   * 折り方を変える。「きっちり折るか」「折り返しの深さ」も、いっしょに渡す。
   *
   * `group` は、ひと続きの操作にまとめるための合図。
   * 辺を引きずって折り返す幅を決めるあいだは細かく何度も変わるので、
   * 同じ合図を付けて**戻るを1回で済ませる**
   */
  onFold: (
    fold: FoldMode, halfFold?: boolean, depth?: Partial<Record<Side, number | null>>,
    group?: string,
  ) => void
  onHalf: (halfFold: boolean) => void
  onDrop: () => void
  /**
   * 買ってくる長さ(mm)。**生地が1枚のときだけ**渡す。
   *
   * 何枚かに分けているときは、買う長さは全部を足したものなので、
   * 一枚の絵の上に書くと「この生地でこれだけ買う」と読めてしまう
   */
  purchaseMm?: number
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
      /**
       * 指が動いたか。**押しただけなのか、引きずったのか**を分けるために持つ。
       * 押しただけなら操作板を開き、引きずったなら開かない（依頼者の指摘・2026-09-04）
       */
      moved: boolean
    } | null
  >(null)
  /**
   * 型紙を折り山へ当てた（離した）ときに出す、ひと言。
   *
   * もとは絵の上の折り方の枠に出していた。その枠は区間が1つのときは
   * 出さなくなった（依頼者の指示・2026-09-01）ので、絵のすぐ下に移してある
   */
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
  /**
   * 端の札を押したまま引きずって、折り返す幅を決めているとき
   * （依頼者の指示・2026-09-05）。
   *
   * 引きはじめの深さを覚えておいて、そこからの**動いたぶん**で決める。
   * 引いた先の座標をそのまま読むと、深さが変わるたびに図の幅も変わるので、
   * 指が止まっているのに数だけが動き続けることになる
   */
  const tagDrag = useRef<{
    side: Side; cx: number; cy: number; moved: boolean
    /** 引きはじめの深さ(mm) */
    startMm: number
    /** 折り切ったときの深さ(mm)。0 なら、途中の深さは決められない */
    spanMm: number
    /** 「置いた型紙の幅だけ折る」ときの深さ(mm) */
    autoMm: number
    /** 戻るを1回で済ませるための合図 */
    group: string
    /**
     * 引きはじめの、画面1px あたりの mm。
     *
     * 折り込むほど描く面が狭くなり、図の縮尺そのものが動く。
     * 動く縮尺で読むと、指を同じところに戻しても同じ数に戻らない。
     * ふり幅は引きはじめに決めて、そのあいだは変えない
     */
    perPx: number
  } | null>(null)
  /** 引きずっている最中に、いま何をしているのかを図の上に出す */
  const [tagHint, setTagHint] = useState<{ side: Side; text: string } | null>(null)

  if (!report) return null

  const W = Math.max(report.surfaceWidthMm, 1)
  /** 折る前の、みみを除いた幅。「置ける幅」がこれより狭ければ、折っているから */
  const usableMm = Math.max(0, state.fabricWidthMm - SELVAGE_MM * 2)
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
  /**
   * 枠の外に取る余白。ふくらんだ折り山と、端の札を書くぶん。
   *
   * 札を生地の**外側**に出すことにしたので（`tagAt`）、
   * いちばん大きい札（縦に置く「わ・折り山」＝幅 0.16）が
   * まるごと入るだけの幅が要る。0.16 ＋ すき間 0.012 ＝ 0.172
   */
  const PAD = W * 0.185
  /** 折り山の内側にできる翳りの幅 */
  const CR = W * 0.06
  /** みみの帯の幅 */
  const SEL_BW = W * 0.022
  /**
   * 生地の裁ち端に見せる、わずかな余白（依頼者の指示・2026-08-31）。
   * **絵のうえの余白で、買う長さには入らない。**
   */
  const EDGE_GAP = W * 0.025
  const meetV = depth.left > 0 && depth.right > 0 && depth.left + depth.right >= W - 0.5
  const meetH = depth.top > 0 && depth.bottom > 0 && depth.top + depth.bottom >= L - 0.5
  /**
   * 上下から折って、裁ち端どうしが真ん中でちょうど出会うとき
   * （`meetH`）だけ使う、**図のうえだけの開き**（依頼者の指示・2026-08-31）。
   *
   * このとき上の型紙の下辺と下の型紙の上辺は、同じ一点をはさんで背中合わせに並び、
   * あいだに生地が1ミリも無い。そのため2枚の裁ち端の波は型紙の下に隠れてしまい、
   * 「ここが生地の端」であることが図から消えていた。
   * 依頼者が Photoshop で「横わ・上端」と「横わ・下端」を貼り合わせて見せてくれた
   * とおり、**上半分と下半分を少しだけ離して描く**と、両方の波が見える。
   *
   * 離すのは絵のうえだけで、買う長さには入らない。
   * `openAt` を通したものだけが下へずれる（下半分の型紙・折り山・札）。
   */
  const OPEN = meetH ? EDGE_GAP * 2 + W * 0.018 : 0
  /** 出会い目。上から来た一枚と下から来た一枚の裁ち端が並ぶところ */
  const meetY = depth.top
  /** 出会い目より下にあるものを、図のうえで下へずらす量 */
  const openAt = (y: number) => (OPEN > 0 && y >= meetY - 0.5 ? OPEN : 0)
  /**
   * 左右から折って、みみとみみが中央で出会うときの、**横向きの開き**。
   *
   * 実物では2本のみみは突き合わせになるが、そのまま描くと帯が1本につながって見え、
   * 「折り返して二重になっている」ことが伝わらない
   * （依頼者の指示・2026-08-27、2026-08-31）。折り返した一枚は、みみの帯のぶんだけ
   * 外へ伸ばして描いてあるので、2つの折り返しが近づくと**帯どうしが重なりさえする**。
   *
   * そこで、みみ2本と、そのあいだの隙間（`SEL_GAP`）が必ず入るだけの
   * 場所を空ける。足りないぶんだけを、図のうえで右半分を右へずらして作る。
   * 上下の出会い目（`OPEN`）と同じ考え方で、**買う長さにも幅にも入らない**。
   */
  const SEL_GAP = SEL_BW * 0.85
  const OPENX = depth.left > 0 && depth.right > 0
    ? Math.max(0, SEL_BW * 2 + SEL_GAP - (W - depth.left - depth.right))
    : 0
  /** みみとみみの出会い目 */
  const meetX = depth.left
  /** 出会い目より右にあるものを、図のうえで右へずらす量 */
  const openAtX = (x: number) => (OPENX > 0 && x >= meetX - 0.5 ? OPENX : 0)

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
  const bx1 = selvages.includes('right') ? W + SEL_BW : W + OPENX
  const bodyW = bx1 - bx0
  /** 生地の左右の真ん中。図の上の文字はここへそろえる */
  const bxMid = (bx0 + bx1) * 0.5
  /**
   * 端の札を、生地の**外側**へ置く。
   *
   * これまでは端からの距離を決め打ちにしていたので、札の大きさによっては
   * 生地に食い込んでいた（横わのとき「わ（折り山）」の札が折り山の線に乗っていた）。
   * 札の大きさから逆に決めれば、どの札でも同じだけ外に出る
   */
  const tagAt = (side: Side, w: number, h: number) => ({
    left: { lx: -(w / 2) - W * 0.012, ly: (L + OPEN) * 0.5 },
    right: { lx: W + OPENX + w / 2 + W * 0.012, ly: (L + OPEN) * 0.5 },
    top: { lx: bxMid, ly: -(h / 2) - W * 0.012 },
    bottom: { lx: bxMid, ly: L + OPEN + h / 2 + W * 0.012 },
  }[side])
  /**
   * まちがっている型紙と、その上に出す短い言い方（`ALERT_TEXT` を見よ）。
   *
   * 重なりは**両方**を赤くする。片方だけ赤くしても、
   * 相手がどれなのか図から読めないため
   */
  const badPlacements = new Map<string, { kind: Problem['kind']; text: string }>()
  for (const pb of report.problems) {
    for (const id of [pb.placementId, pb.otherPlacementId]) {
      if (id && !badPlacements.has(id)) {
        badPlacements.set(id, { kind: pb.kind, text: ALERT_TEXT[pb.kind] })
      }
    }
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
  ) => {
    /*
      折り山になっている辺の札（「わ（折り山）」）は、**押すだけ**（依頼者の指示・2026-09-05）。

      折り山の線は、折る深さを変えても図の上ではまったく動かない。
      わ＝生地の端そのものなので、深く折っても浅く折っても同じ場所に貼りついている。
      動かないものを引きずらせると、手つきと絵が食い違う。
      引いて深さを決める持ち手は、**折る深さで実際に位置が動く線**——
      面の中へ入ってきた折り返しの端——のほうに置いてある
    */
    const folded = foldSidesOf(section.fold).includes(side)
    return (
      <g
        key={`tag-${side}`}
        role="button"
        tabIndex={0}
        aria-label={folded
          ? `${SIDE_LABELS[side]}の端の「わ」をやめる`
          : `${SIDE_LABELS[side]}の端を「わ」にする。内側へ引きずると折り返す幅も決まります`}
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => {
          if (folded) {
            e.stopPropagation()
            onActivate()
            applyEdge(side, 'toggle')
            return
          }
          startFoldDrag(side, e, `fold${(dragSeq += 1)}`)
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
  }

  const gid = `fold-${section.id}`
  const vbW = bodyW + PAD * 2
  const vbH = L + OPEN + PAD * 2

  /** 画面の1px が何mmか。指の動きを実寸に直すのに使う */
  const mmPerPx = () => {
    const box = svgRef.current?.getBoundingClientRect()
    return box && box.width > 0 ? viewW / box.width : 1
  }

  /* --------------------------------------------- 端の札を引いて、折り返す幅を決める */

  /** その辺で折り切ったときの深さ(mm)。小さい折り図と同じ物差しを使う */
  const spanMmOf = (side: Side) => foldScaleOf(state.fabricWidthMm, report).spanMm(side)

  /** その辺から内側へ向かう向きの、動いたぶん */
  const inward = (side: Side, dx: number, dy: number) =>
    side === 'left' ? dx : side === 'right' ? -dx : side === 'top' ? dy : -dy

  /**
   * 引いた先が、どの折り方にあたるか。
   *
   * 「折らない」「置いた型紙の幅だけ」「折り切る」の3つには吸い付き、
   * そのあいだは指で決めた幅になる。吸い付く近さは**画面のうえで一定**にしてある。
   * 寄って見ているときほど細かく決められるほうが、寄った甲斐がある
   */
  const tagValue = (d: NonNullable<typeof tagDrag.current>, x: number, y: number) => {
    const u = d.perPx
    const moved = inward(d.side, (x - d.cx) * u, (y - d.cy) * u)
    const at = Math.max(0, d.spanMm > 0
      ? Math.min(d.spanMm, d.startMm + moved) : d.startMm + moved)
    const tol = 14 * u
    const both = foldSidesOf(section.fold)
      .some((t) => isVerticalSide(t) === isVerticalSide(d.side) && t !== d.side)
    if (at < tol) {
      return { action: 'off' as EdgeAction, hint: `${SIDE_LABELS[d.side]}の端は折らない` }
    }
    if (d.spanMm > 0 && at > d.spanMm - tol) {
      return {
        action: 'half' as EdgeAction,
        hint: both ? '両端が出会うまで折る' : '半分に折る',
      }
    }
    if (d.spanMm <= 0 || (d.autoMm > 0 && Math.abs(at - d.autoMm) < tol)) {
      return { action: 'partial' as EdgeAction, hint: '置いた型紙の幅だけ折る' }
    }
    const mm = Math.round(at / 5) * 5
    return {
      action: { depthMm: mm } as EdgeAction,
      hint: `折り返し ${(mm / 10).toFixed(1)}cm`,
    }
  }

  /** 辺をさわった結果を、そのまま上へ渡す。決め方は小さい折り図と1つの場所で揃えてある */
  const applyEdge = (side: Side, action: EdgeAction, group?: string) => {
    const next = foldFromEdge(section.fold, side, action)
    onFold(next.fold, next.halfFold, { [side]: next.depthMm ?? null }, group)
  }

  /**
   * 折り返した一枚の、**面の中へ入ってきた端**の位置。
   *
   * 折る深さを変えたときに図の上で動くのは、この線だけである。
   * 縦に折ったときはもとの「みみ」が入ってきたもの、
   * 横に折ったときは「裁ち端」が入ってきたもので、どちらも実物なら
   * 手でつまんで内へ入れたり外へ出したりしているところ。
   *
   * 値は生地を描いている式（`topPath`）とそろえてある。
   * 帯や余白のぶんだけ外へ出して描いてあるので、線もそこに見えている
   */
  const flapEdgeAt = (sd: Side) =>
    sd === 'left' ? depth.left + SEL_BW
      : sd === 'right' ? W + OPENX - depth.right - SEL_BW
        : sd === 'top' ? depth.top + EDGE_GAP
          : L + OPEN - depth.bottom - EDGE_GAP

  /**
   * 折り返す幅を、指で決めはじめる（依頼者の指示・2026-09-05）。
   *
   * つかむのは**折る深さで位置が動くもの**だけ。折っていない辺では生地の端の札
   * （「みみ」「裁ち端」）、折ってある辺では上の `flapEdgeAt` の線。
   * どちらも「みみ（や裁ち端）をつまんで、内へ入れたり外へ出したりする」という
   * 同じ動作で、実物でしている手つきと一致する
   * （依頼者の指摘・2026-09-05「耳の部分を掴んで引っ込めたり伸ばしたりというのが、
   * 布を現実で触っている動作としては近しい」）。
   *
   * 指を捕まえるのは**この持ち手ではなく、図そのもの**（`svgRef`）。
   * 持ち手そのものが指について動くうえ、折り方が変わった拍子に
   * 別のもの（みみの札→折り返しの端）へ入れ替わる。
   * 図に捕まえさせておけば、何に入れ替わっても指はついてくる
   */
  const startFoldDrag = (side: Side, e: PointerEvent, group: string) => {
    e.stopPropagation()
    try {
      svgRef.current?.setPointerCapture(e.pointerId)
    } catch { /* 捕まえられなくてよい */ }
    onActivate()
    tagDrag.current = {
      side, cx: e.clientX, cy: e.clientY, moved: false,
      startMm: foldSidesOf(section.fold).includes(side) ? report.foldDepth[side] : 0,
      spanMm: spanMmOf(side), autoMm: report.snapDepth[side], perPx: mmPerPx(),
      group,
    }
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
    /*
      折り返しの持ち手は生地の面の上にあるので、二本指でひろげるつもりの
      一本目がそこに乗ってしまうことがある。二本目が触れたら持ち手は放して、
      つまむほうへ譲る。押しただけの扱いにもしない（折るつもりではなかったので）
    */
    if (tagDrag.current) {
      tagDrag.current = null
      setTagHint(null)
    }
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
    // 端の札を引いているあいだは、図をずらすのでも型紙を動かすのでもない
    const t = tagDrag.current
    if (t) {
      if (!t.moved && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) < 8) return
      t.moved = true
      const r = tagValue(t, e.clientX, e.clientY)
      setTagHint({ side: t.side, text: r.hint })
      applyEdge(t.side, r.action, t.group)
      return
    }
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
    const t = tagDrag.current
    if (t) {
      tagDrag.current = null
      setTagHint(null)
      pointers.current.delete(e.pointerId)
      // 動かさずに離した＝押した。これまでどおり「わ」が付いたり外れたりする
      if (!t.moved) applyEdge(t.side, 'toggle')
      else applyEdge(t.side, tagValue(t, e.clientX, e.clientY).action, t.group)
      return
    }
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
      moved: false,
    }
  }

  const moveDrag = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    /*
      指はまったく止まらないので、少しの震えでは「動かした」と見なさない。
      押したつもりが引きずりになって、板が開かないのを防ぐ。
      TAP_SLOP は画面の点で測る——寄っているときも手つきは同じなので
    */
    if (!d.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) > TAP_SLOP) d.moved = true
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
    /*
      隣の型紙の辺には、そのまま吸い付ける（学生の点検・2026-09-02）。

      引きずる位置は 1cm きざみに丸めているが、型紙の幅は 26.4cm のような
      半端な数になる。だから隣にぴったり寄せようとしても 1cm きざみの
      目盛りにしか止まれず、**わずかに重なったまま**「重なっています」が
      出たきりになる。少し動かしても直らない、という報告があった。

      裁ち合わせでは「隣にぴったり寄せる」がいちばん基本の手つきなので、
      目盛りより先に、隣の辺そのものを狙わせる。
      狙うのは、隣に突き当てる位置と、隣と端をそろえる位置の4通り
    */
    const others = report.boxes.filter((b) => b.placementId !== d.id)
    const nearEdge = (raw: number, cands: number[]) => {
      let best = snap(raw)
      let near = Infinity
      for (const c of cands) {
        const gap = Math.abs(raw - c)
        if (gap <= SNAP_MM && gap < near) { near = gap; best = c }
      }
      return best
    }
    const rawX = d.x0 + (e.clientX - d.px) * k
    const rawY = d.y0 + (e.clientY - d.py) * k
    const x = Math.max(0, Math.min(maxX, nearEdge(
      rawX, others.flatMap((b) => [b.x, b.x + b.w, b.x - d.w, b.x + b.w - d.w]),
    )))
    const y = Math.max(0, nearEdge(
      rawY, others.flatMap((b) => [b.y, b.y + b.h, b.y - d.h, b.y + b.h - d.h]),
    ))

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
    const d = drag.current
    if (d?.targets.length) setHint(null)
    // 押しただけ（ほとんど動いていない）なら、細かく決める板を開く
    if (d && !d.moved) onOpen(d.id)
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
  if (depth.left > 0) {
    flaps.push({ side: 'left', x: 0, y: 0, w: depth.left, h: L, full: depth.left >= W - 0.5 })
  }
  if (depth.right > 0) {
    flaps.push({
      side: 'right', x: W - depth.right, y: 0, w: depth.right, h: L,
      full: depth.right >= W - 0.5,
    })
  }
  if (depth.top > 0) {
    flaps.push({ side: 'top', x: 0, y: 0, w: W, h: depth.top, full: depth.top >= L - 0.5 })
  }
  if (depth.bottom > 0) {
    flaps.push({
      side: 'bottom', x: 0, y: L - depth.bottom, w: W, h: depth.bottom,
      full: depth.bottom >= L - 0.5,
    })
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
  const allDoubled = flaps.some((f) => f.full) || meetV || meetH
  /**
   * 下の一枚を描くかどうか。**折ってあるなら、いつも描く**
   * （依頼者のイラレの図・生地折り方_02 の5〜8ページ目・2026-08-31）。
   *
   * 以前は「面が丸ごと二重のときだけ」に絞っていた。端だけ折り返したときに
   * 2枚目を描くと生地全体が二重に見えてしまう、と考えたためだが、
   * いただいた図ではそうなっていない。**折り返した一枚のほうを明るく、
   * その下から出ている一枚を暗く**描いてあるので、
   * 「明るいところ＝上に一枚乗っている＝二重」と読める。
   * 端だけ折り返したときに折り山の回り込み（U字）が出ていなかったのは、
   * 下の一枚が無く、回り込む相手がいなかったからでもある。
   */
  const hasUnder = flaps.length > 0
  const foldVertical = foldSides.includes('left') || foldSides.includes('right')
  /**
   * 生地の裁ち端に見せる、わずかな余白（依頼者の指示・2026-08-31）。
   *
   * 型紙が生地の端にぴったり付いていると、そこが端であることが伝わらず、
   * 「布のどのあたりを使っているのか」が読めない。実際にはぴったり収まるのだが、
   * 生地端ぎりぎりまで使うことは実務でもまず無いので、図の上だけ少し空けておく。
   *
   * **これは絵のうえの余白で、買う長さには入らない。**
   * 長さの矢印も「ここまで◯ cm」も、これまでどおり本当の座標で引いてある。
   * 値そのものは、出会い目の開き（`OPEN`）といっしょに上のほうで決めてある。
   *
   * 空けるのは**裁ち端の側だけ**。折り山に「わ」を当てているところは、
   * ぴったり合っていることこそが正しいので動かさない。
   * みみの側は、もともと帯のぶんだけ型紙が内側に寄っている。
   */
  /**
   * 図に描く生地の上端・下端。折り山の側は面のまま、裁ち端の側だけ外へ出す。
   * 下の折り山は、出会い目を開いたぶん（`OPEN`）だけ下へ下がる
   */
  const by0 = foldSides.includes('top') ? 0 : -EDGE_GAP
  const by1 = foldSides.includes('bottom') ? L + OPEN : L + EDGE_GAP
  /**
   * 面を丸ごと覆っているときの、下の一枚の箱。
   * 半端な折り返しのときは、下に来るのが**折り返した一枚のほう**なので、
   * この箱は使わない（`underBoxes` を見よ）
   */
  const under = { x0: bx0, y0: by0, x1: bx1, y1: by1 }
  if (allDoubled) {
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
   * まちがっている型紙の印（依頼者の指示・2026-09-04）。
   *
   * 外周を**濃い赤の実線**にして、その型紙の上に赤字を重ねる。
   * 選んでいる印（薄い緑の縁）とは太さも濃さも違うので、並んでも取り違えない。
   *
   * 赤字の帯は、型紙の幅より広くなってもそのまま出す。
   * これは型紙の中身ではなく**直してもらうための呼びかけ**なので、
   * 細い型紙で読めなくなるくらいなら、はみ出したほうがよい。
   * 直せば消えるものなので、はみ出しっぱなしにはならない
   */
  const alertMark = (points: string, bw: number, bh: number, text: string) => {
    const fs = lbl(W * 0.042)
    const pad = fs * 0.6
    const tw = text.length * fs + pad * 2
    const th = fs * 1.9
    return (
      <g pointerEvents="none">
        <polygon points={points} fill="none" stroke={ALERT}
          strokeWidth={W * 0.016} strokeLinejoin="round" />
        <rect
          x={bw * 0.5 - tw * 0.5} y={bh * 0.5 - th * 0.5} width={tw} height={th}
          rx={fs * 0.45} fill="#ffffff" fillOpacity={0.95}
          stroke={ALERT} strokeWidth={lbl(W * 0.005)}
        />
        <text
          x={bw * 0.5} y={bh * 0.5} fontSize={fs} fontWeight={700} fill={ALERT}
          textAnchor="middle" dominantBaseline="middle"
        >
          {text}
        </text>
      </g>
    )
  }

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
    const x = s === 'left' ? 0 : W + OPENX - CR
    const y = s === 'top' ? 0 : L + OPEN - CR
    const over = RIM * 3
    return (
      <rect
        key={`sp-${s}`}
        x={horiz ? x : bx0 - over}
        y={horiz ? -over : y}
        width={horiz ? CR : bodyW + over * 2}
        height={horiz ? L + OPEN + over * 2 : CR}
        fill={`url(#${gid}-sp-${s})`}
      />
    )
  })

  /** 上下の端が、はさみで切った裁ち端かどうか（横わでそちらを折るときだけ違う） */
  const cutTop = !foldSides.includes('top')
  /** はさみで裁つ端＝折り山でもみみでもない辺。ここも押せば折り山になる */
  const cutSides: Side[] = (['top', 'bottom'] as Side[]).filter((sd) => !foldSides.includes(sd))
  const cutBottom = !foldSides.includes('bottom')

  /**
   * ずれた側の折り山の端で、上の一枚と下の一枚の裁ち端が集まる頂点。
   * 上の一枚の身頃より `TIP` だけ先へ出たところに置き、両方の一枚に同じ値を渡す
   */
  const leadApex = foldVertical ? by1 + TIP : bx1 + TIP
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
    if (meetH) {
      /*
        横わ。出会っているのは裁ち端どうし。割った側も波で描く。

        2枚とも、当てた型紙より `EDGE_GAP` だけ先まで伸ばす。
        そのぶん下の一枚は `OPEN` だけ下へ下がっているので、
        2つの波のあいだには下の一枚（一重の色）が細く見える
      */
      const eT = depth.top + EDGE_GAP
      const eB = L - depth.bottom + OPEN - EDGE_GAP
      return `${sheet(bx0, by0, bx1, eT, cutTop, true, leadApex, ['top'])} `
        + sheet(bx0, eB, bx1, by1, true, cutBottom, leadApex, ['bottom'])
    }
    /*
      折り返しが1つも無いときは、ここへ来ても描くものが無い。
      `flaps` が空のまま下の枝へ入ると、輪郭が空文字になって生地ごと消える。

      左右から折ってみみが出会うときも、この枝で描く。
      2つの折り返しが近づいたぶんは `OPENX` で開けてあるので、
      ふつうの折り返しとまったく同じ描き方で、帯2本と隙間が収まる
    */
    /*
      **折り返しは、面の下へ折り込む**（依頼者の判断・2026-09-05）。

      もとは折り返した一枚を面の上に重ねて描いていた。けれども折らない図は
      「生地の表面が上を向いて置かれた」絵なので、折り返しを上に重ねると
      **その部分だけ裏返っている**ことになり、1枚の図の中に表の面と裏の面が
      同居する。一重のところで裁つ型紙は表から裁つのが基本なのに、
      図ぜんぶが「折ったあとの上に来ている面」に見えてしまう。

      折り込む形にすると、型紙を乗せる面は折り方によらず**いつも同じ一枚**になり、
      折る深さを指で変えても面が動かない。二重であることは、面を裏返して見せる
      のではなく、**下からもう一枚がのぞく**ことで伝える（`underBoxes`）。

      例外は、左右から折ってみみが中央で出会うとき（`meetV`）。ここは
      2本のみみのあいだの隙間から下の一枚がのぞいていることが図の要なので
      （依頼者の指示・2026-08-27／2026-08-31）、上の面を2つに割って描く
    */
    if (meetV) {
      /*
        両側から折って、みみが中央で出会うとき。

        上に来ているのは**折り返したぶんだけ**。ここを面ぜんぶで描いていたので、
        折り山で回り込む相手がおらず、U字の折り返しが出ていなかった。
        折り返した一枚を、その幅（高さ）ぶんの一枚として描けば、
        折り山の端で下の一枚と同じ頂点に集まり、半円に回り込む。

        みみの帯は面の外側にあるので、折り返した一枚の端も
        `SEL_BW` ぶん外まで伸ばす。そうしないと帯が下の一枚の上に浮く
      */
      return flaps.map((f) => (
        f.side === 'left'
          ? sheet(bx0, by0, f.w + SEL_BW, by1, cutTop, cutBottom, leadApex, ['left'])
          : f.side === 'right'
            ? sheet(W - f.w - SEL_BW + OPENX, by0, bx1, by1, cutTop, cutBottom, leadApex, ['right'])
            : f.side === 'top'
              ? sheet(bx0, by0, bx1, f.h + EDGE_GAP, cutTop, true, leadApex, ['top'])
              : sheet(bx0, L - f.h - EDGE_GAP, bx1, by1, true, cutBottom, leadApex, ['bottom'])
      )).join(' ')
    }
    return sheet(bx0, by0, bx1, by1, cutTop, cutBottom, leadApex)
  })()
  /** 下の一枚をずらす向き。縦の折りなら下へ、横の折りなら右へ */
  const UB_DX = foldVertical ? 0 : UNDER_SHIFT
  const UB_DY = foldVertical ? UNDER_SHIFT : 0
  /**
   * 下になっている一枚（複数あることがある）。
   *
   * 面が丸ごと二重のときは、同じ大きさの紙をずらして敷いた1枚。
   * 半端な折り返しのときは、**折り返した一枚そのもの**が下に来る
   * （依頼者の判断・2026-09-05「下へ折り込む」）。折り返した幅のぶんだけ
   * ずらして敷いてあるので、その幅ぶんだけ裁ち端の先から紙がのぞく。
   * のぞいている範囲＝二重になっている範囲になる
   */
  const underBoxes: Array<{
    x0: number; y0: number; x1: number; y1: number
    ct: boolean; cb: boolean; sides: Side[]
  }> = allDoubled
    ? [{ ...under, ct: cutTop, cb: cutBottom, sides: foldSides }]
    : flaps.map((f) => (
      f.side === 'left'
        ? {
          x0: bx0 + UB_DX, y0: by0 + UB_DY, x1: f.w + SEL_BW + UB_DX, y1: by1 + UB_DY,
          ct: cutTop, cb: cutBottom, sides: ['left'] as Side[],
        }
        : f.side === 'right'
          ? {
            x0: W - f.w - SEL_BW + OPENX + UB_DX, y0: by0 + UB_DY,
            x1: bx1 + UB_DX, y1: by1 + UB_DY,
            ct: cutTop, cb: cutBottom, sides: ['right'] as Side[],
          }
          : f.side === 'top'
            ? {
              x0: bx0 + UB_DX, y0: by0 + UB_DY,
              x1: bx1 + UB_DX, y1: f.h + EDGE_GAP + UB_DY,
              ct: cutTop, cb: true, sides: ['top'] as Side[],
            }
            : {
              x0: bx0 + UB_DX, y0: L - f.h - EDGE_GAP + UB_DY,
              x1: bx1 + UB_DX, y1: by1 + UB_DY,
              ct: true, cb: cutBottom, sides: ['bottom'] as Side[],
            }
    ))
  /**
   * 下になっている一枚の形。上の一枚とまったく同じ描き方で、
   * 位置と大きさだけを置きかえる。
   * 2枚が「同じ布を折っただけのもの」に見えるためには、
   * 端の描き分け（波・まっすぐ・角のまるみ）もそろっていなければならない
   */
  const underPath = hasUnder
    ? underBoxes.map((b) => sheet(b.x0, b.y0, b.x1, b.y1, b.ct, b.cb, leadApex, b.sides))
      .join(' ')
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
    const line = (o: number, y0: number, y1: number) => {
      const x = (xEdge + outward * o).toFixed(1)
      return `M${x} ${y0.toFixed(1)} L${x} ${y1.toFixed(1)}`
    }
    if (allDoubled) {
      return selvageMarks(line(SEL_BW / 2, by0, by1), line(SEL_BW, by0, by1), SELVAGE)
    }
    /*
      下へ折り込んだときは、この端は**面の下**にある（依頼者の指摘・2026-09-05）。

      それでも帯とピン穴をそのまま引くと、みみが面の真ん中にもう1本
      あるように見える。みみは生地の両端にしかないものなので、これは
      絵としてそのまま嘘になる（右端の本物のみみと見分けが付かない）。

      そこで、みみとしては描かず、二重がここで終わるといううすい線1本に
      とどめる。横に折ったときの、折り返した端に引くうすい波と同じ扱い。
      のぞいているところまで引き通してあるので、線がどこまで下りているかが
      そのまま「どこまで二重か」になる。つまむ持ち手もこの線に乗っている。
      この端がみみであることは、断面図（横から見ると）のほうで言っている
    */
    return (
      <path d={line(0, by0, by1 + UNDER_SHIFT)} fill="none"
        stroke={SELVAGE_UNDER.line} strokeWidth={W * 0.004} opacity={0.45} />
    )
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
        折り方の枠は、区間が2つ以上あるときだけ出す（依頼者の指示・2026-09-01）。

        ふだん（区間1つ）の折り方は「生地」の画面で決まっているので、
        ここに同じものを出すと、上と下で内容がかぶる。パーツが増えると
        画面が縦に伸びていくので、そのぶんの圧迫も避けたい。
        大きい裁ち合わせ図の端の札からは、区間が1つでも変えられる。

        2つ以上になったら話が別で、**どの区間の話なのか**を言う必要が出る。
        そもそも切り分けたということは折り方を変えたいということなので、
        そのときはここに操作があるのが筋になる
      */}
      {canDrop && (
        <FoldSetup
          section={section}
          half={half}
          prefix={`${index + 1} つめ・`}
          onFold={onFold}
          onHalf={onHalf}
          onActivate={onActivate}
          scale={foldScaleOf(state.fabricWidthMm, report)}
        />
      )}

      {/* 平面図に線を引くだけでは、折っていることが伝わらない。横から見た形を添える */}
      <FoldDiagram
        fold={section.fold}
        half={isHalfFold(section)}
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
        {/*
          いま何センチ使っているかを、絵の中にも小さく出す（依頼者の案・2026-09-03
          「配置している生地の上側の緑の余白内などにも小さめでもいいので、
          用尺の表記がそこにもあると動かしながら用尺が変わる様子が分かっていい」）。

          **主役は「並べたぶん」のほう。** 買ってくる長さは 10cm 単位に切り上げてあるので、
          型紙を少し動かしただけでは数字が動かず、「動かすと変わる」ことが見えない。
          切り上げる前の長さを先に置いて、そこから買う長さへ渡す。

          答えそのものは、これまでどおり画面のいちばん下に大きく置いてある
          （依頼者の指示・2026-08-27「結びとして下に置く」）。ここは作業中の目盛りなので、
          小さく、控えめな色にして、下の結びと役どころを取り違えないようにする。

          絵（svg）の外に置いてあるので、**画像に書き出したものには入らない**。
          書き出した図の数字は、下に付く帯にまとめてある（依頼者の指示・2026-09-01）。
          指も通す（`pointer-events-none`）。ここは図をずらすためにつかむ場所でもある
        */}
        {used > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-lg bg-white/90 px-2 py-1 shadow-sm">
            <p className="tnum text-[11px] font-bold leading-tight text-ink-700">
              並べたぶん {(report.yardageMm / 10).toFixed(1)} cm
            </p>
            {purchaseMm !== undefined && (
              <p className="tnum text-[11px] leading-tight text-ink-500">
                買う {(purchaseMm / 10).toFixed(0)} cm
              </p>
            )}
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`${bx0 - PAD + zx} ${-PAD + zy} ${viewW} ${viewH}`}
          /*
            画像に書き出すときの目印（lib/exportImage.ts）。
            画面のほうは指で拡大できるので、上の viewBox はそのときの窓になっている。
            書き出しでは倍率を無視したいので、ぜんぶ見えている状態を別に持たせておく
          */
          data-sheet={index}
          data-viewbox={`${bx0 - PAD} ${-PAD} ${vbW} ${vbH}`}
          data-tour={index === 0 ? 'fabric' : undefined}
          className="mx-auto w-full select-none"
          style={{
            aspectRatio: `${vbW} / ${vbH}`,
            /*
              高さの上限を、**幅の上限に置き換えて**かけている。
              高さだけを止めると SVG の中身が枠の中で寄って余白ができ、
              枠の幅と絵の幅が食い違う。指の動きを mm に直す換算（mmPerPx）は
              枠の幅から出しているので、そこがずれると型紙が指から離れていく
            */
            maxWidth: `calc(${SHEET_MAX_H} * ${(vbW / vbH).toFixed(4)})`,
            touchAction: 'none',
          }}
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
              <path d={underPath} fill="none" stroke="#b8b6a4" strokeWidth={W * 0.004} />
              <g clipPath={`url(#${gid}-clip-under)`}>
                {crestBands()}
                {/*
                  下の一枚のみみ。点々が2列あること＝布が2枚あること。

                  縦に折り込んだときは、下の一枚の遠いほうの端がそのまま
                  「折り返した端」なので、`selvageStraight` が面の上まで
                  引き通している。ここで重ねて引くと帯が二度塗りになる
                */}
                {(allDoubled || !foldVertical) && underBoxes.map((b, i) => (
                  selvages.map((sd) => (
                    selvageOn(b, sd as 'left' | 'right', SELVAGE_UNDER, `usv-${i}-${sd}`)
                  ))
                ))}
              </g>
            </>
          )}

          {/* 上に来ている一枚。ここに型紙を並べる */}
          <path d={topPath} fill={CLOTH}
            filter={underPath ? `url(#${gid}-drop)` : `url(#${gid}-drop2)`} />
          <path d={topPath} fill={`url(#${gid}-weave)`} />
          {/*
            2枚の輪郭をうすく引く（依頼者のイラレの図・2026-08-31）。
            折り返した一枚と下の一枚は色の差がわずかなので、線が無いと
            境目——とくに折り山の回り込み——がどこにあるのか読めない。
            折り返した端に引いていた線をここへまとめた
          */}
          <path d={topPath} fill="none" stroke="#b8b6a4" strokeWidth={W * 0.004} />

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
              selvageOn({ x0: bx0, y0: by0, x1: bx1, y1: by1 }, s as 'left' | 'right', SELVAGE, `sv-${s}`)
            ))}
          </g>

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
            const sx = f.side === 'left' ? f.w
              : f.side === 'right' ? W + OPENX - f.w - shade : 0
            // 横に折ったときの端は、余白のぶんだけ外に描いてある（`topPath` と同じ）
            const fe = allDoubled ? 0 : EDGE_GAP
            const sy = f.side === 'top' ? f.h + fe : f.side === 'bottom' ? L - f.h - fe - shade : 0
            const flip = f.side === 'right' || f.side === 'bottom'
            /*
              みみとみみが出会っているところに影を落とすと、みみの帯が影で暗くなり、
              他の折り方より濃く見える。隙間そのものが下の一枚の色で塗ってあるので、
              ここでは影は要らない（依頼者の指摘・2026-08-30）
            */
            /*
              下の一枚が折り返しの先にのぞいているなら、影は要らない。
              色の違いだけで「ここから先は一重」と分かるうえ、
              影を重ねると同じ生地が折り方によって違う色に見えてしまう
              （依頼者の指示・2026-08-27）
            */
            const shadeless = !allDoubled || (meetV && horiz) || (meetH && !horiz)
            return (
              <g key={f.side}>
                {!shadeless && <rect
                  x={horiz ? sx : bx0}
                  y={horiz ? by0 : sy}
                  width={horiz ? shade : bodyW}
                  height={horiz ? by1 - by0 : shade}
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
                  端そのものの線は上の一枚の輪郭で引いてあるので、
                  ここではみみの帯だけを足す（縦の折りのとき、
                  この端は「もとのみみ」が折り返って来たもの）
                */}
                {horiz && selvageStraight(
                  f.side === 'left' ? f.w : W + OPENX - f.w, f.side === 'left' ? 1 : -1,
                )}
                {/*
                  横に折ったときの折り返した端は、みみではなく**裁ち端**。
                  下へ折り込んであるので面の下にあるが、そこで下の一枚が
                  終わっていることの印として、うすい波を面の上に引いておく。
                  縦に折ったときのみみの帯と同じ役目（依頼者の判断・2026-09-05）
                */}
                {!horiz && !allDoubled && (
                  <path
                    d={`M${bx0.toFixed(1)} ${sy.toFixed(1)}${waveSeg(bx0, bx1, sy)}`}
                    fill="none" stroke={SELVAGE_UNDER.line}
                    strokeWidth={W * 0.004} opacity={0.45}
                  />
                )}
              </g>
            )
          })}

          {/*
            折り返した端をつまむところ（依頼者の指示・2026-09-05）。

            線そのものは細いので、その両側に見えない帯を敷いて指の的をひろげる。
            型紙より**先に**描いてあるので、型紙が乗っているところでは型紙が勝つ。
            生地の空いているところでだけ、折り返しをつまめる。
            型紙の上からでもつまめる小さなつまみは、型紙のあとに別に描いてある
          */}
          {flaps.map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            const at = flapEdgeAt(f.side)
            const band = W * 0.055
            return (
              <rect
                key={`grab-${f.side}`}
                data-ui="fold-grab"
                x={horiz ? at - band / 2 : bx0}
                y={horiz ? by0 : at - band / 2}
                width={horiz ? band : bodyW}
                height={horiz ? by1 - by0 : band}
                fill="none"
                pointerEvents="all"
                style={{ cursor: horiz ? 'ew-resize' : 'ns-resize' }}
                onPointerDown={(e) => startFoldDrag(f.side, e, `fold${(dragSeq += 1)}`)}
              />
            )
          })}

          {report.boxes.map((box) => {
            const p = state.placements.find((q) => q.id === box.placementId)
            const part = p ? partMap.get(p.partId) : null
            if (!p || !part) return null
            // 縫い代の画面と同じ描き分け。縫い代の重なり具合を見ながら置けるように
            const { cut, finished, marks, center } = orientedPair(part, p)
            // 中心線と地の目線が重なるときだけ、地の目線を脇へどける
            const alert = badPlacements.get(p.id)
            const on = selectedId === p.id
            /*
              押した札と、生地の上に出てきたものを結びつける合図
              （依頼者の指摘・2026-09-04「形が似ていると置き間違える」）。
              選んだ印（細い緑の縁）とは別に、外側へ太い輪を1つ出して、
              ひとりでに消えるまでのあいだだけ見せる
            */
            const lit = flashId === p.id
            const twice = countOf(p.id) === 2
            const topOnly = topOnlyOf(p.id)
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
                  transform={`translate(${box.x + openAtX(box.x)} ${box.y + openAt(box.y)})`}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startDrag(e, p)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                >
                  {lit && (
                    <polygon
                      points={pts(cut)} fill="none" stroke="#35664e"
                      strokeWidth={W * 0.05} strokeOpacity={0.5} strokeLinejoin="round"
                      className="flash-ring"
                    />
                  )}
                  {on && (
                    <polygon
                      points={pts(cut)} fill="none" stroke="#35664e"
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
                  {alert && alertMark(pts(cut), box.w, box.h, alert.text)}
                </g>
              )
            }
            return (
              <g
                key={p.id}
                transform={`translate(${box.x + openAtX(box.x)} ${box.y + openAt(box.y)})`}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => startDrag(e, p)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
              >
                {lit && (
                  <polygon
                    points={pts(cut)} fill="none" stroke="#35664e"
                    strokeWidth={W * 0.05} strokeOpacity={0.5} strokeLinejoin="round"
                    className="flash-ring"
                  />
                )}
                {/*
                  選んでいる印は、縫い代の外側にもう一回り描く。
                  縫い代の線そのものを緑にすると、青い帯＝縫い代 という約束が崩れる
                */}
                {on && (
                  <polygon
                    points={pts(cut)}
                    fill="none"
                    stroke="#35664e"
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
                {/*
                  上の一枚だけを裁つと決めてあるもの。
                  ×2 と同じ場所に、逆の意味の印を置く。
                  ここに何も出さないと、この図を見て裁つ人は二重のまま2枚とってしまう
                */}
                {topOnly && (
                  <g>
                    <rect x={box.w - lbl(W * 0.118)} y={box.h - lbl(W * 0.096)}
                      width={lbl(W * 0.12)} height={lbl(W * 0.082)}
                      rx={lbl(W * 0.018)} fill="#ffffff" stroke={CREASE}
                      strokeWidth={lbl(W * 0.006)} />
                    <text x={box.w - lbl(W * 0.058)} y={box.h - lbl(W * 0.055)}
                      fontSize={lbl(W * 0.04)} fontWeight={700} fill={CREASE}
                      textAnchor="middle" dominantBaseline="middle">
                      上だけ
                    </text>
                  </g>
                )}
                {/*
                  まちがっているときの印は、いちばん最後に描く。
                  縫い代の帯・名前・地の目線・ほかの印より上に出さないと、
                  いちばん読んでほしいものがいちばん下に隠れる
                */}
                {alert && (
                  <>
                    {/*
                      「わ」の話は、辺の話。型紙まるごとを赤くするだけでは
                      どの辺を折り山に当てるのかが読めないので、その辺自体を赤くする
                    */}
                    {alert.kind === 'offFold' && marks.map((m, i) => (
                      /*
                        辺そのものの点列をそのままなぞる。
                        以前は真ん中の向きと辺の長さからまっすぐな線を作っていたが、
                        写真からなぞった辺は完全にはまっすぐでなく、弧の長さも弦より長い。
                        そのため型紙から離れて、角の外へ赤い棒が飛び出していた
                        （依頼者の報告・2026-09-04）。

                        外周の赤線より太く引く。同じ太さだと外周に完全に隠れてしまい、
                        「どの辺を折り山に当てるのか」が読めない。
                        端は切りっぱなし（butt）にして、角より先へ出さない
                      */
                      <polyline
                        key={i} points={pts(m.line)} fill="none" stroke={ALERT}
                        strokeWidth={W * 0.034} strokeLinejoin="round" strokeOpacity={0.9}
                      />
                    ))}
                    {alertMark(pts(cut), box.w, box.h, alert.text)}
                  </>
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
            const mid = horiz
              ? (f.side === 'left' ? f.w / 2 : W + OPENX - f.w / 2) : 0
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
              : f.side === 'top' ? nearFold : L + OPEN - nearFold
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
            折り返した端の、つまみ（依頼者の指示・2026-09-05）。

            型紙の**あと**に描く。先に描くと型紙の下に隠れてしまい、
            そこがつまめること自体が見えなくなる。
            矢の向きが、内へ入れる・外へ出すという動きそのものを言っている。

            線に沿った置きどころは、はじまり側を空けておく。
            そこには「生地が二重」の札が出るので、重ねると両方読めなくなる。
            左（上）と右（下）でずらしてあるのは、両側から折って端どうしが
            出会ったとき、2つのつまみが同じところに重なるのを避けるため
          */}
          {flaps.map((f) => {
            const horiz = f.side === 'left' || f.side === 'right'
            const at = flapEdgeAt(f.side)
            const near = f.side === 'left' || f.side === 'top'
            const along = horiz
              ? by0 + (by1 - by0) * (near ? 0.72 : 0.87)
              : bx0 + bodyW * (near ? 0.72 : 0.87)
            const cx = horiz ? at : along
            const cy = horiz ? along : at
            const dw = W * (horiz ? 0.115 : 0.06)
            const dh = W * (horiz ? 0.06 : 0.115)
            const a = W * 0.036
            const b = W * 0.015
            const arrow = horiz
              ? `M ${cx - a + b} ${cy - b} L ${cx - a} ${cy} L ${cx - a + b} ${cy + b}`
                + ` M ${cx + a - b} ${cy - b} L ${cx + a} ${cy} L ${cx + a - b} ${cy + b}`
              : `M ${cx - b} ${cy - a + b} L ${cx} ${cy - a} L ${cx + b} ${cy - a + b}`
                + ` M ${cx - b} ${cy + a - b} L ${cx} ${cy + a} L ${cx + b} ${cy + a - b}`
            return (
              <g
                key={`grip-${f.side}`}
                data-ui="fold-grip"
                role="button"
                tabIndex={0}
                aria-label={`${SIDE_LABELS[f.side]}の折り返す幅を変える`}
                style={{ cursor: horiz ? 'ew-resize' : 'ns-resize' }}
                onPointerDown={(e) => startFoldDrag(f.side, e, `fold${(dragSeq += 1)}`)}
              >
                <rect
                  x={cx - dw / 2} y={cy - dh / 2} width={dw} height={dh}
                  rx={Math.min(dw, dh) / 2}
                  fill="#ffffff" fillOpacity={0.82}
                  stroke={CREASE} strokeOpacity={0.3} strokeWidth={W * 0.004}
                />
                <path d={arrow} fill="none" stroke="#6f766e" strokeWidth={W * 0.008}
                  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )
          })}

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
              ? Math.min(bx0, under.x0) - W * 0.077
              : Math.max(bx1, under.x1) + W * 0.077
            const size = W * 0.036
            // 押すとこちら側が「わ」になる。上の小さな図で押すのと同じこと
            const my = (L + OPEN) * 0.5
            return edgeTag(s, x, my, W * 0.13, W * 0.32, (
              <>
                {iconSelvageLayers(x, my - size * 2.1, W * 0.082, allDoubled ? 2 : 1, '#7f857d')}
                <text x={x} y={my + size * 0.3} fontSize={size} fill="#8a9188"
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
              right: [W + OPENX, TIP, W + OPENX, leadApex],
              top: [bx0 + TIP, 0, leadApex, 0],
              bottom: [bx0 + TIP, L + OPEN, leadApex, L + OPEN],
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
            const { lx, ly } = tagAt(side, tag.w, tag.h)
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

          {/*
            裁ち端の札。これも押せる（依頼者の指示・2026-09-01）。

            これまで押せたのは「みみ」と「わ」の札だけだった。
            縦わのときの上下は裁ち端で札が無かったので、
            **大きい図からは縦わ→横わに変えられなかった**（逆はできた）。
            大きい図を「第二の入口」と言っておきながら片道しか開いていない状態だったので、
            四辺ぜんぶを押せるようにしてある。
            押すとその辺で折る＝そこが折り山になる。実物でやることと同じ。

            上端だけに出していた「裁ち端」の名前は、この札が兼ねている
          */}
          {cutSides.map((side) => {
            const tag = { w: W * 0.3, h: W * 0.13 }
            const { lx, ly } = tagAt(side, tag.w, tag.h)
            return (
              <g key={`cut-${side}`}>
                {edgeTag(side, lx, ly, tag.w, tag.h, (
                  <>
                    {iconScissors(lx - W * 0.098, ly, W * 0.042, '#8a9188')}
                    <text x={lx + W * 0.03} y={ly} fontSize={W * 0.032} fill="#8a9188"
                      textAnchor="middle" dominantBaseline="middle">裁ち端</text>
                  </>
                ))}
              </g>
            )
          })}

          {/*
            端の札を引きずっている最中の、いま何をしているのかの言葉
            （依頼者の指示・2026-09-05）。

            折り返す幅は、指を離すと図の上には数として残らない。
            引いている**今だけ**、その辺のそばに出す。
            図を画像に書き出すときに数を図の中へ入れない決まりとは別の話で、
            これは指が触れているあいだしか出ない案内である
          */}
          {tagHint && (() => {
            /*
              札は生地の**外**にあるので、そこへ字を出すと図の枠から
              はみ出して切れてしまう。引いている辺のすぐ内側へ寄せて置く
            */
            const fs = lbl(W * 0.046)
            const pad = lbl(W * 0.05)
            const mid = (L + OPEN) * 0.5
            const at = {
              left: { x: pad, y: mid, anchor: 'start' as const },
              right: { x: W + OPENX - pad, y: mid, anchor: 'end' as const },
              top: { x: bxMid, y: pad, anchor: 'middle' as const },
              bottom: { x: bxMid, y: L + OPEN - pad, anchor: 'middle' as const },
            }[tagHint.side]
            return (
              <text
                x={at.x} y={at.y} fontSize={fs} fontWeight={700} fill={CREASE}
                textAnchor={at.anchor} dominantBaseline="middle"
                stroke="#ffffff" strokeWidth={fs * 0.42} paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >{tagHint.text}</text>
            )
          })()}

          {/* いま使っているところの終わり。ここまでが買う長さに効く */}
          {used > 0 && used < L && (
            <g>
              {/*
                覆いは**うっすら**に留める（依頼者の指摘・2026-08-31）。
                濃く敷くと、下の一枚（一重のところ）の色までいっしょに飛んでしまい、
                「二重か一重か」が読めなくなる。横わで上端だけ折ったときは
                一重のところと未使用のところがそっくり重なるので、そこが顕著だった。
                「まだ使っていない」は、点線と「ここまで◯ cm」の文字でも言ってある
              */}
              <rect x={bx0} y={used + openAt(used)} width={bodyW}
                height={by1 - used - openAt(used)}
                fill="#f4f5f1" fillOpacity={0.4} />
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
          summary={allDoubled
            ? <T id="layout.layer.all" strong="font-bold text-mat-600" />
            : flaps.length > 0
              ? <T id="layout.layer.some" strong="font-bold text-mat-600" />
              : <T id="layout.layer.none" />}
        >
          {half && section.fold === 'vBoth' ? (
            <T id="layout.fold.vboth" />
          ) : half && section.fold === 'hBoth' ? (
            <T id="layout.fold.hboth" vars={{ cm: (report.surfaceLengthMm / 10).toFixed(0) }} />
          ) : half && isHorizontalFold(section.fold) ? (
            <T id="layout.fold.horiz" vars={{ cm: (report.surfaceLengthMm / 10).toFixed(0) }} />
          ) : half ? (
            <T id="layout.fold.half" vars={{ cm: (report.foldDepth.left * 2 + SELVAGE_MM * 2) / 10 }} />
          ) : flaps.length > 0 ? (
            <T id="layout.fold.flap" />
          ) : (
            <T id="layout.fold.none" />
          )}
          {/*
            つまんで折る深さを変えられること（依頼者の指示・2026-09-05
            「どこかに明記しないと気づかれないだろうな、とは思っていました。
            とりあえずはしまわれている状態でも構わないので」）。

            折り方がどうであっても言うことは同じなので、
            上の場合分けの外に、そのまま続けて置く
          */}
          <span className="mt-1.5 block"><T id="layout.fold.drag" /></span>
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
            <T id="layout.fold.idle" vars={{ side: SIDE_LABELS[idleFold] }} />
          </Note>
        )}
        </div>
      </div>

      {/*
        折ったあとに実際に置ける幅。

        もとは絵の**上**にあった。だがこれは絵を見て分かることの答えなので、
        操作したところより後ろに置く（依頼者の指示・2026-08-27）。
        長さのほうは、すぐ下の「？」と、いちばん下の「買ってくる長さ」にある
      */}
      <div className="tnum flex items-center gap-2 px-1 text-[11px] leading-tight text-ink-300">
        {hint ? (
          <>
            <Icon name="fold" className="h-3.5 w-3.5 shrink-0 text-mat-600" />
            <span className="font-bold text-mat-700">{hint}</span>
          </>
        ) : (
          <>
            <Icon name="clothWidth" className="h-3.5 w-3.5 shrink-0" />
            {/*
              「生地は110cmなのに53cm？」と読まれた（学生の点検・2026-09-02）。
              折っているから狭い、というのは絵を見れば分かることではあるが、
              数字だけを見ている人には届かない。狭いときだけ理由を添える
            */}
            <span>
              <T id="layout.usable.width" vars={{ cm: (W / 10).toFixed(0) }} />
              {W < usableMm - 0.5 && (
                <T id="layout.usable.folded" vars={{ full: (usableMm / 10).toFixed(0) }} />
              )}
            </span>
          </>
        )}
        {canDrop && (
          <button
            type="button"
            onClick={onDrop}
            className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-300 active:text-seam"
          >
            <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
            この生地を消す
          </button>
        )}
      </div>

      {/*
        「いちばん長い型紙より生地が長いのはなぜか」と聞かれた（依頼者・2026-08-27）。
        長さは型紙の丈ではなく、いちばん下まで届いた型紙の「下端の位置」で決まる
      */}
      {report.boxes.length > 0 && (
        <Hint
          icon="yardage"
          summary={<T id="layout.used.summary" vars={{ cm: (used / 10).toFixed(0) }} />}
        >
          <T id="layout.used.body" />
        </Hint>
      )}
    </div>
  )
}

/* --------------------------------------------------------- 手元（下の棚） */

/** 型紙の形そのものを、小さく描く。名前が「パーツ1」でも、形で選べるように */
function Silhouette({ part }: { part: PlacedPart | undefined }) {
  if (!part || part.cutLineMm.length < 3) {
    return <span className="h-7 w-7 shrink-0 rounded border border-ink-100 bg-white" />
  }
  const xs = part.cutLineMm.map((q) => q.x)
  const ys = part.cutLineMm.map((q) => q.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const w = Math.max(1, Math.max(...xs) - x0)
  const h = Math.max(1, Math.max(...ys) - y0)
  const pad = Math.max(w, h) * 0.08
  return (
    <svg
      viewBox={`${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-7 w-7 shrink-0"
      aria-hidden="true"
    >
      <polygon
        points={part.cutLineMm.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}
        fill="#ffffff" stroke="#5c665f" strokeWidth={Math.max(w, h) * 0.035}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * まだ置いていない型紙を、画面の下端に横一列で並べる（依頼者の指示・2026-09-04）。
 *
 * もとは、生地の絵の**下に続く縦の一覧**から「置く」を押していた。
 * 絵の高さは生地の丈そのままなので、型紙を置くほど絵が伸び、
 * 一覧はそのぶん下へ遠ざかる。**枚数が多いときほど往復が長くなる**という、
 * いちばん助けが要る場面でいちばん遠くなる作りだった
 * （依頼者の指摘「すごく上下の動きがある」「置き間違いも起こりうる」）。
 *
 * 画面の下端に貼り付けてしまえば、絵がどれだけ伸びても遠ざからない。
 * 横一列なので、型紙が10枚あっても高さは変わらない。
 * 札には型紙の形そのものを描く——名前が「パーツ1／2／3」でも形で選べる。
 *
 * まだ置いていないものを先に、そろったものを後ろに並べる。
 * いつでも左端を押せばよい形にしておくと、目で探さなくて済む
 */
/** 札と札のすき間（`gap-2`）と、一覧の下の余白（`pb-2`）。段数を数えるのに使う */
const LIST_GAP = 8
const LIST_PAD = 8

function Dock({
  state, partMap, takenOf, reserves, rows, onRows,
  onPlace, onPlaceAll, onDropPart, onAddReserve,
}: {
  state: PartsState
  partMap: Map<string, PlacedPart>
  takenOf: (partId: string) => number
  /** 生地から外してある「あとで裁つぶん」。置きなおす口として札を出す */
  reserves: StoredPart[]
  /** 棚の高さ。0＝たたむ、1＝横一列、2以上＝札を折り返して何段ぶん見せるか */
  rows: number
  onRows: (rows: number) => void
  onPlace: (partId: string) => void
  onPlaceAll: () => void
  onDropPart: (partId: string) => void
  onAddReserve: () => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  /**
   * 札1枚ぶんの高さ（すき間こみ）。実物を測る——札の中身が変わっても付いてくる。
   * 一覧の高さをこれで決めるので、`ref` ではなく描き直しの効く値にしておく
   */
  const [rowH, setRowH] = useState(52)
  /** 折り返して並べたときの段数。引き上げられる上限になる */
  const [fullRows, setFullRows] = useState(6)
  /** 横一列のとき、画面からはみ出した札があるか */
  const [spill, setSpill] = useState(false)
  /** 引きずっている最中の記録。描き直しに関わらないので ref に置く */
  const grab = useRef<{ y: number; rows: number; moved: boolean } | null>(null)

  const patterns = state.parts.filter((p) => !isReserve(p))
  const restOf = (p: StoredPart) => p.needed - takenOf(p.id)
  const left = patterns.reduce((sum, p) => sum + Math.max(0, restOf(p)), 0)
  // まだ足りないものが先。同じなら、もとの並び順のまま
  const order = patterns
    .map((p, i) => ({ p, i, rest: restOf(p) }))
    .sort((a, b) => (b.rest > 0 ? 1 : 0) - (a.rest > 0 ? 1 : 0) || a.i - b.i)

  /*
    札の実物を測る（依頼者の要望・2026-09-05「必要に応じて上側に指で
    引き延ばせるようにするのはどうですか」）。

    引き上げられる上限は、**札がぜんぶ並ぶ段数**まで。
    それ以上に伸ばせてしまうと、空白だけが増えて生地の絵を覆う。
    段数は札の幅と名前の長さで変わるので、決め打ちにはできず、
    折り返して並べているあいだ（`rows >= 2`）に実物から数える。
    横一列のあいだは測れないので、そのときは前に数えた値をそのまま使う
  */
  useEffect(() => {
    const ul = listRef.current
    if (!ul) return
    const li = ul.firstElementChild as HTMLElement | null
    const h = li && li.offsetHeight > 0 ? li.offsetHeight + LIST_GAP : rowH
    setRowH((was) => (was === h ? was : h))
    /*
      折り返して並べているあいだは、実物の高さから段数がそのまま分かる。
      横一列のあいだは、**横にはみ出した長さ**を枠の幅で割って見当をつける。
      どちらの数え方でも、札がぜんぶ収まっているときは 1 になるので、
      伸ばしても空白が増えるだけ、という高さまでは引き上げられない
    */
    const n = rows >= 2
      ? Math.ceil((ul.scrollHeight - LIST_PAD) / h)
      : Math.ceil(ul.scrollWidth / Math.max(1, ul.clientWidth))
    setFullRows((was) => (was === Math.max(1, n) ? was : Math.max(1, n)))
    if (rows === 1) {
      const over = ul.scrollWidth > ul.clientWidth + 1
      setSpill((was) => (was === over ? was : over))
    }
  }, [rows, rowH, order.length, reserves.length, left])

  if (patterns.length === 0) return null

  /** 画面の半分より高くはしない。棚は生地の絵の代わりではない */
  const capRows = () => Math.max(1, Math.min(
    fullRows, Math.floor((window.innerHeight * 0.45) / rowH),
  ))

  return (
    <div data-tour="tray" className="safe-b fixed inset-x-0 bottom-0 z-10 border-t-2 border-mat-500 bg-mat-50 px-3 pt-1.5 shadow-[0_-12px_32px_rgba(43,51,45,0.22)]">
      <div className="mx-auto flex max-w-md flex-col gap-1.5">
        {/*
          たたむための帯（依頼者の要望・2026-09-04）。
          生地の下のほうへ型紙を置くときは、棚がその場所にかぶさるため。
          たたんでも帯は残す——まるごと消すと、戻し方が画面から消える。
          帯そのものが押す場所なので、指の当たる幅を目いっぱい取ってある。

          この帯は、**押しても引いてもよい**（依頼者の要望・2026-09-05）。
          上へ引けば棚が伸びて札が折り返して並び、下へ引けば縮む。
          押しただけなら、これまでどおり開いたり閉じたり。

          持ち手がこの帯なのは、棚の高さを変えたときに画面の上で
          実際に位置が動くのが、この帯そのものだからである
          （折り返す幅のつまみと同じ考え方）
        */}
        <div
          className="flex items-center gap-2"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => { grab.current = { y: e.clientY, rows, moved: false } }}
          onPointerMove={(e) => {
            const g = grab.current
            if (!g) return
            if (!g.moved && Math.abs(e.clientY - g.y) < 8) return
            if (!g.moved) {
              g.moved = true
              /*
                指を捕まえるのは、**動きはじめてから**。
                押した時点で捕まえてしまうと、そのあとの click が
                この枠へ届いてしまい、中の（たたむ）ボタンが押せなくなる
              */
              try {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              } catch { /* 捕まえられなくてよい */ }
            }
            const n = Math.max(0, Math.min(
              capRows(), Math.round(g.rows + (g.y - e.clientY) / rowH),
            ))
            if (n !== rows) onRows(n)
          }}
          onPointerUp={() => { setTimeout(() => { grab.current = null }, 0) }}
          onPointerCancel={() => { grab.current = null }}
        >
          <button
            type="button"
            /*
              引きずったあとにも click は飛んでくるので、動かしたときは何もしない。
              指で高さを決めたのに、離したとたん畳まれてしまわないように
            */
            onClick={() => { if (!grab.current?.moved) onRows(rows > 0 ? 0 : 1) }}
            aria-expanded={rows > 0}
            aria-label={rows > 0
              ? '型紙の棚をたたむ。上へ引きずると、札がぜんぶ並ぶまで広がります'
              : '型紙の棚をひらく。上へ引きずると、札がぜんぶ並ぶまで広がります'}
            className="tap flex min-w-0 flex-1 flex-col items-stretch gap-0.5 py-0.5 text-left"
          >
            {/* つまんで動かせることの印。下から出る棚では見慣れた形 */}
            <span className="mx-auto h-1 w-9 shrink-0 rounded-full bg-mat-300" />
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon
                name="chevron"
                className={`h-4 w-4 shrink-0 text-mat-600 ${rows > 0 ? 'rotate-90' : '-rotate-90'}`}
              />
              <span className="truncate text-xs font-bold text-mat-700">
                {left > 0 ? `まだ置いていない型紙 ${left} 枚` : 'ぜんぶ置きました'}
              </span>
            </span>
          </button>
          {rows > 0 && left > 0 && (
            <button
              type="button"
              onClick={onPlaceAll}
              className="shrink-0 rounded-lg border border-mat-500 bg-white px-2.5 py-1 text-xs font-bold text-mat-700 active:bg-mat-100"
            >
              ぜんぶ出す
            </button>
          )}
        </div>

        {/*
          1段のあいだは、これまでどおり横一列で流す。
          2段以上に引き上げたときだけ折り返して並べる——
          高くしても横一列のままなら、空いたぶんが空白になるだけで、
          「ぜんぶ見えるようにする」という用が足りない
        */}
        {rows > 0 && (
          <ul
            ref={listRef}
            className={`-mx-1 flex gap-2 px-1 pb-2 ${
              rows === 1 ? 'overflow-x-auto' : 'flex-wrap overflow-y-auto'
            }`}
            style={rows === 1 ? undefined : { maxHeight: rows * rowH + LIST_PAD }}
          >
            {order.map(({ p, rest }) => (
              <li key={p.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onPlace(p.id)}
                  /*
                    そろった型紙は、もう出せない（依頼者の指示・2026-09-05）。
                    押せる見た目のまま何も起きないのがいちばん困るので、
                    枠と字を薄くして「もう押すところではない」と分かるようにし、
                    理由は下の一行で言う
                  */
                  disabled={rest <= 0}
                  aria-label={
                    rest > 0
                      ? `${p.name}を生地に置く。あと ${rest} 枚`
                      : `${p.name}は置き終わりました。これ以上は置けません`
                  }
                  className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
                    rest > 0
                      ? 'border-mat-300 bg-white active:bg-mat-100'
                      : 'border-ink-100 bg-white/50 opacity-60'
                  }`}
                >
                  <Silhouette part={partMap.get(p.id)} />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="max-w-[7.5rem] truncate text-xs font-bold text-ink-900">
                      {p.name}
                    </span>
                    {rest > 0 ? (
                      <span className="tnum text-[11px] font-bold text-seam">あと {rest}</span>
                    ) : rest < 0 ? (
                      <span className="tnum text-[11px] text-ink-300">{-rest} 多い</span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-[11px] text-mat-600">
                        <Icon name="check" className="h-3 w-3 shrink-0" />
                        そろいました
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}

            {/*
              「あとで裁つぶん」も、生地に置くものなので同じ棚から出す
              （依頼者の指示・2026-09-05）。もとは生地の絵の下に見出しと
              一覧を出していたが、絵が長いほど遠ざかっていた。

              並ぶのは**生地から外したものだけ**。生地に乗っているあいだは、
              絵の上でその余白を押せば「あとで裁つぶん」の板が出るので、
              ここに控えを並べる必要がない
            */}
            {reserves.map((p) => (
              <li key={p.id} className="shrink-0">
                <div className="flex h-full items-center gap-1 rounded-xl border border-dashed border-hold-400 bg-hold-50 py-1.5 pl-2.5 pr-1.5">
                  <button
                    type="button"
                    onClick={() => onPlace(p.id)}
                    aria-label={`${p.name}の余白を、生地に置きなおす`}
                    className="flex items-center gap-2"
                  >
                    <Icon name="hold" className="h-4 w-4 shrink-0 text-hold-600" />
                    <span className="flex flex-col items-start leading-tight">
                      <span className="max-w-[7.5rem] truncate text-xs font-bold text-ink-900">
                        {p.name}
                      </span>
                      <span className="tnum text-[11px] font-bold text-hold-600">
                        {(p.widthMm / 10).toFixed(0)} × {(p.heightMm / 10).toFixed(0)} cm
                      </span>
                    </span>
                  </button>
                  {/* 消すのはここだけ。生地に乗っているあいだは、まず外してもらう */}
                  <button
                    type="button"
                    onClick={() => onDropPart(p.id)}
                    aria-label={`${p.name}の余白を消す`}
                    className="tap shrink-0 rounded-lg p-1 text-ink-300"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}

            {/*
              足す口。列のいちばん後ろに置くのは、余白の出番が
              「ひととおり並べたあと」だから（依頼者の指示・2026-09-04
              『主役の道具のあいだに割り込ませない』）。
              札の字が、見出しの言葉をそのまま引き受けている
            */}
            <li className="shrink-0">
              <button
                type="button"
                onClick={onAddReserve}
                className="flex h-full items-center gap-1.5 rounded-xl border border-dashed border-hold-400 bg-hold-50 px-3 py-1.5 text-xs font-bold text-hold-700 active:bg-hold-100"
              >
                <Icon name="plus" className="h-4 w-4 shrink-0" />
                <Icon name="hold" className="h-4 w-4 shrink-0" />
                あとで裁つぶん
              </button>
            </li>
          </ul>
        )}

        {/*
          押せなくなった札があるときだけ、その理由を言う
          （PartsView の「枚数は 12 枚までです」と同じ考え方——
          上限そのものは黙って効かせず、**届いたときにだけ**理由を出す）。

          直しに行く先まで書く。ここで枚数は変えられないので、
          「増やせない」とだけ言われても手が止まる
        */}
        {/*
          横一列に収まりきらないときだけ、引き上げられることを言う
          （依頼者の指示・2026-09-05「どこかに明記しないと気づかれない」）。
          つまみは「動かせそうだ」までしか伝えないので、
          何が起きるかは文字にしておく。ぜんぶ見えているときは黙っている
        */}
        {rows === 1 && spill && (
          <p className="pb-2 text-[11px] leading-tight text-ink-300">
            <T id="layout.dock.pull" />
          </p>
        )}

        {rows > 0 && order.some(({ rest }) => rest <= 0) && (
          <p className="pb-2 text-[11px] leading-tight text-ink-300">
            置けるのは、「縫い代」で決めた枚数までです
          </p>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- あとで裁つぶん */

/**
 * ベルトや見返しのように、仮縫いのあとに裁つものの場所を空けておく（依頼者の指示）。
 *
 * 型紙をきちんと置く必要はない。
 * 「このくらいの長方形を空けたまま、ほかを裁つ」ができればよい。
 * だから形は取らず、裁ち切りの寸法だけを入れてもらう。
 *
 * もとは本文に「あとで裁つぶん」という見出しと一覧を出していたが、
 * 生地の絵の**下**にあるので、生地が長いほど下へ遠ざかった
 * （型紙の一覧を下端の棚へ移した 2026-09-04 と、まったく同じ問題）。
 * 見出しごと下端の棚へ移し、棚の札から呼び出す用紙にした
 * （依頼者の指示・2026-09-05）。
 *
 * 一覧そのものは要らなくなった。足した余白はその場で生地に置かれるので、
 * 直したり外したりは**絵の上のその余白を押せばできる**。
 * 外したものだけが、置きなおす口として棚の札に戻る
 */
function ReservePanel({
  onAdd, onClose,
}: {
  onAdd: (name: string, widthMm: number, heightMm: number) => void
  onClose: () => void
}) {
  const [name, setName] = useState(RESERVE_CHOICES[0])
  const [widthCm, setWidthCm] = useState('9')
  const [heightCm, setHeightCm] = useState('72')

  const w = Number(widthCm)
  const h = Number(heightCm)
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0

  // 板の作りは、型紙を選んだときの操作板とそろえてある（下から出る・つまみの横棒・閉じる）
  return (
    <div className="safe-b fixed inset-x-0 bottom-0 z-10 border-t-2 border-mat-500 bg-mat-50 px-4 pt-2 shadow-[0_-12px_32px_rgba(43,51,45,0.22)] panel-up">
      <div className="mx-auto flex max-w-md flex-col gap-2 pb-2">
        <div className="mx-auto h-1 w-10 rounded-full bg-mat-300" />
        <div className="flex items-center gap-2">
          <Icon name="hold" className="h-4 w-4 shrink-0 text-hold-600" />
          {/* 見出しだけでは何のことか分からなかった（学生の点検・2026-09-02） */}
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">
            あとで裁つぶん（場所だけ空けておく）
          </span>
          <button
            type="button"
            onClick={onClose}
            className="tap shrink-0 whitespace-nowrap px-1 text-xs text-ink-300"
          >
            閉じる
          </button>
        </div>

        <Hint icon="hold" summary={<T id="layout.reserve.summary" />}>
          <T id="layout.reserve.body" />
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
          <button
            type="button"
            disabled={!ok}
            onClick={() => onAdd(name, Math.round(w * 10), Math.round(h * 10))}
            className="ml-auto rounded-lg bg-hold-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            生地に置く
          </button>
        </div>
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
  placement, name, size, count, couldBeTwo, twoLayer, reserve, hasNap, snapTargets,
  onPatch, onRemove, onClose,
}: {
  placement: Placement
  name: string
  /** 取り込んだ大きさ(mm)。`cut` は縫い代まで入れた裁ち切り */
  size: { w: number; h: number; cut: { widthMm: number; heightMm: number } | null } | null
  count: number
  /**
   * この区間には二重のところがあるのに、この型紙は1枚しか取れていない。
   *
   * まわすと ×2 が消えて「2/1枚」が「1/1枚」になる理由が
   * 画面のどこにも書いていなかった（学生の点検・2026-09-02）。
   * 損得の話ではなく、二重の帯に丸ごと入っているかどうかで変わるだけ
   */
  couldBeTwo: boolean
  /**
   * 二重のところに丸ごと入っていて、1枚と2枚のどちらにもできる置き方か。
   *
   * ここが true のときだけ、枚数を選んでもらう。
   * 折り山に当てている型紙（開けば左右対称の1枚）や、
   * 一重のところに置いた型紙には出さない——選べることが無いため
   */
  twoLayer: boolean
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
    まわしたり動かしたりすると、取れる枚数が変わることがある。
    理由は下の注意書きに書いてあるが、
    **変わったこと自体に気づかないまま先へ進む**という報告があった
    （学生の点検・2026-09-02・2巡目「まわしただけで枚数が変わる理由が
    画面からは分からず、得したのか損したのか迷いました」）。
    変わった瞬間に、いくつからいくつへ変わったかをその場で言う。
    しばらく置いてから、ひとりでに引っ込む
  */
  const [was, setWas] = useState(count)
  const [changed, setChanged] = useState<{ from: number; to: number } | null>(null)
  // 前の値と見比べるだけなので、描く前にその場で気づく（React の言う「描画中の更新」）
  if (count !== was) {
    setWas(count)
    setChanged({ from: was, to: count })
  }
  useEffect(() => {
    if (!changed) return
    const t = setTimeout(() => setChanged(null), 6000)
    return () => clearTimeout(t)
  }, [changed])
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
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">{name}</span>
          {reserve ? (
            <span className="shrink-0 rounded-md bg-hold-50 px-2 py-0.5 text-xs font-bold text-hold-700">
              あとで裁つぶん
            </span>
          ) : !twoLayer && (
            <span className="tnum shrink-0 rounded-md bg-white px-2 py-0.5 text-xs font-bold text-mat-600">
              この1つで {count} 枚
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="tap flex shrink-0 items-center gap-1 whitespace-nowrap px-1 text-xs text-seam"
          >
            <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
            生地から外す
          </button>
          <button
            type="button"
            onClick={onClose}
            className="tap shrink-0 whitespace-nowrap px-1 text-xs text-ink-300"
          >
            閉じる
          </button>
        </div>

        {/*
          二重の上では「置けば2枚」しかなかった（学生の点検・2026-09-02・2巡目）。
          実物の裁断では、1枚でよいものは下の層を避けて上だけ裁つ。
          その選択をそのまま持たせる。
          入り／切りの名前は付けず、**結果の枚数そのもの**を選んでもらう。

          名前の行に置くと、外す・閉じるとぶつかって字が折り返してしまうので、
          1行取って、意味の言い添えと並べる
        */}
        {!reserve && twoLayer && (
          <div className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tnum flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-xs font-bold text-mat-600">
              この1つで
              <span className="flex overflow-hidden rounded border border-mat-300">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onPatch({ topOnly: n === 1 })}
                    aria-pressed={count === n}
                    className={`px-2 py-1 ${
                      count === n ? 'bg-mat-500 text-white' : 'bg-white text-ink-500'
                    }`}
                  >
                    {n} 枚
                  </button>
                ))}
              </span>
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-500">
              <T id="layout.twolayer.note" strong="font-bold text-mat-700" />
            </span>
          </div>
        )}
        {!reserve && couldBeTwo && (
          <p className="-mt-1 text-[11px] leading-snug text-ink-500">
            <T id="layout.single.note" />
          </p>
        )}

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
                {' '}／ 縫い代まで {cm(size.cut.widthMm)} × {cm(size.cut.heightMm)} cm
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
              className="tap flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-ink-700 active:bg-mat-50"
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
              className="tap flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-ink-700 active:bg-mat-50"
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
            <T id="layout.reserve.note" />
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
              <T id="layout.turn.nap" strong="font-bold" />
            </Note>
          ) : (
            <Note icon="nest">
              <T id="layout.turn.nest" />
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
            <T id="layout.grain.side" />
          </Note>
        )}
        {changed && (
          <Note icon="part" tone="warn">
            <T
              id="layout.count.changed"
              vars={{ from: changed.from, to: changed.to }}
              strong="font-bold"
            />
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
