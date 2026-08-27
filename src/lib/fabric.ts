/**
 * 生地の持ち方と、要尺の計算（判断5・判断7・判断8・判断9）。
 *
 * 生地は「区間の並び」として持つ。区間ごとに折り方をひとつ持ち、
 * 要尺は各区間の長さの合計になる。
 * ふだんは区間ひとつで、学生には区間という言葉すら見せない。
 * パーツが入りきらなくなったときに初めて「ここから折り方を変える」が出る。
 *
 * 学校の配布資料の目安が、すでに足し算になっている——
 * マーメイド③は【上パーツ丈+6〜10】＋【（下パーツ丈+20）×2】。
 * 新しい計算をしているのではなく、いままでの計算を区間の数だけ繰り返して足すだけ。
 *
 * **「折り山に当てる」は、位置ではなく状態として持つ。**
 * 位置から「折り山に接しているか」を判定しようとすると、
 * 面の幅は折りの深さで決まり、折りの深さは面の幅で決まる、という堂々めぐりになる。
 * 実物では「二つ折りにした山折りに、わ の辺を当てる」という動作そのものがあるので、
 * それを `snapTo` として持てば堂々めぐりは起きない。
 */

import type { Point, Polygon } from './geom'
import { bounds } from './geom'

/** 耳の幅(mm)。片側2cm。有効幅 ＝ 生地幅 − 4cm */
export const SELVAGE_MM = 20

/** 置く位置のきざみ(mm)。1cm。細かすぎると「詰めた」感触が出ず、粗いと思った場所に置けない */
export const SNAP_MM = 10

/** よく使う生地幅(mm) */
export const COMMON_WIDTHS_MM = [900, 1100, 1400, 1500]

/**
 * 買ってくる長さへの上乗せ(mm)と、切り上げの単位(mm)。
 * 地直しの縮み・裁ち端・失敗の保険。**暫定値**（第4フェーズで依頼者と詰める）。
 */
export const PURCHASE_MARGIN_MM = 200
export const PURCHASE_ROUND_MM = 100

export type Side = 'left' | 'right' | 'top' | 'bottom'

/**
 * 折り方。判断7の4通りに「折らない」と「横わ・上端」を足したもの。
 * 上端からの横わは、サーキュラーの図（参考資料-02）で実際に使われている。
 *
 * 片側だけの「わ」は、**上下左右どの辺でも作れる**（依頼者の指示・2026-08-28）。
 * 前中心が「わ」で後ろ中心はそうでない、という場面は時折あり、
 * そのとき現実では基本、**右側を山折りにして、そこに前中心の「わ」を当てる**。
 * 左を折って型紙を裏返しても布としては同じものが取れるが、右を折るほうが素直で、
 * 実際にそうしている。このアプリは裁断のシミュレーションで、
 * 学生はここでの手順をそのまま裁断台に持っていくので、
 * 「布として同じものが取れるから左だけでよい」とはしない。
 */
export type FoldMode =
  | 'none' | 'vLeft' | 'vRight' | 'vBoth' | 'hTop' | 'hBottom' | 'hBoth'

export const FOLD_LABELS: Record<FoldMode, string> = {
  none: '折らない',
  // 左右どちらでも折れるようになったので、「片側」ではなくどちら側かを言う
  vLeft: '縦わ・左',
  vRight: '縦わ・右',
  vBoth: '縦わ・両側',
  hTop: '横わ・上端',
  hBottom: '横わ・下端',
  hBoth: '横わ・両側',
}

export const isVerticalFold = (f: FoldMode) =>
  f === 'vLeft' || f === 'vRight' || f === 'vBoth'
export const isHorizontalFold = (f: FoldMode) =>
  f === 'hTop' || f === 'hBottom' || f === 'hBoth'

