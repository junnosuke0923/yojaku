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
 * 見つかった形ひとつぶん。押すと「取り込む／取り込まない」が切りかわる。
 *
 * 写真には型紙のほかに、消しゴムや紙片や手が写り込む。
 * それを機械に見分けさせようとはしない。細長い型紙を「これは道具でしょう」と
 * 捨てられるほうが困るし、確信の持てない自動判定を学生に見せない、
 * というのがこのアプリの方針でもある。
 * 見分けるのは人がして、**外すのを1タップにする**（依頼者の指示・2026-08-31）。
 */
function PartCard({ part, on, onToggle }: {
  part: PatternPart
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex w-full flex-col gap-3 rounded-xl border p-4 text-left transition-opacity ${
        on ? 'border-mat-500 bg-white' : 'border-ink-100 bg-white opacity-45'
      }`}
    >
      {/*
        面積は出さない（依頼者の指示・2026-08-31）。
        要尺は「生地の上に並べたときの丈」で決まるので、面積は使いどころがない。
        使わない数字を並べると、確かめるべき最大丈・最大幅がその中に埋もれる
      */}
      <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
            on ? 'bg-mat-500 text-white' : 'border border-ink-300 text-transparent'
          }`}
        >
          <Icon name="check" className="h-3.5 w-3.5" />
        </span>
        <Icon name="part" className="h-4 w-4 shrink-0 text-mat-600" />
        {part.name}
      </span>

      <PartShape part={part} />

      {/* 縦は地の目の矢印、横は寸法線。数字がどちら向きの寸法か、絵で分かる */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-mat-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-mat-600">
            <Icon name="grain" className="h-3.5 w-3.5 shrink-0" />
            最大丈（地の目方向）
          </span>
          <span className="tnum text-2xl font-bold text-mat-700">{cm(part.heightMm)}<span className="ml-1 text-sm">cm</span></span>
        </div>
        <div className="rounded-lg bg-mat-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-mat-600">
            <Icon name="grainSide" className="h-3.5 w-3.5 shrink-0" />
            最大幅
          </span>
          <span className="tnum text-2xl font-bold text-mat-700">{cm(part.widthMm)}<span className="ml-1 text-sm">cm</span></span>
        </div>
      </div>

      <span className={`text-xs font-bold ${on ? 'text-mat-600' : 'text-ink-300'}`}>
        {on ? '取り込みます' : '取り込みません（押すと戻ります）'}
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
 */
function SmoothPicker({ value, onChange }: {
  value: SmoothLevel
  onChange: (v: SmoothLevel) => void
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-ink-100 bg-white px-4 py-3.5">
      <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
        <Icon name="smooth" className="h-4 w-4 shrink-0 text-mat-600" />
        線のなめらかさ
      </span>
      <div className="grid grid-cols-4 gap-2">
        {SMOOTH_LEVELS.map((lv) => (
          <button
            key={lv.key}
            type="button"
            onClick={() => onChange(lv.key)}
            aria-pressed={value === lv.key}
            className={`rounded-lg px-2 py-2 text-sm font-bold ${
              value === lv.key ? 'bg-mat-500 text-white' : 'border border-ink-100 text-ink-700'
            }`}
          >
            {lv.label}
          </button>
        ))}
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
  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2.5 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-3">
        <Icon name="measure" className="mt-[0.15em] h-5 w-5 shrink-0 text-mat-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-mat-700">
            <span className="font-bold">この数字が実物と近いか、確かめてください。</span>
            <br />
            大きくちがうときは、定規の種類か、四隅の位置が合っていません。
          </p>
          <p className="tnum mt-2 text-xs text-mat-600">
            換算率 1px ＝ {result.scale.mmPerPixel.toFixed(3)} mm
          </p>
        </div>
      </div>

      {result.parts.length > 0 && <SmoothPicker value={smooth} onChange={onSmooth} />}

      {result.parts.length === 0 ? (
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
          {result.parts.length > 1 && (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-500">
              <Icon name="hint" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0 text-mat-600" />
              <span className="min-w-0 flex-1">
                型紙でないものが混じっていたら、そのカードを押して外してください
                （消しゴムや紙片も、3cmより大きければ出てきます）。
              </span>
            </p>
          )}
          {result.parts.map((p) => (
            <PartCard
              key={p.id}
              part={p}
              on={!excluded.has(p.id)}
              onToggle={() => onToggle(p.id)}
            />
          ))}
        </>
      )}

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
          <Icon name="photo" className="h-4 w-4 shrink-0 text-mat-600" />
          写真の上での切り抜き位置
        </span>
        <PhotoOverlay bitmap={bitmap} result={result} excluded={excluded} />
      </div>
    </div>
  )
}
