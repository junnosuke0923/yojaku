/**
 * 解析結果の表示。
 *
 * ここでいちばん大事なのは「実寸が正しく出ているか、学生自身が気づけること」。
 * 定規を取り違えていれば数字が明らかにおかしくなるので、
 * 最大丈と最大幅を大きく出して検算してもらう。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bounds } from '../lib/geom'
import { cm } from '../lib/format'
import type { AnalyzeResult, PatternPart } from '../lib/pipeline'
import { SMOOTH_LEVELS, type SmoothLevel } from '../lib/smooth'
import { Hint, Icon } from './Icon'
import { T } from './TextTools'

const PAD = 26

function PartShape({ part }: { part: PatternPart }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !w) return

    const aspect = part.heightMm / Math.max(part.widthMm, 1)
    const h = Math.min(Math.max(w * aspect * 0.9, 160), 340)

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const b = bounds(part.outlineMm)
    const k = Math.min((w - PAD * 2) / Math.max(b.maxX - b.minX, 1), (h - PAD * 2) / Math.max(b.maxY - b.minY, 1))
    const ox = (w - (b.maxX - b.minX) * k) / 2
    const oy = (h - (b.maxY - b.minY) * k) / 2
    const X = (mm: number) => ox + (mm - b.minX) * k
    const Y = (mm: number) => oy + (mm - b.minY) * k

    // 外接する四角（最大丈・最大幅の目安）
    ctx.strokeStyle = '#9aa69e'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.strokeRect(X(b.minX), Y(b.minY), (b.maxX - b.minX) * k, (b.maxY - b.minY) * k)
    ctx.setLineDash([])

    // 型紙のシルエット
    ctx.beginPath()
    part.outlineMm.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))))
    ctx.closePath()
    ctx.fillStyle = 'rgba(53,102,78,0.13)'
    ctx.fill()
    ctx.strokeStyle = '#35664e'
    ctx.lineWidth = 2
    ctx.stroke()

    // 地の目の向き（実寸の座標系では、縦がそのまま地の目になる）
    const ax = X(b.minX) - 12
    ctx.strokeStyle = '#b4433a'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ax, Y(b.minY))
    ctx.lineTo(ax, Y(b.maxY))
    ctx.moveTo(ax - 4, Y(b.minY) + 7)
    ctx.lineTo(ax, Y(b.minY))
    ctx.lineTo(ax + 4, Y(b.minY) + 7)
    ctx.moveTo(ax - 4, Y(b.maxY) - 7)
    ctx.lineTo(ax, Y(b.maxY))
    ctx.lineTo(ax + 4, Y(b.maxY) - 7)
    ctx.stroke()

    ctx.save()
    ctx.translate(ax - 6, (Y(b.minY) + Y(b.maxY)) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillStyle = '#b4433a'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('地の目', 0, 0)
    ctx.restore()
  }, [part, w])

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

/**
 * カードの中の小さな形。輪郭だけを描く。
 *
 * 外接する四角も地の目の矢印も入れない。
 * この大きさでは線が重なって、かえって形が読めなくなる。
 * こまかいところを見たい人は、カードを開いて大きな絵で見る。
 */
