/**
 * 「もう撮り終えた状態」を作る道具（開発用）。
 *
 * 実物の型紙がまだ手元に無いので、依頼者が用意したスカートの見本写真
 * （前・後ろ・ベルトと、まん中に置いた方眼定規）を、
 * アプリと同じ処理にかけて、出てきた実寸の輪郭を src/lib/devSeed.ts に書き出す。
 *
 * こうしておくと、撮影と定規合わせを毎回やり直さずに、
 * 縫い代や配置の画面だけを何度でも触れる。
 *
 *   実行: npm run seed
 *
 * 写真は1枚を1回だけ読む。定規が1本しか写っていないので、
 * 実寸も地の目の向きも、その1本から決まる。
 * （2026-08-31 に見本を差し替えるまでは、定規が縦横2本あったため2回に分けて読んでいた。
 *   写真に定規が2本あると、合わせなかったほうが、ただの物として型紙にくっついて読まれる）
 *
 * 見本の写真そのものは、この配りものの repository の外——
 * プロジェクトの一段上——に置いてある。学生に配るものではないため。
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  ?? fileURLToPath(new URL('../../テストサンプル.png', import.meta.url))

const img = downscale(readPng(SOURCE), MAX_EDGE)
const imageData = new NodeImageData(img.width, img.height, img.data) as unknown as ImageData
const green = { ...DEFAULT_GREEN, hueCenter: estimateHueCenter(img.data) }

/** 短辺を先に並べた四隅（defaultRulerQuad と同じ順番） */
const quadOf = (x0: number, y0: number, x1: number, y1: number, vertical: boolean): Quad =>
  vertical
    ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    : [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }]

/**
 * 見本の中で実際に測った定規の位置（縮小後の画素）。
 * 前と後ろのあいだに、縦に1本だけ置いてある。
 * この四隅から、縦横比 9.75 →「50cm定規」と自動で当てられている
 */
const RULER = quadOf(346, 290, 411, 924, true)

const out = analyze({ imageData, rulerQuad: RULER, ruler: RULERS.r50, green })
if ('error' in out) throw new Error(out.error)

console.log(`換算 ${out.scale.mmPerPixel.toFixed(4)} mm/px`
  + `  定規の自動判別 ${out.guess.suggested ?? 'なし'}（縦横比 ${out.guess.observedRatio.toFixed(2)}）`)
console.log(`  定規そのものとして取り除いた画素 ${out.rulerOverhangPx}`
  + `  小さすぎて捨てたかたまり ${out.discarded}`)
out.parts.forEach((p, i) => {
  console.log(`  ${i}: ${(p.widthMm / 10).toFixed(1)} × ${(p.heightMm / 10).toFixed(1)} cm`
    + `  点 ${p.outlineMm.length}`)
})

// 大きいほうから2つが前後スカート。見本では左が「後ろ」、右が「前」
const big = out.parts.slice().sort((a, b) => b.areaMm2 - a.areaMm2).slice(0, 2)
big.sort((a, b) => a.outlinePx[0].x - b.outlinePx[0].x)
const [ushiro, mae] = big

// 残ったいちばん細長いものがベルト
const beltPart = out.parts
  .filter((p) => p !== ushiro && p !== mae)
  .reduce((a, b) =>
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
 * もとは依頼者が用意したスカートの見本写真
 * （前スカート・後ろスカート・ベルトと、まん中に置いた方眼定規）。
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
