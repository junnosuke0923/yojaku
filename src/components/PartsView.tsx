/**
 * 取り込んだパーツの一覧（第2フェーズ）と、そこから縫い代の画面へ（第3フェーズ）。
 *
 * 名前より先に「枚数」を置いてある（判断2）。
 * 2枚必要なパーツを1枚と数えると、要尺が丸ごと狂うため。
 * 名前は付けなくても計算は進む。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PlacedPart } from '../lib/fabric'
import { bounds } from '../lib/geom'
import {
  canOpenFold, cutSizeOf, isReserve, NAME_CHOICES, outlineOf, placedPartOf, planOf,
  type PartsState, type StoredPart, withTurn,
} from '../lib/store'
import { Heading, Hint, Icon } from './Icon'
import { PatternMarks } from './PatternMarks'
import { SeamEditor, TurnRow } from './SeamEditor'
import { T } from './TextTools'
import { Tour } from './Tour'

/** 枚数の上限。これ以上要る型紙は、まず見かけない */
const MAX_NEEDED = 12
/** 名前の一覧のいちばん下に置く、じぶんで打つための札 */
const OWN_NAME = '__own'

type Props = {
  state: PartsState
  onChange: (state: PartsState) => void
  /** 開発用：この型紙の縫い代の画面を、開いた状態で始める */
  onAddMore: () => void
  onLayout: () => void
}