function PartThumb({ part }: { part: PatternPart }) {
  const b = bounds(part.outlineMm)
  const w = Math.max(b.maxX - b.minX, 1)
  const h = Math.max(b.maxY - b.minY, 1)
  const d = part.outlineMm
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x - b.minX).toFixed(1)} ${(p.y - b.minY).toFixed(1)}`)
    .join('') + 'Z'
  const pad = Math.max(w, h) * 0.04
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="rgba(53,102,78,0.16)"
        stroke="#35664e"
        strokeWidth={Math.max(w, h) * 0.035}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 見つかった形ひとつぶん。
 *
 * 写真には型紙のほかに、消しゴムや紙片や手が写り込む。
 * それを機械に見分けさせようとはしない。細長い型紙を「これは道具でしょう」と
 * 捨てられるほうが困るし、確信の持てない自動判定を学生に見せない、
 * というのがこのアプリの方針でもある。
 * 見分けるのは人がして、**外すのを1タップにする**（依頼者の指示・2026-08-31）。
 *
 * 2026-09-04、依頼者の指示で小さくした。
 * 形が拾えているかは、この上の写真で一覧できる。
 * カードに残る仕事は「数字の確認」と「外す操作」の2つだけなので、
 * 1枚 509px あった絵を 48px のサムネイルにした。
 *
 * ただし**こまかいところは見えなくなる**ので、押すと大きな絵が開く。
 * それにともない、押す＝外す をやめて、外すのは左の ✓ に分けた。
 * 1つの的に2つの意味を持たせない。
 */
function PartCard({ part, index, on, onToggle }: {
  part: PatternPart
  /** 写真の上の番号と同じもの（1 から数える） */
  index: number
  on: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`rounded-xl border transition-opacity ${
        on ? 'border-mat-500 bg-white' : 'border-ink-100 bg-white opacity-50'
      }`}
    >
      <div className="flex items-center gap-2.5 p-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={on}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md ${
              on ? 'bg-mat-500 text-white' : 'border border-ink-300 text-transparent'
            }`}
          >
            <Icon name="check" className="h-4 w-4" />
          </span>
          <span className="sr-only">{on ? `${part.name}を外す` : `${part.name}を取り込む`}</span>
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {/* 写真の番号と同じ数字を先頭に。名前そのものが「パーツ1」なので、絵の隣に置くだけでよい */}
          <span className="h-12 w-12 shrink-0"><PartThumb part={part} /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs font-bold text-ink-700">{index} ・ {part.name}</span>
            {/*
              面積は出さない（依頼者の指示・2026-08-31）。
              要尺は「生地の上に並べたときの丈」で決まるので、面積は使いどころがない。
              数字を小さくはしたが、消しはしない——
              実寸が合っているかを確かめられる、この画面で唯一の手がかりなので
            */}
            <span className="flex items-baseline gap-3">
              <span className="flex items-baseline gap-1">
                <Icon name="grain" className="h-3 w-3 shrink-0 translate-y-[0.1em] text-mat-600" />
                {/* 画面によって「丈」「最大丈」と呼び分けていた（学生の点検・2026-09-02） */}
                <span className="text-[10px] text-mat-600">丈</span>
                <span className="tnum text-lg font-bold leading-tight text-mat-700">{cm(part.heightMm)}<span className="ml-0.5 text-[10px]">cm</span></span>
              </span>
              <span className="flex items-baseline gap-1">
                <Icon name="grainSide" className="h-3 w-3 shrink-0 translate-y-[0.1em] text-mat-600" />
                <span className="text-[10px] text-mat-600">幅</span>
                <span className="tnum text-lg font-bold leading-tight text-mat-700">{cm(part.widthMm)}<span className="ml-0.5 text-[10px]">cm</span></span>
              </span>
            </span>
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
              open ? 'border-mat-500 bg-mat-50 text-mat-700' : 'border-ink-100 text-ink-300'
            }`}
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}
            />
          </span>
          <span className="sr-only">{open ? '形を閉じる' : '形を大きく見る'}</span>
        </button>
      </div>

      {!on && (
        <p className="px-2.5 pb-2.5 text-xs font-bold text-ink-300">
          取り込みません（左の ✓ を押すと戻ります）
        </p>
      )}

      {open && (
        <div className="px-2.5 pb-2.5">
          {/* 縦は地の目の矢印、横は寸法線。数字がどちら向きの寸法か、絵で分かる */}
          <PartShape part={part} />
        </div>
      )}
    </div>
  )
}

function PhotoOverlay({ bitmap, result, excluded }: {
  bitmap: ImageBitmap
  result: AnalyzeResult
  excluded: Set<string>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !w) return
    const k = w / bitmap.width
    const h = bitmap.height * k
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(bitmap, 0, 0, w, h)

    // 外したものは、細い破線で塗りなし。写真の上でも「これは入れていない」と分かる
    for (const part of result.parts) {
      const off = excluded.has(part.id)
      ctx.setLineDash(off ? [6, 5] : [])
      ctx.lineWidth = off ? 1.5 : 2.5
      ctx.strokeStyle = off ? 'rgba(255,255,255,0.85)' : '#35664e'
      ctx.fillStyle = 'rgba(53,102,78,0.16)'
      ctx.beginPath()
      part.outlinePx.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * k, p.y * k) : ctx.lineTo(p.x * k, p.y * k)))
      ctx.closePath()
      if (!off) ctx.fill()
      ctx.stroke()
    }
    ctx.setLineDash([])

    /*
      輪郭に番号を振る（依頼者の指示・2026-09-04）。
      この写真を型紙カードより先に出すことにしたので、
      写真は「形が拾えているか」を一覧する場所になった。
      ただし番号が無いと、おかしい形を見つけても
      **どのカードを押せばよいか**が分からない。
      下のカードの名前（パーツ1…）と同じ番号を、ここに置く。

      置き場所は外接する四角の中心。型紙は縦長の凸に近い形がほとんどで、
      重心よりも「見た目の真ん中」に近い
    */
    const r = Math.max(11, w * 0.032)
    ctx.font = `700 ${(r * 1.25).toFixed(1)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    result.parts.forEach((part, i) => {
      const off = excluded.has(part.id)
      const b = bounds(part.outlinePx)
      const cx = (b.minX + b.maxX) * 0.5 * k
      const cy = (b.minY + b.maxY) * 0.5 * k
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = off ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.94)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = off ? 'rgba(154,166,158,0.9)' : '#35664e'
      ctx.stroke()
      ctx.fillStyle = off ? '#9aa69e' : '#35664e'
      ctx.fillText(String(i + 1), cx, cy + r * 0.06)
    })
  }, [bitmap, result, excluded, w])

  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-xl">
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