/** その折り方が持つ折り山は、生地のどの端にあるか */
export function foldSidesOf(fold: FoldMode): Side[] {
  switch (fold) {
    case 'vLeft': return ['left']
    case 'vRight': return ['right']
    case 'vBoth': return ['left', 'right']
    case 'hTop': return ['top']
    case 'hBottom': return ['bottom']
    case 'hBoth': return ['top', 'bottom']
    default: return []
  }
}

export const isVerticalSide = (s: Side) => s === 'left' || s === 'right'

/** `foldSidesOf` の逆。折り山にした辺の組から折り方を決める */
export function foldOfSides(sides: Iterable<Side>): FoldMode {
  const s = new Set(sides)
  if (s.has('left') && s.has('right')) return 'vBoth'
  if (s.has('left')) return 'vLeft'
  if (s.has('right')) return 'vRight'
  if (s.has('top') && s.has('bottom')) return 'hBoth'
  if (s.has('top')) return 'hTop'
  if (s.has('bottom')) return 'hBottom'
  return 'none'
}

/**
 * 辺をひとつ押したときの、新しい折り方（依頼者の指示・2026-08-28）。
 *
 * すでに「わ」なら、押すと「わ」でなくなる。
 * まだなら「わ」になるが、縦の折りと横の折りは同時に存在できないので、
 * **最後に押した辺を通して、両立しないほうを外す**。
 * できませんと拒むより、外れる様子が見えるほうが分かりやすい。
 * 同じ向きどうし（左と右、上と下）は両立するので、そのまま重ねられる。
 */
export function toggleFoldSide(fold: FoldMode, side: Side): FoldMode {
  const now = new Set(foldSidesOf(fold))
  if (now.has(side)) {
    now.delete(side)
  } else {
    for (const s of [...now]) {
      if (isVerticalSide(s) !== isVerticalSide(side)) now.delete(s)
    }
    now.add(side)
  }
  return foldOfSides(now)
}

export type Fabric = {
  /** 生地幅(mm)。耳を含む */
  widthMm: number
  /**
   * 上下の向きがあるか（判断9）。
   * true ＝ 毛並みのあるウールや一方向の柄。180度回転（差し込み）を止める。
   * **いちばん最初に決める**（依頼者の指示）。あとから聞くと、
   * すでに差し込んで並べ終えたものを崩すことになるうえ、買う長さそのものが変わる。
   */
  hasNap: boolean
  sections: Section[]
}

export type Section = {
  id: string
  fold: FoldMode
  /**
   * 生地幅を**きっちり折る**か。折り方によって意味が変わる。
   *
   *   縦わ・片側  みみからみみへ、きっちり半分に折る。
   *               学校で最初に習う、いちばん多い基本のたたみ方（依頼者の指示）
   *   縦わ・両側  両側のみみを、中央で突き合わせるまで折る。
   *               折り山が左右に1本ずつでき、みみは真ん中で出会う
   *
   * どちらも見えている面は**すべて二重**になり、置ける幅は有効幅の半分。
   *
   * false なら従来どおり、折り山に当てた型紙の大きさから深さが決まる（判断7）。
   * 横わは、半分の元になる長さそのものをこれから求めるところなので、
   * きっちり折ることができない。
   */
  halfFold?: boolean
}

/** きっちり折るやり方がある折り方かどうか */
export const canHalfFold = (f: FoldMode) =>
  f === 'vLeft' || f === 'vRight' || f === 'vBoth'

/** この区間は、生地幅を半分に折って使うのか */
export const isHalfFold = (section: Section) =>
  section.halfFold === true && canHalfFold(section.fold)

export type Placement = {
  id: string
  partId: string
  sectionId: string
  /**
   * 区間の中での左上の位置(mm)。
   * 折り山に当ててある向きについては、この値は使わない（折り山から決まる）。
   */
  xMm: number
  yMm: number
  /** どの折り山に当てているか。当てていなければ null */
  snapTo: Side | null
  /** 差し込み。生地に向きがあるときは許さない */
  rot180: boolean
  /** 裏返し（鏡像）。許すが、印を出す */
  mirrored: boolean
  /** 地の目の変更。ふだんは止まっているが、学生が解除できる。解除したら印が残る */
  rot90: boolean
}

