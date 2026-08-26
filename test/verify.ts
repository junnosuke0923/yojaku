/**
 * 合成画像による検算。
 *
 * 実写がまだ無い段階で「計算そのものが正しいか」を確かめるための道具。
 * 実寸が分かっている型紙と定規を、わざと斜めから撮ったように歪ませて画像を作り、
 * それを解析して元の寸法に戻せるかを見る。
 *
 *   実行: npx esbuild test/verify.ts --bundle --platform=node --format=esm --outfile=test/verify.mjs && node test/verify.mjs
 */

import { analyze } from '../src/lib/pipeline'
import { guessRuler, RULERS } from '../src/lib/ruler'
import { DEFAULT_GREEN, estimateHueCenter } from '../src/lib/hsv'
import type { Point, Quad } from '../src/lib/geom'

// Node には ImageData が無いので、必要な部分だけ用意する
class NodeImageData {
  width: number
  height: number
  data: Uint8ClampedArray
  constructor(w: number, h: number) {
    this.width = w
    this.height = h
    this.data = new Uint8ClampedArray(w * h * 4)
  }
}
;(globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData

const W = 1200
const H = 900

const GREEN: [number, number, number] = [60, 140, 95]
const PAPER: [number, number, number] = [235, 230, 220]
const PLASTIC: [number, number, number] = [205, 208, 210]
/** 実物は赤みがかった半透明。下の色を残しつつ、赤を乗せる。 */
const TINT: [number, number, number] = [206, 96, 88]
const TINT_ALPHA = 0.42

/** 実寸(mm)の型紙。前身頃を思わせるかたち。bbox は 450 × 620 mm。 */
const PATTERN_MM: Point[] = [
  { x: 100, y: 20 },
  { x: 300, y: 24 },
  { x: 400, y: 90 },
  { x: 520, y: 210 },
  { x: 550, y: 350 },
  { x: 520, y: 500 },
  { x: 540, y: 640 },
  { x: 200, y: 636 },
  { x: 140, y: 420 },
  { x: 105, y: 220 },
]
/** カフスほどの小さいパーツ。50cm定規を載せると上下にはみ出す。 */
const SMALL_MM: Point[] = [
  { x: 120, y: 200 }, { x: 320, y: 198 }, { x: 322, y: 320 }, { x: 118, y: 322 },
]
const SMALL_WIDTH_MM = 322 - 118   // 204
const SMALL_HEIGHT_MM = 322 - 198  // 124

const TRUE_WIDTH_MM = 550 - 100  // 450
const TRUE_HEIGHT_MM = 640 - 20  // 620

/**
 * 本物のカメラを模した写しかた（ピンホールモデル）。
 *
 * 机の面を高さ0の平面とし、その上 distanceMm のところに
 * tiltDeg だけ傾けたカメラを置いて撮る。画素は正方形。
 * ここを「適当な台形変換」で済ませると、実際のカメラでは起きない
 * 縦横のゆがみが混ざり、定規の判別テストが意味をなさなくなる。
 */
function makeCamera(tiltDeg: number, distanceMm = 1600, focalPx = 1700) {
  const t = (tiltDeg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  // 画面の中心に来てほしい机の上の点
  const lookAt = { x: 300, y: 330 }
  // 傾けても、その点が画面の中心に残るようにレンズを向け直す
  const recenter = focalPx * Math.tan(t)

  return (p: Point): Point => {
    const x = p.x - lookAt.x
    const y = p.y - lookAt.y
    // カメラを傾ける（机の面を回すのと同じこと）
    const yc = y * cos + distanceMm * sin
    const zc = -y * sin + distanceMm * cos
    if (zc <= 1) throw new Error('カメラの後ろに回り込みました')
    return { x: (focalPx * x) / zc + W / 2, y: (focalPx * yc) / zc + H / 2 - recenter }
  }
}

function fillPolygon(img: NodeImageData, poly: Point[], rgb: [number, number, number], alpha = 1) {
  let minY = Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(img.height - 1, Math.ceil(maxY))

  for (let y = y0; y <= y1; y++) {
    const xs: number[] = []
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]
      if (a.y > y === b.y > y) continue
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]))
      const x1 = Math.min(img.width - 1, Math.floor(xs[k + 1]))
      for (let x = x0; x <= x1; x++) {
        const i = (y * img.width + x) * 4
        for (let c = 0; c < 3; c++) {
          img.data[i + c] = img.data[i + c] * (1 - alpha) + rgb[c] * alpha
        }
        img.data[i + 3] = 255
      }
    }
  }
}

/** 実際のカメラらしく、ざらつきと明るさのむらを足す。 */
function addNoise(img: NodeImageData, amount: number) {
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  for (let y = 0; y < img.height; y++) {
    // 画面の端が暗くなる（周辺光量落ち）
    const vignette = 1 - 0.12 * Math.abs(y / img.height - 0.5) * 2
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = img.data[i + c] * vignette + rand() * amount
      }
    }
  }
}