/**
 * 輪郭のガタガタをならす強さ。
 *
 * 入り／切りの2つではなく、素直な段階1組にしてある。
 * 「なめらかにする機能」を別に付けるのではなく、
 * 同じひとつの軸の上でどこに置くかを選んでもらう。
 *
 * 選んだところがすぐ下のカードに出るので、
 * 押しては見て、を繰り返して決められる（依頼者の指示・2026-08-31）。
 *
 * ふだんは畳んでおく（依頼者の指示・2026-09-04）。
 * ほとんどの人は既定のままでよく、いじる必要があるのは
 * 実物の線がほんとうに波打っているときだけ。
 * ただし**いま何が効いているか**は畳んだままでも見えるようにしてある。
 * 畳んで隠れるのは選び直す手段であって、いまの状態ではない。
 *
 * 畳んでいるあいだは、**白いカードではなく1行の見出しだけ**にしてある
 * （依頼者の指示・2026-09-05「『線のなめらかさ』もコンパクトには
 * 出来ないでしょうか？…もしくは簡易的にして下さい」）。
 * この画面のいちばんの仕事は「拾えた型紙を確かめること」で、
 * なめらかさはその脇の道具である。畳んでいるのに枠と余白で
 * カード1枚ぶんの場所を取っていると、主役の写真とカードを押し下げてしまう。
 * 同じ画面のほかの「？」の行と見た目をそろえてあるので、
 * 「押せば開く補足」の仲間だと形から分かる。
 */
