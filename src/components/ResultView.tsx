/**
 * 撮ったばかりの写真から見つかった形を、確かめて取り込む帯。
 *
 * ## もとは「実寸」という独立した段階だった（2026-09-01 に統合）
 *
 * 依頼者の指摘——
 *
 *   「実寸のパートと縫い代のパートは、それぞれパーツが表記されるところで
 *     似たような表記なんですけれども、ここをまとめられないのかな」
 *   「生地のセクションも増やしたので、セクション数が少し多いかな…
 *     最後まで行き着くまでに結構な段階を踏まないといけない印象です」
 *
 * 2つが似て見えたのには理由があった。**同じものを、別の瞬間に扱っていた**——
 * こちらは「いま撮った写真から見つかったぶん」、あちらは
 * 「これまでに取り込んだぶん」。並んでいる対象は同じで、時点だけが違う。
 * だから1つの画面の中の2つの状態にまとめ、段階を6つから5つに減らした。
 *
 * この帯は、取り込むまでのあいだだけ「パーツ」の画面の上に出る。
 * 取り込めば消えて、あとには一覧だけが残る。
 * 「撮り足す」で戻ってくる先も同じ画面なので、
 * 撮る→定規→ここ、を繰り返している構造がそのまま見える。
 *
 * ## まとめるにあたって、ここは削った
 *
 * ただ移すだけでは、パーツの画面が2つぶんの長さになって前より悪くなる。
 * いちばん場所を取っていたのは、形ひとつごとの大きな絵と、
 * 最大丈・最大幅の大きな数字だった（3つで縦1000pxを超えていた）。
 *
 * 絵は**写真に重ねた1枚に集約した**。もともと形ごとの絵と写真の絵とで
 * 似たものを2回見せていたし、「影を拾っていないか」「2つの型紙が繋がって
 * 1つになっていないか」を確かめられるのは、写真に重ねたほうだけである。
 *
 * 数字は行の中に小さく置き直した。小さくはしたが、消してはいない——
 * 実寸が正しく出ているかを学生自身が気づけること、
 * それがこの帯のいちばんの仕事だからで、
 * そのためには「何cmとして取り込まれるのか」が見えている必要がある。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bounds } from '../lib/geom'
import { cm } from '../lib/format'
import type { AnalyzeResult, PatternPart } from '../lib/pipeline'
import { SMOOTH_LEVELS, type SmoothLevel } from '../lib/smooth'
import { Hint, Icon } from './Icon'

/**
 * 写真に重ねる絵の、縦の上限（画面の px）。
 *
 * 幅なりに伸ばすと、横長の写真でも縦 280px ほどを使ってしまう。
 * ここは「だいたい合っているか」を見るところなので、
 * 全体が入っていれば小さくてよい。細かく見たいときは定規の画面で寄れる
 */
const OVERLAY_MAX_H = 210

/**
 * 見つかった形ひとつぶんの行。押すと「取り込む／取り込まない」が切りかわる。
 *
 * 写真には型紙のほかに、消しゴムや紙片や手が写り込む。
 * それを機械に見分けさせようとはしない。細長い型紙を「これは道具でしょう」と
 * 捨てられるほうが困るし、確信の持てない自動判定を学生に見せない、
 * というのがこのアプリの方針でもある。
 * 見分けるのは人がして、**外すのを1タップにする**（依頼者の指示・2026-08-31）。
 */
