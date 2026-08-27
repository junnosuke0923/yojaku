/**
 * 取り込んだパーツを置いておく場所（第2フェーズ）。
 *
 * 大きいパーツは1枚ずつ、小さいパーツは並べてまとめて撮る（現場の前提）。
 * つまり1枚の写真で終わらず、何度も撮り足すことになる。
 * その途中でブラウザを閉じてしまっても消えないよう、端末の中に持たせる。
 *
 * 外へは何も送らない。学校の管理端末で使うものなので、
 * 写真も型紙の形も、この端末から出ない作りにしてある。
 */

import type { EdgeGroup } from './edges'
import { bounds, centroid, clipLineToBox, type Point, type Polygon } from './geom'
import { rotate180 } from './marks'
import { unionWithMirror } from './openFold'
import { buildSeam, DEFAULT_SEAM_MM, initialPlan, SEAM_INCLUDED_MM, type SeamPlan } from './seam'
import { FOLD_MARK_REF_MM, type FoldMark, type PlacedPart, type Placement, type Section } from './fabric'

const KEY = 'yojaku.parts.v1'

/** 名前の候補（判断2）。手書き認識は作らないので、押して選ぶ */
export const NAME_CHOICES = [
  '前身頃', '後身頃', '袖', '衿', '見返し', 'カフス',
  'ポケット', 'ヨーク', 'ベルト', 'スカート前', 'スカート後',
]

export type StoredPart = {
  id: string
  /**
   * 型紙そのものか、後で裁つぶんの余白か（依頼者の指示・2026-08-26）。
   *
   * ベルトや見返しは、仮縫いのあとに寸法が変わることがあるので、
   * この段階では本布を裁たずに置いておくことが多い。
   * そのぶんの場所だけは残しておく必要があるので、
   * 「この大きさの長方形を空けておく」という指定だけを置けるようにしてある。
   *
   * 型紙ではないので、写真も出来上がり線も無い。ただの長方形。
   * 計算のうえでは型紙と同じに扱う（場所を取り、要尺に効く）。
   */
  kind?: 'pattern' | 'reserve'
  /** 取り込んだ順の仮名（パーツ1、パーツ2…）。名前が無くても計算は進む */
  name: string
  /** 出来上がり線(mm)。写真から取れるのはこれ（学生の型紙は出来上がり線で切ってある） */
  outlineMm: Polygon
  /**
   * 取り込んだ型紙に、もう縫い代が付いているか。
   *
   * 学生が持ってくる型紙は出来上がり線で切ってあるとは限らない。
   * 付いていれば縫い代を足す画面は要らず、「わ」の辺の指定だけになる（依頼者の指示）。
   */
  seamIncluded: boolean
  /** 辺のまとまりごとの縫い代(mm)。0 は「ここは折り山」、負は「もう付いている」 */
  allowancesMm: number[]
  /**
   * 「わ」の辺で開いた形で裁つか（依頼者の指示・2026-08-27）。
   *
   * ベルトは、型紙が出来上がり幅で描いてあっても、
   * 裁つときは長い辺で折るぶんを見込んで幅を倍にすることがある。
   *
   * 切ってあるのは同じ布なので、生地の折り山に当てて二重のまま裁っても、
   * 一重の生地に開いた形を描いて裁ってもよい。ここを入にすると後者になる。
   * 開けば型紙の中に折り山があるだけなので、生地の折り山はもう要らない。
   */
  openFold?: boolean
  /** 必要な枚数。2枚必要なパーツを1枚と数えると要尺が丸ごと狂う（判断2） */
  needed: number
  /**
   * 上下を入れかえてあるか。
   *
   * 定規は地の目の**向き**までは教えてくれない（上下対称なので）。
   * 回転して地の目を縦にするところまでは自動でできるが、どちらが上かは決まらない。
   * 外すと向きあり生地で要尺が丸ごと狂うので、当てにいかず学生の手に残す。
   */
  flipped: boolean
  widthMm: number
  heightMm: number
  addedAt: number
}

export type PartsState = {
  parts: StoredPart[]
  /** 生地の設定。差し込みの可否は**いちばん最初に**決める（判断9） */
  fabricWidthMm: number
  hasNap: boolean
  /** 生地の区間。区間ごとに折り方をひとつ持つ。ふだんは1つ（判断7） */
  sections: Section[]
  /** 生地の上に置いたパーツ（第4フェーズ） */
  placements: Placement[]
}

export const EMPTY: PartsState = {
  parts: [],
  fabricWidthMm: 1100,
  hasNap: false,
  // 初期値は「縦わ・片側を、生地幅の半分で折る」。学校で最初に習う基本のたたみ方
  sections: [{ id: 's1', fold: 'vLeft', halfFold: true }],
  placements: [],
}

