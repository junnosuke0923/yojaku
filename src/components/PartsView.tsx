/**
 * 取り込んだパーツの一覧（第2フェーズ）と、そこから縫い代の画面へ（第3フェーズ）。
 *
 * 名前より先に「枚数」を置いてある（判断2）。
 * 2枚必要なパーツを1枚と数えると、要尺が丸ごと狂うため。
 * 名前は付けなくても計算は進む。
 */

import { useMemo, useState } from 'react'
import { bounds } from '../lib/geom'
import { buildSeam, type SeamResult } from '../lib/seam'
import {
  isReserve, NAME_CHOICES, outlineOf, planOf, type PartsState, type StoredPart,
} from '../lib/store'
import { FabricSetup } from './FabricSetup'
import { Heading, Icon, Note } from './Icon'
import { PatternMarks } from './PatternMarks'
import { SeamEditor } from './SeamEditor'

type Props = {
  state: PartsState
  onChange: (state: PartsState) => void
  onAddMore: () => void
  onLayout: () => void
}

export function PartsView({ state, onChange, onAddMore, onLayout }: Props) {
  const [editing, setEditing] = useState<string | null>(null)

  /*
    後で裁つぶんの余白は、ここには出さない。
    写真から取り込んだものではないし、縫い代も枚数も無い。
    作るのも消すのも「生地に並べる」画面の中だけで完結させる（依頼者の指示）
  */
  const patterns = state.parts.filter((p) => !isReserve(p))

  const patch = (id: string, over: Partial<StoredPart>) =>
    onChange({ ...state, parts: state.parts.map((p) => (p.id === id ? { ...p, ...over } : p)) })

  const part = state.parts.find((p) => p.id === editing)

  if (part) {
    return (
      <section className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="flex items-center gap-1.5 self-start text-sm font-bold text-mat-700"
        >
          <Icon name="back" className="h-4 w-4 shrink-0" />
          パーツの一覧へ
        </button>

        <div className="flex items-center gap-2">
          <Icon name={part.seamIncluded ? 'scissors' : 'seam'} className="h-5 w-5 shrink-0 text-mat-600" />
          <h2 className="text-base font-bold text-ink-900">{part.name}</h2>
          <span className="tnum text-xs text-ink-300">
            {(part.widthMm / 10).toFixed(1)} × {(part.heightMm / 10).toFixed(1)} cm
          </span>
        </div>

        <p className="text-sm leading-relaxed text-ink-500">
          {part.seamIncluded ? (
            <>
              この型紙には<span className="font-bold text-ink-700">もう縫い代が付いている</span>
              ので、足す量は聞きません。
              <br />
              折り山に当てる辺（<span className="font-bold text-seam">わ</span>）だけ選んでください。
            </>
          ) : (
            <>
              型紙は<span className="font-bold text-ink-700">出来上がり線</span>で切ってあるので、
              ここで縫い代を足します。足したぶんだけが
              <span className="font-bold text-cut">青</span>で出ます。
            </>
          )}
          <br />
          <span className="font-bold text-ink-700">辺をそのまま指で押して</span>選べます。
        </p>

        <SeamEditor
          plan={planOf(part)}
          hasNap={state.hasNap}
          name={part.name}
          seamIncluded={part.seamIncluded}
          onChange={(plan) => patch(part.id, { allowancesMm: plan.allowancesMm })}
        />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-5">
      <FabricSetup
        widthMm={state.fabricWidthMm}
        hasNap={state.hasNap}
        onWidth={(fabricWidthMm) => onChange({ ...state, fabricWidthMm })}
        onNap={(hasNap) => onChange({ ...state, hasNap })}
      />

      <Heading
        icon="part"
        right={
          <button
            type="button"
            onClick={onAddMore}
            className="flex shrink-0 items-center gap-1 text-sm font-bold text-mat-700"
          >
            <Icon name="camera" className="h-4 w-4 shrink-0" />
            撮り足す
          </button>
        }
      >
        取り込んだパーツ<span className="tnum pl-2 text-ink-300">{patterns.length}</span>
      </Heading>

      {patterns.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-100 px-4 py-8 text-center text-sm text-ink-300">
          <Icon name="part" className="h-8 w-8" />
          <p>
            まだ1つもありません。
            <br />
            大きいパーツは1枚ずつ、小さいパーツは並べてまとめて撮ってください。
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {patterns.map((p) => (
              <PartRow
                key={p.id}
                part={p}
                hasNap={state.hasNap}
                onOpen={() => setEditing(p.id)}
                onPatch={(over) => patch(p.id, over)}
                onRemove={() =>
                  onChange({ ...state, parts: state.parts.filter((x) => x.id !== p.id) })
                }
              />
            ))}
          </ul>

          {/*
            枚数には二つの意味がある（依頼者の指摘）。
            ここで聞いているのは「できあがりに何枚要るか」。
            裁断のときに置く型紙の数はこれとは別で、二重の生地の上なら1枚で足りる
          */}
          <div className="rounded-xl border border-ink-100 bg-white px-4 py-3">
            <Note>
              ここの枚数は<span className="font-bold text-ink-700">できあがりに必要な数</span>です。
              左右で使うパーツなら 2 枚。
              <br />
              生地に並べるときは、<span className="font-bold text-ink-700">
                二重に重なっているところに型紙を1つ置けば、そのまま2枚とも裁てます
              </span>。だから置く型紙の数は 2 つとは限りません。
            </Note>
          </div>

          {/*
            定規は地の目の「向き」までは教えてくれない。上下対称だから。
            まっすぐ縦にするところまでは自動、どちらが上かは学生に決めてもらう
          */}
          <Note icon="grain">
            地の目は、写真で定規を沿わせた向きから
            <span className="font-bold text-ink-700">自動でまっすぐ縦</span>にしています。
            ただし、どちらが上かまでは写真から決められません。
            {state.hasNap
              ? '向きのある生地では上下が買う長さに効くので、逆さまなら「上下」で直してください。'
              : '向きのない生地なら、上下が逆でも買う長さは変わりません。'}
          </Note>

          <button
            type="button"
            onClick={onLayout}
            className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-3 text-base font-bold text-white active:bg-mat-600"
          >
            <Icon name="layout" className="h-5 w-5 shrink-0" />
            生地の上に並べる →
          </button>
        </>
      )}
    </section>
  )
}