/**
 * 「わ」の辺に付ける作図の記号（◎の半分）を、どこにどの向きで描くか。
 *
 * 向きを角度や法線で持たず、**3つの点**で持たせてある。
 * 生地の上ではパーツを回したり裏返したりするが、点にしておけば
 * 裁ち切り線とまったく同じ計算に通せて、裏返したときの弧の向きも自然に付いてくる。
 *
 * a と b は辺に沿った直径の両端、inn は型紙の内側にある点。
 * a と b の間は `FOLD_MARK_REF_MM` に固定してあり、実際に描く大きさは
 * 描く側が決める（縫い代の画面と生地の画面では、見やすい大きさが違うため）。
 */
export type FoldMark = {
  a: Point
  b: Point
  inn: Point
  /** もとの辺の長さ(mm)。短い辺に大きく描くとはみ出すので、大きさの上限に使う */
  lengthMm: number
}

/** 「わ」の記号の 3 点を作るときの、a–b 間の長さ(mm)。向きを取り出すためだけの目安 */
export const FOLD_MARK_REF_MM = 10

/** 配置に使うパーツ。縫い代を足したあとの形と、もとの出来上がり線の両方を持つ */
export type PlacedPart = {
  id: string
  /** 裁ち切り線(mm)。左上を原点に寄せてある */
  cutLineMm: Polygon
  /**
   * 出来上がり線(mm)。裁ち切り線と同じ原点。
   *
   * 生地の上でも縫い代の帯が見えていないと、
   * 「この縫い代の重なりならどうにかなる」という判断ができない（依頼者の指示）。
   */
  finishedLineMm: Polygon
  /** 縫い代 0 の辺（＝折り山に当てる辺）を持つか */
  hasFoldEdge: boolean
  /** 「わ」の辺に付ける作図の記号の置き場所。辺ごとに1つ */
  foldMarksMm: FoldMark[]
  /**
   * 「わ」の辺で開いて裁つ型紙の、中心線（依頼者の質問・2026-08-28）。
   *
   * 開いた型紙は左右対称の1枚になっていて、真ん中に折り線が通っている。
   * これを引かないと、ただの幅広の紙にしか見えず、
   * **「わ」で開いた形になっているのかどうかが図から読めない**。
   * 一点鎖線で引く。開いていないパーツでは null。
   */
  centerLineMm: { a: Point; b: Point } | null
}

export const usableWidthMm = (fabric: Fabric) => Math.max(0, fabric.widthMm - SELVAGE_MM * 2)

export const newPlacement = (
  id: string, partId: string, sectionId: string,
  over: Partial<Placement> = {},
): Placement => ({
  id, partId, sectionId,
  xMm: 0, yMm: 0, snapTo: null,
  rot180: false, mirrored: false, rot90: false,
  ...over,
})

/**
 * パーツを、置いた向きのとおりに変換する。裁ち切り線と出来上がり線を一緒に返す。
 *
 * 位置合わせの基準は**必ず裁ち切り線の枠**にする。
 * 出来上がり線を自分の枠で正規化すると、2本が別々にずれてしまう。
 */
export function orientedPair(
  part: PlacedPart, p: Placement,
): { cut: Polygon; finished: Polygon; marks: FoldMark[]; center: { a: Point; b: Point } | null } {
  const swap = (poly: Polygon) => (p.rot90 ? poly.map((q) => ({ x: q.y, y: q.x })) : poly)
  const cut = swap(part.cutLineMm)
  const finished = swap(part.finishedLineMm)

  const b = bounds(cut)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const move = (poly: Polygon) =>
    poly.map((q) => {
      let x = q.x - b.minX
      let y = q.y - b.minY
      if (p.mirrored) x = w - x
      if (p.rot180) { x = w - x; y = h - y }
      return { x, y }
    })

  // 「わ」の記号も中心線も、裁ち切り線とまったく同じ計算に通す
  const marks = part.foldMarksMm.map((m) => {
    const [a, bb, inn] = move(swap([m.a, m.b, m.inn]))
    return { a, b: bb, inn, lengthMm: m.lengthMm }
  })
  let center: { a: Point; b: Point } | null = null
  if (part.centerLineMm) {
    const [a, bb] = move(swap([part.centerLineMm.a, part.centerLineMm.b]))
    center = { a, b: bb }
  }

  return { cut: move(cut), finished: move(finished), marks, center }
}

