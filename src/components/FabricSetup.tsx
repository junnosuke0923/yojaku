/**
 * 生地の設定（判断9）。
 *
 * 置き場所は「並べる」の画面のいちばん上（依頼者の指示・2026-09-05）。
 * もとは「生地」という独立した段階があったが、そこで決めることは
 * 生地幅ひとつに絞れたので、段階ごと「並べる」に畳み込んだ。
 * 折り方は大きな裁ち合わせ図の端の札で決める。
 *
 * 1画面に収めたいので、説明は畳んである（依頼者の指示・2026-08-27）。
 * ただし**幅を選ぶところは畳まない**。この画面でいちばん先に効く数なので、
 * 隠すと 110cm のまま並べ終えてしまう。
 *
 * 上下の向きだけは畳んである（依頼者の指示・2026-09-05
 * 「向きがあることをオプションとして付けることが出来る程度にして
 * 小さく収納してしまおうか」）。買う長さには**いっさい効かない**——
 * 効くのは、型紙の地の目線が両矢印か下向き一本かということと、
 * 180度回して置いたときに「向きがそろわない」と知らせるかどうかの2つだけ。
 * ふだんは「向きなし」のままでよいので、畳んだ1行に current の値だけ出す。
 * 消してしまわないのは、ベロアやコーデュロイ、一方向の柄で差し込みをしても
 * 何も言われなくなるため。裁ってからでないと気づけない失敗である。
 */

import { useState } from 'react'
import { COMMON_WIDTHS_MM, WIDTH_FABRICS } from '../lib/fabric'
import { Hint, Icon, Note } from './Icon'
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
  /** 上下の向きの中身を開いているか。ふだんは畳んだまま */
  const [napOpen, setNapOpen] = useState(false)
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
        <span className="text-sm font-bold text-ink-700">生地幅</span>
        <span className="tnum ml-auto text-xs text-ink-300">
          みみを除くと{' '}
          <span className="font-bold text-ink-500">{(widthMm - 40) / 10} cm</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/*
          数字の下に、その幅でよく見かける生地の名前を小さく添える
          （依頼者の指示・2026-08-31）。数字だけでは、どれを選ぶのか決められない。
          あくまで手がかりなので、色は薄く、字も小さくしてある
        */}
        {COMMON_WIDTHS_MM.map((mm) => (
          <button
            key={mm}
            type="button"
            onClick={() => { setTyping(null); onWidth(mm) }}
            className={`flex flex-col items-center rounded-lg px-2.5 py-1.5 leading-tight ${
              widthMm === mm ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            <span className="tnum text-sm font-bold">{mm / 10}</span>
            <span className={`text-[10px] ${widthMm === mm ? 'text-white/80' : 'text-ink-300'}`}>
              {WIDTH_FABRICS[mm]}
            </span>
          </button>
        ))}
        <label className="flex items-center gap-1 rounded-lg border border-ink-100 px-2 py-2">
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

      {/*
        「みみ」は図の中に小さく書いてあるだけで、知らない人には通じない
        （学生の点検・2026-09-02）。上の行で「みみを除くと」と言っている
        すぐ下で、一度だけ何のことか言う
      */}
      <p className="text-[11px] leading-relaxed text-ink-300">
        <T id="fabric.selvage.note" strong="font-bold text-ink-500" />
      </p>

      <Hint
        icon="clothWidth"
        summary={<T id="fabric.width.summary" />}
      >
        <T id="fabric.width.body" />
      </Hint>

      <div className="border-t border-ink-100 pt-2">
        {/*
          畳んだままでも、いまどちらなのかは見えるようにしてある。
          畳んで隠れるのは選び直す手段であって、いまの状態ではない。
          左の絵も、両矢印（向きなし）と下向き一本（向きあり）で入れ替わる。
          型紙の地の目線に出るものと同じ形なので、絵だけでも読める
        */}
        <button
          type="button"
          onClick={() => setNapOpen((v) => !v)}
          aria-expanded={napOpen}
          className="flex w-full items-center gap-2 py-0.5 text-left"
        >
          <Icon
            name={hasNap ? 'nap' : 'napNone'}
            className="h-4 w-4 shrink-0 text-mat-600"
          />
          {/* 「何の向きか」が分からなかった（学生の点検・2026-09-02）。生地幅と同じ形で見出しを立てる */}
          <span className="text-sm font-bold text-ink-700"><T id="fabric.nap.label" /></span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
            <span className={hasNap ? 'font-bold text-mat-700' : 'text-ink-500'}>
              {hasNap ? '向きあり' : '向きなし'}
            </span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                napOpen ? 'border-mat-500 bg-mat-50 text-mat-700' : 'border-ink-100 text-ink-300'
              }`}
            >
              <Icon
                name="chevron"
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${napOpen ? '-rotate-90' : 'rotate-90'}`}
              />
            </span>
          </span>
          <span className="sr-only">{napOpen ? '閉じる' : '変える'}</span>
        </button>

        {napOpen && (
        <div className="flex flex-col gap-1 pt-1">
        <Hint
          icon="nap"
          summary={<T id="fabric.nap.summary" />}
        >
          <T id="fabric.nap.body" />
        </Hint>
        <div data-tour="fabric-nap" className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onNap(false)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold ${
              hasNap ? 'border border-ink-100 text-ink-700' : 'bg-mat-500 text-white'
            }`}
          >
            <Icon name="napNone" className="h-4 w-4 shrink-0" />
            <span className="flex flex-col items-start leading-tight">
              向きなし
              {/*
                「何の向きか分からない」と読まれた（学生の点検・2026-09-02・2巡目）。
                見出しの「上下の向き」だけでは、押す札そのものに届いていなかった。
                言葉は現場のまま残し、その下に、何が決まるのかを添える
              */}
              <span className="text-[11px] font-normal opacity-80">
                どちらを上にしてもよい
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNap(true)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold ${
              hasNap ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            <Icon name="nap" className="h-4 w-4 shrink-0" />
            <span className="flex flex-col items-start leading-tight">
              向きあり
              <span className="text-[11px] font-normal opacity-80">
                上が決まっている
              </span>
            </span>
          </button>
        </div>
        {/*
          押しても画面が何も変わらなかった（学生の点検・2026-09-02・2巡目）。
          「いちばん最初に決めます」と言っておきながら、
          決めた結果がどこにも出ないので、決めた実感がない。
          押した札のほうで、これから何が変わるのかをその場で言う
        */}
        <Note icon={hasNap ? 'nap' : 'nest'} tone={hasNap ? 'warn' : 'plain'}>
          <T id={hasNap ? 'fabric.nap.on' : 'fabric.nap.off'} strong="font-bold" />
        </Note>
        </div>
        )}
      </div>
    </section>
  )
}
