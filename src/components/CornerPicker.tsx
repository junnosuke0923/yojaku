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
 * ■ 2本の指で広げると、写真そのものを大きくできる（2026-09-01 に追加）
 *
 * ここだけは「だいたい合っていればよい」では済まない。
 * 定規の長さがそのまま換算率になるので、四隅が数画素ずれると、
 * 写っている型紙ぜんぶの寸法がその割合だけ狂う。
 * ところがスマホの画面では、写真の中の定規はせいぜい指1本ぶんの幅しかなく、
 * 合わせようにも指が邪魔で角が見えない
 * （依頼者の指摘・2026-09-01「2本指で拡縮できるようにして、定規を当てていくことは可能ですか」）。
 *
 * そこで写真のほうを拡大できるようにした。倍率を上げても、
 * つまむ丸の大きさは画面上では変わらない（＝写真に対しては相対的に小さくなる）ので、
 * 拡大するほど細かく合わせられる。「拡大の入り／切り」のような状態は作らず、
 * ふだんの操作にそのまま重ねてある。
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
/**
 * 何倍まで大きくできるか。
 * 8倍あれば、幅 350px の画面でも写真の 1px が指先より大きくなる
 */
const MAX_ZOOM = 8
/** 寄ったとき、窓の上に残すすき間（画面の px） */
const TOP_GAP = 10
/**
 * 寄ったとき、窓の下に残す高さ（画面の px）。
 * ここを 0 にすると画面がそこで終わっているように見えるので、
 * 次の操作の頭が少しだけのぞくようにしてある
 */
const BOTTOM_KEEP = 76
/**
 * 1本目の指が着いてから、これだけの間に2本目が来たら
 * 「はじめから2本で広げるつもりだった」とみなす（ミリ秒）
 */
const PINCH_GRACE = 350

type Frame = {
  cx: number
  cy: number
  /** 短辺の向き（ラジアン）。長辺はこれに直交する */
  ang: number
  halfShort: number
  halfLong: number
}

/** 写真の見せ方。z が倍率、ox/oy が左上のずれ（画面の px） */
type Zoom = { z: number; ox: number; oy: number }

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
  /** 大きくしてあるとき、写真のほうを指でずらす */
  | { kind: 'pan'; fromX: number; fromY: number; ox: number; oy: number }

