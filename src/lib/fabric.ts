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
 * それぞれの生地幅で、店頭でよく見かける生地の名前（依頼者の指示・2026-08-31）。
 * 数字だけでは、どれを選べばいいのか学生には分からない。
 *
 * **規格の呼び名（「シングル幅」「普通幅」など）は書かない。**
 * 依頼者からもらった一覧表は 108〜112cm を「シングル幅」と呼んでいるが、
 * 生地問屋の解説では 90〜92cm が「シングル幅」で、110〜120cm は「普通幅」だった。
 * 出どころによって指す幅が違うので、確信の持てない呼び名を
 * 学生の画面に出すことはしない。生地の名前だけなら食い違わない。
 */
export const WIDTH_FABRICS: Record<number, string> = {
  900: 'シーチング',
  1100: '綿・麻',
  1400: 'ウール',
  1500: 'コート地',
}

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

/*
  「縦わ・左」の「・左」が何を指すのか読めなかった
  （学生の点検・2026-09-02・2巡目）。どの辺で折るか、という意味なので、そう書く
*/
export const FOLD_LABELS: Record<FoldMode, string> = {
  none: '折らない',
  // 左右どちらでも折れるようになったので、「片側」ではなくどちら側かを言う
  vLeft: '縦わ・左で折る',
  vRight: '縦わ・右で折る',
  vBoth: '縦わ・両側で折る',
  hTop: '横わ・上で折る',
  hBottom: '横わ・下で折る',
  hBoth: '横わ・両側で折る',
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

/** 折り図の辺をさわり終えたときに起きること */
export type EdgeAction =
  /** 押した。「わ」が付いていなければ付け、付いていれば外す */
  | 'toggle'
  /** 引きずって、折るのをやめた */
  | 'off'
  /** 引きずって、浅く折った＝折る深さは置いた型紙に合わせる */
  | 'partial'
  /** 引きずって、半分まで折った＝きっちり折る */
  | 'half'

/**
 * 辺をさわった結果、折り方がどうなるか。
 *
 * 小さい折り図は「生地」の画面と「並べる」の画面の両方に出る（依頼者の指示・2026-09-01）。
 * どちらでさわっても同じことが起きるように、決め方はここに1つだけ置いてある。
 */
export function foldFromEdge(
  fold: FoldMode, side: Side, action: EdgeAction,
): { fold: FoldMode; halfFold?: boolean } {
  if (action === 'toggle') return { fold: toggleFoldSide(fold, side) }
  if (action === 'off') {
    const left = new Set(foldSidesOf(fold))
    left.delete(side)
    return { fold: foldOfSides(left) }
  }
  // まだ「わ」でなければ付ける。縦と横は両立しないので、通し方は押したときと同じ
  const next = foldSidesOf(fold).includes(side) ? fold : toggleFoldSide(fold, side)
  return { fold: next, halfFold: action === 'half' }
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
   *   横わ・片側  上（下）の裁ち端を、面の長さのぶんだけ折り返す。
   *               置いた型紙が届く長さの、ちょうど倍の生地を使うことになる
   *   横わ・両側  上下の裁ち端を、中央で突き合わせるまで折る
   *
   * どれも見えている面は**すべて二重**になる。
   * 縦わなら置ける幅が有効幅の半分になり、
   * 横わなら必要な長さが面の長さの倍になる。
   *
   * false なら従来どおり、折り山に当てた型紙の大きさから深さが決まる（判断7）。
   */
  halfFold?: boolean
}

/** きっちり折るやり方がある折り方かどうか */
export const canHalfFold = (f: FoldMode) => f !== 'none'

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
  /**
   * 回した向き。90度きざみの4通りを、この2つの真偽値で持っている。
   *
   * **画面では角度そのもの（`turnOf`）を見せ、左右へ90度ずつ回してもらう**
   * （依頼者の指摘・2026-08-31「任意で左右方向に90°ずつ回転出来るボタンがあれば
   * それで済むし、分かりやすい」）。もとは「差し込む（180°）」と
   * 「横向き（地の目を変える）」という2つの入り／切りに分けていたが、
   * 学生から見れば同じ「回す」であり、2つの札のどちらを押せば目当ての向きになるのかが
   * 読めなかった。持ちかたは変えていない——古い見積もりをそのまま開けるようにするため。
   *
   * 角度が持つ意味（実物の言葉）は、こちらで言い添える。
   * 90度・270度は**地の目が横**、180度は**差し込み**（上下逆）にあたる。
   */
  rot180: boolean
  /** 裏返し（鏡像）。許すが、印を出す */
  mirrored: boolean
  rot90: boolean
  /**
   * 二重のところに置いてあっても、**上の一枚だけを裁つ**か。
   *
   * 半分に折った生地では、見えている面が丸ごと二重になる。
   * すると型紙を1つ置くたびに必ず2枚とれてしまい、
   * 1枚しか要らないパーツは「0枚」か「2枚」しか選べない。
   * 「要る数より多く置いています」が何をしても消えず、
   * 自分の操作が悪いのだと思って置いては消してを繰り返す、
   * という報告があった（学生の点検・2026-09-02・2巡目。3〜4分止まった）。
   *
   * 実物の裁断では、1枚でよいものは下の層を避けて上だけ裁つ。
   * その動きをそのまま持たせる。既定は false（二重なら2枚）。
   */
  topOnly?: boolean
}

