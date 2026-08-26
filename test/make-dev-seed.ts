/**
 * 「もう撮り終えた状態」を作る道具（開発用）。
 *
 * 実物の型紙がまだ手元に無いので、依頼者がイラストレーターで作った
 * スカートの図（前・後ろ・ベルト＋方眼定規）を、アプリと同じ処理にかけて、
 * 出てきた実寸の輪郭を src/lib/devSeed.ts に書き出す。
 *
 * こうしておくと、撮影と定規合わせを毎回やり直さずに、
 * 縫い代や配置の画面だけを何度でも触れる。
 *
 *   実行: npm run seed
 *
 * 写真は2回に分けて読む。
 * この図では前後スカートの定規が縦、ベルトの定規が横に置かれていて、
 * 地の目の向きが違うため。実際の撮影でも、向きが違うものは分けて撮ってもらう。
 */

import { writeFileSync } from 'node:fs'
import { readPng, downscale } from './png'
import { analyze } from '../src/lib/pipeline'
import { MAX_EDGE } from '../src/lib/image'
import { RULERS } from '../src/lib/ruler'
import { DEFAULT_GREEN, estimateHueCenter } from '../src/lib/hsv'
import type { Polygon, Quad } from '../src/lib/geom'

class NodeImageData {
  width: number
  height: number
  data: Uint8ClampedArray
  constructor(w: number, h: number, data?: Uint8ClampedArray) {
    this.width = w
    this.height = h
    this.data = data ?? new Uint8ClampedArray(w * h * 4)
  }
}
;(globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData

const SOURCE = process.argv[2]
  ?? 'C:/Users/bun121194/Desktop/スカート作図 (用尺シミュレーションTEST).png'

const img = downscale(readPng(SOURCE), MAX_EDGE)
const imageData = new NodeImageData(img.width, img.height, img.data) as unknown as ImageData
const green = { ...DEFAULT_GREEN, hueCenter: estimateHueCenter(img.data) }

/** 短辺を先に並べた四隅（defaultRulerQuad と同じ順番） */
const quadOf = (x0: number, y0: number, x1: number, y1: number, vertical: boolean): Quad =>
  vertical
    ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    : [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }]

/** 図の中で実際に測った定規の位置（縮小後の画素） */
const SKIRT_RULER = quadOf(215, 669, 272, 1249, true)   // 後ろスカートの上・縦向き
const BELT_RULER = quadOf(267, 273, 848, 331, false)    // ベルトの上・横向き。下へはみ出している

const run = (rulerQuad: Quad) => {
  const out = analyze({ imageData, rulerQuad, ruler: RULERS.r50, green })
  if ('error' in out) throw new Error(out.error)
  return out
}

const skirts = run(SKIRT_RULER)
const belt = run(BELT_RULER)

const show = (label: string, r: ReturnType<typeof run>) => {
  console.log(`\n${label}  換算 ${r.scale.mmPerPixel.toFixed(4)} mm/px  はみ出し除去 ${r.rulerOverhangPx}px`)
  r.parts.forEach((p, i) => {
    console.log(
      `  ${i}: ${(p.widthMm / 10).toFixed(1)} × ${(p.heightMm / 10).toFixed(1)} cm` +
      `  点 ${p.outlineMm.length}`,
    )
  })
}
show('縦の定規で読んだとき', skirts)
show('横の定規で読んだとき', belt)

/** 面積の大きい順に並べた添字 */
const byArea = (r: ReturnType<typeof run>) =>
  r.parts.map((p, i) => ({ p, i })).sort((a, b) => b.p.areaMm2 - a.p.areaMm2)

// 縦の定規の回からは、大きいほうから2つ（前後スカート）。
// 図では左が「後ろ」、右が「前」に描かれている
const big = byArea(skirts).slice(0, 2).map((e) => e.p)
big.sort((a, b) => a.outlinePx[0].x - b.outlinePx[0].x)
const [ushiro, mae] = big

// 横の定規の回からは、いちばん細長いもの（ベルト）
const beltPart = belt.parts.reduce((a, b) =>
  Math.max(a.heightMm, a.widthMm) / Math.min(a.heightMm, a.widthMm) >
  Math.max(b.heightMm, b.widthMm) / Math.min(b.heightMm, b.widthMm) ? a : b)

const round = (poly: Polygon) =>
  '[' + poly.map((q) => `[${q.x.toFixed(1)},${q.y.toFixed(1)}]`).join(',') + ']'

const seeds = [
  { name: '前スカート', needed: 2, part: mae },
  { name: '後ろスカート', needed: 2, part: ushiro },
  { name: 'ベルト', needed: 1, part: beltPart },
]

const body = seeds.map((s) =>
  `  {\n` +
  `    name: '${s.name}',\n` +
  `    needed: ${s.needed},\n` +
  `    widthMm: ${s.part.widthMm.toFixed(1)},\n` +
  `    heightMm: ${s.part.heightMm.toFixed(1)},\n` +
  `    outline: ${round(s.part.outlineMm)},\n` +
  `  },`,
).join('\n')

const file = `/**
 * 開発用の「撮影ずみ」データ。自動生成なので手で直さないこと。
 *
 * 作り直す: npm run seed
 *
 * もとは依頼者がイラストレーターで作ったスカートの図
 * （前スカート・後ろスカート・ベルトに方眼定規を載せたもの）。
 * それをアプリと同じ処理にかけ、出てきた実寸の輪郭だけを写してある。
 *
 * URL のうしろに ?dev を付けて開いたときだけ読み込まれる。
 * 学生が見る画面には出てこないし、ふだんの配信ファイルにも混ざらない。
 */

/** [x, y] のミリメートル。左上を原点に寄せてある */
type Pt = [number, number]

export type Seed = {
  name: string
  needed: number
  widthMm: number
  heightMm: number
  outline: Pt[]
}

export const DEV_SEEDS: Seed[] = [
${body}
]
`

const dest = new URL('../src/lib/devSeed.ts', import.meta.url)
writeFileSync(dest, file)
console.log('\n書き出しました → src/lib/devSeed.ts')
for (const s of seeds) {
  console.log(`  ${s.name}  ${(s.part.widthMm / 10).toFixed(1)} × ${(s.part.heightMm / 10).toFixed(1)} cm`)
}
