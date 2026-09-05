/**
 * 生地の断面図。**二つ折りにして山を作っている**ことを、絵で分からせるためのもの。
 *
 * 平面図に線を1本引いて「わ」と書くだけでは、折っていることがまったく伝わらない
 * （依頼者の指摘）。横から見た形を添えると、
 * 「折り返したところだけ二重で、残りは一重」がひと目で分かる。
 *
 * 折り返した腕が、平面図でいう「二重の帯」にそのまま対応している。
 * 縦に潰れると、ただの平行線2本に見えて意味が消えてしまうので、
 * 縦横の比はここで決め打ちにしてある（生地の実寸とは関係ない、説明のための絵）。
 */

import { FOLD_LABELS, foldSidesOf, isHorizontalFold, type FoldMode } from '../lib/fabric'
import { Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  fold: FoldMode
  /** この区間は、きっちり折るやり方か */
  half: boolean
  /** 折り返す深さ(mm)。手前側／奥側 */
  nearMm: number
  farMm: number
  /** 折ったあとの、見えている面の長さ(mm)。断面図の全長になる */
  spanMm: number
}

const W = 1000
/*
  絵の高さ。もとは 300 あり、いちばん上に
  「いま画面で見ているのは、この上の面」という矢印と説明を入れていた。
  枠の見出しが「横から見ると」と言っているので、それは落として詰めた
  （依頼者の指示・2026-08-27）。

  そのあと 215 → 168 にもう一段詰めた（依頼者の指示・2026-09-04）。
  布そのものは y=63〜153 しか使っておらず、下の3割は
  **文字を並べるためだけの帯**だった。そこに居たのは
  「わ」「ここがわ」「生地が一重」の3つ。3つとも、
  自分が指しているものの**すぐそば**へ移してある——
  「わ」は折り山の真横、「一重」は一重の真上、「ここがわ」は点線の真上。
  字幕をやめて印そのものにした形なので、詰まると同時に読み方も揃った。
  （どれか1つでも下へ戻すと、その帯が復活して H を戻すことになる）
*/
const H = 168
/** 生地の厚み。見た目のためのもので、実寸ではない */
const THICK = 16
/**
 * 断面の2本の線の高さ。
 * 折り返した一枚は**下へ折り込む**ので（依頼者の判断・2026-09-05）、
 * ふだんは UPPER のほうが「折らずに広がっている一枚」になる。
 * 端の名前をその下に置けるよう、全体を少し上へ寄せてある
 */
const LOWER = 128
const UPPER = LOWER - 74
/** 折り山の丸み */
const R = (LOWER - UPPER) / 2
/**
 * 左右の余白。折り山の丸みがはみ出す分に加えて、
 * 「わ」の一文字ぶんを外側に置けるだけ取ってある（PAD を狭めると「わ」が切れる）
 */
const PAD = 90
/** 折り山の高さ。「わ」の文字を、折り山と同じ高さに置くための位置 */
const CREASE_Y = (UPPER + LOWER) / 2
/**
 * 両側から折ったとき、中央で出会うみみのあいだに残す隙間（依頼者の指示・2026-08-27）。
 *
 * ぴったり突き合わせて描くと、二重の帯が1枚の面に見えてしまい、
 * 「ここが端どうしの出会うところ」だと分からない。
 * 実物でも、折った耳がぴったり揃うことはまずない。
 * 隙間から下の一枚がのぞいていることが、いちばん強い手がかりになる。
 */
const MEET_GAP = 30

const CLOTH = '#cdcbbc'
const CREASE = '#35664e'
const FAINT = '#9aa69e'