export function CornerPicker({ bitmap, imageWidth, imageHeight, quad, mode, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [grab, setGrab] = useState<Grab | null>(null)
  const [zoom, setZoom] = useState<Zoom>({ z: 1, ox: 0, oy: 0 })
  /**
   * 窓を伸ばせる高さ。**寄り始めた瞬間に測って、等倍に戻るまで動かさない**。
   *
   * 「画面の高さの何割」と決め打ちにしていたが、依頼者から
   * 「もっと縦長にまで伸びるのはやりすぎになりますか」と問われて考え直した。
   * やりすぎになる境目は割合ではなく、**窓の下端が画面から出るところ**にある。
   * 出てしまえば、見たかった下の端を見るためにまた指を動かすことになり、
   * 伸ばした意味が消える。
   *
   * そこで、寄り始めたときに窓を画面の上へ送り、
   * その下に残る高さをそのまま上限にしている。下に少しだけ残すのは、
   * 画面がそこで終わっているように見えないようにするため。
   * 割合で決めるより 5 割ほど大きく取れて、しかもはみ出さない。
   *
   * 測るのを寄り始めの一度きりにしているのは、
   * 画面を上下させるたびに窓の高さが変わると、落ち着かないため
   */
  const [room, setRoom] = useState(0)
  /** いま触れている指（pointerId → 画面の座標）。2本になったら広げ縮めに切り替える */
  const pointers = useRef(new Map<number, Point>())
  /** 広げ始めたときの、指の間の長さ・まん中・そのときの見せ方 */
  const pinch = useRef<{ d: number; mx: number; my: number } & Zoom | null>(null)
  /**
   * 1本目の指が着いた時刻と、そのときの四隅。
   * 2本指で広げようとすると、どうしても片方の指が先に着く。
   * その指が枠の中だと、広げ始める前に枠がわずかに動いてしまう。
   * ここは数画素のずれがそのまま換算率の狂いになる画面なので、
   * 「着いてすぐ2本目が来た」ときは、動いたぶんを無かったことにする
   */
  const began = useRef<{ at: number; quad: Quad } | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(el)
    setBoxWidth(el.clientWidth)
    // 横向きにしたら高さが変わるので、測り直させる
    const onResize = () => setRoom(0)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  /*
    写真を入れ替えたら、見せ方はいったん元に戻す。
    effect ではなく描き出しの途中で直しているのは、
    前の写真の倍率のまま一瞬描いてしまうのを避けるため
    （React の「props が変わったときに state を直す」やり方）
  */
  const [lastBitmap, setLastBitmap] = useState(bitmap)
  if (lastBitmap !== bitmap) {
    setLastBitmap(bitmap)
    setZoom({ z: 1, ox: 0, oy: 0 })
    setRoom(0)
  }

  const view = boxWidth || imageWidth
  /** 写真の px → 画面の px（等倍のとき） */
  const k = view / imageWidth
  /** 等倍のときの写真の高さ。倍率をかければ、いま描いている絵の高さになる */
  const viewHeight = imageHeight * k
  /**
   * **窓の高さ。寄ったときだけ縦に伸びる**（依頼者の指摘・2026-09-01）。
   *
   *   「定規のセクションでは図を拡大した際に、
   *     もっと縦長のウィンドウとして見れると定規の位置をとりやすく感じる」
   *
   * もとは窓の形が写真の形そのままだった。等倍ではそれで正しい——
   * 写真をまるごと見せる必要があるので、写真の形をしているほかない。
   * けれど**寄った時点で、写真ぜんぶはもう見えていない**。
   * 窓が写真の形をしている理由は消えているのに、形だけ残っていた。
   *
   * 横長の写真だと、窓は横に広く縦に短い。定規は細長いものなので、
   * 寄るほど両端が同時に見えなくなる。合わせたいものが窓からはみ出す。
   *
   * いまは絵の高さ（`viewHeight * z`）まで伸ばし、画面に収まるところで止める。
   * 等倍では `viewHeight` そのものなので、寄る前の見え方は何も変わらない。
   */
  const capH = Math.max(viewHeight, room)
  const boxH = Math.min(capH, viewHeight * zoom.z)
  /** 写真の px → 画面の px（いまの倍率で） */
  const s = k * zoom.z
  const X = (v: number) => v * s + zoom.ox
  const Y = (v: number) => v * s + zoom.oy

  /** その倍率のときの窓の高さ。止め位置は「これから変える倍率」で見る必要がある */
  const boxHOf = (z: number) => Math.min(capH, viewHeight * z)

  /**
   * 寄り始めたら、窓を画面の上へ送って、その下に残る高さを上限として覚える。
   * 等倍に戻ったら忘れる（次に寄ったときに測り直す）
   */
  const measureRoom = () => {
    if (room > 0) return
    setRoom(Math.max(0, window.innerHeight - TOP_GAP - BOTTOM_KEEP))
  }

  /*
    窓を画面の上へ送る。**伸びたあと**でないと送れない——
    伸びる前のページはまだ短いので、送りたいところまで巻けない
    （先に送ろうとしたら、45px しか動かず下端が画面から出た）。
    高さが決まってから動かすので、ここは描き終わったあとに置く
  */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || room === 0) return
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, top - TOP_GAP), behavior: 'smooth' })
  }, [room])
  /** 倍率とずれを、行きすぎないところまで戻す */
  const fit = (next: Zoom): Zoom => {
    const z = Math.min(Math.max(next.z, 1), MAX_ZOOM)
    // 画面の外へ写真を送り出してしまわないよう、はみ出す幅までで止める
    return {
      z,
      ox: Math.min(0, Math.max(view * (1 - z), next.ox)),
      oy: Math.min(0, Math.max(boxHOf(z) - viewHeight * z, next.oy)),
    }
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !boxWidth) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(view * dpr)
    canvas.height = Math.round(boxH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, view, boxH)
    ctx.drawImage(bitmap, zoom.ox, zoom.oy, view * zoom.z, viewHeight * zoom.z)
  }, [bitmap, boxWidth, view, viewHeight, boxH, zoom])

  const toImage = (clientX: number, clientY: number): Point => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - zoom.ox) / s,
      y: (clientY - rect.top - zoom.oy) / s,
    }
  }

  const frame = frameOf(quad)
  /** 回すための丸の位置（写真の座標） */
  const spin: Point = {
    x: frame.cx + (frame.halfLong + SPIN_GAP / s) * Math.sin(frame.ang),
    y: frame.cy - (frame.halfLong + SPIN_GAP / s) * Math.cos(frame.ang),
  }

  const nearestCorner = (p: Point): number => {
    let nearest = -1
    let best = GRAB_R / s
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

  /** 2本目の指が着いたところ。枠をつまんでいた途中でも、そちらは手放す */
  const startPinch = (now: number) => {
    const [a, b] = [...pointers.current.values()]
    const rect = wrapRef.current!.getBoundingClientRect()
    pinch.current = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2 - rect.left,
      my: (a.y + b.y) / 2 - rect.top,
      ...zoom,
    }
    // 1本目が着いてすぐなら、その指で動いたぶんは広げ始めの一部とみなして戻す
    const first = began.current
    if (first && now - first.at < PINCH_GRACE) onChange(first.quad)
    setGrab(null)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      if (pointers.current.size === 2) {
        measureRoom()
        startPinch(e.timeStamp)
      }
      return
    }

    began.current = { at: e.timeStamp, quad }
    const p = toImage(e.clientX, e.clientY)

    if (mode === 'rect' && Math.hypot(spin.x - p.x, spin.y - p.y) < GRAB_R / s) {
      setGrab({ kind: 'spin' })
      return
    }

    const corner = nearestCorner(p)
    if (corner >= 0) {
      setGrab({ kind: 'corner', index: corner })
      return
    }

    if (mode === 'rect' && inside(p)) {
      setGrab({ kind: 'move', fromX: p.x, fromY: p.y, cx: frame.cx, cy: frame.cy })
      return
    }

    // 枠のどこでもないところ。大きくしてあるときは、写真のほうをずらす
    if (zoom.z > 1) {
      setGrab({ kind: 'pan', fromX: e.clientX, fromY: e.clientY, ox: zoom.ox, oy: zoom.oy })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 指が2本あるあいだは、広げ縮めだけを見る
    const start = pinch.current
    if (start && pointers.current.size >= 2) {
      e.preventDefault()
      const [a, b] = [...pointers.current.values()]
      const rect = wrapRef.current!.getBoundingClientRect()
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const z = Math.min(Math.max(start.z * (d / start.d), 1), MAX_ZOOM)
      // つまみ始めた場所を、いまの指のまん中へ持っていく（＝広げながらずらせる）
      const atX = (a.x + b.x) / 2 - rect.left
      const atY = (a.y + b.y) / 2 - rect.top
      setZoom(fit({
        z,
        ox: atX - ((start.mx - start.ox) / start.z) * z,
        oy: atY - ((start.my - start.oy) / start.z) * z,
      }))
      return
    }

    if (!grab) return
    e.preventDefault()

    if (grab.kind === 'pan') {
      setZoom(fit({
        z: zoom.z,
        ox: grab.ox + (e.clientX - grab.fromX),
        oy: grab.oy + (e.clientY - grab.fromY),
      }))
      return
    }

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

  const stop = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) began.current = null
    if (pointers.current.size < 2) pinch.current = null
    // 指が離れて等倍に戻っていたら忘れる。次に寄るときに、そのときの画面で測り直す
    if (pointers.current.size === 0 && zoom.z <= 1) setRoom(0)
    setGrab(null)
  }

  /*
    パソコンの操作板（トラックパッド）でつまむと、ブラウザは
    ctrl を押しながらの回し操作として送ってくる。指のときと同じに扱う。
    React の onWheel からでは止められないことがあるので、じかに繋いでいる
  */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      // 寄せる向きのときだけ。room を見ているので、この繋ぎ直しは deps に入れてある
      if (e.deltaY < 0 && room === 0) {
        setRoom(Math.max(0, window.innerHeight - TOP_GAP - BOTTOM_KEEP))
      }
      const rect = el.getBoundingClientRect()
      const atX = e.clientX - rect.left
      const atY = e.clientY - rect.top
      setZoom((now) => {
        const z = Math.min(Math.max(now.z * Math.exp(-e.deltaY / 180), 1), MAX_ZOOM)
        return {
          z,
          ox: Math.min(0, Math.max(view * (1 - z), atX - ((atX - now.ox) / now.z) * z)),
          oy: Math.min(0, Math.max(Math.min(capH, viewHeight * z) - viewHeight * z,
            atY - ((atY - now.oy) / now.z) * z)),
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view, viewHeight, capH, room])

  const path = quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x)},${Y(p.y)}`).join(' ') + ' Z'
  const grabbedCorner = grab?.kind === 'corner' ? grab.index : -1

  return (
    <div
      ref={wrapRef}
      className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-ink-100"
      style={{ height: boxH || undefined }}
    >
      <canvas ref={canvasRef} style={{ width: view, height: boxH }} className="block" />
      <svg
        className="absolute inset-0"
        width={view}
        height={boxH}
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
              x1={X(frame.cx)}
              y1={Y(frame.cy)}
              x2={X(spin.x)}
              y2={Y(spin.y)}
              stroke="#35664e"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={X(spin.x)} cy={Y(spin.y)} r={GRAB_R} fill="transparent" />
            <circle
              cx={X(spin.x)}
              cy={Y(spin.y)}
              r={HANDLE_R}
              fill={grab?.kind === 'spin' ? '#35664e' : '#ffffff'}
              stroke="#35664e"
              strokeWidth={3}
            />
            {/* 回す向きが分かるように、丸の中に弧を描く */}
            <path
              d={`M${X(spin.x) - 5},${Y(spin.y) + 2} a5,5 0 1,1 4,3`}
              fill="none"
              stroke={grab?.kind === 'spin' ? '#ffffff' : '#35664e'}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
        )}

        {quad.map((p, i) => (
          <g key={i}>
            <circle cx={X(p.x)} cy={Y(p.y)} r={GRAB_R} fill="transparent" />
            <circle
              cx={X(p.x)}
              cy={Y(p.y)}
              r={HANDLE_R}
              fill={grabbedCorner === i ? '#35664e' : '#ffffff'}
              stroke="#35664e"
              strokeWidth={3}
            />
          </g>
        ))}
      </svg>

      {/*
        大きくしたあと、元へ戻る口。
        等倍のあいだは出さない（押すもののない札を画面に残さない）。
        いま何倍かも札の中で言っておく。数字だけを置くと、
        何のための数字なのかが分からなくなる
      */}
      {zoom.z > 1 && (
        <button
          type="button"
          onClick={() => { setZoom({ z: 1, ox: 0, oy: 0 }); setRoom(0) }}
          className="tnum absolute right-2 top-2 rounded-lg border border-ink-100 bg-white/90 px-2.5 py-1.5 text-xs font-bold text-ink-700"
        >
          {zoom.z.toFixed(1)}倍 ／ ぜんぶ見る
        </button>
      )}
    </div>
  )
}
