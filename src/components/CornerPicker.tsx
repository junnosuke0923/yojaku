/**
 * 定規の位置を教えてもらう画面。
 *
 * 透明な方眼定規は緑マットに溶けて自動では見つけにくいので、ここは人の手に頼る。
 *
 * ■ ふだんは「長方形をそのまま定規へ持っていく」（2026-08-26 に変更）
 *
 * もとは4つの丸を1つずつ角に合わせる作りだった。
 * けれど定規はもともと長方形なので、4点を別々に置く必要はない。
 * 依頼者から「長方形のまま定規のところへ持っていって、そこから微調整するほうが
 * 手っ取り早いのでは」という提案があり、そのとおりに変えた。
 *
 * 速いだけではなく、計算のうえでも大事だった。
 * 4点を自由に置けると、指の数画素のずれがそのまま「遠近の歪み」として読み取られ、
 * 定規から遠い型紙ほど大きく歪む（合成画像で最悪56%）。
 * 長方形のまま動かすかぎり、そういう崩れ方はしない。
 * 詳しくは lib/ruler.ts の buildScale の説明を参照。
 *
 * 動かし方は3つ。イラストレーターの選択と同じ考え方にしてある。
 *   中を押して動かす／角をつまんで伸ばす／上の丸をつまんで回す
 *
 * ■ 斜めから撮ってしまったときだけ「ゆがみを直す」
 *
 * そのときは4つの角が自由になり、台形に合わせられる（もとの作り）。
 * 角を正確に合わせられるなら、こちらのほうが正確に直せる。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { dist, type Point, type Quad } from '../lib/geom'

type Props = {
  bitmap: ImageBitmap
  imageWidth: number
  imageHeight: number
  quad: Quad
  /** rect = 長方形のまま動かす（ふだん） / free = 4隅を自由に置く（ゆがみを直す） */
  mode: 'rect' | 'free'
  onChange: (quad: Quad) => void
}

const HANDLE_R = 13
const GRAB_R = 30
/** 回すための丸を、定規の端からどれだけ外へ出すか（画面上の px） */
const SPIN_GAP = 34
/** 短辺・長辺の最小の長さ（写真の px）。つぶれてしまわないように */
const MIN_SIDE = 12

type Frame = {
  cx: number
  cy: number
  /** 短辺の向き（ラジアン）。長辺はこれに直交する */
  ang: number
  halfShort: number
  halfLong: number
}

/** 四隅から、長方形としての姿を取り出す */
function frameOf(q: Quad): Frame {
  const ang = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x)
  return {
    cx: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    cy: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
    ang,
    halfShort: (dist(q[0], q[1]) + dist(q[3], q[2])) / 4,
    halfLong: (dist(q[1], q[2]) + dist(q[0], q[3])) / 4,
  }
}

/** 長方形としての姿から、四隅に戻す。順番は defaultRulerQuad と同じ */
function quadOf(f: Frame): Quad {
  const ux = Math.cos(f.ang)
  const uy = Math.sin(f.ang)
  const at = (su: number, sv: number): Point => ({
    x: f.cx + su * f.halfShort * ux - sv * f.halfLong * uy,
    y: f.cy + su * f.halfShort * uy + sv * f.halfLong * ux,
  })
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]
}

/**
 * ばらけた4点を、いちばん近い長方形に直す。
 * 「ゆがみに合わせる」から戻ってきたときに使う（台形のままだと角をつまめない）
 */
export const rectifyQuad = (q: Quad): Quad => quadOf(frameOf(q))

/** どの角をつまんだかで決まる、中心から見た向き */
const CORNER_SIGN: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

type Grab =
  | { kind: 'corner'; index: number }
  | { kind: 'spin' }
  | { kind: 'move'; fromX: number; fromY: number; cx: number; cy: number }