type Scene = {
  image: NodeImageData
  rulerQuad: Quad
}

function buildScene(opts: {
  rulerId: 'r50' | 'r30'
  tiltDeg: number
  opaqueRuler: boolean
  distanceMm?: number
  /** 赤みがかった半透明の定規として描く（実物に近い） */
  tintedRuler?: boolean
  /** 型紙の形。省略すると前身頃 */
  pattern?: Point[]
  /** 定規の左上を実寸のどこに置くか。省略すると型紙の左脇（従来どおり） */
  rulerOriginMm?: Point
}): Scene {
  const distance = opts.distanceMm ?? 1600
  // 距離を変えても写る大きさが変わらないよう、焦点距離も合わせて動かす
  const project = makeCamera(opts.tiltDeg, distance, (1700 * distance) / 1600)

  const img = new NodeImageData(W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = GREEN[0]
    img.data[i + 1] = GREEN[1]
    img.data[i + 2] = GREEN[2]
    img.data[i + 3] = 255
  }

  const spec = RULERS[opts.rulerId]
  const origin = opts.rulerOriginMm ?? { x: 0, y: 20 }
  const rulerMm: Quad = [
    { x: origin.x, y: origin.y },
    { x: origin.x + spec.shortMm, y: origin.y },
    { x: origin.x + spec.shortMm, y: origin.y + spec.longMm },
    { x: origin.x, y: origin.y + spec.longMm },
  ]
  const rulerQuad = rulerMm.map(project) as Quad

  fillPolygon(img, (opts.pattern ?? PATTERN_MM).map(project), PAPER)
  if (opts.opaqueRuler) fillPolygon(img, rulerQuad, PLASTIC)
  // 実物どおりの描き方。紙の上では紙が赤く、緑の上では緑が赤く濁って見える
  else if (opts.tintedRuler) fillPolygon(img, rulerQuad, TINT, TINT_ALPHA)

  addNoise(img, 10)
  return { image: img, rulerQuad }
}

// ── 検算 ───────────────────────────────────────────────

let failures = 0

function check(label: string, actual: number, expected: number, tolerancePercent: number) {
  const diff = Math.abs(actual - expected)
  const pct = (diff / expected) * 100
  const ok = pct <= tolerancePercent
  if (!ok) failures++
  const mark = ok ? 'OK  ' : 'NG  '
  console.log(
    `  ${mark}${label.padEnd(24)} 実測 ${actual.toFixed(1).padStart(7)}  正解 ${expected.toFixed(1).padStart(7)}  ずれ ${pct.toFixed(2)}%`,
  )
}