function PartRow({ part, on, onToggle }: {
  part: PatternPart
  on: boolean
  onToggle: () => void
}) {
  const b = bounds(part.outlineMm)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const pad = Math.max(w, h) * 0.06

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex w-full items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 text-left ${
        on ? 'border-mat-500' : 'border-ink-100 opacity-45'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
          on ? 'bg-mat-500 text-white' : 'border border-ink-300 text-transparent'
        }`}
      >
        <Icon name="check" className="h-3.5 w-3.5" />
      </span>

      <svg
        viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        className="h-11 w-11 shrink-0 rounded-lg bg-table"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-hidden="true"
      >
        <polygon
          points={part.outlineMm.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="#FAF7F0"
          stroke="#2b332d"
          strokeWidth={Math.max(w, h) * 0.018}
          strokeLinejoin="round"
        />
      </svg>

      <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-700">{part.name}</span>

      {/*
        面積は出さない（依頼者の指示・2026-08-31）。
        要尺は「生地の上に並べたときの丈」で決まるので、面積は使いどころがない。
        使わない数字を並べると、確かめるべき最大丈・最大幅がその中に埋もれる。

        縦は地の目の矢印、横はその直交の印。
        どちら向きの寸法なのかを、字ではなく印で言う
      */}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="flex items-center gap-1 text-[11px] text-ink-500">
          <Icon name="grain" className="h-3 w-3 shrink-0" />
          丈 <span className="tnum font-bold text-ink-900">{cm(part.heightMm)}</span> cm
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-500">
          <Icon name="grainSide" className="h-3 w-3 shrink-0" />
          幅 <span className="tnum font-bold text-ink-900">{cm(part.widthMm)}</span> cm
        </span>
      </span>
    </button>
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
    // 幅と、縦の上限と、両方に収める。横長でも縦長でも全体が入る
    const k = Math.min(w / bitmap.width, OVERLAY_MAX_H / bitmap.height)
    const cw = bitmap.width * k
    const ch = bitmap.height * k
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(bitmap, 0, 0, cw, ch)

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
  }, [bitmap, result, excluded, w])

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas ref={canvasRef} className="block rounded-lg" />
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
 * 選んだところがすぐ上の絵に出るので、押しては見て、を繰り返して決められる
 * （依頼者の指示・2026-08-31）。
 */
function SmoothPicker({ value, onChange }: {
  value: SmoothLevel
  onChange: (v: SmoothLevel) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Icon name="smooth" className="h-4 w-4 shrink-0 text-ink-300" />
        <span className="shrink-0 text-xs font-bold text-ink-700">線のなめらかさ</span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-ink-100">
          {SMOOTH_LEVELS.map((lv) => (
            <button
              key={lv.key}
              type="button"
              onClick={() => onChange(lv.key)}
              aria-pressed={value === lv.key}
              className={`border-l border-ink-100 px-3 py-1.5 text-xs font-bold first:border-l-0 ${
                value === lv.key ? 'bg-mat-500 text-white' : 'bg-white text-ink-700'
              }`}
            >
              {lv.label}
            </button>
          ))}
        </div>
      </div>
      <Hint
        icon="smooth"
        summary={<>紙のふちの<b className="text-ink-700">ガタガタ</b>をならします。大きさは変わりません</>}
      >
        角ときつい曲がりは動かさないので、最大丈・最大幅はほとんど変わりません。
        実物の線がほんとうに波打っているときも、いっしょにならされます。
        そこまで写し取りたいときは「なし」にしてください。
      </Hint>
    </div>
  )
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
  const found = result.parts.length

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        <Icon name="measure" className="mt-[0.15em] h-5 w-5 shrink-0 text-mat-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-mat-700">
            <span className="font-bold">
              この写真から{' '}
              <span className="tnum">{found}</span> つ 見つかりました。
            </span>
            <br />
            大きさが実物と近いか、確かめてください。
          </p>
          <p className="tnum pt-0.5 text-[11px] text-mat-600">
            換算率 1px ＝ {result.scale.mmPerPixel.toFixed(3)} mm
          </p>
        </div>
      </div>

      {found === 0 ? (
        <div className="flex gap-2.5 rounded-xl border border-seam bg-white px-4 py-4 text-sm leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            型紙を見つけられませんでした。
            <br />
            「台の色の調整」を開いて、写真の台のところを1回押してみてください。
            白く塗られる部分が型紙の形になれば成功です。
            <br />
            白い机や木目の机では、型紙と色が近すぎて分けられません。
            無地で色のついた布か紙を1枚敷いてから撮り直してください。
            <br />
            どうしても拾えないときは、生地に並べる画面の
            <b>「余白を空けておく」</b>から、実物を測った幅と丈を入れて
            長方形として置けます。要尺の見積もりとしてはそれで足ります。
          </span>
        </div>
      ) : (
        <>
          <PhotoOverlay bitmap={bitmap} result={result} excluded={excluded} />

          {found > 1 && (
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
              <Icon name="hint" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0 text-mat-600" />
              <span className="min-w-0 flex-1">
                型紙でないものが混じっていたら、その行を押して外してください
                （消しゴムや紙片も、3cmより大きければ出てきます）。
              </span>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {result.parts.map((p) => (
              <PartRow
                key={p.id}
                part={p}
                on={!excluded.has(p.id)}
                onToggle={() => onToggle(p.id)}
              />
            ))}
          </div>

          <SmoothPicker value={smooth} onChange={onSmooth} />
        </>
      )}
    </div>
  )
}
