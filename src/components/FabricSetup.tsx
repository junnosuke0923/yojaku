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

import { COMMON_WIDTHS_MM } from '../lib/fabric'
import { Hint, Icon } from './Icon'

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
        {COMMON_WIDTHS_MM.map((mm) => (
          <button
            key={mm}
            type="button"
            onClick={() => onWidth(mm)}
            className={`tnum rounded-lg px-3 py-2 text-sm font-bold ${
              widthMm === mm ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            {mm / 10}
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

      <div className="border-t border-ink-100 pt-2.5">
        <Hint
          icon="nap"
          summary={<>上下の向きは<b className="text-ink-700">いちばん最初に</b>決めます</>}
        >
          パーツを 180 度回して差し込めるかどうかが、ここで決まります。
          毛並みのあるウールや一方向の柄は「向きあり」。無地の平織などは「向きなし」です。
          「向きあり」にしても回すことはできますが、上下逆にした型紙には注意書きが出ます。
          差し込めないとそのぶん生地を長く買うことになるので、
          あとから変えると並べ直しになります。
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
