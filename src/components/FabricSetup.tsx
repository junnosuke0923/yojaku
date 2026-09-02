/**
 * 生地の設定（判断9）。
 *
 * **差し込みの可否は、いちばん最初に決める。**
 * あとから聞くと、すでに差し込んで並べ終えたものを崩すことになるうえ、
 * そもそも買う長さそのものが変わってしまうので、後出しにはできない。
 * だから生地幅と同じ画面に置いてある。
 *
 * 1画面に収めたいので、説明は畳んである（依頼者の指示・2026-08-27）。
 * ただし**選ぶところは畳まない**。いちばん最初に決めるものを隠すと、
 * 決めないまま先へ進んでしまう。
 */

import { COMMON_WIDTHS_MM, WIDTH_FABRICS } from '../lib/fabric'
import { Hint, Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  widthMm: number
  hasNap: boolean
  onWidth: (mm: number) => void
  onNap: (hasNap: boolean) => void
}

export function FabricSetup({ widthMm, hasNap, onWidth, onNap }: Props) {
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
            onClick={() => onWidth(mm)}
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
            value={widthMm / 10}
            min={30}
            max={300}
            onChange={(e) => onWidth(Math.round(Number(e.target.value) * 10))}
            className="tnum w-12 bg-transparent text-sm font-bold text-ink-900 outline-none"
          />
          <span className="text-xs text-ink-300">cm</span>
        </label>
      </div>

      <Hint
        icon="clothWidth"
        summary={<T id="fabric.width.summary" />}
      >
        <T id="fabric.width.body" />
      </Hint>

      <div className="border-t border-ink-100 pt-2.5">
        <Hint
          icon="nap"
          summary={<T id="fabric.nap.summary" />}
        >
          <T id="fabric.nap.body" />
        </Hint>
        <div data-tour="fabric-nap" className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => onNap(false)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold ${
              hasNap ? 'border border-ink-100 text-ink-700' : 'bg-mat-500 text-white'
            }`}
          >
            <Icon name="napNone" className="h-4 w-4 shrink-0" />
            向きなし
          </button>
          <button
            type="button"
            onClick={() => onNap(true)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold ${
              hasNap ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            <Icon name="nap" className="h-4 w-4 shrink-0" />
            向きあり
          </button>
        </div>
      </div>
    </section>
  )
}
