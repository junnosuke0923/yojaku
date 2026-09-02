/**
 * 文言を打ち替えるための道具一式（依頼者の指示・2026-09-02）。
 *
 *   一覧（`TextList`）  … 画面ごとに文言が縦に並ぶ。まとめて直すのはこちら
 *   その場（`T` の枠）  … アプリを触りながら、気になった文をその場で押して直す
 *   帯（`TextBar`）     … 上に出る。一覧とアプリを行き来する口と、書き出す口
 *
 * どれも `?text` を付けて開いたときにしか出ない。ふつうに開いた学生の画面には出ない。
 *
 * ## 一覧が主で、その場は従
 *
 * 依頼者の選択（2026-09-02）。まとめて読み直すには一覧のほうが向いているが、
 * 「この文、画面で見るとくどい」と気づくのは触っているときなので、
 * その場でも直せるようにしてある。どちらで直しても入る先は同じ。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SCREENS, TEXTS, entryOf, idsByScreen, type TextId } from '../lib/text'
import {
  TEXT_MODE, countChanged, exportText, openEditor, openList,
  resetAllText, resetText, setText, textOf,
  useEditingId, useListOpen, useOverrides,
} from '../lib/textStore'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ *
 * 書き方の決まりを、絵に直す
 * ------------------------------------------------------------------ */

/**
 * `*太字*`・`[赤字]`・`{数字}`・改行 を、画面に出せる形にする。
 *
 * 決まりを少なくしてあるのは、打ち替える人が覚えることを増やさないため。
 * 印を書き忘れても文が消えたりはせず、そのままの字が出るだけになる
 */
function markup(src: string, vars: Vars | undefined, strong: string): ReactNode {
  const filled = vars
    ? src.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
    : src
  const out: ReactNode[] = []
  let key = 0
  filled.split('\n').forEach((line, i) => {
    if (i > 0) out.push(<br key={`br${key++}`} />)
    const re = /\*([^*]+)\*|\[([^\]]+)\]/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m.index > last) out.push(line.slice(last, m.index))
      out.push(
        <b key={key++} className={m[1] ? strong : 'font-bold text-seam'}>
          {m[1] ?? m[2]}
        </b>,
      )
      last = re.lastIndex
    }
    if (last < line.length) out.push(line.slice(last))
  })
  return out
}

type Vars = Record<string, string | number>

/**
 * 集めてある文言を1つ出す。
 *
 * @param strong `*…*` をどう見せるか。まわりが色つきの帯なら
 *   `font-bold` だけを渡して、その色のまま太字にする
 */
export function T({ id, vars, strong = 'font-bold text-ink-700' }: {
  id: TextId
  vars?: Vars
  strong?: string
}) {
  const over = useOverrides()
  const body = markup(over[id] ?? TEXTS[id].value, vars, strong)
  if (!TEXT_MODE) return <>{body}</>
  /*
    打ち替えの口。`Hint` のひと言はボタンの中に入っているので、
    押した出来事をここで止めないと、畳んだり開いたりのほうが動いてしまう
  */
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditor(id) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); openEditor(id)
        }
      }}
      className={`cursor-text rounded-sm outline-dashed outline-1 outline-offset-2 ${
        over[id] ? 'bg-amber-100 outline-amber-500' : 'outline-mat-300'
      }`}
    >
      {body}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * 上の帯
 * ------------------------------------------------------------------ */