function PartRow({
  part, hasNap, onOpen, onPatch, onRemove,
}: {
  part: StoredPart
  hasNap: boolean
  onOpen: () => void
  onPatch: (over: Partial<StoredPart>) => void
  onRemove: () => void
}) {
  const seam = useMemo(() => buildSeam(planOf(part)), [part])
  const folds = part.allowancesMm.filter((a) => a === 0).length

  return (
    <li className="flex gap-3 rounded-xl border border-ink-100 bg-white p-3">
      <button type="button" onClick={onOpen} className="shrink-0" aria-label={`${part.name}の縫い代`}>
        <Thumb part={part} hasNap={hasNap} seam={seam} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <select
            value={NAME_CHOICES.includes(part.name) ? part.name : ''}
            onChange={(e) => onPatch({ name: e.target.value || part.name })}
            className="min-w-0 flex-1 rounded-lg border border-ink-100 px-2 py-1.5 text-sm"
          >
            <option value="">{part.name}</option>
            {NAME_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 px-1.5 text-ink-300"
            aria-label="このパーツを消す"
          >
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="whitespace-nowrap text-xs text-ink-500">できあがりに</span>
          {[1, 2, 4].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onPatch({ needed: k })}
              className={`tnum rounded-lg px-3 py-1 text-sm font-bold ${
                part.needed === k ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
              }`}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPatch({ flipped: !part.flipped })}
            className="ml-auto flex items-center gap-1 rounded-lg border border-ink-100 px-3 py-1 text-xs font-bold text-ink-700"
            aria-label="地の目の上下を入れかえる"
          >
            <Icon name="flip" className="h-3.5 w-3.5 shrink-0" />
            上下
          </button>
        </div>

        <button type="button" onClick={onOpen} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
          <span className="tnum flex items-center gap-1 text-xs text-ink-500">
            <Icon name="scissors" className="h-3.5 w-3.5 shrink-0" />
            裁ち切り{' '}
            {seam
              ? `${(seam.widthMm / 10).toFixed(1)} × ${(seam.heightMm / 10).toFixed(1)} cm`
              : '—'}
          </span>
          {folds > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold text-seam">
              <Icon name="fold" className="h-3.5 w-3.5 shrink-0" />
              わ {folds}本
            </span>
          )}
          {part.seamIncluded && (
            <span className="text-xs text-ink-300">縫い代つき</span>
          )}
        </button>
      </div>
    </li>
  )
}

/**
 * 一覧に出す小さな絵。
 * 出来上がり線を実線で描き、そこから外へ足された縫い代のぶんだけを青く見せる。
 *
 * 2本の線は必ず buildSeam が返した同じ組を使う。
 * 裁ち切り線だけを buildSeam から取って、出来上がり線を別に持ってくると、
 * 座標の原点が違うので図が横にずれる。
 */
function Thumb({
  part, hasNap, seam,
}: {
  part: StoredPart
  hasNap: boolean
  seam: SeamResult | null
}) {
  const cut = seam?.cutLineMm ?? null
  const outline = seam?.finishedLineMm ?? outlineOf(part)
  const b = bounds(cut ?? outline)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const pad = Math.max(w, h) * 0.06
  const line = Math.max(w, h) * 0.012

  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-24 w-24 rounded-lg bg-chalk"
      role="img"
      aria-hidden="true"
    >
      {cut && (
        <polygon
          points={cut.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="#3F6FA8"
          fillOpacity={0.22}
          stroke="#3F6FA8"
          strokeWidth={line * 0.8}
          strokeLinejoin="round"
        />
      )}
      <polygon
        points={outline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="#FAF7F0"
        stroke="#2b332d"
        strokeWidth={line}
        strokeLinejoin="round"
      />
      <PatternMarks poly={outline} hasNap={hasNap} name={part.name} fontScale={0.13} />
    </svg>
  )
}
