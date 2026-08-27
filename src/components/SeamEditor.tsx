/**
 * 縫い代の画面（判断6）。
 *
 * 辺に名前は付けない。写真から取れるのは輪郭だけで、
 * それが前身頃なのか後身頃なのか、どちらが上なのかは分からないため。
 * 誤った名前を出すと、各部の名称をまだ覚えていない下級生がそのまま覚えてしまう。
 * 番号なら形から決まるので、間違えようがない。
 *
 * そのかわり、**型紙の辺を直接押して選べる**ようにしてある。
 * 番号を読まなくても、押せば光る。
 */

import { useMemo, useState } from 'react'
import { bounds } from '../lib/geom'
import { applyToAll, buildSeam, SEAM_INCLUDED_MM, SEAM_STEPS_CM, type SeamPlan } from '../lib/seam'
import { Icon, Note } from './Icon'
import { PatternMarks } from './PatternMarks'

type Props = {
  plan: SeamPlan
  onChange: (plan: SeamPlan) => void
  /** 地の目の矢印の向きが変わる */
  hasNap: boolean
  /** 型紙の中に書く名前 */
  name: string
  /**
   * 取り込んだ型紙に、もう縫い代が付いているか。
   * 付いているなら足す量は聞かず、「わ」の辺の指定だけになる。
   */
  seamIncluded: boolean
}

/** 番号のふきだしを、辺からどれだけ外へ押し出すか(mm) */
const LABEL_PUSH_MM = 22

