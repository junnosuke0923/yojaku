/**
 * 定規の四隅を合わせる画面。
 *
 * 透明な方眼定規は緑マットに溶けて自動では見つけにくい。
 * そこで「4つの丸を定規の角に合わせる」という、確実で説明しやすい操作にしている。
 * ここで指定した4点が、そのまま歪み補正の入力になる。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { Point, Quad } from '../lib/geom'

type Props = {
  bitmap: ImageBitmap
  imageWidth: number
  imageHeight: number
  quad: Quad
  onChange: (quad: Quad) => void
}

const HANDLE_R = 13
const GRAB_R = 30

export function CornerPicker({ bitmap, imageWidth, imageHeight, quad, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(el)
    setBoxWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const view = boxWidth || imageWidth
  const k = view / imageWidth
  const viewHeight = imageHeight * k

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !boxWidth) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(view * dpr)
    canvas.height = Math.round(viewHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, view, viewHeight)
    ctx.drawImage(bitmap, 0, 0, view, viewHeight)
  }, [bitmap, boxWidth, view, viewHeight])

  const toImage = (clientX: number, clientY: number): Point => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY)
    let nearest = -1
    let best = GRAB_R / k
    quad.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d < best) { best = d; nearest = i }
    })
    if (nearest < 0) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(nearest)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging === null) return
    e.preventDefault()
    const p = toImage(e.clientX, e.clientY)
    const next = [...quad] as Quad
    next[dragging] = {
      x: Math.min(Math.max(p.x, 0), imageWidth),
      y: Math.min(Math.max(p.y, 0), imageHeight),
    }
    onChange(next)
  }

  const stop = () => setDragging(null)

  const path = quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * k},${p.y * k}`).join(' ') + ' Z'

  return (
    <div
      ref={wrapRef}
      className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-ink-100"
      style={{ height: viewHeight || undefined }}
    >
      <canvas ref={canvasRef} style={{ width: view, height: viewHeight }} className="block" />
      <svg
        className="absolute inset-0"
        width={view}
        height={viewHeight}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <path d={path} fill="rgba(53,102,78,0.18)" stroke="#35664e" strokeWidth={2.5} />
        {quad.map((p, i) => (
          <g key={i}>
            <circle cx={p.x * k} cy={p.y * k} r={GRAB_R} fill="transparent" />
            <circle
              cx={p.x * k}
              cy={p.y * k}
              r={HANDLE_R}
              fill={dragging === i ? '#35664e' : '#ffffff'}
              stroke="#35664e"
              strokeWidth={3}
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