/** パーツを、置いた向きのとおりに変換した裁ち切り線 */
export const orientedOutline = (part: PlacedPart, p: Placement): Polygon =>
  orientedPair(part, p).cut

export function sizeOf(part: PlacedPart, p: Placement): { w: number; h: number } {
  const b = bounds(orientedOutline(part, p))
  return { w: b.maxX - b.minX, h: b.maxY - b.minY }
}

export type Problem = {
  kind: 'tooWide' | 'tooDeep' | 'overlap' | 'offFold' | 'noSuchFold' | 'napLocked'
  message: string
  placementId?: string
}

export type Box = { x: number; y: number; w: number; h: number }

export type SectionReport = {
  id: string
  fold: FoldMode
  /** 描く面の幅(mm)。折り込んだぶんを引いてある */
  surfaceWidthMm: number
  /** 描く面の長さ(mm)。置いたパーツのいちばん下で決まる */
  surfaceLengthMm: number
  /** 折り込む深さ(mm)。折り山に当てたパーツのうち、いちばん深いものから決まる */
  foldDepth: Record<Side, number>
  /** この区間が使う生地の長さ(mm)。横わのときは折り込んだぶんが足される */
  yardageMm: number
  /** 二重になっている帯。ここに丸ごと入ったパーツは2枚取れる */
  doubled: Box[]
  /** 折り山に当てたパーツを含む、実際に置かれた場所 */
  boxes: Array<Box & { placementId: string }>
  problems: Problem[]
}

export type YardageReport = {
  sections: SectionReport[]
  /** 要尺(mm)。各区間の合計 */
  totalMm: number
  /** 買ってくる長さ(mm)。上乗せして切り上げたもの */
  purchaseMm: number
  /** パーツごとの取れる枚数 */
  counts: Array<{ placementId: string; count: 1 | 2; onFold: boolean }>
  problems: Problem[]
}

/**
 * 要尺を出す。
 *
 * 折り込む深さは学生に入力させない（判断7）。
 * 折り山に当てたパーツのうち、いちばん深いものから自動で決まる。
 * つまみが1つ減るうえ、「大きいパーツを載せると折りが深くなる」という実物どおりの反応になる。
 */
