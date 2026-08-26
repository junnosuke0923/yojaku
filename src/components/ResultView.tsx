/**
 * 解析結果の表示。
 *
 * ここでいちばん大事なのは「実寸が正しく出ているか、学生自身が気づけること」。
 * 定規を取り違えていれば数字が明らかにおかしくなるので、
 * 最大丈と最大幅を大きく出して検算してもらう。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bounds } from '../lib/geom'
import { cm, cm2 } from '../lib/format'
import type { AnalyzeResult, PatternPart } from '../lib/pipeline'
import { Icon } from './Icon'

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

function PartCard({ part }: { part: PatternPart }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
          <Icon name="part" className="h-4 w-4 shrink-0 text-mat-600" />
          {part.name}
        </span>
        <span className="tnum text-xs text-ink-300">面積 約 {cm2(part.areaMm2)} cm²</span>
      </div>

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
    </div>
  )
}

function PhotoOverlay({ bitmap, result }: { bitmap: ImageBitmap; result: AnalyzeResult }) {
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

    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#35664e'
    ctx.fillStyle = 'rgba(53,102,78,0.16)'
    for (const part of result.parts) {
      ctx.beginPath()
      part.outlinePx.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * k, p.y * k) : ctx.lineTo(p.x * k, p.y * k)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }, [bitmap, result, w])

  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-xl">
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

export function ResultView({ bitmap, result }: { bitmap: ImageBitmap; result: AnalyzeResult }) {
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

      {result.parts.length === 0 ? (
        <div className="flex gap-2.5 rounded-xl border border-seam bg-white px-4 py-4 text-sm leading-relaxed text-seam">
          <Icon name="warn" className="mt-[0.15em] h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            型紙を見つけられませんでした。
            <br />
            「緑の調整」を開いて、白く塗られる部分が型紙の形になるよう合わせてみてください。
          </span>
        </div>
      ) : (
        result.parts.map((p) => <PartCard key={p.id} part={p} />)
      )}

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
          <Icon name="photo" className="h-4 w-4 shrink-0 text-mat-600" />
          写真の上での切り抜き位置
        </span>
        <PhotoOverlay bitmap={bitmap} result={result} />
      </div>
    </div>
  )
}
