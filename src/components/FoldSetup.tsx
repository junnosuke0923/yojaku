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
 */

import { useState } from 'react'
import {
  canHalfFold, foldFromEdge, FOLD_LABELS,
  type FoldMode, type Section,
} from '../lib/fabric'
import { FoldPicker } from './FoldPicker'
import { Icon } from './Icon'

type Props = {
  section: Section
  /** いま「きっちり折る」になっているか */
  half: boolean
  /** 区間が2つ以上あるときだけ付ける見出し（「2つめ・」） */
  prefix?: string
  onFold: (fold: FoldMode, halfFold?: boolean) => void
  onHalf: (halfFold: boolean) => void
  /** 名前の行の右端に足すもの。区間ごとの幅や「消す」を差し込むのに使う */
  extra?: React.ReactNode
  /** 辺をさわったときに、その区間を選び直す */
  onActivate?: () => void
}

export function FoldSetup({ section, half, prefix, onFold, onHalf, extra, onActivate }: Props) {
  /** 引きずっている最中に、いま何をしているのかを言葉で出すためのもの */
  const [hint, setHint] = useState<string | null>(null)

  return (
    <div className="flex items-start gap-2 rounded-xl border border-ink-100 bg-white px-2 py-1.5">
      <FoldPicker
        fold={section.fold}
        half={half}
        onHint={setHint}
        onEdge={(side, action) => {
          onActivate?.()
          const next = foldFromEdge(section.fold, side, action)
          onFold(next.fold, next.halfFold)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink-700">
          <Icon name="layout" className="h-4 w-4 shrink-0 text-mat-600" />
          {prefix}
          {FOLD_LABELS[section.fold]}
        </span>
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
        {extra}
      </div>
    </div>
  )
}