export function SeamEditor({ plan, onChange, hasNap, name, seamIncluded }: Props) {
  const [selected, setSelected] = useState(0)
  const [bulkCm, setBulkCm] = useState(1)
  const [note, setNote] = useState<string | null>(null)

  const seam = useMemo(() => buildSeam(plan), [plan])

  const view = useMemo(() => {
    const all = seam ? [...seam.cutLineMm, ...seam.finishedLineMm] : plan.path.points
    const b = bounds(all)
    const pad = LABEL_PUSH_MM + 30
    return {
      x: b.minX - pad, y: b.minY - pad,
      w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2,
      // 出来上がり線を、裁ち切り線と同じ原点へずらすための差
      dx: seam ? seam.finishedLineMm[0].x - plan.path.points[0].x : 0,
      dy: seam ? seam.finishedLineMm[0].y - plan.path.points[0].y : 0,
    }
  }, [seam, plan])

  const setAllowance = (groupIndex: number, mm: number) => {
    const allowancesMm = [...plan.allowancesMm]
    allowancesMm[groupIndex] = mm
    setNote(null)
    onChange({ ...plan, allowancesMm })
  }

  const doBulk = () => {
    const { plan: next, changed } = applyToAll(plan, bulkCm * 10)
    const skipped = plan.allowancesMm.filter((a) => a === 0).length
    setNote(
      skipped > 0
        ? `${changed} 本を ${bulkCm} cm に。わ（縫い代 0）の ${skipped} 本はそのままです`
        : `${changed} 本を ${bulkCm} cm にしました。ここから裾だけ直します`,
    )
    onChange(next)
  }

  const pts = plan.path.points
  const n = pts.length
  const px = (i: number) => pts[i % n].x + view.dx
  const py = (i: number) => pts[i % n].y + view.dy

  /** 出来上がり線を、裁ち切り線と同じ原点にそろえたもの */
  const shifted = useMemo(
    () => pts.map((q) => ({ x: q.x + view.dx, y: q.y + view.dy })),
    [pts, view.dx, view.dy],
  )

  const pathOf = (start: number, end: number) => {
    let d = `M${px(start).toFixed(1)} ${py(start).toFixed(1)}`
    for (let i = start + 1; i <= end; i++) d += `L${px(i).toFixed(1)} ${py(i).toFixed(1)}`
    return d
  }

  const currentMm = plan.allowancesMm[selected] ?? 0

  return (
    <div className="flex flex-col gap-2.5">
      {/*
        縦長のパーツだと図が画面を占領して、下の操作が押し出されてしまう。
        高さに上限を付ける。図は SVG のほうで中央に収まる。

        上限は「画面の高さから、下の操作のぶんを引いた残り」。
        こうしておくと、小さい端末では図のほうが縮んで、
        1画面に収まる状態をできるだけ保てる（依頼者の指示・2026-08-27）。
        ただし縮みすぎると辺を押せなくなるので、下限も決めてある
      */}
      <svg
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="w-full rounded-xl border border-ink-100 bg-table"
        style={{ aspectRatio: `${view.w} / ${view.h}`, maxHeight: 'max(140px, min(34vh, calc(100dvh - 33rem)))' }}
        role="img"
        aria-label="型紙と縫い代"
      >
        {/*
          もとの型紙（出来上がり線）は実線のまま残す。学生が形として覚えているのはこちら。
          縫い代は「後から足したぶんの帯」だけを青い塗りで示す。
          そのために、裁ち切り線を青く塗ってから、出来上がり線を紙の色で上塗りしている
        */}
        {seam && (
          <polygon
            points={seam.cutLineMm.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="#3F6FA8"
            fillOpacity={0.22}
            stroke="#3F6FA8"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        )}

        <polygon
          points={pts.map((_, i) => `${px(i).toFixed(1)},${py(i).toFixed(1)}`).join(' ')}
          fill="#FAF7F0"
          stroke="#2b332d"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* 地の目線とパーツ名 */}
        <PatternMarks poly={shifted} hasNap={hasNap} name={name} />

        {/* 選んでいる辺を光らせる */}
        {plan.groups.map((g, gi) => (
          <path
            key={`hi-${g.no}`}
            d={pathOf(g.start, g.end)}
            fill="none"
            stroke={gi === selected ? '#b4433a' : 'transparent'}
            strokeWidth={4}
            strokeLinecap="round"
          />
        ))}

        {/* 押せる場所。見えない太い線にして、指で当てやすくする */}
        {plan.groups.map((g, gi) => (
          <path
            key={`hit-${g.no}`}
            d={pathOf(g.start, g.end)}
            fill="none"
            stroke="transparent"
            strokeWidth={26}
            strokeLinecap="round"
            style={{ cursor: 'pointer' }}
            onPointerDown={() => { setSelected(gi); setNote(null) }}
          />
        ))}

        {/* 番号。まとまりの真ん中から外へ押し出す */}
        {plan.groups.map((g, gi) => {
          const mm = plan.allowancesMm[gi]
          const push = mm + LABEL_PUSH_MM
          const cx = g.midpoint.x + view.dx + g.outward.x * push
          const cy = g.midpoint.y + view.dy + g.outward.y * push
          const on = gi === selected
          return (
            <g
              key={`no-${g.no}`}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => { setSelected(gi); setNote(null) }}
            >
              <circle cx={cx} cy={cy} r={14} fill={on ? '#b4433a' : '#ffffff'}
                stroke={on ? '#b4433a' : '#9aa69e'} strokeWidth={1.6} />
              <text x={cx} y={cy + 6} textAnchor="middle" fontSize={17}
                fill={on ? '#ffffff' : '#5c665f'} fontWeight={700}>
                {g.no}
              </text>
              {mm === 0 && (
                <text x={cx} y={cy + 30} textAnchor="middle" fontSize={15} fill="#2b332d">
                  わ
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/*
        まとめてと、1本ずつ。もとは別々の枠だったが、
        1画面に収めたいので同じ枠に入れてある（依頼者の指示・2026-08-27）
      */}
      <div className="rounded-xl border border-ink-100 bg-white px-4 py-3">
        {!seamIncluded && (
          <div className="flex items-center gap-3 border-b border-ink-100 pb-3">
            <span className="flex items-center gap-1.5 text-sm font-bold text-ink-700">
              <Icon name="seam" className="h-4 w-4 shrink-0 text-mat-600" />
              まとめて
            </span>
            <select
              value={bulkCm}
              onChange={(e) => setBulkCm(Number(e.target.value))}
              className="tnum rounded-lg border border-ink-100 px-3 py-1.5 text-base"
            >
              {SEAM_STEPS_CM.filter((c) => c > 0).map((c) => (
                <option key={c} value={c}>{c} cm</option>
              ))}
            </select>
            <button
              type="button"
              onClick={doBulk}
              className="ml-auto rounded-lg bg-mat-500 px-4 py-2 text-sm font-bold text-white active:bg-mat-600"
            >
              全部に付ける
            </button>
          </div>
        )}
        {note && (
          <div className="pt-2">
            <Note icon="check" tone="good">{note}</Note>
          </div>
        )}
        <div className="flex items-baseline gap-2 pt-3 pb-2">
          <span className="text-sm font-bold text-ink-700">
            {plan.groups[selected]?.no ?? 1} 番の辺
          </span>
          <span className="tnum text-xs text-ink-300">
            長さ {Math.round((plan.groups[selected]?.lengthMm ?? 0) / 10)} cm
          </span>
          <span className="tnum ml-auto text-lg font-bold text-seam">
            {currentMm === 0 ? (
              <>
                わ
                <span className="pl-1 text-xs font-bold opacity-70">縫い代 0</span>
              </>
            ) : seamIncluded ? (
              'ふつうの辺'
            ) : (
              `${(currentMm / 10).toFixed(1)} cm`
            )}
          </span>
        </div>

        {seamIncluded ? (
          <>
            {/*
              縫い代つきの型紙でも「わ」の指定だけは要る。
              折り山に当てる辺かどうかで、要尺も枚数も変わるため
            */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAllowance(selected, SEAM_INCLUDED_MM)}
                className={`rounded-lg py-3 text-sm font-bold ${
                  currentMm !== 0 ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
                }`}
              >
                ふつうの辺
              </button>
              <button
                type="button"
                onClick={() => setAllowance(selected, 0)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-3 text-sm font-bold ${
                  currentMm === 0 ? 'bg-seam text-white' : 'border border-ink-100 text-ink-700'
                }`}
              >
                <Icon name="fold" className="h-4 w-4 shrink-0" />
                わ（折り山）
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-6 gap-1.5">
              {SEAM_STEPS_CM.map((cm) => {
                const on = Math.abs(currentMm - cm * 10) < 0.01
                return (
                  <button
                    key={cm}
                    type="button"
                    onClick={() => setAllowance(selected, cm * 10)}
                    className={`tnum rounded-lg py-2 text-sm font-bold ${
                      on ? 'bg-seam text-white' : 'border border-ink-100 text-ink-700'
                    }`}
                  >
                    {/*
                      「わ」と「縫い代 0」が同じことだと、札そのものに書いておく
                      （依頼者の案・2026-08-27）。文で説明するより短く、消えない
                    */}
                    {cm === 0 ? (
                      <>
                        わ
                        <span className="pl-0.5 text-[0.72em] opacity-70">0</span>
                      </>
                    ) : (
                      cm
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* 縫い代つきの型紙は、取り込んだ形そのものが裁ち切り線。二重に出しても混乱するだけ */}
      {seam && !seamIncluded && (
        <p className="tnum flex items-center gap-2 text-sm text-ink-500">
          <Icon name="scissors" className="h-4 w-4 shrink-0 text-mat-600" />
          裁ち切りの大きさ{' '}
          <span className="font-bold text-ink-900">
            {(seam.widthMm / 10).toFixed(1)} × {(seam.heightMm / 10).toFixed(1)} cm
          </span>
        </p>
      )}
    </div>
  )
}
