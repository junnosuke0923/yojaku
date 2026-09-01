/**
 * 取り込んだパーツの一覧（第2フェーズ）と、そこから縫い代の画面へ（第3フェーズ）。
 *
 * 名前より先に「枚数」を置いてある（判断2）。
 * 2枚必要なパーツを1枚と数えると、要尺が丸ごと狂うため。
 * 名前は付けなくても計算は進む。
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { PlacedPart } from '../lib/fabric'
import { bounds } from '../lib/geom'
import {
  canOpenFold, cutSizeOf, isReserve, NAME_CHOICES, outlineOf, placedPartOf, planOf,
  type PartsState, type StoredPart, withTurn,
} from '../lib/store'
import { Heading, Hint, Icon } from './Icon'
import { PatternMarks } from './PatternMarks'
import { SeamEditor } from './SeamEditor'
import { Tour } from './Tour'

type Props = {
  state: PartsState
  onChange: (state: PartsState) => void
  /** 「撮り足す」。写真を撮るところへ戻る */
  onAddMore: () => void
  onLayout: () => void
  /**
   * いま撮った写真から見つかった形を、確かめて取り込む帯。
   * 取り込むまでのあいだだけ渡ってくる（App.tsx の `intake`）
   */
  intake?: ReactNode
}

export function PartsView({ state, onChange, onAddMore, onLayout, intake }: Props) {
  const [editing, setEditing] = useState<string | null>(null)

  /*
    後で裁つぶんの余白は、ここには出さない。
    写真から取り込んだものではないし、縫い代も枚数も無い。
    作るのも消すのも「生地に並べる」画面の中だけで完結させる（依頼者の指示）
  */
  const patterns = state.parts.filter((p) => !isReserve(p))

  const patch = (id: string, over: Partial<StoredPart>) =>
    onChange({ ...state, parts: state.parts.map((p) => (p.id === id ? { ...p, ...over } : p)) })

  /** まるごと差しかえる。まわしたときのように、いくつもの値が同時に変わるとき */
  const replace = (next: StoredPart) =>
    onChange({ ...state, parts: state.parts.map((p) => (p.id === next.id ? next : p)) })

  const part = state.parts.find((p) => p.id === editing)
  /** 縫い代の画面で、隣の型紙へ移るための前後 */
  const at = state.parts.findIndex((p) => p.id === editing)
  const prev = at > 0 ? state.parts[at - 1] : null
  const next = at >= 0 && at < state.parts.length - 1 ? state.parts[at + 1] : null

  if (part) {
    return (
      <section className="flex flex-col gap-2.5">
        <Tour id="seam" />
        {/*
          1画面に収めたいので、戻る・名前・隣の型紙への送りを1段にまとめてある
          （依頼者の指示・2026-08-27）。送りは右上。
        */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(null)}
            aria-label="パーツの一覧へ"
            className="flex h-9 w-8 shrink-0 items-center justify-center text-mat-700"
          >
            <Icon name="back" className="h-5 w-5 shrink-0" />
          </button>
          <Icon
            name={part.seamIncluded ? 'scissors' : 'seam'}
            className="h-5 w-5 shrink-0 text-mat-600"
          />
          <h2 className="truncate text-base font-bold text-ink-900">{part.name}</h2>
          <span className="tnum shrink-0 text-xs text-ink-300">
            {(part.widthMm / 10).toFixed(1)} × {(part.heightMm / 10).toFixed(1)}
          </span>

          <div
            data-tour="seam-next"
            className="ml-auto flex shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-white"
          >
            <button
              type="button"
              onClick={() => prev && setEditing(prev.id)}
              disabled={!prev}
              aria-label={prev ? `前の型紙：${prev.name}` : '前の型紙はありません'}
              className="flex h-9 w-10 items-center justify-center text-ink-700 active:bg-chalk disabled:text-ink-100"
            >
              <Icon name="back" className="h-4 w-4 shrink-0" />
            </button>
            {next ? (
              <button
                type="button"
                onClick={() => setEditing(next.id)}
                aria-label={`次の型紙：${next.name}`}
                className="flex h-9 w-10 items-center justify-center border-l border-ink-100 text-ink-700 active:bg-chalk"
              >
                <Icon name="back" className="h-4 w-4 shrink-0 rotate-180" />
              </button>
            ) : (
              /* 最後の1枚まで来たら、そのまま並べるところへ進める */
              <button
                type="button"
                onClick={onLayout}
                aria-label="生地に並べる"
                className="flex h-9 w-10 items-center justify-center border-l border-ink-100 bg-mat-500 text-white active:bg-mat-600"
              >
                <Icon name="layout" className="h-4 w-4 shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/*
          説明はひと言だけ。続きは「？」の中（依頼者の指示・2026-08-27）。
          絵は「？」の印そのものにしてある。この画面には縫い代の絵が
          いくつも出るので、同じ絵を並べない（依頼者の指摘・2026-08-27）
        */}
        {part.seamIncluded ? (
          <Hint icon="fold" summary={<>辺を押して、<b className="text-seam">わ</b>の辺だけ選びます</>}>
            この型紙にはもう縫い代が付いているので、足す量は聞きません。
            折り山に当てる辺だけ教えてください。
          </Hint>
        ) : (
          <Hint summary={<>辺を押して、<b className="text-ink-700">縫い代</b>を決めます</>}>
            型紙は出来上がり線で切ってあるので、ここで縫い代を足します。
            足したぶんだけが青で出ます。縫い代 0 は「ここは折り山（わ）」の意味です。
          </Hint>
        )}

        <SeamEditor
          plan={planOf(part)}
          hasNap={state.hasNap}
          name={part.name}
          seamIncluded={part.seamIncluded}
          turnDeg={part.turnDeg}
          /*
            まわすと外まわりの大きさも変わるので、`withTurn` に通して
            幅と丈を測り直してもらう（依頼者の指示・2026-09-01）
          */
          onTurn={(turnDeg) => replace(withTurn(part, turnDeg))}
          onChange={(plan) => patch(part.id, { allowancesMm: plan.allowancesMm })}
        />

        <OpenFoldOption part={part} onPatch={(over) => patch(part.id, over)} />

      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2.5">
      <Tour id="parts" />

      {/*
        いま撮った写真の確認。取り込むまでのあいだだけ、一覧の上に出る。
        もとは「実寸」という別の段階だった（依頼者の指摘・2026-09-01）
      */}
      {intake}

      {/*
        取り込む前で、まだ1つも無いときは、一覧の見出しごと出さない。
        「取り込んだパーツ 0」と「まだ1つもありません」を確認の帯の下に並べても、
        いま何をすればよいかが薄まるだけ
      */}
      {(patterns.length > 0 || !intake) && (
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
      )}

      {patterns.length === 0 ? (
        !intake && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-100 px-4 py-8 text-center text-sm text-ink-300">
            <Icon name="part" className="h-8 w-8" />
            <p>
              まだ1つもありません。
              <br />
              大きいパーツは1枚ずつ、小さいパーツは並べてまとめて撮ってください。
            </p>
          </div>
        )
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {patterns.map((p, i) => (
              <PartRow
                key={p.id}
                part={p}
                first={i === 0}
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
            裁断のときに置く型紙の数はこれとは別で、二重の生地の上なら1枚で足りる。

            この説明は、はじめて開いたときの案内（Tour.tsx）と同じことを言っている。
            案内を出すようにしたら、こちらは消すこと。いまは案内を止めてあるので置いてある
          */}
          <Hint summary={<>枚数は<b className="text-ink-700">できあがりに必要な数</b>（左右で使うなら 2）</>}>
            二重に重なっているところに型紙を1つ置けば、そのまま2枚とも裁てます。
          </Hint>

          {/*
            定規は地の目の「向き」までは教えてくれない。上下対称だから。
            まっすぐ縦にするところまでは自動、どちらが上かは学生に決めてもらう。

            この文は前まで、生地に上下の向きがあるかどうかで言い分けていた。
            その設定が「生地」の画面（この次）へ移った（依頼者の指示・2026-09-01）ので、
            まだ決まっていない。だから向きの話はせず、直し方だけを言う
          */}
          <Hint
            icon="grain"
            summary={<>向きがちがっていたら、<b className="text-ink-700">パーツを開いてまわせます</b></>}
          >
            定規は上下対称なので、どちらが上かまでは写真から決められません。
            地の目の縦横をとりちがえて撮ってしまったときも、撮り直さずに直せます。
            パーツを押して開くと、図の右上につまみが出ます。
          </Hint>

          <button
            type="button"
            data-tour="to-layout"
            onClick={onLayout}
            className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-2.5 text-base font-bold text-white active:bg-mat-600"
          >
            <Icon name="cloth" className="h-5 w-5 shrink-0" />
            生地を決める →
          </button>
        </>
      )}
    </section>
  )
}

/**
 * カードに出す、いまの縫い代のようす。
 *
 * 足す量として数えるのは 0 より大きい辺だけ。
 * 0 は「わ」（折り山に当てる）、負の値は「型紙にもう付いている」という印で、
 * どちらも足す量ではないので、cm の幅の話からは外す（lib/seam.ts を参照）
 */
function seamSummary(part: StoredPart): string {
  const add = part.allowancesMm.filter((a) => a > 0)
  const cm = (v: number) => (v / 10).toFixed(1)
  if (add.length === 0) return part.seamIncluded ? '型紙についている' : 'なし'
  const lo = Math.min(...add)
  const hi = Math.max(...add)
  return lo === hi ? `${cm(lo)} cm` : `${cm(lo)}〜${cm(hi)} cm`
}

/** 置く形の、外まわりの大きさ(mm) */
const sizeOf = (placed: PlacedPart) => {
  const b = bounds(placed.cutLineMm)
  return { widthMm: b.maxX - b.minX, heightMm: b.maxY - b.minY }
}

/**
 * 「わ」の辺を、生地の折り山に当てるか、開いて幅を倍にして裁つか（依頼者の指示）。
 *
 * ベルトでよく起きる。型紙は出来上がり幅で描いてあるが、
 * 裁つときは長い辺で折るぶんを見込んで幅を倍にすることがある。
 * どちらも同じ布になるので、選べるようにしてある。
 *
 * 「わ」の辺が無いパーツには関係がないので、そのときは何も出さない。
 * 使わない設定を並べても、画面が重くなるだけ。
 */
function OpenFoldOption({
  part, onPatch,
}: {
  part: StoredPart
  onPatch: (over: Partial<StoredPart>) => void
}) {
  const open = part.openFold === true
  // 選んでいないほうの大きさも要る。「開くとどうなるか」を先に見せたいので
  const opened = useMemo(() => placedPartOf({ ...part, openFold: true }), [part])
  const plain = useMemo(() => cutSizeOf({ ...part, openFold: false }), [part])

  if (!canOpenFold(part)) return null

  const size = opened ? sizeOf(opened) : null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2">
      {/*
        1画面に収めたいので、選ぶところだけを1段にしてある（依頼者の指示・2026-08-27）。
        説明は、ふつうでないほう（開いて裁つ）を選んだときにだけ出す
      */}
      <div className="flex items-center gap-2">
        <Icon name="fold" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="shrink-0 text-sm font-bold text-ink-700">「わ」の辺は</span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-ink-100">
          <button
            type="button"
            onClick={() => onPatch({ openFold: false })}
            className={`px-3 py-2 text-xs font-bold ${
              !open ? 'bg-mat-500 text-white' : 'text-ink-700'
            }`}
          >
            折り山に当てる
          </button>
          <button
            type="button"
            onClick={() => onPatch({ openFold: true })}
            className={`border-l border-ink-100 px-3 py-2 text-xs font-bold ${
              open ? 'bg-mat-500 text-white' : 'text-ink-700'
            }`}
          >
            開いて裁つ
          </button>
        </div>
      </div>

      {open && (
        <>
          {opened && <OpenedPreview placed={opened} />}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <Icon name="scissors" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
            <span className="min-w-0 flex-1">
              「わ」の辺で左右に開いた形で置きます。生地は折らなくてかまいません。
              {size && (
                <>
                  {' '}裁ち切り{' '}
                  <span className="tnum font-bold text-ink-900">
                    {(size.widthMm / 10).toFixed(1)} × {(size.heightMm / 10).toFixed(1)} cm
                  </span>
                  {plain && (
                    <span className="tnum text-ink-300">
                      {' '}（当てるなら {(plain.widthMm / 10).toFixed(1)} ×{' '}
                      {(plain.heightMm / 10).toFixed(1)}）
                    </span>
                  )}
                </>
              )}
            </span>
          </p>
        </>
      )}
    </div>
  )
}

/** 開いたあとの形。数字だけでは、どちらに倍になったのか分からない */
function OpenedPreview({ placed }: { placed: PlacedPart }) {
  const b = bounds(placed.cutLineMm)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const pad = Math.max(w, h) * 0.05
  const line = Math.max(w, h) * 0.008

  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="max-h-40 w-full rounded-lg bg-table"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="開いたあとの形"
    >
      <polygon
        points={placed.cutLineMm.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="#3F6FA8" fillOpacity={0.22} stroke="#3F6FA8" strokeWidth={line}
      />
      <polygon
        points={placed.finishedLineMm.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="#FAF7F0" stroke="#2b332d" strokeWidth={line * 1.4}
      />
      {/*
        真ん中に通る折り線（依頼者の質問・2026-08-28）。
        一点鎖線で引かないと、ただの幅広の紙に見えて、
        「わ」の線を軸に左右へ開いた形だということが伝わらない
      */}
      {placed.centerLineMm && (
        <path
          d={`M${placed.centerLineMm.a.x.toFixed(1)} ${placed.centerLineMm.a.y.toFixed(1)}`
            + ` L${placed.centerLineMm.b.x.toFixed(1)} ${placed.centerLineMm.b.y.toFixed(1)}`}
          fill="none" stroke="#2b332d" strokeWidth={line}
          strokeDasharray={`${line * 8} ${line * 3} ${line * 1.2} ${line * 3}`}
        />
      )}
    </svg>
  )
}

function PartRow({
  part, hasNap, first, onOpen, onPatch, onRemove,
}: {
  part: StoredPart
  hasNap: boolean
  /** はじめて開いたときの案内は、先頭の1行だけを指す */
  first?: boolean
  onOpen: () => void
  onPatch: (over: Partial<StoredPart>) => void
  onRemove: () => void
}) {
  /*
    一覧に出すのは「生地の上で実際に置く形」。
    「わ」で開いて裁つ設定なら、そのぶん倍になった形でないと絵も数字も合わない
  */
  const placed = useMemo(() => placedPartOf(part), [part])
  const size = placed ? sizeOf(placed) : null
  const folds = part.allowancesMm.filter((a) => a === 0).length
  const opened = part.openFold === true && folds > 0
  const seam = seamSummary(part)

  return (
    <li
      data-tour={first ? 'part-row' : undefined}
      className="flex gap-3 rounded-xl border border-ink-100 bg-white p-3"
    >
      <button type="button" onClick={onOpen} className="shrink-0" aria-label={`${part.name}の縫い代`}>
        <Thumb part={part} hasNap={hasNap} placed={placed} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* 1画面に近づけるため、行を折り返させない（依頼者の指示・2026-08-27） */}
        <div className="flex items-center gap-1.5">
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
            className="flex h-8 w-6 shrink-0 items-center justify-center text-ink-300"
            aria-label="このパーツを消す"
          >
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <Icon name="part" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
          {[1, 2, 4].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onPatch({ needed: k })}
              className={`tnum rounded-lg px-2.5 py-1 text-sm font-bold ${
                part.needed === k ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
              }`}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpen}
            className="tnum ml-auto flex min-w-0 items-center gap-1 truncate text-[11px] text-ink-500"
          >
            <Icon name="scissors" className="h-3.5 w-3.5 shrink-0" />
            {size
              ? `${(size.widthMm / 10).toFixed(1)} × ${(size.heightMm / 10).toFixed(1)}`
              : '—'}
          </button>
        </div>

        {/*
          縫い代の画面への入口（依頼者の指摘・2026-09-01
          「一度そのパートをタップしないと縫い代付けの中に入っていけないのが、
            もしかしたら分かりづらいのかも」）。

          もともと絵も大きさもこの行も押せば開いたのだが、
          **押せると分かる印が何も無かった**。名前と枚数だけ決めて、
          縫い代を一度も見ないまま次へ進めてしまう。

          そこで、行き先の矢じりを付けたうえで、いまの縫い代を文字で出す。
          既定は全辺 1cm なので、開かなくても計算自体は進む——
          だからこそ「1.0 cm のまま」と見えていないと、
          裾を 3cm にする、「わ」の辺を 0 にする、といった直す機会に気づけない。
          禁じたり止めたりはせず、いまどうなっているかを言うだけにしてある
        */}
        <button
          type="button"
          onClick={onOpen}
          className="-mx-1 flex items-center gap-1.5 rounded-b-lg border-t border-ink-100 px-1 pt-2 pb-0.5 text-left active:bg-table"
        >
          <Icon name="seam" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
          <span className="min-w-0 truncate text-[11px] font-bold text-ink-700">
            縫い代を決める
          </span>
          {folds > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-seam">
              <Icon name="fold" className="h-3.5 w-3.5 shrink-0" />
              {opened ? 'わで開いて裁つ' : `わ ${folds}本`}
            </span>
          )}
          <span className="tnum ml-auto shrink-0 text-[11px] text-ink-500">{seam}</span>
          <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300" />
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
  part, hasNap, placed,
}: {
  part: StoredPart
  hasNap: boolean
  placed: PlacedPart | null
}) {
  const cut = placed?.cutLineMm ?? null
  const outline = placed?.finishedLineMm ?? outlineOf(part)
  const b = bounds(cut ?? outline)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const pad = Math.max(w, h) * 0.06
  const line = Math.max(w, h) * 0.012

  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-20 w-20 rounded-lg bg-table"
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