export function computeYardage(
  fabric: Fabric,
  placements: Placement[],
  parts: Map<string, PlacedPart>,
): YardageReport {
  const usable = usableWidthMm(fabric)
  const sections: SectionReport[] = []
  const counts: YardageReport['counts'] = []

  for (const section of fabric.sections) {
    const sides = foldSidesOf(section.fold)
    const problems: Problem[] = []

    const items = placements
      .filter((p) => p.sectionId === section.id)
      .map((p) => {
        const part = parts.get(p.partId)
        return part ? { p, part, ...sizeOf(part, p) } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // 折り山でない側に当てようとしていたら、当てていない扱いにして知らせる
    for (const it of items) {
      if (it.p.snapTo && !sides.includes(it.p.snapTo)) {
        problems.push({
          kind: 'noSuchFold',
          placementId: it.p.id,
          message: `この区間の折り方（${FOLD_LABELS[section.fold]}）には、その側に折り山がありません。`,
        })
      }
    }
    const snapOf = (p: Placement): Side | null =>
      p.snapTo && sides.includes(p.snapTo) ? p.snapTo : null

    // 1. 折り込む深さ。折り山に当てたパーツの、折り山と直角の向きの大きさ
    const depth: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
    if (isHalfFold(section)) {
      // きっちり折る。置いた型紙には左右されない。
      // 両側から折るときは、左右のみみが中央で出会うので、片側ずつは4分の1
      if (section.fold === 'vBoth') {
        depth.left = usable / 4
        depth.right = usable / 4
      } else if (section.fold === 'vRight') {
        depth.right = usable / 2
      } else {
        depth.left = usable / 2
      }
    } else {
      for (const it of items) {
        const s = snapOf(it.p)
        if (s === 'left') depth.left = Math.max(depth.left, it.w)
        else if (s === 'right') depth.right = Math.max(depth.right, it.w)
        else if (s === 'top') depth.top = Math.max(depth.top, it.h)
        else if (s === 'bottom') depth.bottom = Math.max(depth.bottom, it.h)
      }
    }

    const surfaceWidth = usable - depth.left - depth.right

    // 2. 面の長さ。下端の折り山に当てたパーツは、面の長さが決まってから位置が決まるので、
    //    まず「それ以外のパーツがどこまで下がっているか」と「下端パーツの高さ」で決める
    let surfaceLength = 0
    for (const it of items) {
      const s = snapOf(it.p)
      if (s === 'bottom') surfaceLength = Math.max(surfaceLength, it.h)
      else if (s === 'top') surfaceLength = Math.max(surfaceLength, it.h)
      else surfaceLength = Math.max(surfaceLength, it.p.yMm + it.h)
    }

    // 3. 実際に置かれた場所。折り山に当てた向きは、折り山から決まる
    const boxes = items.map((it) => {
      const s = snapOf(it.p)
      let x = it.p.xMm
      let y = it.p.yMm
      if (s === 'left') x = 0
      else if (s === 'right') x = surfaceWidth - it.w
      else if (s === 'top') y = 0
      else if (s === 'bottom') y = surfaceLength - it.h
      return { placementId: it.p.id, x, y, w: it.w, h: it.h }
    })

    // 折りは半分より深くできない。実物で起きないことは、画面でも起こさない
    if (depth.left + depth.right > usable / 2 + 0.5) {
      problems.push({
        kind: 'tooDeep',
        message: `折り山に当てたパーツが、有効幅 ${fmtCm(usable)}cm の半分を超えました。生地幅を上げるか、折り方を変えてください。`,
      })
    }
    if (surfaceLength > 0 && depth.top + depth.bottom > surfaceLength + 0.5) {
      problems.push({
        kind: 'tooDeep',
        message: '上下から折る深さの合計が、区間の長さを超えました。折り方を変えてください。',
      })
    }

    // 4. 二重になっている帯。ここに丸ごと入ったパーツは2枚取れる。
    //    両側から折って左右（上下）の帯が中央で出会っているときは、面が丸ごと二重。
    //    そこを2本の帯のままにしておくと、中央をまたいで置いたパーツが
    //    「どちらの帯にも収まっていない＝1枚」と数えられてしまう（依頼者の指摘）
    const doubled: Box[] = []
    if (depth.left + depth.right >= surfaceWidth - 0.5 && depth.left > 0 && depth.right > 0) {
      doubled.push({ x: 0, y: 0, w: surfaceWidth, h: surfaceLength })
    } else {
      if (depth.left > 0) doubled.push({ x: 0, y: 0, w: depth.left, h: surfaceLength })
      if (depth.right > 0) {
        doubled.push({ x: surfaceWidth - depth.right, y: 0, w: depth.right, h: surfaceLength })
      }
    }
    if (surfaceLength > 0 && depth.top + depth.bottom >= surfaceLength - 0.5
      && depth.top > 0 && depth.bottom > 0) {
      doubled.push({ x: 0, y: 0, w: surfaceWidth, h: surfaceLength })
    } else {
      if (depth.top > 0) doubled.push({ x: 0, y: 0, w: surfaceWidth, h: depth.top })
      if (depth.bottom > 0) {
        doubled.push({ x: 0, y: surfaceLength - depth.bottom, w: surfaceWidth, h: depth.bottom })
      }
    }

    // 5. パーツごとの枚数と、置き方の問題
    for (let i = 0; i < items.length; i++) {
      const { p, part } = items[i]
      const box = boxes[i]
      const onFold = snapOf(p) !== null

      if (box.x < -0.5 || box.x + box.w > surfaceWidth + 0.5) {
        // 「そもそも入らない」と「置き場所が悪いだけ」では、することが違う
        const tooBig = box.w > surfaceWidth + 0.5
        problems.push({
          kind: 'tooWide',
          placementId: p.id,
          message: tooBig
            ? `この生地幅では横に収まりません（パーツ ${fmtCm(box.w)}cm ／ 置ける幅 ${fmtCm(surfaceWidth)}cm）。`
            : `生地の横幅からはみ出しています。内側へ寄せてください（置ける幅 ${fmtCm(surfaceWidth)}cm）。`,
        })
      }
      if (p.rot180 && fabric.hasNap) {
        problems.push({
          kind: 'napLocked',
          placementId: p.id,
          message: '毛並みのある生地・一方向の柄では、差し込み（180度回転）はできません。',
        })
      }
      // 縫い代 0 の辺を持つパーツは、折り山に当てないといけない。
      // 少しずれたまま置けてしまうと、実物ではありえない図が出来上がる
      if (part.hasFoldEdge && !onFold) {
        problems.push({
          kind: 'offFold',
          placementId: p.id,
          message: 'このパーツには「わ」の辺（縫い代 0）があります。折り山に当ててください。',
        })
      }

      counts.push({
        placementId: p.id,
        onFold,
        // 折り山に当てていれば、開いて左右対称の1枚。
        // 二重の帯に丸ごと入っていれば2枚。またいでいるなら1枚（安全側に倒す）
        count: onFold ? 1 : insideAny(box, doubled) ? 2 : 1,
      })
    }

    // 6. 重なり
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!boxesOverlap(boxes[i], boxes[j])) continue
        problems.push({
          kind: 'overlap',
          placementId: boxes[i].placementId,
          message: 'パーツが重なっています。',
        })
      }
    }

    sections.push({
      id: section.id,
      fold: section.fold,
      surfaceWidthMm: surfaceWidth,
      surfaceLengthMm: surfaceLength,
      foldDepth: depth,
      // 縦に折っても長さは変わらないが、横に折ると折ったぶんだけ余分に使う
      yardageMm: surfaceLength + depth.top + depth.bottom,
      doubled,
      boxes,
      problems,
    })
  }

  const totalMm = sections.reduce((s, x) => s + x.yardageMm, 0)
  return {
    sections,
    totalMm,
    purchaseMm: toPurchaseLength(totalMm),
    counts,
    problems: sections.flatMap((s) => s.problems),
  }
}

/** 要尺から「買ってくる長さ」へ。上乗せして切り上げる（暫定値） */
export const toPurchaseLength = (yardageMm: number): number =>
  yardageMm <= 0
    ? 0
    : Math.ceil((yardageMm + PURCHASE_MARGIN_MM) / PURCHASE_ROUND_MM) * PURCHASE_ROUND_MM

const fmtCm = (mm: number) => Math.round(mm / 10)

/** 枠が離れていれば形も離れている。まず枠で当たりを付ける（判断3の実装のこつ） */
const boxesOverlap = (a: Box, b: Box): boolean =>
  !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 ||
    a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5)

const insideAny = (box: Box, areas: Box[]): boolean =>
  areas.some(
    (d) => box.x >= d.x - 0.5 && box.x + box.w <= d.x + d.w + 0.5 &&
           box.y >= d.y - 0.5 && box.y + box.h <= d.y + d.h + 0.5,
  )
