/**
 * 動作確認用のサンプル写真を書き出す。
 *
 * 実際の裁断机で撮る前に、アプリの操作をひととおり試せるようにするためのもの。
 * 緑のマットの上に、実寸 450 × 620 mm の型紙と 50 × 5 cm の定規を置いて
 * 15度ほど傾けて撮った、という想定の画像を作る。
 *
 *   実行: npm run sample
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { RULERS } from '../src/lib/ruler'
import type { Point } from '../src/lib/geom'

const W = 1200
const H = 900

const GREEN: [number, number, number] = [58, 138, 96]
const PAPER: [number, number, number] = [236, 231, 219]
const LINE: [number, number, number] = [120, 110, 96]
/** 方眼定規の色。赤みがかった半透明。 */
const TINT: [number, number, number] = [206, 96, 88]

/** 実寸(mm)の型紙。bbox は 450 × 620 mm。 */
const PATTERN_MM: Point[] = [
  { x: 100, y: 20 }, { x: 300, y: 24 }, { x: 400, y: 90 }, { x: 520, y: 210 },
  { x: 550, y: 350 }, { x: 520, y: 500 }, { x: 540, y: 640 }, { x: 200, y: 636 },
  { x: 140, y: 420 }, { x: 105, y: 220 },
]

const TILT_DEG = 15
const DISTANCE_MM = 1600
const FOCAL_PX = 1700

function project(p: Point): Point {
  const t = (TILT_DEG * Math.PI) / 180
  const lookAt = { x: 300, y: 330 }
  const x = p.x - lookAt.x
  const y = p.y - lookAt.y
  const yc = y * Math.cos(t) + DISTANCE_MM * Math.sin(t)
  const zc = -y * Math.sin(t) + DISTANCE_MM * Math.cos(t)
  return {
    x: (FOCAL_PX * x) / zc + W / 2,
    y: (FOCAL_PX * yc) / zc + H / 2 - FOCAL_PX * Math.tan(t),
  }
}

const rgb = new Uint8Array(W * H * 3)

function fill(poly: Point[], color: [number, number, number], alpha = 1) {
  let minY = Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = []
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]
      if (a.y > y === b.y > y) continue
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        const i = (y * W + x) * 3
        for (let c = 0; c < 3; c++) rgb[i + c] = rgb[i + c] * (1 - alpha) + color[c] * alpha
      }
    }
  }
}

// 緑のマット
for (let i = 0; i < rgb.length; i += 3) {
  rgb[i] = GREEN[0]; rgb[i + 1] = GREEN[1]; rgb[i + 2] = GREEN[2]
}

// 型紙
fill(PATTERN_MM.map(project), PAPER)

// 地の目線（型紙の上に引いた線）
const spec = RULERS.r50
const grainX = 250
for (let mm = 30; mm < 620; mm += 2) {
  const a = project({ x: grainX - 1.5, y: mm })
  const b = project({ x: grainX + 1.5, y: mm + 2 })
  fill([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], LINE, 0.8)
}

// 方眼定規。地の目線に沿わせて置く。
// 実物は「透明」ではなく赤みがかった半透明で、下は透けるが色は乗る。
const rulerMm = [
  { x: grainX - spec.shortMm / 2, y: 30 },
  { x: grainX + spec.shortMm / 2, y: 30 },
  { x: grainX + spec.shortMm / 2, y: 30 + spec.longMm },
  { x: grainX - spec.shortMm / 2, y: 30 + spec.longMm },
]
fill(rulerMm.map(project), TINT, 0.40)

// 定規の縁
const edge = (a: Point, b: Point) => {
  const pa = project(a), pb = project(b)
  const nx = -(pb.y - pa.y), ny = pb.x - pa.x
  const len = Math.hypot(nx, ny) || 1
  const ox = (nx / len) * 1.2, oy = (ny / len) * 1.2
  fill([
    { x: pa.x - ox, y: pa.y - oy }, { x: pb.x - ox, y: pb.y - oy },
    { x: pb.x + ox, y: pb.y + oy }, { x: pa.x + ox, y: pa.y + oy },
  ], [150, 155, 158], 0.85)
}
for (let i = 0; i < 4; i++) edge(rulerMm[i], rulerMm[(i + 1) % 4])

// 定規の目盛り（1cm ごと）
for (let cm = 1; cm < 50; cm++) {
  const y = 30 + cm * 10
  const long = cm % 5 === 0
  edge({ x: grainX - spec.shortMm / 2, y }, { x: grainX - spec.shortMm / 2 + (long ? 18 : 9), y })
}

// 照明のむらと、わずかなざらつき
let seed = 7
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5 }
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const dx = x / W - 0.35, dy = y / H - 0.3
    const light = 1.06 - 0.3 * (dx * dx + dy * dy)
    for (let c = 0; c < 3; c++) {
      rgb[i + c] = Math.max(0, Math.min(255, rgb[i + c] * light + rand() * 9))
    }
  }
}

// ── PNG に書き出す ──────────────────────────────────────

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const ihdr = new Uint8Array(13)
new DataView(ihdr.buffer).setUint32(0, W)
new DataView(ihdr.buffer).setUint32(4, H)
ihdr[8] = 8   // ビット深度
ihdr[9] = 2   // カラータイプ: トゥルーカラー
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const raw = new Uint8Array(H * (1 + W * 3))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0 // フィルタなし
  raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', new Uint8Array(0)),
])

const dest = new URL('../../テスト用の写真.png', import.meta.url)
writeFileSync(dest, png)
console.log(`書き出しました: ${decodeURIComponent(dest.pathname.replace(/^\//, ''))}`)
console.log(`  型紙の実寸 450 × 620 mm ／ 赤みがかった50cm定規を地の目線に沿わせて 15度傾けて撮影した想定`)