export function PartsView({ state, onChange, onAddMore, onLayout }: Props) {
  /*
    後で裁つぶんの余白は、ここには出さない。
    写真から取り込んだものではないし、縫い代も枚数も無い。
    作るのも消すのも「生地に並べる」画面の中だけで完結させる（依頼者の指示）
  */
  const patterns = state.parts.filter((p) => !isReserve(p))

  /**
   * いま開いている型紙。**はじめから1つ目が開いている**（依頼者の指示・2026-09-01）。
   *
   * もとは一覧と編集画面が別々で、カードを押して中に入る作りだった。
   * 依頼者の指摘——「一度そのパートをタップしないと縫い代付けの中に
   * 入っていけないんですけれども、これがもしかしたら分かりづらいのかも」。
   *
   * はじめは矢じりを付けて**入口を見えるように**しただけだったが、
   * それでも「入る」という動作そのものは残っていた。
   * そこで入るのをやめ、**その場で開く**ことにした。
   * 画面を開いた瞬間に縫い代のパネルが目に入るので、
   * ここが何をするところなのかが、字ではなく絵で分かる。
   *
   * 全部を開いたままにはしない。パネル1つで縦 736px あり（実測）、
   * 3つ並べれば 2100px を超えて、一覧としては読めなくなる。
   * 開くのは1つだけで、ほかは畳んだ行のまま置く。
   * もう一度押せば閉じられるので、多いときは全部畳んで見渡せる。
   *
   * この画面に入り直すたびに1つ目から開く。
   * 「撮り足す」で戻ってきたときも同じで、
   * どこを開いていたかを覚えているより、いつも同じ形で始まるほうが迷わない
   */
  const [openId, setOpenId] = useState<string | null>(() => patterns[0]?.id ?? null)

  const patch = (id: string, over: Partial<StoredPart>) =>
    onChange({ ...state, parts: state.parts.map((p) => (p.id === id ? { ...p, ...over } : p)) })

  /** まるごと差しかえる。まわしたときのように、いくつもの値が同時に変わるとき */
  const replace = (next: StoredPart) =>
    onChange({ ...state, parts: state.parts.map((p) => (p.id === next.id ? next : p)) })

  return (
    <section className="flex flex-col gap-2.5">
      <Tour id="parts" />
      <Heading
        icon="part"
        right={
          <button
            type="button"
            onClick={onAddMore}
            className="tap flex shrink-0 items-center gap-1 text-sm font-bold text-mat-700"
          >
            <Icon name="camera" className="h-4 w-4 shrink-0" />
            撮り足す
          </button>
        }
      >
        {/*
          数だけを並べると「パーツ3」という名前に読める（学生の点検・2026-09-02）。
          単位を付けて、数であることを言い切る
        */}
        取り込んだパーツ
        <span className="tnum pl-2 text-ink-300">{patterns.length} 個</span>
      </Heading>

      {patterns.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-100 px-4 py-8 text-center text-sm text-ink-300">
          <Icon name="part" className="h-8 w-8" />
          <p>
            <T id="parts.empty" />
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {patterns.map((p, i) => (
              <PartRow
                key={p.id}
                part={p}
                first={i === 0}
                hasNap={state.hasNap}
                open={p.id === openId}
                onOpen={() => setOpenId(p.id === openId ? null : p.id)}
                onPatch={(over) => patch(p.id, over)}
                onRemove={() =>
                  onChange({ ...state, parts: state.parts.filter((x) => x.id !== p.id) })
                }
                body={p.id === openId ? (
                  <SeamBody
                    part={p}
                    hasNap={state.hasNap}
                    onPatch={(over) => patch(p.id, over)}
                    onReplace={replace}
                  />
                ) : null}
                nav={p.id === openId && patterns.length > 1 ? (
                  <PartNav
                    index={i}
                    total={patterns.length}
                    onGo={(n) => { const t = patterns[n]; if (t) setOpenId(t.id) }}
                    onNext={onLayout}
                  />
                ) : null}
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
          <Hint summary={<T id="parts.count.summary" />}>
            <T id="parts.count.body" />
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
            summary={<T id="parts.turn.summary" />}
          >
            <T id="parts.turn.body" />
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
            わにしない
          </button>
        </div>
      </div>

      {open && (
        <>
          {opened && <OpenedPreview placed={opened} />}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <Icon name="scissors" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
            <span className="min-w-0 flex-1">
              <T id="parts.opened.note" />
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

/**
 * 開いているカードの中身。辺を押して、その辺の縫い代を決めるところ。
 *
 * もとは画面ごと切りかわる作りで、ここに戻る・名前・前後の型紙への送りが
 * 並んでいた。カードの中に置いたので、そのどれも要らなくなった——
 * 名前と大きさはカードの頭にもう出ているし、
 * 隣の型紙へは、その行を押せば開く
 */
function SeamBody({ part, hasNap, onPatch, onReplace }: {
  part: StoredPart
  hasNap: boolean
  onPatch: (over: Partial<StoredPart>) => void
  onReplace: (next: StoredPart) => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <Tour id="seam" />

      {/*
        説明はひと言だけ。続きは「？」の中（依頼者の指示・2026-08-27）。
        絵は「？」の印そのものにしてある。ここには縫い代の絵が
        いくつも出るので、同じ絵を並べない（依頼者の指摘・2026-08-27）
      */}
      {part.seamIncluded ? (
        <Hint icon="fold" summary={<T id="parts.seam.included.summary" />}>
          <T id="parts.seam.included.body" />
        </Hint>
      ) : (
        <Hint summary={<T id="parts.seam.add.summary" />}>
          <T id="parts.seam.add.body" />
        </Hint>
      )}

      <SeamEditor
        plan={planOf(part)}
        hasNap={hasNap}
        name={part.name}
        seamIncluded={part.seamIncluded}
        turnDeg={part.turnDeg}
        /*
          まわすと外まわりの大きさも変わるので、`withTurn` に通して
          幅と丈を測り直してもらう（依頼者の指示・2026-09-01）
        */
        onTurn={(turnDeg) => onReplace(withTurn(part, turnDeg))}
        onChange={(plan) => onPatch({ allowancesMm: plan.allowancesMm })}
      />

      <OpenFoldOption part={part} onPatch={onPatch} />

      {/*
        まわす操作は、縫い代の話がぜんぶ済んだいちばん下に置く
        （依頼者の指摘・2026-09-04）。
        この画面のいちばんの仕事は縫い代を付けることなので、
        図とその操作のあいだに割り込ませない
      */}
      <TurnRow
        turnDeg={part.turnDeg}
        onTurn={(turnDeg) => onReplace(withTurn(part, turnDeg))}
      />
    </div>
  )
}

function PartRow({
  part, hasNap, first, open, body, nav, onOpen, onPatch, onRemove,
}: {
  part: StoredPart
  hasNap: boolean
  /** はじめて開いたときの案内は、先頭の1行だけを指す */
  first?: boolean
  /** いまこのカードが開いているか */
  open: boolean
  /** 開いているときに、カードの中に出すもの（縫い代のパネル） */
  body: ReactNode
  /** カードのいちばん上に置く、隣のパーツへの行き来 */
  nav?: ReactNode
  onOpen: () => void
  onPatch: (over: Partial<StoredPart>) => void
  onRemove: () => void
}) {
  const liRef = useRef<HTMLLIElement>(null)
  const wasOpen = useRef(open)
  /**
   * 一覧に無い名前を、じぶんで打っているところ（学生の点検・2026-09-02）。
   *
   * 候補は11個しか無いので、「一覧にない名前は付けられません」という報告があった。
   * 手書きの認識は作らない（判断2）ので押して選ぶのが基本だが、
   * 打つ道はふさがない。名前は計算に効かないので、何を入れてもよい
   */
  const [naming, setNaming] = useState(false)
  /**
   * 打ち込みに入る直前の名前。取り消しと、空のまま出たときの戻し先。
   *
   * 「じぶんで入れる…」に入ると、一覧へ戻る道が無く、
   * 名前を空にしたまま出ることもできた（学生の点検・2026-09-02・2巡目）。
   * 名前が空になると図の中の札まで空になるので、黙って元に戻す
   */
  const nameBefore = useRef('')
  const stopNaming = (keep: boolean) => {
    if (!keep || part.name.trim() === '') onPatch({ name: nameBefore.current })
    setNaming(false)
  }

  /*
    別のカードを開くと、上で開いていたぶんが畳まれて中身が上へ動く。
    押した行が画面の外へ逃げてしまうので、開いたほうを画面に呼び戻す。
    はじめから開いている1つ目では動かさない（もう画面の上にいる）
  */
  useEffect(() => {
    if (open && !wasOpen.current) {
      liRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    wasOpen.current = open
  }, [open])

  /*
    一覧に出すのは「生地の上で実際に置く形」。
    「わ」で開いて裁つ設定なら、そのぶん倍になった形でないと絵も数字も合わない
  */
  const placed = useMemo(() => placedPartOf(part), [part])
  const size = placed ? sizeOf(placed) : null
  const folds = part.allowancesMm.filter((a) => a === 0).length
  const opened = part.openFold === true && folds > 0
  const seam = seamSummary(part)

  /**
   * 枚数の増減。**開いているあいだは名前の行に入れ、閉じているあいだは自分の行に出す。**
   *
   * 名前の一覧は最長でも「スカート前」の5文字なので、名前の右は大きく余っている
   * （依頼者の指示・2026-09-05「パーツ名はそれほど長くなるわけではないので、
   * 横長にする必要はありません」）。そこへ枚数を入れると、
   * 開いた頭が3行から2行になり、縫い代のパネルがそのぶん上がる。
   *
   * 名前をじぶんで打ち込んでいるあいだだけは、入力欄と「やめる」で行が埋まるので、
   * 閉じているときと同じように自分の行へ落とす
   */
  const count = (
    <>
      {/*
        1 / 2 / 4 の3つだけ選べる形だった（学生の点検・2026-09-02
        「3枚要るときはどうするのか分かりませんでした」）。
        三段スカートの段、フリル、共布のループなど、3枚も5枚もふつうにある。
        押す場所はむしろ減るので、1画面に収める方針とも喧嘩しない
      */}
      <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-ink-100">
        <button
          type="button"
          disabled={part.needed <= 1}
          onClick={() => onPatch({ needed: Math.max(1, part.needed - 1) })}
          aria-label="枚数を減らす"
          className="tap px-3 py-1.5 text-sm font-bold text-ink-500 disabled:opacity-25"
        >
          −
        </button>
        <span className="tnum min-w-6 text-center text-sm font-bold text-ink-900">
          {part.needed}
        </span>
        <button
          type="button"
          disabled={part.needed >= MAX_NEEDED}
          onClick={() => onPatch({ needed: Math.min(MAX_NEEDED, part.needed + 1) })}
          aria-label="枚数を増やす"
          className="tap px-3 py-1.5 text-sm font-bold text-ink-500 disabled:opacity-25"
        >
          ＋
        </button>
      </span>
      <span className="shrink-0 text-[11px] text-ink-300">枚</span>
    </>
  )

  return (
    <li
      ref={liRef}
      data-tour={first ? 'part-row' : undefined}
      className={`flex flex-col rounded-xl border bg-white p-3 ${
        open ? 'border-mat-500' : 'border-ink-100'
      }`}
    >
      {/*
        開いているあいだ、カードの**いちばん上**に「このカードから出る」操作だけを集める
        （依頼者の指示・2026-09-05「前のパーツと次のパーツは、
        名称よりも上に置く方が良いように思います」）。

        隣のパーツへ送るのも、閉じるのも、行き先はどちらもこのカードの外なので、
        ひとつの帯に並べておく。カードを開くとそのカードは画面の上へ呼び戻されるので
        （下の scrollIntoView）、いちばん上に置いてあれば、
        続けて何枚送っても指は毎回まったく同じ場所に留まれる。
        名前や枚数の行より下にあると、その行の高さが変わったぶんだけ現れる位置がずれる。

        パーツが1つだけのときは nav が来ないので、閉じるだけがここに残る
      */}
      {open && (
        <div className="mb-3 flex items-center gap-2 border-b border-ink-100 pb-3">
          {nav}
          <button
            type="button"
            onClick={onOpen}
            aria-label="このパーツを閉じる"
            className="tap ml-auto flex w-11 shrink-0 items-center justify-center self-stretch rounded-lg border border-ink-100 text-ink-500 active:bg-table"
          >
            <Icon name="close" className="h-4 w-4 shrink-0" />
          </button>
        </div>
      )}

      <div className="flex gap-3">
        {/*
          小さな絵は、**閉じているあいだだけ**（依頼者の指摘・2026-09-04
          「パーツを選んで、この大きな縫い代付けの画面を開いた時に、
            上にある小さなアイコンは要らないですよね」）。

          開けばすぐ下に同じ形の大きな図が出るので、同じものが二つ並ぶ。
          一覧をながめて「どれのことか」を見分けるための絵なので、
          もうその1枚を開いてしまったあとには役目が無い。

          同じ理由で、開いているあいだは大きさの数字と
          「縫い代を決める」の行も畳んである（どちらもパネルの中に出ている）。
          残すのは、パネルの中では決められないこと——名前と枚数、
          それに消すことと閉じること——だけ
        */}
        {!open && (
          <button type="button" onClick={onOpen} className="shrink-0" aria-label={`${part.name}の縫い代`}>
            <Thumb part={part} hasNap={hasNap} placed={placed} />
          </button>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 1画面に近づけるため、行を折り返させない（依頼者の指示・2026-08-27） */}
          <div className="flex items-center gap-1.5">
            {naming ? (
              <>
                <input
                  type="text"
                  autoFocus
                  value={part.name}
                  onChange={(e) => onPatch({ name: e.target.value })}
                  onBlur={() => stopNaming(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') stopNaming(true)
                    if (e.key === 'Escape') stopNaming(false)
                  }}
                  aria-label="パーツの名前"
                  className="min-w-0 flex-1 rounded-lg border-2 border-mat-500 px-2 py-1.5 text-sm"
                />
                {/*
                  一覧へ戻る道。押されるまえに input の onBlur が走るので、
                  onMouseDown で先に受ける
                */}
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); stopNaming(false) }}
                  onClick={() => stopNaming(false)}
                  className="tap shrink-0 whitespace-nowrap px-1 text-xs font-bold text-ink-500"
                >
                  やめる
                </button>
              </>
            ) : (
              <select
                value={NAME_CHOICES.includes(part.name) ? part.name : ''}
                onChange={(e) => {
                  if (e.target.value === OWN_NAME) {
                    nameBefore.current = part.name
                    setNaming(true)
                  }
                  else onPatch({ name: e.target.value || part.name })
                }}
                className="min-w-0 flex-1 rounded-lg border border-ink-100 px-2 py-1.5 text-sm"
              >
                {/*
                  いまの名前が一覧にも入っていると、同じ名前が2回並ぶ
                  （学生の点検・2026-09-02・2巡目）。
                  一覧に無い名前（じぶんで入れたもの）のときだけ、先頭に出す
                */}
                {!NAME_CHOICES.includes(part.name) && (
                  <option value="">{part.name}</option>
                )}
                {NAME_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={OWN_NAME}>じぶんで入れる…</option>
              </select>
            )}
            {/* 開いているあいだは、名前の右に空いた場所へ枚数を入れて1行減らす */}
            {open && !naming && count}
            <button
              type="button"
              onClick={onRemove}
              className="tap flex h-11 w-9 shrink-0 items-center justify-center text-ink-300"
              aria-label="このパーツを消す"
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </div>

          {/*
            枚数の行。開いているあいだは上の行に混ぜてあるので出さない。
            大きさの数字も、開いていればパネルの終わりに
            「縫い代まで入れた大きさ」として出ている
          */}
          {(!open || naming) && (
            <div className="flex items-center gap-1.5">
              <Icon name="part" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
              {count}
              {!open && (
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
              )}
            </div>
          )}

          {/*
            ＋ が上限で黙って効かなくなっていた（学生の点検・2026-09-02・2巡目）。
            押しても何も起きないので、壊れているのか上限なのか分からない。
            上限は変えず（それ以上は要尺の道具の話ではなくなる）、
            **届いたときだけ**理由を出す
          */}
          {part.needed >= MAX_NEEDED && (
            <p className="text-[11px] leading-tight text-ink-300">
              枚数は {MAX_NEEDED} 枚までです
            </p>
          )}

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
          {!open && (
            <button
              type="button"
              onClick={onOpen}
              aria-expanded={open}
              data-tour={first ? 'seam-open' : undefined}
              className="-mx-1 flex items-center gap-1.5 rounded-b-lg border-t border-ink-100 px-1 pt-2 pb-0.5 text-left active:bg-table"
            >
              <Icon name="seam" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
              <span className="min-w-0 truncate text-[11px] font-bold text-ink-700">
                縫い代を決める
              </span>
              {folds > 0 && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-seam">
                  <Icon name="fold" className="h-3.5 w-3.5 shrink-0" />
                  {opened ? 'わにしないで裁つ' : `わ ${folds}本`}
                </span>
              )}
              <span className="tnum ml-auto shrink-0 text-[11px] text-ink-500">{seam}</span>
              <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300" />
            </button>
          )}
        </div>
      </div>

      {/* 開いているときだけ、縫い代のパネルがカードの中に出る */}
      {body && <div className="pt-3">{body}</div>}
    </li>
  )
}

/**
 * 隣のパーツへの行き来（依頼者の指示・2026-09-04）。
 *
 * パネルは縦 736px あるので、1つ目を決め終えた指は画面のずっと下にいる。
 * そこから次のパーツの行へ進むには、自分で巻き戻さなければならなかった。
 *
 * 置き場所は**カードのいちばん上**、名前よりも上（依頼者の指示・2026-09-05）。
 * はじめは下——「決め終わったその場所」——に置いたが、それだと
 * 押しに行くのにパネルの丈だけ巻き下ろすことになり、移動そのものにスクロールが要る。
 * 次にパネルの頭へ移したが、それでも名前と枚数の2行ぶん下だった。
 * 別のカードを開くとそのカードは画面の上へ呼び戻されるので（`scrollIntoView`）、
 * カードの先頭に置いてはじめて、続けて何枚送っても指が毎回同じ場所に留まる。
 * 上の行の高さが変われば（枚数の上限の注意書き、名前の打ち込み中）
 * そのぶん現れる位置がずれてしまうため。
 *
 * 「閉じる」を隣に並べるのは `PartRow` の側。ここは行き来の2つだけを返す。
 *
 * 前へも後ろへも行けるようにしてある。戻って1つだけ直し、また続きへ帰れること。
 *
 * **最後のパーツでは、右側が「生地を決める」に変わる**
 * （依頼者の指示・2026-09-05「一番最後のパーツになっているものには
 * 『次のパーツ』の代わりに『次のセクションへ』などというボタンにしてください。
 * その際すぐにそれに気づけるように『生地を決める』と同じ緑色のボタンが
 * 良いかと思っています」）。
 *
 * もとは端で押せなくしてあった。「別の段階への移動をこの段に混ぜない」
 * という理屈だったが、実際に使うと**最後を決め終えた指が行き止まりに当たる**。
 * 縫い代のパネルは縦に長いので、そこから下の「生地を決める」まで
 * 巻き下ろすことになり、この行き来をカードの頭に置いた意味が消えていた。
 * 行き先が変わることは、灰色と緑という**色そのもの**で言う。
 * 文字だけでなく色が変わるので、押す前に気づける
 */
function PartNav({ index, total, onGo, onNext }: {
  index: number
  total: number
  onGo: (i: number) => void
  /** 最後のパーツから先。次の段階（生地を決める）へ */
  onNext: () => void
}) {
  const side = 'flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2.5 text-sm font-bold'
  const live = 'border-mat-300 text-mat-700 active:bg-mat-50'
  const dead = 'border-ink-100 text-ink-300'
  // 下の大きな「生地を決める →」と同じ緑。同じところへ行くものは同じ色にする
  const go = 'border-mat-500 bg-mat-500 text-white active:bg-mat-600'
  const first = index === 0
  const last = index === total - 1
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={() => onGo(index - 1)}
        disabled={first}
        className={`${side} ${first ? dead : live}`}
      >
        <Icon name="back" className="h-4 w-4 shrink-0" />
        前のパーツ
      </button>
      <span className="tnum shrink-0 text-xs font-bold text-ink-300">{index + 1} / {total}</span>
      {last ? (
        <button type="button" onClick={onNext} className={`${side} ${go}`}>
          生地を決める
          <Icon name="chevron" className="h-4 w-4 shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onGo(index + 1)}
          className={`${side} ${live}`}
        >
          次のパーツ
          <Icon name="chevron" className="h-4 w-4 shrink-0" />
        </button>
      )}
    </div>
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