/** 回した角度（0・90・180・270）。真偽値2つの組み合わせから出す */
export const turnOf = (p: Placement): 0 | 90 | 180 | 270 =>
  ((p.rot90 ? 90 : 0) + (p.rot180 ? 180 : 0)) as 0 | 90 | 180 | 270

/** 角度を真偽値2つに戻す。90度きざみでない値は丸める */
export const turnTo = (deg: number): { rot90: boolean; rot180: boolean } => {
  const t = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  return { rot90: t === 90 || t === 270, rot180: t === 180 || t === 270 }
}

/** いまの向きから、右（`+1`）か左（`-1`）へ90度回した向き */
export const turnBy = (p: Placement, dir: 1 | -1) => turnTo(turnOf(p) + dir * 90)

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
  /*
    回すのは**本当の回転**にする。

    もとは90度のところで x と y を入れかえていた。入れかえは対角線を軸にした
    鏡映であって回転ではないので、左右対称でない型紙は裏返った形で描かれていた
    （枠の大きさは同じなので、要尺の数字には出ない。図だけが違う）。
    「裏返す」を別の札にして印まで出しているのに、
    回しただけで黙って裏返るのでは筋が通らない。

    画面の y は下向きなので、`+90` は画面上の右回り。
  */
  const turn = turnOf(p)
  const spin = (poly: Polygon): Polygon =>
    turn === 90 ? poly.map((q) => ({ x: -q.y, y: q.x }))
      : turn === 180 ? poly.map((q) => ({ x: -q.x, y: -q.y }))
        : turn === 270 ? poly.map((q) => ({ x: q.y, y: -q.x }))
          : poly
  const cut = spin(part.cutLineMm)
  const finished = spin(part.finishedLineMm)

  const b = bounds(cut)
  const w = b.maxX - b.minX
  // 裏返しは、回したあとの画面の上で左右をひっくり返す。
  // 「見えている形が左右反転する」のが、いちばん読みやすい
  const move = (poly: Polygon) =>
    poly.map((q) => {
      const x = q.x - b.minX
      const y = q.y - b.minY
      return { x: p.mirrored ? w - x : x, y }
    })

  // 「わ」の記号も中心線も、裁ち切り線とまったく同じ計算に通す
  const marks = part.foldMarksMm.map((m) => {
    const [a, bb, inn] = move(spin([m.a, m.b, m.inn]))
    return { a, b: bb, inn, lengthMm: m.lengthMm }
  })
  let center: { a: Point; b: Point } | null = null
  if (part.centerLineMm) {
    const [a, bb] = move(spin([part.centerLineMm.a, part.centerLineMm.b]))
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

/**
 * 「わ」の辺が、いま置いている向きで**どちら側を向いているか**。
 *
 * 生地の上で引きずったときに、勝手に折り山へ吸い付かせるために要る
 * （依頼者の指摘・2026-08-31「手動でわの折り方の部分に持っていった際は
 * 自動で吸着して欲しい」）。どの折り山にでも吸い付いてよいわけではない。
 * 「わ」の辺が縦に走っている型紙が、上の折り山に当たることはないためである。
 *
 * 向きは**型紙の本体が辺のどちら側にあるか**で決まる。
 * 本体が辺より右にあるなら、その辺は左を向いている＝左の折り山に当てる。
 * 「わ」の記号は辺に沿った2点（a・b）と内側の1点（inn）で持っているので、
 * 回転や裏返しを通したあとでも、そのまま同じ判定ができる。
 *
 * 「わ」の辺を持たない型紙（開いて裁つ設定にしたものを含む）では空になる。
 */
export function foldEdgeSides(part: PlacedPart, p: Placement): Side[] {
  if (!part.hasFoldEdge) return []
  const out: Side[] = []
  for (const m of orientedPair(part, p).marks) {
    const dx = Math.abs(m.b.x - m.a.x)
    const dy = Math.abs(m.b.y - m.a.y)
    const side: Side = dy >= dx
      ? (m.inn.x >= (m.a.x + m.b.x) / 2 ? 'left' : 'right')
      : (m.inn.y >= (m.a.y + m.b.y) / 2 ? 'top' : 'bottom')
    if (!out.includes(side)) out.push(side)
  }
  return out
}

export type Problem = {
  kind: 'tooWide' | 'tooDeep' | 'overlap' | 'offFold' | 'noSuchFold' | 'napLocked' | 'acrossMeet'
  message: string
  placementId?: string
  /**
   * 重なりの、もう一方（学生の点検・2026-09-02）。
   *
   * もとは片方の名前しか持っていなかったので、3つ重ねると
   * 「スカート後：パーツが重なっています。」がまったく同じ文で何度も並び、
   * どれとどれの話なのか分からなかった。相手を持たせて、両方の名前で言う
   */
  otherPlacementId?: string
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
  /**
   * 理屈のうえでの最短(mm)。**置いた型紙の面積を、置ける幅で割ったもの**。
   *
   * 要尺で本当に教えたいのは数字そのものではなく、
   * 「詰め方しだいで変わる」ということのほう。いまの並べ方が良いのか悪いのかを
   * 画面が何も言わないと、雑に並べても丁寧に並べても同じ顔をしてしまう。
   *
   * 型紙は四角ではないので、ここまで短くはできない。**下限であって目標ではない**。
   * 何%なら良いという目安は書かない（依頼者の判断・2026-09-02）。
   * 実習でどれくらいが妥当かはこちらで決められることではなく、
   * 数字を決め打ちにすると嘘を教えることになるため
   */
  minYardageMm: number
  /** 二重になっている帯。ここに丸ごと入ったパーツは2枚取れる */
  doubled: Box[]
  /** 折り山に当てたパーツを含む、実際に置かれた場所 */
  boxes: Array<Box & { placementId: string }>
  /**
   * 両側から折って端どうしが出会うところ（出会い目）の座標(mm)。出会っていなければ null。
   *
   * 面としては丈ごと二重でも、**上になっている一枚はここで切れている**ので、
   * ここをまたいで型紙は置けない。画面側は、引きずっているあいだから
   * ここを越えられないようにする（依頼者の指示・2026-08-30
   * 「隙間が空いている部分の上には乗せられないようにしてください」）
   */
  meetXMm: number | null
  meetYMm: number | null
  problems: Problem[]
}

export type YardageReport = {
  sections: SectionReport[]
  /** 要尺(mm)。各区間の合計 */
  totalMm: number
  /** 理屈のうえでの最短(mm)。各区間の合計。`totalMm` を超えることはない */
  minTotalMm: number
  /** 買ってくる長さ(mm)。上乗せして切り上げたもの */
  purchaseMm: number
  /** パーツごとの取れる枚数 */
  counts: Array<{
    placementId: string
    count: 1 | 2
    onFold: boolean
    /** 上の一枚だけにしなければ2枚とれる置き方か（`topOnly` の札を出す目印） */
    couldBeTwo: boolean
  }>
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

    // 1. 面の長さ。下端の折り山に当てたパーツは、面の長さが決まってから位置が決まるので、
    //    まず「それ以外のパーツがどこまで下がっているか」と「下端パーツの高さ」で決める。
    //    横わをきっちり折るときは、この長さがそのまま折り込む深さになるので、深さより先に出す
    let surfaceLength = 0
    /**
     * 上下の両方から折って端が出会うとき、折り山に当てたパーツは
     * **その側の折り返し1枚のなかに収まっていなければならない**。
     *
     * 上から折り返した一枚は面の半分までしか来ておらず、その先にあるのは
     * 下から折り返してきた別の一枚。はみ出すと、上になっている一枚が
     * 途中で切れているところをまたぐことになり、裁てない
     * （依頼者の指摘・2026-08-30）。したがって面の長さは、
     * 折り山に当てたパーツの**倍**が要る。折り方としては不利になるが、
     * 実物でできないことを数字の上でできることにしてはいけない。
     */
    /** 折り山に当てたパーツの、折り山と直角の向きの大きさ。いちばん深いもの */
    const snapped: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
    for (const it of items) {
      const sd = snapOf(it.p)
      if (sd === 'left' || sd === 'right') {
        snapped[sd] = Math.max(snapped[sd], it.w)
        // 左右の折り山に当てても、長さの方向には自由に置ける。丈は面の長さに効く
        surfaceLength = Math.max(surfaceLength, it.p.yMm + it.h)
      } else if (sd) snapped[sd] = Math.max(snapped[sd], it.h)
      else surfaceLength = Math.max(surfaceLength, it.p.yMm + it.h)
    }
    // 上下の両方から折るなら、面には**2つぶん**が要る。
    // 上から折り返した一枚と下から折り返した一枚は、重ねられないため
    surfaceLength = sides.includes('top') && sides.includes('bottom')
      ? Math.max(surfaceLength, snapped.top + snapped.bottom)
      : Math.max(surfaceLength, snapped.top, snapped.bottom)

    // 2. 折り込む深さ。折り山に当てたパーツの、折り山と直角の向きの大きさ
    const depth: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
    if (isHalfFold(section)) {
      /**
       * 両端が出会うまで折る。
       *
       * 出会うのに要る深さの合計は決まっている（縦なら有効幅の半分、
       * 横なら面の長さ）。**その内訳までは決め打ちにしない**
       * （依頼者の指示・2026-08-30「マイスカート分が入るところまでは
       * 上側が輪にならないといけない……折り返ってきて2枚が重なっている幅を
       * 自動で調整できるようにしなければならない」）。
       *
       * 実物の手つきがそうなっている。人は「まず半分に折ってから型紙を置く」
       * のではなく、「この型紙が入るところまで折る」という順に手を動かす。
       * だから深さは結果であって、前提ではない。
       * 折り山に何も当てていないときだけ、半分ずつに分ける。
       */
      const share = (a: Side, b: Side, total: number) => {
        if (snapped[a] === 0 && snapped[b] === 0) {
          depth[a] = total / 2
          depth[b] = total / 2
          return
        }
        depth[a] = snapped[a] > 0 ? snapped[a] : Math.max(total - snapped[b], 0)
        depth[b] = Math.max(snapped[b], total - depth[a])
      }
      if (section.fold === 'vBoth') share('left', 'right', usable / 2)
      else if (section.fold === 'vRight') depth.right = usable / 2
      else if (section.fold === 'vLeft') depth.left = usable / 2
      else if (section.fold === 'hBoth') share('top', 'bottom', surfaceLength)
      // 横わは「面の長さ」を折り返す。折る前の生地は、その倍の長さになる
      else if (section.fold === 'hBottom') depth.bottom = surfaceLength
      else depth.top = surfaceLength
    } else {
      for (const sd of sides) depth[sd] = snapped[sd]
    }

    const surfaceWidth = usable - depth.left - depth.right

    /**
     * 両側から折って端どうしが出会っているときの、その出会い目。
     *
     * ここは面としては丸ごと二重だが、**上になっている一枚はここで切れている**。
     * 折り返してきた左の一枚と右の一枚は別々の布で、突き合わせているだけ。
     * だからここをまたいで型紙を置くと、下の一枚からは1枚とれるものの、
     * 上の一枚は2つに割れて使えなくなる。実物では成り立たない置き方なので、
     * 画面では**引きずっているあいだから越えられないようにする**
     * （依頼者の指示・2026-08-30
     * 「隙間が空いている部分の上には乗せられないようにしてください」）。
     * ここに残す知らせは、古い状態を読み込んだときなどの受け皿である。
     *
     * 出会い目は真ん中とはかぎらない。折り山に当てた型紙に合わせて深さが動くので、
     * 大きいほうの型紙を当てた側へ寄る。
     */
    const meetX = depth.left > 0 && depth.right > 0
      && depth.left + depth.right >= surfaceWidth - 0.5 ? depth.left : null
    const meetY = surfaceLength > 0 && depth.top > 0 && depth.bottom > 0
      && depth.top + depth.bottom >= surfaceLength - 0.5 ? depth.top : null

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
      const acrossMeet =
        (meetX !== null && box.x < meetX - 0.5 && box.x + box.w > meetX + 0.5)
        || (meetY !== null && box.y < meetY - 0.5 && box.y + box.h > meetY + 0.5)
      if (acrossMeet) {
        // 片側に寄せれば済むのか、そもそも折り返し一枚に入らないのかで、
        // 学生がすることが変わる。「寄せてください」と言われても
        // どこにも寄せられない、という行き止まりを作らない
        const across = meetX !== null && box.x < meetX && box.x + box.w > meetX
        const room = across
          ? Math.max(depth.left, depth.right) >= box.w - 0.5
          : Math.max(depth.top, depth.bottom) >= box.h - 0.5
        problems.push({
          kind: 'acrossMeet',
          placementId: p.id,
          message: `${across ? '左右' : '上下'}から折った端どうしが出会うところをまたいでいます。`
            + '上になっている一枚はここで切れているので、またぐと裁てません。'
            + (room
              ? 'どちらか片側へ寄せてください。'
              : 'この型紙は折り返し一枚に収まらないので、折り山に当てるか'
                + '（当てた側の折り返しが、その型紙に合わせて深くなります）、'
                + '折り方を変えてください。'),
        })
      }

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
      /*
        上下逆（差し込み）は、向きのある生地では毛並みや柄がそろわない。
        **止めはせず、そうなっていることを知らせる**（依頼者の指示・2026-08-30）。
        左右へ90度ずつ回す作りにした以上、途中の180度だけ通さない、
        という作りにはできない（依頼者の指摘・2026-08-31）。

        見るのは180度のときだけ。270度は `rot180` が立っているが、
        これは「地の目が横」の側であって、差し込みではない
      */
      if (turnOf(p) === 180 && fabric.hasNap) {
        problems.push({
          kind: 'napLocked',
          placementId: p.id,
          message: '毛並みのある生地・一方向の柄です。上下逆（180度）にすると向きがそろいません。',
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

      // 折り山に当てていれば、開いて左右対称の1枚。
      // 二重の帯に丸ごと入っていれば2枚。またいでいるなら1枚（安全側に倒す）。
      // 端どうしの出会い目をまたいでいるときも、上の一枚が割れるので1枚
      const couldBeTwo = !onFold && !acrossMeet && insideAny(box, doubled)
      counts.push({
        placementId: p.id,
        onFold,
        couldBeTwo,
        // 上の一枚だけを裁つと決めてあれば、二重の上でも1枚
        count: couldBeTwo && !p.topOnly ? 2 : 1,
      })
    }

    // 6. 重なり
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!boxesOverlap(boxes[i], boxes[j])) continue
        problems.push({
          kind: 'overlap',
          placementId: boxes[i].placementId,
          otherPlacementId: boxes[j].placementId,
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
      minYardageMm: minYardageOf(
        boxes, surfaceWidth, surfaceLength, depth,
        isHalfFold(section) && isHorizontalFold(section.fold),
      ),
      doubled,
      boxes,
      meetXMm: meetX,
      meetYMm: meetY,
      problems,
    })
  }

  const totalMm = sections.reduce((s, x) => s + x.yardageMm, 0)
  return {
    sections,
    totalMm,
    minTotalMm: sections.reduce((s, x) => s + x.minYardageMm, 0),
    purchaseMm: toPurchaseLength(totalMm),
    counts,
    problems: sections.flatMap((s) => s.problems),
  }
}

/**
 * 生地の幅からはみ出したものを、幅の中へ戻す（学生の点検・2026-09-02・2巡目）。
 *
 * 生地幅を変えて戻ってくると、置いたものはそのまま残る。
 * これは狙いどおり（並べ直しにならない）なのだが、
 * **幅を狭めたときにはみ出したものは、はみ出したまま**になっていた。
 * 幅の中へ戻すのは横に寄せるだけの機械的な作業なので、まとめて引き受ける。
 *
 * 動かすのは、はみ出しているものだけ。入っているものには触らない。
 * 折り山に当てているものは、折り山のほうから位置が決まるので動かさない。
 * 幅そのものより大きくて入らないものは、動かしても入らないのでそのままにする
 * （そのときは「この生地幅では横に収まりません」が出たままになる）。
 *
 * 横へ寄せた先がすでに埋まっていたら、**空いているところまで下げる**。
 * はみ出しを直したつもりが、代わりに重なりが出るのでは直したことにならない。
 *
 * @returns 動くものがあれば、置き換えた一式。1つも動かないなら null
 */
export function pulledIn(
  sections: SectionReport[],
  placements: Placement[],
): Placement[] | null {
  const moved = new Map<string, { x: number; y: number }>()
  for (const sr of sections) {
    const boxOf = new Map(sr.boxes.map((b) => [b.placementId, b]))
    const mine = placements.filter((p) => p.sectionId === sr.id && boxOf.has(p.id))
    /** 動かさないもの。これが土台になる */
    const settled: Box[] = []
    const out: Placement[] = []
    for (const p of mine) {
      const b = boxOf.get(p.id)!
      const inside = b.x >= -0.5 && b.x + b.w <= sr.surfaceWidthMm + 0.5
      const stuck = p.snapTo === 'left' || p.snapTo === 'right'
      const tooBig = b.w > sr.surfaceWidthMm + 0.5
      if (inside || stuck || tooBig) settled.push(b)
      else out.push(p)
    }
    for (const p of out) {
      const b = boxOf.get(p.id)!
      const x = Math.min(Math.max(0, b.x), sr.surfaceWidthMm - b.w)
      const at = freeSpotFor({ w: b.w, h: b.h }, { ...sr, boxes: settled }, { x })
      settled.push({ x, y: at.yMm, w: b.w, h: b.h })
      moved.set(p.id, { x, y: at.yMm })
    }
  }
  if (moved.size === 0) return null
  return placements.map((p) => {
    const at = moved.get(p.id)
    return at ? { ...p, xMm: at.x, yMm: at.y } : p
  })
}

/**
 * 上の空きを、まとめて詰める（依頼者の判断・2026-09-02）。
 *
 * 学生はスマホで型紙を1つずつ引きずって上へ寄せている。
 * 10個を超えると、それだけでかなりの手間になる。
 *
 * ただし**並べるのは学生自身**という軸は崩さない。
 * ここでするのは「上へ落とす」だけで、**左右の位置も、前後の順も変えない**。
 * どのパーツをどこへ置くかは、これまでどおり本人が決めたままになる。
 *
 * 上にあるものから順に、ぶつかるまで上げていく。
 * 上下の折り山に当てているものは、面の長さのほうから位置が決まるので動かさない。
 *
 * @returns 動くものがあれば、置き換えた一式。1つも動かないなら null
 */
export function packedUp(
  sections: SectionReport[],
  placements: Placement[],
): Placement[] | null {
  const moved = new Map<string, number>()
  for (const sr of sections) {
    const boxOf = new Map(sr.boxes.map((b) => [b.placementId, b]))
    const mine = placements
      .filter((p) => p.sectionId === sr.id && boxOf.has(p.id))
      .sort((a, b) => boxOf.get(a.id)!.y - boxOf.get(b.id)!.y)
    const settled: Box[] = []
    for (const p of mine) {
      const b = boxOf.get(p.id)!
      if (p.snapTo === 'top' || p.snapTo === 'bottom') {
        settled.push(b)
        continue
      }
      const at = freeSpotFor({ w: b.w, h: b.h }, { ...sr, boxes: settled }, { x: b.x })
      settled.push({ x: b.x, y: at.yMm, w: b.w, h: b.h })
      if (Math.abs(at.yMm - p.yMm) > 0.5) moved.set(p.id, at.yMm)
    }
  }
  if (moved.size === 0) return null
  return placements.map((p) => (moved.has(p.id) ? { ...p, yMm: moved.get(p.id)! } : p))
}

/**
 * 理屈のうえでの最短の長さ。**置いた型紙の面積を、置ける幅で割る**。
 *
 * 守っていること。
 *
 *   - **出した数が、実際に使っている長さを上回らない**。上回ると
 *     「最短のほうが長い」という、読んだ人が意味を取れない画面になる
 *   - いちばん丈のある型紙より短くしない。面積では足りていても、
 *     その一枚が入らないなら、その長さは成り立たない
 *
 * 横に折って半分にしているときは、折り込むぶんも面の長さについて動く。
 * そのときだけ、実際の長さと同じ割合で縮める。
 * それ以外の折りは、折り込む深さが置いた型紙で決まっていて面の長さには連れないので、
 * 深さはそのまま足す
 */
function minYardageOf(
  boxes: Box[],
  surfaceWidth: number,
  surfaceLength: number,
  depth: Record<Side, number>,
  scalesWithSurface: boolean,
): number {
  if (surfaceWidth <= 0 || surfaceLength <= 0 || boxes.length === 0) return 0
  const area = boxes.reduce((s, b) => s + b.w * b.h, 0)
  const tallest = boxes.reduce((m, b) => Math.max(m, b.h), 0)
  const minSurface = Math.min(Math.max(area / surfaceWidth, tallest), surfaceLength)
  return scalesWithSurface
    ? minSurface * ((surfaceLength + depth.top + depth.bottom) / surfaceLength)
    : minSurface + depth.top + depth.bottom
}

/**
 * 新しく置く型紙を、どこに出すか（学生の点検・2026-09-02）。
 *
 * もとは「置く」を押すたびに左上の角（0, 0）へ出していた。
 * そのため2つめを押した瞬間に1つめと丸ごと重なり、
 * 押しただけで「パーツが重なっています」が出る。
 * 学生は自分が何か間違えたと思って手が止まった、という報告があった。
 *
 * **並べるのは学生自身**（依頼者の指示）なので、ここでやるのは
 * 「詰めて並べてあげる」ことではない。ぶつからない場所へ出すだけで、
 * どこへ動かすかは、これまでどおり本人が指で決める。
 *
 * 探し方は、すでに置いてあるものの**右の端と下の端**だけを候補にする。
 * 隙間なく敷き詰めるための探索ではないので、これで足りるし、
 * 出てくる場所も「前のものの隣か、下」で見当がつく。
 * どこにも入らなければ、いちばん下の下へ出す。生地は下へ伸びるので必ず空いている。
 *
 * @param fixed 折り山に当てているとき、その向きの座標は折り山から決まる。
 *   決まっているほうは動かさずに、もう片方だけを探す
 */
export function freeSpotFor(
  size: { w: number; h: number },
  area: {
    surfaceWidthMm: number
    meetXMm: number | null
    meetYMm: number | null
    boxes: Box[]
  },
  fixed: { x?: number; y?: number } = {},
): { xMm: number; yMm: number } {
  const { boxes, surfaceWidthMm, meetXMm, meetYMm } = area
  const uniq = (v: number[]) =>
    [...new Set(v.map((n) => Math.round(n * 10) / 10))].sort((a, b) => a - b)
  const xs = fixed.x !== undefined
    ? [fixed.x]
    : uniq([0, ...boxes.map((b) => b.x + b.w), ...(meetXMm !== null ? [meetXMm] : [])])
  const ys = fixed.y !== undefined
    ? [fixed.y]
    : uniq([0, ...boxes.map((b) => b.y + b.h), ...(meetYMm !== null ? [meetYMm] : [])])

  for (const y of ys) {
    for (const x of xs) {
      // はみ出す場所は候補にしない。ただし折り山から決まっている座標はそのまま通す
      if (fixed.x === undefined && x + size.w > surfaceWidthMm + 0.5) continue
      // 端どうしの出会い目はまたげない（上になっている一枚がそこで切れている）
      if (meetXMm !== null && x < meetXMm - 0.5 && x + size.w > meetXMm + 0.5) continue
      if (meetYMm !== null && y < meetYMm - 0.5 && y + size.h > meetYMm + 0.5) continue
      const at = { x, y, w: size.w, h: size.h }
      if (boxes.some((b) => boxesOverlap(at, b))) continue
      return { xMm: x, yMm: y }
    }
  }
  const bottom = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0)
  return { xMm: fixed.x ?? 0, yMm: fixed.y ?? bottom }
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