export function load(): PartsState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<PartsState>
    return {
      parts: Array.isArray(parsed.parts)
        ? parsed.parts.map((p) => ({
            ...p, flipped: p.flipped ?? false, seamIncluded: p.seamIncluded ?? false,
            kind: p.kind ?? 'pattern', openFold: p.openFold ?? false,
          }))
        : [],
      fabricWidthMm: parsed.fabricWidthMm ?? EMPTY.fabricWidthMm,
      hasNap: parsed.hasNap ?? EMPTY.hasNap,
      sections: parsed.sections?.length ? parsed.sections : EMPTY.sections,
      placements: Array.isArray(parsed.placements) ? parsed.placements : [],
    }
  } catch {
    // 壊れていたら黙って最初からにする。学生に JSON の話をしても仕方がない
    return EMPTY
  }
}

export function save(state: PartsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 容量が尽きても、その回の作業は続けられるようにする
  }
}

/** 解析結果のパーツを、しまっておく形に直す。既定の縫い代を全周に付けておく */
export function toStored(
  outlineMm: Polygon, widthMm: number, heightMm: number, index: number,
  seamIncluded = false,
): StoredPart {
  const plan = initialPlan(outlineMm, seamIncluded ? SEAM_INCLUDED_MM : DEFAULT_SEAM_MM)
  return {
    id: `p${Date.now().toString(36)}${index}`,
    kind: 'pattern',
    name: `パーツ${index + 1}`,
    outlineMm,
    seamIncluded,
    allowancesMm: plan.allowancesMm,
    needed: 1,
    flipped: false,
    widthMm,
    heightMm,
    addedAt: Date.now(),
  }
}

/** 後で裁つぶんの余白か */
export const isReserve = (part: StoredPart) => part.kind === 'reserve'

/** 余白の名前の候補。仮縫いのあとに裁つことが多いもの */
export const RESERVE_CHOICES = ['ベルト', '見返し', 'カフス', '衿', 'その他']

/**
 * 後で裁つぶんの余白を作る。
 *
 * 型紙ではないので、写真も出来上がり線も持たない。指定された大きさの長方形そのもの。
 * 縫い代は「もう含まれている」扱いにしてある。
 * 学生が入れるのは裁ち切りの寸法（例：ベルトなら「ベルト幅×2＋縫い代」の幅）で、
 * そこからさらに足すと二重に足すことになるため。
 */
export function toReserve(name: string, widthMm: number, heightMm: number): StoredPart {
  const outlineMm: Polygon = [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ]
  const plan = initialPlan(outlineMm, SEAM_INCLUDED_MM)
  return {
    id: `r${Date.now().toString(36)}`,
    kind: 'reserve',
    name,
    outlineMm,
    seamIncluded: true,
    allowancesMm: plan.allowancesMm,
    needed: 1,
    flipped: false,
    widthMm,
    heightMm,
    addedAt: Date.now(),
  }
}

/**
 * 実際に画面へ出す出来上がり線。上下を入れかえてあれば、まわしてから返す。
 *
 * 180度の回転は形を変えないので、辺の切り分けも縫い代の並び順も変わらない。
 * だから `allowancesMm` はそのまま使える。
 */
export const outlineOf = (part: StoredPart): Polygon =>
  part.flipped ? rotate180(part.outlineMm) : part.outlineMm

/**
 * しまってある値から、縫い代の計画を組み直す。
 *
 * 辺の切り分けは輪郭から毎回同じ結果になるので、切り分けそのものは持たない。
 * 持つのは学生が決めた縫い代の値だけ。
 * 万一、辺の数が食い違ったら（プログラムを直したときなど）既定値に戻す。
 */
export function planOf(part: StoredPart): SeamPlan {
  const plan = initialPlan(
    outlineOf(part),
    part.seamIncluded ? SEAM_INCLUDED_MM : DEFAULT_SEAM_MM,
  )
  if (part.allowancesMm.length === plan.groups.length) {
    plan.allowancesMm = [...part.allowancesMm]
  }
  return plan
}

/** 外まわりの長方形の面積(mm²)。開いて本当に倍になったかを見るのに使う */
function boxAreaOf(poly: Polygon): number {
  const b = bounds(poly)
  return (b.maxX - b.minX) * (b.maxY - b.minY)
}

/**
 * 生地の上に置くための形。縫い代を足したあとの裁ち切り線を、左上へ寄せて渡す。
 *
 * 縫い代 0 の辺があるかどうかも一緒に渡す。
 * その辺は折り山に当てないと実物ではありえない図になるので、計算側で見張っている。
 */