export function TextBar() {
  const over = useOverrides()
  const list = useListOpen()
  const n = countChanged(over)
  if (!TEXT_MODE) return null
  return (
    <div className="flex items-center gap-2 border-b-2 border-amber-500 bg-amber-50 px-4 py-2">
      <Icon name="save" className="h-4 w-4 shrink-0 text-amber-700" />
      <span className="min-w-0 flex-1 text-xs font-bold text-amber-800">
        文言モード{n > 0 && `・${n} か所`}
      </span>
      <button
        type="button"
        onClick={() => openList(!list)}
        className="shrink-0 rounded-lg border border-amber-500 bg-white px-2.5 py-1 text-xs font-bold text-amber-800"
      >
        {list ? 'アプリを見る' : '一覧をひらく'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * その場で直す（下から出る）
 * ------------------------------------------------------------------ */

export function TextSheet() {
  const id = useEditingId()
  const over = useOverrides()
  if (!TEXT_MODE || !id) return null
  const entry = entryOf(id)
  return (
    <div className="safe-b panel-up fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t-2 border-amber-500 bg-white px-4 pt-3 pb-3 shadow-[0_-12px_32px_rgba(43,51,45,0.22)]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-500">
          {entry.screen}／{entry.label}
        </span>
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="shrink-0 rounded-lg border border-ink-100 px-2.5 py-1 text-xs font-bold text-ink-500"
        >
          閉じる
        </button>
      </div>
      <Field id={id} changed={!!over[id]} rows={4} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 打ち込む枠。一覧でも、その場の枠でも、同じものを使う
 * ------------------------------------------------------------------ */

function Field({ id, changed, rows }: { id: TextId; changed: boolean; rows: number }) {
  const entry = entryOf(id)
  const value = textOf(id)
  const ref = useRef<HTMLTextAreaElement>(null)
  /*
    打ち込むそばから高さを合わせる。文が長いほど直したくなるものなので、
    小さい枠の中で巻き下ろしながら読むことにはしたくない
  */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => setText(id, e.target.value)}
        className={`w-full resize-none rounded-lg border px-2.5 py-2 text-sm leading-relaxed ${
          changed ? 'border-amber-500 bg-amber-50' : 'border-ink-100 bg-white'
        }`}
      />
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-300">
          {changed ? <>もとの文：{entry.value}</> : entry.why}
        </p>
        {changed && (
          <button
            type="button"
            onClick={() => resetText(id)}
            className="shrink-0 rounded-lg border border-ink-100 px-2 py-1 text-xs font-bold text-ink-500"
          >
            もどす
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 一覧
 * ------------------------------------------------------------------ */

export function TextList() {
  const over = useOverrides()
  const [askReset, setAskReset] = useState(false)
  const n = countChanged(over)

  /** 直したぶんを file に落とす。これが本体へ渡す唯一の橋 */
  const save = () => {
    const blob = new Blob([exportText()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `要尺-文言-${stamp()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-3.5 py-3">
        <p className="text-sm font-bold text-ink-700">画面の文言を直す</p>
        <p className="text-xs leading-relaxed text-ink-500">
          直した文は、この端末の中に残ります。アプリを見ればそのまま出るので、
          実物で確かめられます。本体に入れるには「書き出す」でファイルに落として、
          そのファイルを渡してください。
        </p>
        <ul className="flex flex-col gap-0.5 text-xs leading-relaxed text-ink-500">
          <li><code className="font-bold text-ink-700">*ここ*</code> … 太字になります</li>
          <li><code className="font-bold text-seam">[ここ]</code> … 赤くなります</li>
          <li>
            <code className="font-bold text-ink-700">{'{n}'}</code>
            {' '}… 数字が入るところです。消さないでください
          </li>
          <li>改行すると、そのまま改行になります</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={n === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-3 text-sm font-bold text-white active:bg-mat-600 disabled:bg-ink-100 disabled:text-ink-300"
        >
          <Icon name="save" className="h-4 w-4 shrink-0" />
          {n > 0 ? `${n} か所を書き出す` : '直したところがありません'}
        </button>
        {n > 0 && (
          <button
            type="button"
            onClick={() => setAskReset(true)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-ink-100 px-3 py-3 text-sm font-bold text-ink-500"
          >
            <Icon name="undo" className="h-4 w-4 shrink-0" />
            全部もどす
          </button>
        )}
      </div>

      {/* 消すと戻せないので、押したその場では消さずに一度たずねる */}
      {askReset && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-seam bg-white px-4 py-4">
          <p className="text-sm leading-relaxed text-ink-700">
            打ち替えた <b className="font-bold">{n} か所</b> を、
            全部もとの文に戻します。書き出していないぶんは戻せません。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { resetAllText(); setAskReset(false) }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-seam px-4 py-3 text-sm font-bold text-white"
            >
              <Icon name="trash" className="h-4 w-4 shrink-0" />
              全部もどす
            </button>
            <button
              type="button"
              onClick={() => setAskReset(false)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-ink-100 px-4 py-3 text-sm font-bold text-ink-700"
            >
              <Icon name="back" className="h-4 w-4 shrink-0" />
              やめる
            </button>
          </div>
        </div>
      )}

      {idsByScreen().map(([screen, ids]) => (
        <section key={screen} className="flex flex-col gap-2.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-700">
            <span className="h-3.5 w-1 shrink-0 rounded-full bg-mat-500" />
            {screen}
            <span className="tnum text-xs font-normal text-ink-300">{ids.length}</span>
          </h2>
          {ids.map((id) => (
            <div key={id} className="flex flex-col gap-1.5 rounded-xl border border-ink-100 bg-white px-3 py-2.5">
              <p className="text-xs font-bold text-ink-500">{TEXTS[id].label}</p>
              <Field id={id} changed={!!over[id]} rows={2} />
            </div>
          ))}
        </section>
      ))}

      <p className="px-1 text-xs leading-relaxed text-ink-300">
        全部で {SCREENS.length} 画面・{Object.keys(TEXTS).length} か所です。
        ボタンの文字と段階の名前は、ここには出していません。
      </p>
    </main>
  )
}

/** 書き出す file の名前に付ける日付 */
function stamp(): string {
  const d = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
