/**
 * 定規の種類を選ぶトグル。
 *
 * 自動判別はあくまで「初期値の提案」。最後に効くのはこのトグルの値。
 * 取り違えると要尺が 1.67倍 または 0.6倍 ずれるため、人が確定させる。
 */

import { RULERS, type RulerGuess, type RulerId } from '../lib/ruler'
import { Icon, Note } from './Icon'
import { T } from './TextTools'

type Props = {
  value: RulerId
  guess: RulerGuess | null
  onChange: (id: RulerId) => void
}

export function RulerToggle({ value, guess, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
          <Icon name="ruler" className="h-4 w-4 shrink-0 text-mat-600" />
          <T id="ruler.kind.title" strong="font-bold" />
        </span>
        {guess?.confident && guess.suggested === value && (
          <span className="flex items-center gap-1 text-xs text-mat-600">
            <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
            <T id="ruler.kind.match" strong="font-bold" />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['r50', 'r30'] as const).map((id) => {
          const spec = RULERS[id]
          const active = value === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={[
                'rounded-xl border-2 px-3 py-3 text-left transition',
                active
                  ? 'border-mat-500 bg-mat-50 text-mat-700'
                  : 'border-ink-100 bg-white text-ink-500',
              ].join(' ')}
            >
              <span className="block text-base font-bold">{spec.label}</span>
              <span className="tnum block text-xs">
                {spec.longMm / 10} × {spec.shortMm / 10} cm
              </span>
            </button>
          )
        })}
      </div>

      {/*
        自分で選び直したときは、推測の文をそのまま出さない
        （学生の点検・2026-09-02）。
        もとは「縦横比 9.7 なので 50cm定規 と判断しました」が出たままだったので、
        30cm定規 を押して見た目はそちらが選ばれているのに、
        文はもう一方を指したままになり、どちらが効いているのか分からなかった。
        効いているのは常に**このトグルの値**なので、それを先に言う
      */}
      <Note>
        {guess && guess.suggested !== null && guess.suggested !== value ? (
          <T
            id="ruler.kind.override"
            vars={{
              picked: RULERS[value].label,
              guessed: RULERS[guess.suggested].label,
              ratio: guess.observedRatio > 0 ? guess.observedRatio.toFixed(1) : '—',
            }}
          />
        ) : guess ? (
          <>
            {guess.reason}
            {guess.observedRatio > 0 && (
              <span className="tnum"> （写真上の縦横比 {guess.observedRatio.toFixed(1)}）</span>
            )}
          </>
        ) : (
          <T id="ruler.kind.note" />
        )}
      </Note>
    </div>
  )
}
