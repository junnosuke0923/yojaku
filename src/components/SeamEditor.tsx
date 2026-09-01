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

import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { bounds } from '../lib/geom'
import { applyToAll, buildSeam, SEAM_INCLUDED_MM, SEAM_STEPS_CM, type SeamPlan } from '../lib/seam'
import { isSquare, squaredTurn } from '../lib/store'
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
   * まわしてある角度（度）。時計まわりが正。
   *
   * **地の目線は縦のまま動かさず、形だけがその下でまわる。**
   * このアプリでは実寸の座標系の縦が地の目そのものなので、
   * 学生の手つきは「地の目線が実物の型紙の地の目線と重なるまで、形をまわす」になる。
   */
  turnDeg: number
  onTurn: (turnDeg: number) => void
  /**
   * 取り込んだ型紙に、もう縫い代が付いているか。
   * 付いているなら足す量は聞かず、「わ」の辺の指定だけになる。
   */
  seamIncluded: boolean
}

/** 番号のふきだしを、辺からどれだけ外へ押し出すか(mm) */
const LABEL_PUSH_MM = 22

export function SeamEditor({ plan, onChange, hasNap, name, seamIncluded, turnDeg, onTurn }: Props) {
  const [selected, setSelected] = useState(0)
  const [bulkCm, setBulkCm] = useState(1)
  /** 一覧に無い幅を、自分で入れる欄。cm。空なら「まだ入れていない」 */
  const [freeCm, setFreeCm] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const seam = useMemo(() => buildSeam(plan), [plan])

  const view = useMemo(() => {
    const all = seam ? [...seam.cutLineMm, ...seam.finishedLineMm] : plan.path.points
    const b = bounds(all)
    const pad = LABEL_PUSH_MM + 30
    return {
      x: b.minX - pad, y: b.minY - pad,
      w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2,
      // まわすつまみと、まわす軸の置きどころに使う
      right: b.maxX, top: b.minY,
      cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2,
      // 出来上がり線を、裁ち切り線と同じ原点へずらすための差
      dx: seam ? seam.finishedLineMm[0].x - plan.path.points[0].x : 0,
      dy: seam ? seam.finishedLineMm[0].y - plan.path.points[0].y : 0,
    }
  }, [seam, plan])

  /*
    まわす操作（依頼者の指示・2026-09-01）。

    **直角へは吸い付かせない。** はじめは吸い付かせるつもりでいたが、
    この道具でいちばん多い使い道は「定規の枠が少しずれて、数度だけ斜めに
    取り込まれた形を直す」ことなので、直角の近くを吸い込んでしまうと
    その数度がそもそも入れられなくなる。
    きっちりした 90 度は下の押しボタンで出す。つまみは細かい直しのためのもの。

    つまみは型紙の外に置いてある。この画面は**辺を押して選ぶ**画面なので、
    形そのものを指でひねらせると、押しと引きずりを見分けることになる。
    つまむ場所を分けておけば、その見分けが要らない。
  */
  const svgRef = useRef<SVGSVGElement>(null)
  /** つまみを持った時点の、指の角度と、そのときの回転量 */
  const turning = useRef<{ from: number; base: number } | null>(null)

  /** 画面の位置を、図の中の位置（mm）に直す */
  /**
   * 画面の指の位置を、図の中の座標（mm）に直す。
   *
   * 枠の左上からの割合で割り算してはいけない。
   * 図には高さの上限があるので、縦長の型紙では**絵が枠の中で横に寄せて置かれる**。
   * 割合で割ると、その余白のぶんだけ指の位置がずれる
   * （四つ角をつまんでも、どの角にも届かなかった）。
   * ブラウザが実際に使っている変換（`getScreenCTM`）で戻せば、
   * 余白があっても寄せて置かれていても、そのまま合う
   */
  const atSvg = (e: PointerEvent) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  /** -180 度から 180 度のあいだに直す。何周も回っても数が育たないように */
  const norm = (deg: number) => ((deg % 360) + 540) % 360 - 180

  const turnStart = (e: PointerEvent) => {
    const at = atSvg(e)
    if (!at) return
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 捕まえられなくてよい */ }
    turning.current = { from: Math.atan2(at.y - view.cy, at.x - view.cx), base: turnDeg }
  }

  const turnMove = (e: PointerEvent) => {
    if (!turning.current) return
    const at = atSvg(e)
    if (!at) return
    const now = Math.atan2(at.y - view.cy, at.x - view.cx)
    onTurn(norm(turning.current.base + ((now - turning.current.from) * 180) / Math.PI))
  }

  const turnEnd = () => { turning.current = null }

  /**
   * 辺を選び直す。自分で入れた数字は、そのつど空にする。
   * 別の辺を選んだのに前の辺の数字が残っていると、
   * いま出ている幅と欄の数字が食い違って見えるため
   */
  const pick = (groupIndex: number) => {
    setSelected(groupIndex)
    setNote(null)
    setFreeCm('')
  }

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
  /** いまの幅が、決まった札のどれでもない＝自分で決めた辺 */
  const isCustom =
    currentMm > 0 && !SEAM_STEPS_CM.some((c) => Math.abs(currentMm - c * 10) < 0.01)

  /**
   * 一覧に無い幅を、選んでいる辺だけに付ける（依頼者の指示・2026-08-27）。
   *
   * 決まった札だけだと、1.8 cm のような指定が出たときに入れる場所が無い。
   * かといって札を増やすと、いつも使う 1 cm や 1.5 cm が探しにくくなる。
   * めったに使わない数値は、この欄へ逃がしてある。
   *
   * 1 mm 刻みに丸める。それより細かい指定は、裁つときに意味を持たない。
   * 0 と入れたら「わ」になる。札の「わ 0」と同じ扱い
   */
  const applyFree = () => {
    const cm = Number(freeCm)
    if (freeCm.trim() === '' || !Number.isFinite(cm)) return
    setAllowance(selected, Math.round(Math.min(20, Math.max(0, cm)) * 10))
    setFreeCm('')
  }

  /**
   * 「わ」の辺に付ける、作図の記号（依頼者の指示・2026-08-27）。
   *
   * ◎ を半分にした形——同じ中心の半円を二重に、辺の上に伏せて描く。
   * 学校の作図では、これが「この辺は折り山（わ）」を表す決まった印なので、
   * 文字より先に、この形で読み取れるようにしておく。
   *
   * 平らな側を辺に伏せ、まるいほうは型紙の内側へふくらませる。
   * 辺の向きは `outward`（外向きの法線）から出す。
   * 辺に沿う向きを t = (outward.y, -outward.x) に取ると、
   * SVG の弧を sweep=1 で引いたときに内側へふくらむ。
   */
  const foldMark = (g: (typeof plan.groups)[number]) => {
    const cx = g.midpoint.x + view.dx
    const cy = g.midpoint.y + view.dy
    const tx = g.outward.y
    const ty = -g.outward.x
    // 短い辺で大きく描くと、辺からはみ出して別の形に見える
    const R = Math.min(15, g.lengthMm * 0.3)
    if (R < 4) return null
    const half = (rr: number) =>
      `M${(cx - tx * rr).toFixed(1)} ${(cy - ty * rr).toFixed(1)}`
      + ` A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1`
      + ` ${(cx + tx * rr).toFixed(1)} ${(cy + ty * rr).toFixed(1)}`
    return (
      <g key={`wa-${g.no}`} fill="none" stroke="#2b332d" strokeWidth={2}>
        <path d={half(R)} />
        <path d={half(R * 0.48)} />
      </g>
    )
  }

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
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        data-tour="seam-figure"
        className="w-full rounded-xl border border-ink-100 bg-table"
        style={{
          aspectRatio: `${view.w} / ${view.h}`,
          // 下に置く操作のぶんを引いた残り。自分で決める欄がある画面は、そのぶん深く引く
          // まわす操作の1段ぶん（3rem）を足して引く
          maxHeight: `max(140px, min(34vh, calc(100dvh - ${seamIncluded ? '36rem' : '38.5rem'})))`,
          touchAction: 'none',
        }}
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

        {/* 「わ」の辺に付ける作図の記号。地の目線より後に描いて、隠れないようにする */}
        {plan.groups.map((g, gi) => (plan.allowancesMm[gi] === 0 ? foldMark(g) : null))}

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
            onPointerDown={() => pick(gi)}
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
              onPointerDown={() => pick(gi)}
            >
              <circle cx={cx} cy={cy} r={14} fill={on ? '#b4433a' : '#ffffff'}
                stroke={on ? '#b4433a' : '#9aa69e'} strokeWidth={1.6} />
              <text x={cx} y={cy + 6} textAnchor="middle" fontSize={17}
                fill={on ? '#ffffff' : '#5c665f'} fontWeight={700}>
                {g.no}
              </text>
              {/*
                「わ」の字は、さらに外へ押し出す。
                番号のふきだしの真下に置くと、辺に付けた わ の記号に重なる
              */}
              {mm === 0 && (
                <text
                  x={cx + g.outward.x * 24} y={cy + g.outward.y * 24 + 6}
                  textAnchor="middle" fontSize={15} fill="#2b332d"
                >
                  わ
                </text>
              )}
            </g>
          )
        })}
        {/*
          まわすつまみ。型紙の右上の外に置いてある。

          番号のふきだしは辺の**まん中**から外へ出るので、角のあたりは空いている。
          そこへ置けば、番号を押すつもりの指がつまみに当たることがない
        */}
        {(() => {
          // 図のまわりの余白は 52mm。つまみの半径 15 を足しても、はみ出さない位置
          const hx = view.right + 26
          const hy = view.top - 26
          const held = turnDeg !== 0
          const color = held ? '#b4433a' : '#5c665f'
          return (
            <g
              style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={turnStart}
              onPointerMove={turnMove}
              onPointerUp={turnEnd}
              onPointerCancel={turnEnd}
              role="button"
              tabIndex={0}
              aria-label="型紙をまわす"
            >
              {/* 軸とつまみを結ぶ線。どこを軸にまわるのかが分かる */}
              <line
                x1={view.cx} y1={view.cy} x2={hx} y2={hy}
                stroke={color} strokeOpacity={0.28} strokeWidth={1.4} strokeDasharray="5 5"
              />
              {/* 指で当てやすいように、見えない広い下地を敷く */}
              <circle cx={hx} cy={hy} r={26} fill="transparent" />
              <circle cx={hx} cy={hy} r={15} fill="#ffffff" stroke={color} strokeWidth={2} />
              {/* まわる向きの矢。四分の三の弧に、先端の三角をひとつ */}
              <path
                d={`M${hx} ${hy - 8} A8 8 0 1 1 ${hx - 8} ${hy}`}
                fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round"
              />
              <path d={`M${hx - 11.4} ${hy - 3} L${hx - 4.6} ${hy - 3} L${hx - 8} ${hy + 3.6} Z`} fill={color} />
            </g>
          )
        })()}
      </svg>

      {/*
        まわす操作の段。

        90 度ずつの押しボタンと、まっすぐでなくなったときだけ出る戻り道。
        つまみ（図の上）は細かい直し、この押しボタンはきっちりした直角、
        と役目を分けてある。小さい折り図の「押す／引きずる」と同じ二段構え
      */}
      <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2">
        <Icon name="grain" className="h-4 w-4 shrink-0 text-ink-300" />
        <span className="min-w-0 flex-1 text-xs leading-tight text-ink-300">
          {isSquare(turnDeg)
            ? '地の目線に合うまで、右上のつまみでまわせます'
            : '斜めに直してあります'}
        </span>
        <button
          type="button"
          onClick={() => onTurn(((turnDeg - 90) % 360 + 540) % 360 - 180)}
          aria-label="左へ90度まわす"
          className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-100 text-ink-700 active:bg-chalk"
        >
          <Icon name="turnLeft" className="h-4 w-4 shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => onTurn(((turnDeg + 90) % 360 + 540) % 360 - 180)}
          aria-label="右へ90度まわす"
          className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-100 text-ink-700 active:bg-chalk"
        >
          <Icon name="turnRight" className="h-4 w-4 shrink-0" />
        </button>
        {/* 回しすぎたときの帰り道。まっすぐなときは出さない */}
        {!isSquare(turnDeg) && (
          <button
            type="button"
            onClick={() => onTurn(squaredTurn(turnDeg))}
            className="shrink-0 rounded-lg border border-ink-100 px-2 py-1.5 text-xs font-bold text-ink-700 active:bg-chalk"
          >
            直角に戻す
          </button>
        )}
      </div>

      {/*
        まとめてと、1本ずつ。もとは別々の枠だったが、
        1画面に収めたいので同じ枠に入れてある（依頼者の指示・2026-08-27）
      */}
      <div className="rounded-xl border border-ink-100 bg-white px-4 py-3">
        {!seamIncluded && (
          <div data-tour="seam-bulk" className="flex items-center gap-3 border-b border-ink-100 pb-3">
            {/* 絵は付けない。この画面には縫い代の絵がすでに出ている（依頼者の指摘・2026-08-27） */}
            <span className="shrink-0 text-sm font-bold text-ink-700">まとめて</span>
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
            <div data-tour="seam-steps" className="grid grid-cols-2 gap-2">
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
            <div data-tour="seam-steps" className="grid grid-cols-6 gap-1.5">
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

            {/*
              札に無い幅は、ここに直接入れる（依頼者の指示・2026-08-27）。
              いま入っている幅が札のどれでもないときは、この欄を縫い代の色にして、
              「その数字はここから来ている」と分かるようにしてある
            */}
            <form
              onSubmit={(e) => { e.preventDefault(); applyFree() }}
              className="mt-2 flex items-center gap-2 border-t border-ink-100 pt-2"
            >
              <span className="shrink-0 text-xs font-bold text-ink-500">自分で決める</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                max={20}
                value={freeCm}
                onChange={(e) => setFreeCm(e.target.value)}
                placeholder={isCustom ? (currentMm / 10).toFixed(1) : '1.8'}
                aria-label="縫い代の幅（cm）"
                className={`tnum w-16 rounded-lg border px-2 py-1.5 text-center text-base ${
                  isCustom ? 'border-seam font-bold text-seam' : 'border-ink-100'
                }`}
              />
              <span className="text-sm text-ink-500">cm</span>
              <button
                type="submit"
                className="ml-auto shrink-0 rounded-lg border border-mat-500 px-3 py-1.5 text-sm font-bold text-mat-700 active:bg-mat-50"
              >
                この辺に付ける
              </button>
            </form>
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