export function CornerPicker({ bitmap, imageWidth, imageHeight, quad, mode, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [grab, setGrab] = useState<Grab | null>(null)

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

  const frame = frameOf(quad)
  /** 回すための丸の位置（写真の座標） */
  const spin: Point = {
    x: frame.cx + (frame.halfLong + SPIN_GAP / k) * Math.sin(frame.ang),
    y: frame.cy - (frame.halfLong + SPIN_GAP / k) * Math.cos(frame.ang),
  }

  const nearestCorner = (p: Point): number => {
    let nearest = -1
    let best = GRAB_R / k
    quad.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d < best) { best = d; nearest = i }
    })
    return nearest
  }

  /** 押した場所が長方形の中か（動かす操作にするか） */
  const inside = (p: Point): boolean => {
    const ux = Math.cos(frame.ang)
    const uy = Math.sin(frame.ang)
    const dx = p.x - frame.cx
    const dy = p.y - frame.cy
    return (
      Math.abs(dx * ux + dy * uy) <= frame.halfShort &&
      Math.abs(-dx * uy + dy * ux) <= frame.halfLong
    )
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY)

    if (mode === 'rect' && Math.hypot(spin.x - p.x, spin.y - p.y) < GRAB_R / k) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setGrab({ kind: 'spin' })
      return
    }

    const corner = nearestCorner(p)
    if (corner >= 0) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setGrab({ kind: 'corner', index: corner })
      return
    }

    if (mode === 'rect' && inside(p)) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setGrab({ kind: 'move', fromX: p.x, fromY: p.y, cx: frame.cx, cy: frame.cy })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!grab) return
    e.preventDefault()
    const p = toImage(e.clientX, e.clientY)

    if (grab.kind === 'move') {
      onChange(quadOf({
        ...frame,
        cx: Math.min(Math.max(grab.cx + (p.x - grab.fromX), 0), imageWidth),
        cy: Math.min(Math.max(grab.cy + (p.y - grab.fromY), 0), imageHeight),
      }))
      return
    }

    if (grab.kind === 'spin') {
      // つまんだ丸のほうが「長辺の先」になるように回す
      onChange(quadOf({
        ...frame,
        ang: Math.atan2(p.y - frame.cy, p.x - frame.cx) + Math.PI / 2,
      }))
      return
    }

    if (mode === 'free') {
      const next = [...quad] as Quad
      next[grab.index] = {
        x: Math.min(Math.max(p.x, 0), imageWidth),
        y: Math.min(Math.max(p.y, 0), imageHeight),
      }
      onChange(next)
      return
    }

    // 長方形のまま、向かいの角を留めたまま伸ばす
    const [su, sv] = CORNER_SIGN[grab.index]
    const pin = quad[(grab.index + 2) % 4]
    const ux = Math.cos(frame.ang)
    const uy = Math.sin(frame.ang)
    const dx = p.x - pin.x
    const dy = p.y - pin.y
    let a = dx * ux + dy * uy
    let b = -dx * uy + dy * ux
    if (su * a < MIN_SIDE) a = su * MIN_SIDE
    if (sv * b < MIN_SIDE) b = sv * MIN_SIDE
    onChange(quadOf({
      ang: frame.ang,
      cx: pin.x + (a * ux - b * uy) / 2,
      cy: pin.y + (a * uy + b * ux) / 2,
      halfShort: Math.abs(a) / 2,
      halfLong: Math.abs(b) / 2,
    }))
  }

  const stop = () => setGrab(null)

  const path = quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * k},${p.y * k}`).join(' ') + ' Z'
  const grabbedCorner = grab?.kind === 'corner' ? grab.index : -1

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

        {mode === 'rect' && (
          <g>
            {/* 回すための丸。定規の先から棒を1本出しておく */}
            <line
              x1={frame.cx * k}
              y1={frame.cy * k}
              x2={spin.x * k}
              y2={spin.y * k}
              stroke="#35664e"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={spin.x * k} cy={spin.y * k} r={GRAB_R} fill="transparent" />
            <circle
              cx={spin.x * k}
              cy={spin.y * k}
              r={HANDLE_R}
              fill={grab?.kind === 'spin' ? '#35664e' : '#ffffff'}
              stroke="#35664e"
              strokeWidth={3}
            />
            {/* 回す向きが分かるように、丸の中に弧を描く */}
            <path
              d={`M${spin.x * k - 5},${spin.y * k + 2} a5,5 0 1,1 4,3`}
              fill="none"
              stroke={grab?.kind === 'spin' ? '#ffffff' : '#35664e'}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
        )}

        {quad.map((p, i) => (
          <g key={i}>
            <circle cx={p.x * k} cy={p.y * k} r={GRAB_R} fill="transparent" />
            <circle
              cx={p.x * k}
              cy={p.y * k}
              r={HANDLE_R}
              fill={grabbedCorner === i ? '#35664e' : '#ffffff'}
              stroke="#35664e"
              strokeWidth={3}
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