export function FoldDiagram({ fold, half, nearMm, farMm, spanMm }: Props) {
  const span = Math.max(spanMm, 1)
  const toX = (mm: number) => (mm / span) * W
  // 折り返しが極端に浅くても、絵としては見える太さを残す。
  // 両側から折るときだけは、互いに乗り上げないよう半分で止める
  const both = nearMm > 0 && farMm > 0
  // 両側から折るときは、みみが中央で出会うところまで（＝半分ずつ）がいちばん深い。
  // ただし、ぴったり突き合わせては描かない（MEET_GAP を見よ）
  const cap = both ? (W - MEET_GAP) * 0.5 : W
  const arm = (mm: number) => (mm <= 0 ? 0 : Math.min(Math.max(toX(mm), 90), cap))
  const near = arm(nearMm)
  const far = arm(farMm)
  /**
   * 見えている面が丸ごと二重。
   * 片側から折るなら端まで届いたとき、両側から折るなら中央で出会ったとき
   */
  const allDoubled = near + far >= W - (both ? MEET_GAP : 0) - 0.5
  /** 両側から折って、左右のみみが中央で突き合わさっている */
  const metInMiddle = both && allDoubled
  /**
   * 折り返した一枚を、下へ折り込んだ形で描くか（依頼者の判断・2026-09-05）。
   *
   * 裁ち合わせ図のほうの描き方に合わせる。断面図と裁ち合わせ図とで
   * どちらの一枚が上なのかが食い違うと、並べて置いてある2つの図が
   * そのまま食い違って見える。
   * 左右から折ってみみが中央で出会うときだけは、裁ち合わせ図のほうも
   * 折り返しを上に描いている（みみのあいだの隙間から下の一枚が
   * のぞく図が要るため）ので、断面図もそれに合わせる
   */
  const flapUnder = !metInMiddle
  const folded = near > 0 || far > 0
  /**
   * 折り方は選んであるけれど、まだ何も「わに当てて」いない状態。
   * 折り込む深さは置いた型紙から決まるので（判断7）、このときはまだ平らな一重。
   */
  const pending = !folded && foldSidesOf(fold).length > 0
  /**
   * 「半分に折る」を選んであるのに、まだ折れていない状態（学生の点検・2026-09-02）。
   *
   * 横に折るときの深さは**面の長さ**で決まる（判断7）。
   * 面の長さは置いた型紙のいちばん下で決まるので、
   * 何も置いていないあいだは深さが 0 のままになる。
   * 選択は「半分に折る」なのに絵は「まだ折っていません」で、食い違って見えた。
   * 言い添えのほうを、なぜまだ折れていないのかに差し替える
   */
  const pendingHalf = pending && half
  const along = isHorizontalFold(fold) ? '長さの向き' : '幅の向き'
  /**
   * 折り山ではないほうの端の名前（依頼者の指摘・2026-08-31）。
   *
   * 縦に折った断面は**幅の向き**に切ったものなので、両端はみみ——
   * 織り上がったときからある、ほつれない端。
   * ところが横に折った断面は**長さの向き**に切ったもので、
   * 両端ははさみで切った裁ち端であって、みみではない。
   * みみはこの断面では左右の奥行き方向にあり、絵には出てこない。
   * 同じ絵を向きだけ変えて使い回していたので、
   * 横わのときにも端を「みみ」と呼んでしまっていた
   */
  const edgeName = isHorizontalFold(fold) ? '裁ち端' : 'みみ'
  /** 端の名前を、折り山と反対のほうへどける量。文字数ぶん広げる */
  const edgeDx = edgeName.length * 11 + 12

  /*
    「二重」とだけ書くと、置いた型紙が2枚という意味に読めてしまう
    （依頼者から実際にそう質問された・2026-08-27）。数えているのは布の枚数なので、
    腕が広いときは主語を書く。狭いときははみ出すので短いほうにする
  */
  const layerLabel = (len: number) => (len > 230 ? '生地が二重' : '二重')

  /**
   * 二重になっているところ。折り返して上に乗っている一枚と、
   * その下にある一枚と、つないでいる折り山の丸みを、
   * **ひとつながりの線**として描く（依頼者の判断・2026-08-31）。
   *
   * 色が変わるのは、折り返した端の真下——そこから先が一重になる。
   * 上の一枚だけを緑にすると、「生地が二重」と書いてあるすぐ下の一枚が、
   * 一重のところと同じ色になってしまい、文と絵が食い違う
   */
  const doubled = (at: 'near' | 'far', len: number) => {
    const edge = at === 'near' ? len : W - len
    const turn = at === 'near' ? 0 : W
    const sweep = at === 'near' ? 0 : 1
    return `M${edge} ${UPPER} H${turn} A${R} ${R} 0 0 ${sweep} ${turn} ${LOWER} H${edge}`
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2">
      <div className="flex items-center gap-2 pb-1">
        <Icon name="fold" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="text-xs font-bold text-ink-700">横から見ると</span>
        <span className="text-xs text-ink-300">{FOLD_LABELS[fold]} ／ {along}</span>
      </div>

      {/* 左右に余白を取る。折り山の丸みが枠の外にふくらむため */}
      <svg viewBox={`${-PAD} 0 ${W + PAD * 2} ${H}`} className="w-full" role="img"
        aria-label={`${FOLD_LABELS[fold]}にした生地の断面`}>
        {/* 折らずに広がっている一枚。端から端まである。ふだんはこれが上に来る */}
        <path d={`M0 ${flapUnder ? UPPER : LOWER} H${W}`} stroke={CLOTH} strokeWidth={THICK}
          strokeLinecap="butt" fill="none" />

        {/*
          折り返して上に乗っている一枚。先が丸くつながっているところが折り山。
          下の一枚もふくめて、二重になっているところをまとめて緑にする
        */}
        {near > 0 && (
          <path d={doubled('near', near)} stroke={CREASE} strokeWidth={THICK}
            fill="none" strokeLinecap="butt" />
        )}
        {far > 0 && (
          <path d={doubled('far', far)} stroke={CREASE} strokeWidth={THICK}
            fill="none" strokeLinecap="butt" />
        )}

        {/* 折り方だけ先に決まっているとき。ここが山になる、という予告 */}
        {pending && foldSidesOf(fold).map((side) => {
          const atStart = side === 'left' || side === 'top'
          const x = atStart ? 0 : W
          return (
            <g key={side}>
              <path d={`M${x} ${UPPER + 4} v46`} stroke={CREASE} strokeWidth={5}
                strokeDasharray="12 10" />
              {/* 点線の印に、旗のように添える。折り込む先は下なので、下に置く */}
              <text x={atStart ? 10 : W - 10} y={UPPER + 84} fontSize={30} fontWeight={700}
                fill={CREASE} textAnchor={atStart ? 'start' : 'end'}>ここがわ</text>
            </g>
          )
        })}

        {/* 何枚重なっているか */}
        {near > 0 && (
          <>
            <text x={near / 2} y={UPPER - 26} fontSize={30} fontWeight={700} fill={CREASE}
              textAnchor="middle">{layerLabel(near)}</text>
            {/*
              「わ」は、絵の下ではなく**折り山の真横**に置く（依頼者の指示・2026-09-04）。
              断面図では、わは左右の端そのもの。下に書くとただの字幕だが、
              横に置けばその文字が印になる。丸みのふくらみ（R）と
              線の太さ（THICK / 2）を避けた外側に、少し離して置いている
            */}
            <text x={-R - THICK * 0.5 - 7} y={CREASE_Y + 11} fontSize={30} fontWeight={700}
              fill={CREASE} textAnchor="end">わ</text>
            {/* 中央で出会っているときは、みみの名前をひとつだけ、その場所に置く */}
            {!metInMiddle && (
              <text x={near} y={flapUnder ? LOWER + 26 : UPPER - 26} fontSize={22}
                fill={FAINT} textAnchor="middle"
                dx={allDoubled ? -edgeDx : edgeDx}>{edgeName}</text>
            )}
          </>
        )}
        {far > 0 && (
          <>
            <text x={W - far / 2} y={UPPER - 26} fontSize={30} fontWeight={700} fill={CREASE}
              textAnchor="middle">{layerLabel(far)}</text>
            <text x={W + R + THICK * 0.5 + 7} y={CREASE_Y + 11} fontSize={30} fontWeight={700}
              fill={CREASE} textAnchor="start">わ</text>
            {!metInMiddle && (
              <text x={W - far} y={flapUnder ? LOWER + 26 : UPPER - 26} fontSize={22}
                fill={FAINT} textAnchor="middle"
                dx={allDoubled ? edgeDx : -edgeDx}>{edgeName}</text>
            )}
          </>
        )}

        {/*
          中央で向かい合っている端どうし。
          隙間そのものが「ここが端どうしの出会うところ」を語るので、
          あとは両端に印を付けて、名前をひとつ添えるだけにする
        */}
        {metInMiddle && (
          <>
            {[near, W - far].map((x) => (
              <path key={x} d={`M${x} ${UPPER - THICK * 0.5 - 7} v${THICK + 14}`}
                stroke={FAINT} strokeWidth={4} strokeLinecap="round" />
            ))}
            <text x={W * 0.5} y={UPPER - 26} fontSize={22} fill={FAINT} textAnchor="middle">
              {edgeName}
            </text>
          </>
        )}
        {/*
          一重のところの名前。「生地が二重」が二重の真上にいるので、
          こちらも**一重の真上**に置く（依頼者の指示・2026-09-04）。
          層の名前は、その層のすぐ上——上下で同じ規則になる。
          一重の部分には折り返した一枚が乗っていないので、ここは必ず空いている
        */}
        {W - near - far > W * 0.16 && (
          <text x={(near + (W - far)) / 2} y={flapUnder ? UPPER - 26 : LOWER - 30}
            fontSize={28} fill={FAINT}
            textAnchor="middle">{
              folded
                ? (W - near - far > W * 0.3 ? '生地が一重' : '一重')
                : pending ? 'まだ折っていません' : '折らずに一重'
            }</text>
        )}
      </svg>

      {/*
        絵の下にあった一文は落とした（依頼者の指示・2026-08-27）。
        「二重」「一重」「わ」「みみ」は絵の中に書いてあるので、
        同じことを文でもう一度言っていた。
        まだ折っていないときだけは、絵の中の「まだ折っていません」の続きとして、
        何をすれば折れるのかを短く添える
      */}
      {pending && (
        <p className="pt-1 text-xs text-ink-500">
          <T id={pendingHalf ? 'fold.pending.half' : 'fold.pending.note'} />
        </p>
      )}
    </div>
  )
}
