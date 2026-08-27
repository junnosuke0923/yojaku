/**
 * 生地の設定（判断9）。
 *
 * **差し込みの可否は、いちばん最初に決める。**
 * あとから聞くと、すでに差し込んで並べ終えたものを崩すことになるうえ、
 * そもそも買う長さそのものが変わってしまうので、後出しにはできない。
 * だから生地幅と同じ画面に置いてある。
 */

import { COMMON_WIDTHS_MM } from '../lib/fabric'
import { Heading, Hint, Icon, Note } from './Icon'

type Props = {
  widthMm: number
  hasNap: boolean
  onWidth: (mm: number) => void
  onNap: (hasNap: boolean) => void
}

export function FabricSetup({ widthMm, hasNap, onWidth, onNap }: Props) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-ink-100 bg-white px-4 py-4">
      <div className="flex flex-col gap-3">
        <Heading icon="clothWidth">生地幅</Heading>
        <Note icon="selvage">
          みみは片側2cm。置けるのは{' '}
          <span className="tnum font-bold text-ink-700">{(widthMm - 40) / 10} cm</span> です。
        </Note>
        <div className="flex flex-wrap gap-2">
          {COMMON_WIDTHS_MM.map((mm) => (
            <button
              key={mm}
              type="button"
              onClick={() => onWidth(mm)}
              className={`tnum rounded-lg px-4 py-2 text-sm font-bold ${
                widthMm === mm ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
              }`}
            >
              {mm / 10} cm
            </button>
          ))}
          <label className="flex items-center gap-1.5 rounded-lg border border-ink-100 px-3 py-2">
            <input
              type="number"
              value={widthMm / 10}
              min={30}
              max={300}
              onChange={(e) => onWidth(Math.round(Number(e.target.value) * 10))}
              className="tnum w-14 bg-transparent text-sm font-bold text-ink-900 outline-none"
            />
            <span className="text-xs text-ink-300">cm</span>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-ink-100 pt-4">
        <Heading icon="question">この生地に、上下の向きはありますか</Heading>
        <Hint summary={<>ここは<b className="text-ink-700">いちばん最初に</b>決めます</>}>
          パーツを 180 度回して差し込めるかどうかが、ここで決まります。
          差し込めないと、そのぶん生地を長く買うことになるので、
          あとから変えると並べ直しになります。
        </Hint>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onNap(false)}
            className={`rounded-lg px-3 py-3 text-left ${
              hasNap ? 'border border-ink-100' : 'bg-mat-500 text-white'
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Icon name="napNone" className="h-4 w-4 shrink-0" />
              向きなし
            </span>
            <span className={`block pt-0.5 text-xs ${hasNap ? 'text-ink-500' : 'text-mat-50'}`}>
              無地の平織など。差し込めます
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNap(true)}
            className={`rounded-lg px-3 py-3 text-left ${
              hasNap ? 'bg-mat-500 text-white' : 'border border-ink-100'
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Icon name="nap" className="h-4 w-4 shrink-0" />
              向きあり
            </span>
            <span className={`block pt-0.5 text-xs ${hasNap ? 'text-mat-50' : 'text-ink-500'}`}>
              毛並みのあるウール、一方向の柄
            </span>
          </button>
        </div>
        {hasNap && (
          <Note icon="warn" tone="warn">
            毛並みのある生地では、パーツを 180 度回して差し込むことはできません。
            そのぶん生地を長く買うことになります。
          </Note>
        )}
      </div>
    </section>
  )
}
