/**
 * 折り方を決める枠——小さい折り図と、その結果の名前と、折る深さ。
 *
 * この枠は2か所に出る（依頼者の指示・2026-09-01）。
 *
 *   「生地」の画面   … はじめの折り方。ふだんはここだけで済む
 *   「並べる」の画面 … 生地を切り分けて区間が2つ以上になったときだけ
 *
 * 区間が1つのあいだ「並べる」に出さないのは、同じものが2つ出るのを避けるため。
 * 折り方はもう決まっているし、大きい裁ち合わせ図の端の札からでも変えられる。
 * 区間が2つ以上になったら話が別で、**どの区間の話なのか**を言う必要が出るので、
 * そのときだけ戻ってくる。
 *
 * 折り方は名前を並べたプルダウンではなく、**辺を押して**決める
 * （依頼者の指示・2026-08-28）。「縦わ・片側」という名前は、
 * 頭の中でいったん図に直さないと選べない。辺を押すなら、その手間が要らない。
 * ただし名前そのものにも意味がある（学校で使う言葉なので）ので、
 * 図のとなりに結果を文字で出して、押して決めて名前で覚える順にしてある。
 *
 * 折る深さは、辺を引きずって決める（依頼者の指示・2026-09-05）。
 * 下のプルダウンはその**行き先を名前で言い直したもの**であって、別の設定ではない。
 * 「折らない」「まだ折っていない」「半分」「指で決めた幅」は、
 * どれも深さという1本の物差しの上に並んでいる。
 */

import { useState } from 'react'
import {
  canHalfFold, foldFromEdge, foldSidesOf, FOLD_LABELS, handDepthOf, hasHandDepth, SIDE_NAMES,
  type FoldMode, type Section, type Side,
} from '../lib/fabric'
import { FoldPicker } from './FoldPicker'
import { Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  section: Section
  /** いま「きっちり折る」になっているか */
  half: boolean
  /** 区間が2つ以上あるときだけ付ける見出し（「2つめ・」） */
  prefix?: string
  onFold: (
    fold: FoldMode, halfFold?: boolean, depth?: Partial<Record<Side, number | null>>,
  ) => void
  onHalf: (halfFold: boolean) => void
  /** 名前の行の右端に足すもの。区間ごとの幅や「消す」を差し込むのに使う */
  extra?: React.ReactNode
  /** 辺をさわったときに、その区間を選び直す */
  onActivate?: () => void
  /** 折り図の1辺を引ききったときの実寸。`FoldPicker` の同名の props をそのまま渡す */
  scale?: {
    spanMm: (side: Side) => number
  }
}

/** 折り山にした辺すべての、指で決めた深さを消すための差分 */
const CLEAR: Partial<Record<Side, number | null>> = {
  left: null, right: null, top: null, bottom: null,
}

export function FoldSetup({
  section, half, prefix, onFold, onHalf, extra, onActivate, scale,
}: Props) {
  /** 引きずっている最中に、いま何をしているのかを言葉で出すためのもの */
  const [hint, setHint] = useState<string | null>(null)

  /** 指で決めた深さの言い方。「左 12.5 ／ 右 8.0cm」 */
  const handLabel = () => {
    const parts = foldSidesOf(section.fold)
      .map((sd) => ({ sd, mm: handDepthOf(section, sd) }))
      .filter((x): x is { sd: Side; mm: number } => x.mm !== null)
    if (parts.length === 0) return ''
    if (parts.length === 1) return `${(parts[0].mm / 10).toFixed(1)}cm`
    return parts.map((x) => `${SIDE_NAMES[x.sd]} ${(x.mm / 10).toFixed(1)}`).join(' ／ ') + 'cm'
  }
  const byHand = hasHandDepth(section)

  return (
    <div className="flex items-start gap-2 rounded-xl border border-ink-100 bg-white px-2 py-1.5">
      <FoldPicker
        fold={section.fold}
        half={half}
        onHint={setHint}
        scale={scale}
        onEdge={(side, action) => {
          onActivate?.()
          const next = foldFromEdge(section.fold, side, action)
          onFold(next.fold, next.halfFold, { [side]: next.depthMm ?? null })
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink-700">
          <Icon name="layout" className="h-4 w-4 shrink-0 text-mat-600" />
          {prefix}
          {FOLD_LABELS[section.fold]}
        </span>
        <span className={`text-xs leading-relaxed ${hint ? 'font-bold text-mat-700' : 'text-ink-300'}`}>
          {hint ?? <T id="fold.idle.hint" />}
        </span>
        {canHalfFold(section.fold) && (
          <select
            value={byHand ? 'hand' : half ? 'half' : 'none'}
            onChange={(e) => {
              const v = e.target.value
              // 指で決めた深さは、名前のほうを選び直した時点で消える。
              // 同じ物差しの上の話なので、両方が同時に効いていることはない
              if (v === 'hand') return
              onFold(section.fold, v === 'half', CLEAR)
              onHalf(v === 'half')
            }}
            className="min-w-0 rounded-lg border border-ink-100 bg-white px-1.5 py-1.5 text-sm"
          >
            <option value="half">
              {section.fold === 'vBoth' || section.fold === 'hBoth'
                ? '両端が出会うまで折る' : '半分に折る'}
            </option>
            {/*
              「わ」に指定しただけで、まだ折る深さを決めていない状態。
              選び直せば、いつでもここへ戻せる
            */}
            <option value="none">まだ折っていない（端を引いて決める）</option>
            {/*
              辺を引きずって決めたときだけ出る。指で決めた深さは図には残らないので、
              いくつになっているのかを言えるところが、ここしかない
            */}
            {byHand && <option value="hand">{`指で決めた幅（${handLabel()}）`}</option>}
          </select>
        )}
        {extra}
      </div>
    </div>
  )
}
