/**
 * 生地の設定（判断9）。
 *
 * 置き場所は「並べる」の画面のいちばん上（依頼者の指示・2026-09-05）。
 * もとは「生地」という独立した段階があったが、そこで決めることは
 * 生地幅ひとつに絞れたので、段階ごと「並べる」に畳み込んだ。
 * 折り方は大きな裁ち合わせ図の端の札で決める。
 *
 * **この枠は、下の裁ち合わせ図の場所を借りている。**
 * この画面のいちばんの見せどころは図のほうなので、ここは2段に収めてある
 * （依頼者の指示・2026-09-05「ここはかなりコンパクトにしておきたいです。
 * 理由としては配置図の部分を出来るだけ見せたいからです」）。
 *
 * - 1段目 … 見出しと、みみを除いた幅と、一方裁ちの小さな札
 * - 2段目 … 幅の札4つと、直に打つ欄
 *
 * 2段目は「4等分に並べた札 ＋ 直に打つ欄」。札の幅を中身に任せると
 * 「シーチング」の札だけが広くなって、選ぶものが同じ重さに見えないので、
 * 4等分の枠で幅をそろえてある。
 * 375px より細い画面では、打つ欄のほうが次の行へ折り返す（`flex-wrap`）
 *
 * 落としたもの（依頼者の指示・2026-09-05「耳の説明や『数字の下は～～』の
 * 部分は削除でいいです」）:
 *
 * - 「みみ＝生地の両端にある、ほつれない耳」の一文。すぐ下の図に
 *   *みみ* と書いた帯が実際に描いてあるので、言葉より図のほうが早い
 * - 「数字の下は、その幅でよく見かける生地です」の「？」の行。
 *   札にシーチング・綿麻・ウール・コート地と書いてあること自体が
 *   その説明になっている
 *
 * 上下の向きは、1段目の右端の小さな札**ひとつ**にしてある
 * （依頼者の指示・2026-09-05「『向きなし』を『差し込み可』にして、
 * クリックしたら『一方裁ち↓』で切り替わるようにして、現状クリック時に
 * 出てくるパネルは出さなくていいです」）。
 *
 * 押すたびに、差し込み可 ⇄ 一方裁ち が入れ替わる。開いて選ぶ画面は無い。
 * 2つしかない状態を2段階で選ばせる（開く → 選ぶ）必要はなく、
 * 札そのものが持ち手であるほうが早い。
 *
 * 言葉は現場の言い方にそろえてある。「向きなし／向きあり」は
 * 何の向きか分からないと読まれていたが、「差し込み可」「一方裁ち」なら
 * **何が出来るのか／何をする裁ち方なのか**がそのまま書いてある。
 * 一方裁ちの側だけ絵の矢が下向き一本になるので、絵だけでも読める
 * （型紙の地の目線に出るものと同じ形）。
 *
 * 買う長さに効くのは、この設定そのものではなく差し込みの可否である——
 * 型紙の地の目線が両矢印か下向き一本かということと、
 * 180度回して置いたときに「向きがそろわない」と知らせるかどうかの2つ。
 * 消してしまわないのは、ベロアやコーデュロイ、一方向の柄で差し込みをしても
 * 何も言われなくなるため。裁ってからでないと気づけない失敗である。
 *
 * 幅を選ぶところは畳まない。この画面でいちばん先に効く数なので、
 * 隠すと 110cm のまま並べ終えてしまう。
 */

import { useState } from 'react'
import { COMMON_WIDTHS_MM, WIDTH_FABRICS } from '../lib/fabric'
import { Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  widthMm: number
  hasNap: boolean
  onWidth: (mm: number) => void
  onNap: (hasNap: boolean) => void
}

/** 欄に直に打てる幅の範囲（cm）。反物としてありうる下限と上限 */
const MIN_WIDTH_CM = 30
const MAX_WIDTH_CM = 300