export function placedPartOf(part: StoredPart): PlacedPart | null {
  const plan = planOf(part)
  const seam = buildSeam(plan)
  if (!seam) return null

  let cutLineMm = seam.cutLineMm
  let finishedLineMm = seam.finishedLineMm
  /** 開いたときの中心線（＝鏡にした線）。開かなければ無い */
  let centerLineMm: { a: Point; b: Point } | null = null
  // 0 は「ここは折り山」。負（縫い代つき）は折り山ではない
  let hasFoldEdge = plan.allowancesMm.some((a) => a === 0)

  if (part.openFold && hasFoldEdge) {
    // いちばん長い「わ」の辺を鏡にして、左右に開く。
    // 短いほうを選ぶと、ベルトで長さの向きに開いてしまう
    let mirror: EdgeGroup | null = null
    for (let i = 0; i < plan.groups.length; i++) {
      if (plan.allowancesMm[i] !== 0) continue
      const g = plan.groups[i]
      if (!mirror || g.lengthMm > mirror.lengthMm) mirror = g
    }
    if (mirror) {
      /*
        鏡にするのは、「わ」の辺の**端どうしを結んだ直線**。
        写真から取った辺は、まっすぐに見えても1〜2mmは波打っている。
        折り山は本来まっすぐな線なので、その波は形ではなく写真のゆらぎと見て、
        直線に均してから開く。

        出来上がり線の点は、辺の切り分けと同じ並び順のまま返ってくるので、
        まとまりの番号からそのまま端の点が引ける。
      */
      const n = plan.path.points.length
      const a = seam.finishedLineMm[mirror.start % n]
      const b = seam.finishedLineMm[mirror.end % n]
      const inside = centroid(seam.finishedLineMm)
      const cut = unionWithMirror(seam.cutLineMm, a, b, inside)
      const finished = unionWithMirror(seam.finishedLineMm, a, b, inside)
      // 開いたのに小さくなるのは、鏡の線の取り方をどこかで間違えている。
      // そのまま出すと学生が短い生地を買うので、黙って開かないほうを選ぶ
      const grew = cut !== null && boxAreaOf(cut) > boxAreaOf(seam.cutLineMm) * 1.5
      if (cut && finished && grew) {
        cutLineMm = cut
        finishedLineMm = finished
        // 開いてしまえば、生地の折り山に当てる必要はない。一重の上に置ける
        hasFoldEdge = false
        /*
          鏡にした線が、開いた型紙の中心線になる（依頼者の質問・2026-08-28）。
          もとの「わ」の辺は型紙の一部しか通っていないことがあるので、
          出来上がり線の枠いっぱいまで伸ばしてから引く。
          これを描かないと、ただの幅広の紙に見えて、
          左右に開いた形になっていることが図から読めない。
        */
        const span = clipLineToBox(a, b, bounds(finished))
        if (span) centerLineMm = { a: span[0], b: span[1] }
      }
    }
  }

  /*
    「わ」の辺に付ける作図の記号の置き場所（依頼者の指示・2026-08-27）。

    縫い代の画面だけでなく、生地に並べた図にも出す。
    裁ち合わせ図では、どの辺を折り山に当てているのかが図の要になるので、
    むしろこちらのほうが本番、と依頼者から言われている。

    向きは「辺に沿う向き」と「型紙の内側」の2つが分かればよいので、
    真ん中の点から左右へ伸ばした2点と、内側へ寄せた1点で表す。
    開いて裁つ設定にしたときは、生地の折り山に当てないので記号も出さない。
  */
  const foldMarksMm: FoldMark[] = []
  if (hasFoldEdge) {
    // 辺の切り分けは出来上がり線のもとの座標で出ているので、そのぶんずらす
    const sx = seam.finishedLineMm[0].x - plan.path.points[0].x
    const sy = seam.finishedLineMm[0].y - plan.path.points[0].y
    const R = FOLD_MARK_REF_MM
    for (let i = 0; i < plan.groups.length; i++) {
      if (plan.allowancesMm[i] !== 0) continue
      const g = plan.groups[i]
      const cx = g.midpoint.x + sx
      const cy = g.midpoint.y + sy
      // 辺に沿う向き。外向きの法線を 90 度まわしたもの
      const tx = g.outward.y
      const ty = -g.outward.x
      foldMarksMm.push({
        a: { x: cx - tx * R, y: cy - ty * R },
        b: { x: cx + tx * R, y: cy + ty * R },
        inn: { x: cx - g.outward.x * R, y: cy - g.outward.y * R },
        lengthMm: g.lengthMm,
      })
    }
  }

  const b = bounds(cutLineMm)
  const mv = (q: { x: number; y: number }) => ({ x: q.x - b.minX, y: q.y - b.minY })
  const move = (poly: Polygon) => poly.map(mv)
  return {
    id: part.id,
    cutLineMm: move(cutLineMm),
    finishedLineMm: move(finishedLineMm),
    hasFoldEdge,
    foldMarksMm: foldMarksMm.map((m) => ({
      a: mv(m.a), b: mv(m.b), inn: mv(m.inn), lengthMm: m.lengthMm,
    })),
    centerLineMm: centerLineMm
      ? { a: mv(centerLineMm.a), b: mv(centerLineMm.b) }
      : null,
  }
}

/** 「わ」で開いて裁つ設定が使えるか（＝縫い代 0 の辺があるか） */
export const canOpenFold = (part: StoredPart): boolean =>
  !isReserve(part) && part.allowancesMm.some((a) => a === 0)

/** 実際に生地の上で場所を取る大きさ(mm)。「わ」で開いてあればその倍の幅 */
export function cutSizeOf(part: StoredPart): { widthMm: number; heightMm: number } | null {
  const placed = placedPartOf(part)
  if (!placed) return null
  const b = bounds(placed.cutLineMm)
  return { widthMm: b.maxX - b.minX, heightMm: b.maxY - b.minY }
}