function SmoothPicker({ value, onChange }: {
  value: SmoothLevel
  onChange: (v: SmoothLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const current = SMOOTH_LEVELS.find((lv) => lv.key === value)
  return (
    <div className="flex flex-col gap-2">
      {/* 行そのものを押せるようにする。小さな矢じりだけを的にすると指では狙いにくい */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1 text-left text-sm font-bold text-ink-700"
      >
        <Icon name="smooth" className="h-4 w-4 shrink-0 text-mat-600" />
        線のなめらかさ
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-normal text-ink-500">
          いま {current?.label}
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              open ? 'border-mat-500 bg-mat-50 text-mat-700' : 'border-ink-100 text-ink-300'
            }`}
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}
            />
          </span>
        </span>
        <span className="sr-only">{open ? '閉じる' : '変える'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-lg bg-chalk px-3 py-2.5">
          <div className="grid grid-cols-4 gap-2">
            {SMOOTH_LEVELS.map((lv) => (
              <button
                key={lv.key}
                type="button"
                onClick={() => onChange(lv.key)}
                aria-pressed={value === lv.key}
                className={`rounded-lg px-2 py-2 text-sm font-bold ${
                  value === lv.key ? 'bg-mat-500 text-white' : 'border border-ink-100 bg-white text-ink-700'
                }`}
              >
                {lv.label}
              </button>
            ))}
          </div>
          {/*
            「どれが正解なのか分かりません。要尺に影響するのかも分からず、
            『大きさは変わりません』を見つけてやっと安心しました」
            （学生の点検・2026-09-02）。安心する一文は「？」の中ではなく、
            選ぶところの隣に出す
          */}
          <span className="text-xs text-ink-500"><T id="ruler.smooth.safe" /></span>
          <Hint
            icon="smooth"
            summary={<T id="ruler.smooth.summary" />}
          >
            <T id="ruler.smooth.body" />
          </Hint>
        </div>
      )}
    </div>
  )
}

/**
 * 写真ぜんぶが1つの型紙として拾われていないか（依頼者の点検・2026-09-02）。
 *
 * 木の机や白い机の上で撮ると、台と型紙の色が分かれない。
 * すると輪郭は写真の外枠そのものになり、**写真まるごとが1枚の型紙**になる。
 * それでも実寸の数字はいつもどおり堂々と出るので、
 * 言わないかぎり、ありえない大きさの型紙がそのまま取り込まれてしまう。
 *
 * 止めはしない。画面いっぱいに大きな型紙を撮ることは実際にあるので、
 * 「ダメ」ではなく「そうなっている」と言うだけにする
 */
function fillsWholePhoto(part: PatternPart, w: number, h: number) {
  const b = bounds(part.outlinePx)
  return b.maxX - b.minX >= w * 0.92 && b.maxY - b.minY >= h * 0.92
}

export function ResultView({ bitmap, result, excluded, onToggle, smooth, onSmooth }: {
  bitmap: ImageBitmap
  result: AnalyzeResult
  /** 取り込まないことにした形の id */
  excluded: Set<string>
  onToggle: (id: string) => void
  smooth: SmoothLevel
  onSmooth: (v: SmoothLevel) => void
}) {
  const wholePhoto = result.parts.some((p) => fillsWholePhoto(p, bitmap.width, bitmap.height))
  return (
    <div className="flex flex-col gap-5">
      {/*
        枠の高さを詰めてある（依頼者の指示・2026-09-05
        「ここの緑の枠の内容を整理して縦幅を少しでも縮めておきたいです」）。
        いちばん効くのは**折り返しをなくすこと**で、行が1本増えるだけで
        枠は 20px 高くなる。そこで下の一文を細い画面でも1行に収まる長さにし、
        そのうえで行送りと上下の余白を詰めた
      */}
      <div className="flex gap-2.5 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-2.5">
        <Icon name="measure" className="mt-[0.1em] h-5 w-5 shrink-0 text-mat-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-mat-700">
            <T id="ruler.check.main" strong="font-bold" />
          </p>
          {/*
            直し方は、頼みごとより一段小さく置く（依頼者の指示・2026-09-04）。
            同じ大きさで2文並べると、この緑の枠だけで画面をふさいでしまう
          */}
          <p className="mt-0.5 text-xs leading-snug text-mat-600">
            <T id="ruler.check.how" />
          </p>
          {/*
            「写真の点ひとつが、実物の 0.412 mm にあたります」をやめた
            （依頼者の指示・2026-09-04）。
            学生にとっては知らなくてよい数字で、二度も言い換えたのに
            伝わらなかった（学生の点検・2026-09-02 と 2巡目）。
            確かめてもらうための数字は、下のカードの丈と幅（cm）のほう
          */}
        </div>
      </div>

      {wholePhoto && (
        <div className="flex gap-2.5 rounded-xl border border-seam bg-white px-4 py-3 text-sm leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <T id="ruler.whole.note" strong="font-bold" />
          </span>
        </div>
      )}

      {result.parts.length === 0 ? (
        <div className="flex gap-2.5 rounded-xl border border-seam bg-white px-4 py-4 text-sm leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <T id="ruler.none.body" strong="font-bold" />
          </span>
        </div>
      ) : (
        <>
          {/*
            写真を先に出す（依頼者の指示・2026-09-04）。
            「形がきちんと拾えているか」は、ここで一覧するのがいちばん速い。
            もとはカード3枚（1527px）の下にあり、たどり着くころには
            どのカードを見ていたか分からなくなっていた。
            輪郭には下のカードと同じ番号を振ってある
          */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
              <Icon name="photo" className="h-4 w-4 shrink-0 text-mat-600" />
              写真の上での切り抜き位置
            </span>
            <PhotoOverlay bitmap={bitmap} result={result} excluded={excluded} />
          </div>

          {/* なめらかさを変えると、すぐ上の写真の輪郭がその場で変わる */}
          <SmoothPicker value={smooth} onChange={onSmooth} />

          {result.parts.length > 1 && (
            <p className="flex items-start gap-2 text-xs leading-snug text-ink-500">
              <Icon name="hint" className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0 text-mat-600" />
              <span className="min-w-0 flex-1">
                <T id="ruler.exclude.note" />
              </span>
            </p>
          )}
          {/* カードは小さくなったので、あいだも詰める（20px では離れて見える） */}
          <div className="flex flex-col gap-2">
            {result.parts.map((p, i) => (
              <PartCard
                key={p.id}
                part={p}
                index={i + 1}
                on={!excluded.has(p.id)}
                onToggle={() => onToggle(p.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