export function FabricSetup({ widthMm, hasNap, onWidth, onNap }: Props) {
  /*
    打っている最中の字は、そのまま手元に置いておく（依頼者の点検・2026-09-02）。

    もとは打った字をそのまま幅にしていたので、
    **消して打ち直そうとした瞬間**に欄が空になり、
    その空文字が 0 と読まれて「みみを除くと -4 cm」と出ていた。
    `min` `max` は付いていたが、あれは送信するときの決まりで、
    打っている最中の値を止めるものではない。

    いまは、まともな数になったときだけ幅として上へ渡す。
    欄から指を離したら、いま効いている幅に表示を戻す。

    ただし**黙って捨てない**（学生の点検・2026-09-02）。
    「5」と入れても上の「みみを除くと」は前のままで、何も言われないので、
    効いたのか効いていないのか分からなかった。
    範囲から外れているあいだは、そう書いて出す
  */
  const [typing, setTyping] = useState<string | null>(null)
  /** 打っている数が、幅として受け取れる範囲から外れているか */
  const outOfRange = typing !== null && typing.trim() !== '' && !(
    Number.isFinite(Number(typing))
    && Number(typing) >= MIN_WIDTH_CM && Number(typing) <= MAX_WIDTH_CM
  )

  return (
    <section
      data-tour="fabric-width"
      className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-2.5"
    >
      <div className="flex items-center gap-2">
        <Icon name="clothWidth" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="whitespace-nowrap text-sm font-bold text-ink-700">生地幅</span>
        {/*
          ここから右そろえの組。みみを除いた幅と、一方裁ちの札。

          みみを除いた幅は、見出しのすぐ隣。
          この数は選んだ幅から出るものなので、幅の札と同じ段にあるほうが
          どこから来た数かが分かる。ここに置くと、下の段が
          「札4つ ＋ 直に打つ欄」で1行に収まり、枠が2段で済む。

          360px より細い画面では、この一言だけ引っ込める。
          3つを横に並べきれず、「生地幅」が2行に折れて枠が高くなるため。
          同じ数は、下の「買ってくる長さ」の枠にも書いてある
        */}
        <div className="ml-auto flex items-center gap-2">
        <span className="tnum hidden whitespace-nowrap text-xs text-ink-300 min-[360px]:inline">
          みみを除くと{' '}
          <span className="font-bold text-ink-500">{(widthMm - 40) / 10} cm</span>
        </span>
        {/*
          一方裁ちかどうかは、この段の右端の札ひとつで切り替える。
          押すたびに入れ替わるので、開いて選ぶ画面は無い。

          絵は、両矢印（差し込み可）と下向き一本（一方裁ち）。
          型紙の地の目線に出るものと同じ形なので、絵だけでも読める。
          一方裁ちのときだけ緑を敷いて、ふだんと違う状態であることを言う
        */}
        <button
          type="button"
          data-tour="fabric-nap"
          onClick={() => onNap(!hasNap)}
          aria-pressed={hasNap}
          aria-label={`一方裁ち（いま${hasNap ? '一方裁ち' : '差し込み可'}）`}
          className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-xs ${
            hasNap ? 'border-mat-500 bg-mat-50 font-bold text-mat-700' : 'border-ink-100 text-ink-500'
          }`}
        >
          <Icon
            name={hasNap ? 'nap' : 'napNone'}
            className="h-3.5 w-3.5 shrink-0 text-mat-600"
          />
          {hasNap ? '一方裁ち' : '差し込み可'}
        </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/*
          札4つは**同じ幅**にそろえる（依頼者の指示・2026-09-05
          「生地幅のそれぞれの数字のボタンがその下に書かれている生地名の幅に
          依存している為に幅が不ぞろいなのでそろえたいです」）。

          もとは中身なりの幅にしていたので、「シーチング」の札だけが
          「ウール」の札より 15px 広く、選ぶものが同じ重さに見えなかった。
          4等分の枠（`grid-cols-4`）に入れて、幅は枠のほうで決める。

          残りを直に打つ欄が取る。枠には下限を付けてあるので、
          これより細い画面では欄のほうが次の行へ折り返し、
          札は4つ並んだまま横いっぱいに広がる
        */}
        <div className="grid min-w-[200px] flex-1 grid-cols-4 gap-1.5">
        {COMMON_WIDTHS_MM.map((mm) => (
          <button
            key={mm}
            type="button"
            onClick={() => { setTyping(null); onWidth(mm) }}
            className={`flex flex-col items-center rounded-lg px-1 py-1.5 leading-tight ${
              widthMm === mm ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            <span className="tnum text-sm font-bold">{mm / 10}</span>
            <span className={`text-[10px] ${widthMm === mm ? 'text-white/80' : 'text-ink-300'}`}>
              {WIDTH_FABRICS[mm]}
            </span>
          </button>
        ))}
        </div>
        <label className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-100 px-2 py-2">
          <input
            type="number"
            inputMode="decimal"
            value={typing ?? widthMm / 10}
            min={MIN_WIDTH_CM}
            max={MAX_WIDTH_CM}
            onChange={(e) => {
              setTyping(e.target.value)
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= MIN_WIDTH_CM && v <= MAX_WIDTH_CM) {
                onWidth(Math.round(v * 10))
              }
            }}
            onBlur={() => setTyping(null)}
            className="tnum w-12 bg-transparent text-sm font-bold text-ink-900 outline-none"
          />
          <span className="text-xs text-ink-300">cm</span>
        </label>
      </div>

      {outOfRange && (
        <p className="flex gap-2 text-xs leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0" />
          <span className="min-w-0 flex-1">
            <T id="fabric.width.range" vars={{ min: MIN_WIDTH_CM, max: MAX_WIDTH_CM }} />
          </span>
        </p>
      )}

    </section>
  )
}