function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'NG  '}${label.padEnd(24)} ${detail}`)
}

type RunOpts = {
  rulerId: 'r50' | 'r30'
  tiltDeg: number
  opaqueRuler: boolean
  tintedRuler?: boolean
  pattern?: Point[]
  rulerOriginMm?: Point
  expectWidthMm?: number
  expectHeightMm?: number
  /** 定規が型紙からはみ出しているはず（取り除いた画素があるはず） */
  expectOverhang?: boolean
}

function run(title: string, opts: RunOpts) {
  console.log(`\n■ ${title}`)
  const scene = buildScene(opts)
  const image = scene.image as unknown as ImageData

  const hue = estimateHueCenter(image.data)
  report('緑の自動推定', Math.abs(hue - 146) < 12, `色相 ${hue.toFixed(0)}° （正解 146°）`)

  const out = analyze({
    imageData: image,
    rulerQuad: scene.rulerQuad,
    ruler: RULERS[opts.rulerId],
    green: { ...DEFAULT_GREEN, hueCenter: hue },
  })

  if ('error' in out) {
    failures++
    console.log(`  NG  解析に失敗: ${out.error}`)
    return
  }

  report('検出したパーツ数', out.parts.length === 1, `${out.parts.length} 個（正解 1 個・定規は除外されるべき）`)

  if (opts.expectOverhang !== undefined) {
    const removed = out.rulerOverhangPx > 0
    report(
      'はみ出しの取り除き',
      removed === opts.expectOverhang,
      `${out.rulerOverhangPx} 画素を除去（${opts.expectOverhang ? 'はみ出しているはず' : 'はみ出していないはず'}）`,
    )
  }

  if (out.parts.length === 0) return

  const part = out.parts[0]
  check('最大幅 (mm)', part.widthMm, opts.expectWidthMm ?? TRUE_WIDTH_MM, 2)
  check('最大丈 (mm)', part.heightMm, opts.expectHeightMm ?? TRUE_HEIGHT_MM, 2)
}

/**
 * 自動判別に守らせたい性質は「当たること」ではなく、
 * 「外れた提案を出さないこと」。分からないときは黙るのが正しい。
 *
 * 傾きと撮影距離を総当たりして、誤った提案が1件も出ないことを確かめる。
 */
function sweepGuess() {
  const tilts = [0, 5, 10, 15, 20, 25, 30, 35]
  const distances = [600, 800, 1200, 1600]
  const rulers: Array<'r50' | 'r30'> = ['r50', 'r30']

  let suggested = 0
  let wrong = 0
  let total = 0
  const wrongCases: string[] = []

  for (const rulerId of rulers) {
    for (const tiltDeg of tilts) {
      for (const distanceMm of distances) {
        total++
        const scene = buildScene({ rulerId, tiltDeg, opaqueRuler: false, distanceMm })
        const g = guessRuler(scene.rulerQuad)
        if (!g.confident || !g.suggested) continue
        suggested++
        if (g.suggested !== rulerId) {
          wrong++
          wrongCases.push(
            `${rulerId} を ${tiltDeg}度・${distanceMm}mm で撮影 → ${g.suggested} と誤提案（縦横比 ${g.observedRatio.toFixed(2)}）`,
          )
        }
      }
    }
  }

  report('誤った提案の件数', wrong === 0, `${wrong} 件 / 提案した ${suggested} 件（全 ${total} 通り）`)
  for (const c of wrongCases) console.log(`        ${c}`)

  // 真上から撮ったときは、必ず提案が出てほしい（出ないなら機能として無意味）
  for (const rulerId of rulers) {
    const g = guessRuler(buildScene({ rulerId, tiltDeg: 0, opaqueRuler: false }).rulerQuad)
    report(
      `真上・${RULERS[rulerId].label}`,
      g.confident && g.suggested === rulerId,
      `縦横比 ${g.observedRatio.toFixed(2)} → ${g.suggested ?? '（提案しない）'}`,
    )
  }

  console.log(
    `        提案が出たのは ${((suggested / total) * 100).toFixed(0)}%。` +
    `残りは黙って、学生が選んだ値をそのまま使う。`,
  )
}

console.log('合成画像による検算 — 実寸 450 × 620 mm の型紙を、歪ませてから元に戻せるか')

run('真上から・50cm定規・透明', { rulerId: 'r50', tiltDeg: 0, opaqueRuler: false })
run('10度傾き・50cm定規・透明', { rulerId: 'r50', tiltDeg: 10, opaqueRuler: false })
run('20度傾き・50cm定規・透明', { rulerId: 'r50', tiltDeg: 20, opaqueRuler: false })
run('真上から・30cm定規・透明', { rulerId: 'r30', tiltDeg: 0, opaqueRuler: false })
run('10度傾き・50cm定規・不透明', { rulerId: 'r50', tiltDeg: 10, opaqueRuler: true })

console.log('\n── 実物どおりの定規（赤みがかった半透明）を、型紙の上に載せた場合 ──')

run('大パーツ・定規は収まる', {
  rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
  rulerOriginMm: { x: 250, y: 60 },
  expectOverhang: false,
})
run('大パーツ・10度傾き', {
  rulerId: 'r50', tiltDeg: 10, opaqueRuler: false, tintedRuler: true,
  rulerOriginMm: { x: 250, y: 60 },
  expectOverhang: false,
})
run('小パーツ・定規がはみ出す', {
  rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
  pattern: SMALL_MM, rulerOriginMm: { x: 195, y: 10 },
  expectWidthMm: SMALL_WIDTH_MM, expectHeightMm: SMALL_HEIGHT_MM,
  expectOverhang: true,
})
run('小パーツ・はみ出し・15度傾き', {
  rulerId: 'r50', tiltDeg: 15, opaqueRuler: false, tintedRuler: true,
  pattern: SMALL_MM, rulerOriginMm: { x: 195, y: 10 },
  expectWidthMm: SMALL_WIDTH_MM, expectHeightMm: SMALL_HEIGHT_MM,
  expectOverhang: true,
})

console.log('\n■ 定規の自動判別（傾き0〜35度 × 距離60〜160cm を総当たり）')
sweepGuess()

console.log('\n■ 定規を取り違えたときの被害を確認（0.6倍になるはず）')
{
  const scene = buildScene({ rulerId: 'r50', tiltDeg: 0, opaqueRuler: false })
  const out = analyze({
    imageData: scene.image as unknown as ImageData,
    rulerQuad: scene.rulerQuad,
    ruler: RULERS.r30, // わざと間違える
    green: { ...DEFAULT_GREEN, hueCenter: estimateHueCenter(scene.image.data) },
  })
  if ('error' in out || out.parts.length === 0) {
    failures++
    console.log('  NG  解析に失敗')
  } else {
    check('誤選択時の最大丈 (mm)', out.parts[0].heightMm, TRUE_HEIGHT_MM * 0.6, 2)
  }
}

console.log(failures === 0 ? '\nすべて通りました。' : `\n${failures} 件、期待どおりになりませんでした。`)
process.exit(failures === 0 ? 0 : 1)
