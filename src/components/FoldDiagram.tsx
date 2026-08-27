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

type Props = {
  fold: FoldMode
  /** 折り返す深さ(mm)。手前側／奥側 */
  nearMm: number
  farMm: number
  /** 折ったあとの、見えている面の長さ(mm)。断面図の全長になる */
  spanMm: number
}

const W = 1000
const H = 300
/** 生地の厚み。見た目のためのもので、実寸ではない */
const THICK = 16
/** 下の一枚と、その上に折り返して乗っている一枚の高さ */
const LOWER = 205
const UPPER = 205 - 74
/** 折り山の丸み */
const R = (LOWER - UPPER) / 2
/** 折り山の丸みがはみ出す分の余白 */
const PAD = 56

const CLOTH = '#cdcbbc'
const CREASE = '#35664e'
const FAINT = '#9aa69e'

export function FoldDiagram({ fold, nearMm, farMm, spanMm }: Props) {
  const span = Math.max(spanMm, 1)
  const toX = (mm: number) => (mm / span) * W
  // 折り返しが極端に浅くても、絵としては見える太さを残す。
  // 両側から折るときだけは、互いに乗り上げないよう半分で止める
  const both = nearMm > 0 && farMm > 0
  // 両側から折るときは、みみが中央で出会うところまで（＝半分ずつ）がいちばん深い
  const cap = both ? W * 0.5 : W
  const arm = (mm: number) => (mm <= 0 ? 0 : Math.min(Math.max(toX(mm), 90), cap))
  const near = arm(nearMm)
  const far = arm(farMm)
  /**
   * 見えている面が丸ごと二重。
   * 片側から折るなら端まで届いたとき、両側から折るなら中央で出会ったとき
   */
  const allDoubled = near + far >= W - 0.5
  /** 両側から折って、左右のみみが中央で突き合わさっている */
  const metInMiddle = both && allDoubled
  const folded = near > 0 || far > 0
  /**
   * 折り方は選んであるけれど、まだ何も「わに当てて」いない状態。
   * 折り込む深さは置いた型紙から決まるので（判断7）、このときはまだ平らな一重。
   */
  const pending = !folded && foldSidesOf(fold).length > 0
  const along = isHorizontalFold(fold) ? '長さの向き' : '幅の向き'

  /** 折り返した腕。端（みみ）から折り山まで戻って、下の一枚につながる */
  const flap = (at: 'near' | 'far', len: number) => {
    const edge = at === 'near' ? len : W - len
    const turn = at === 'near' ? 0 : W
    const sweep = at === 'near' ? 0 : 1
    return `M${edge} ${UPPER} H${turn} A${R} ${R} 0 0 ${sweep} ${turn} ${LOWER}`
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2">
      <div className="flex items-center gap-2 pb-1">
        <Icon name="fold" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="text-xs font-bold text-ink-700">横から見ると</span>
        <span className="text-xs text-ink-300">{FOLD_LABELS[fold]}・{along}</span>
      </div>

      {/* 左右に余白を取る。折り山の丸みが枠の外にふくらむため */}
      <svg viewBox={`${-PAD} 0 ${W + PAD * 2} ${H}`} className="w-full" role="img"
        aria-label={`${FOLD_LABELS[fold]}にした生地の断面`}>
        {/* 上から見下ろしている、という説明 */}
        <g stroke={FAINT} strokeWidth={4} fill="none" strokeLinecap="round">
          <path d={`M${W * 0.5} 10 v46`} />
          <path d={`M${W * 0.5 - 13} 44 L${W * 0.5} 60 L${W * 0.5 + 13} 44`} />
        </g>
        <text x={W * 0.5 + 22} y={44} fontSize={26} fill={FAINT}>
          いま画面で見ているのは、この上の面
        </text>

        {/* 下になっている一枚。端から端まである */}
        <path d={`M0 ${LOWER} H${W}`} stroke={CLOTH} strokeWidth={THICK}
          strokeLinecap="butt" fill="none" />

        {/* 折り返して上に乗っている一枚。先が丸くつながっているところが折り山 */}
        {near > 0 && (
          <path d={flap('near', near)} stroke={CREASE} strokeWidth={THICK}
            fill="none" strokeLinecap="butt" />
        )}
        {far > 0 && (
          <path d={flap('far', far)} stroke={CREASE} strokeWidth={THICK}
            fill="none" strokeLinecap="butt" />
        )}

        {/* 折り方だけ先に決まっているとき。ここが山になる、という予告 */}
        {pending && foldSidesOf(fold).map((side) => {
          const atStart = side === 'left' || side === 'top'
          const x = atStart ? 0 : W
          return (
            <g key={side}>
              <path d={`M${x} ${LOWER - 4} v-46`} stroke={CREASE} strokeWidth={5}
                strokeDasharray="12 10" />
              <text x={atStart ? 10 : W - 10} y={LOWER + 52} fontSize={30} fontWeight={700}
                fill={CREASE} textAnchor={atStart ? 'start' : 'end'}>ここがわ</text>
            </g>
          )
        })}

        {/* 何枚重なっているか */}
        {near > 0 && (
          <>
            <text x={near / 2} y={UPPER - 26} fontSize={30} fontWeight={700} fill={CREASE}
              textAnchor="middle">二重</text>
            <text x={4} y={LOWER + 52} fontSize={30} fontWeight={700} fill={CREASE}>わ</text>
            {/* 中央で出会っているときは、みみの名前をひとつだけ、その場所に置く */}
            {!metInMiddle && (
              <text x={near} y={UPPER - 26} fontSize={22} fill={FAINT} textAnchor="middle"
                dx={allDoubled ? -34 : 30}>みみ</text>
            )}
          </>
        )}
        {far > 0 && (
          <>
            <text x={W - far / 2} y={UPPER - 26} fontSize={30} fontWeight={700} fill={CREASE}
              textAnchor="middle">二重</text>
            <text x={W - 4} y={LOWER + 52} fontSize={30} fontWeight={700} fill={CREASE}
              textAnchor="end">わ</text>
            {!metInMiddle && (
              <text x={W - far} y={UPPER - 26} fontSize={22} fill={FAINT} textAnchor="middle"
                dx={-30}>みみ</text>
            )}
          </>
        )}

        {/* 突き合わさったみみ。ここで生地の端どうしが出会っている */}
        {metInMiddle && (
          <>
            <path d={`M${W * 0.5} ${UPPER - 12} v${THICK + 24}`} stroke={FAINT}
              strokeWidth={4} strokeDasharray="9 8" />
            <text x={W * 0.5} y={UPPER - 26} fontSize={22} fill={FAINT} textAnchor="middle">
              みみ
            </text>
          </>
        )}
        {W - near - far > W * 0.16 && (
          <text x={(near + (W - far)) / 2} y={LOWER + 52} fontSize={28} fill={FAINT}
            textAnchor="middle">{folded ? '一重' : pending ? 'まだ折っていません' : '折らずに一重'}</text>
        )}
      </svg>

      <p className="flex gap-2 pt-1 text-xs leading-relaxed text-ink-500">
        <Icon name={allDoubled || folded ? 'fold' : 'hint'}
          className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">
        {metInMiddle ? (
          <>
            両側のみみを<span className="font-bold text-mat-600">中央で突き合わせる</span>まで
            折っているので、見えている面は
            <span className="font-bold text-mat-600">すべて二重</span>です。
            折り山が<span className="font-bold text-mat-600">左右に1本ずつ</span>あるので、
            「わ」の辺を持つ型紙を、左右どちらにも当てられます。
          </>
        ) : allDoubled ? (
          <>
            きっちり半分に折っているので、見えている面は
            <span className="font-bold text-mat-600">すべて二重</span>です。
            どこに型紙を1つ置いても、そのまま
            <span className="font-bold text-mat-600">2枚とも裁てます</span>。
          </>
        ) : folded ? (
          <>
            折り返したところは生地が<span className="font-bold text-mat-600">二重</span>です。
            そこに型紙を1つ置けば、そのまま
            <span className="font-bold text-mat-600">2枚とも裁てます</span>。
          </>
        ) : pending ? (
          <>
            「<span className="font-bold text-mat-700">わに当てる</span>」を使った型紙を置くと、
            その型紙の幅のぶんだけ生地を折り返します。
          </>
        ) : (
          <>折らずに一重で使います。型紙は必要な枚数だけ置いてください。</>
        )}
        </span>
      </p>
    </div>
  )
}
