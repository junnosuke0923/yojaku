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
import { findRulerQuad } from '../src/lib/findRuler'
import { DEFAULT_GREEN, estimateHueCenter } from '../src/lib/hsv'
import { dist, type Point, type Quad } from '../src/lib/geom'

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

/**
 * ベルトほどの細長いパーツ。68 × 3.2 cm。
 * 定規の幅は5cmあるので、地の目に沿わせて載せると必ず横へはみ出す。
 * 見返し・バイアス布でも同じことが起きる。
 */
const BELT_MM: Point[] = [
  { x: 180, y: 40 }, { x: 212, y: 40 }, { x: 212, y: 720 }, { x: 180, y: 720 },
]
const BELT_WIDTH_MM = 212 - 180   // 32
const BELT_HEIGHT_MM = 720 - 40   // 680

/**
 * 一度に何枚も撮るとき用の、2枚並べた型紙（依頼者の質問・2026-08-26）。
 *
 * 定規は手元に1本しかないので、写真の中にも1本しか写らない。
 * 定規は写真の面そのものの実寸を決めているので、
 * 1本あれば写真に写っているものは全部そのまま測れる——それを確かめる。
 * 大きさを変えてあるのは、面積の大きい順に並ぶことを当てにするため。
 */
const TWIN_A_MM: Point[] = [
  { x: 30, y: 70 }, { x: 290, y: 70 }, { x: 290, y: 620 }, { x: 30, y: 620 },
]
const TWIN_B_MM: Point[] = [
  { x: 480, y: 70 }, { x: 710, y: 70 }, { x: 710, y: 620 }, { x: 480, y: 620 },
]
const TWIN_EXPECT = [
  { widthMm: 260, heightMm: 550 },
  { widthMm: 230, heightMm: 550 },
]

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
  /** 何枚も一度に写すとき。指定すると pattern より優先する */
  patterns?: Point[][]
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

  for (const poly of opts.patterns ?? [opts.pattern ?? PATTERN_MM]) {
    fillPolygon(img, poly.map(project), PAPER)
  }
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
  /** 寸法の許容ずれ（%）。省略すると 2% */
  tolerancePercent?: number
  /**
   * 4隅を台形に合わせた場合（射影変換）。
   * 合成画像の4隅は誤差ゼロなので、傾いた場面はこちらで測る。
   * 既定の相似変換は遠近を表せないぶん、傾きに応じて片寄る（buildScale の説明を参照）
   */
  perspective?: boolean
}

/**
 * 何枚も一度に撮ったときの検算。
 *
 * 定規が1本しかなくても、写真の面の実寸はそれで決まるので、
 * 写っているパーツはすべて同じ換算で測れるはず。
 * 定規を緑の上に置いた場合と、どれか1枚に載せた場合の両方を見る。
 */
function runMulti(
  title: string,
  opts: {
    tiltDeg: number
    patterns: Point[][]
    rulerOriginMm: Point
    expect: { widthMm: number; heightMm: number }[]
    tolerancePercent?: number
    perspective?: boolean
  },
) {
  console.log(`
■ ${title}`)
  const scene = buildScene({
    rulerId: 'r50',
    tiltDeg: opts.tiltDeg,
    opaqueRuler: false,
    tintedRuler: true,
    patterns: opts.patterns,
    rulerOriginMm: opts.rulerOriginMm,
  })
  const image = scene.image as unknown as ImageData
  const hue = estimateHueCenter(image.data)

  const out = analyze({
    imageData: image,
    rulerQuad: scene.rulerQuad,
    ruler: RULERS.r50,
    green: { ...DEFAULT_GREEN, hueCenter: hue },
    perspective: opts.perspective,
  })
  if ('error' in out) {
    failures++
    console.log(`  NG  解析に失敗: ${out.error}`)
    return
  }

  report(
    '検出したパーツ数',
    out.parts.length === opts.expect.length,
    `${out.parts.length} 個（正解 ${opts.expect.length} 個・定規は除外されるべき）`,
  )
  if (out.parts.length !== opts.expect.length) return

  const tol = opts.tolerancePercent ?? 3
  out.parts.forEach((part, i) => {
    check(`パーツ${i + 1} 最大幅 (mm)`, part.widthMm, opts.expect[i].widthMm, tol)
    check(`パーツ${i + 1} 最大丈 (mm)`, part.heightMm, opts.expect[i].heightMm, tol)
  })
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
    perspective: opts.perspective,
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
  const tol = opts.tolerancePercent ?? 2
  check('最大幅 (mm)', part.widthMm, opts.expectWidthMm ?? TRUE_WIDTH_MM, tol)
  check('最大丈 (mm)', part.heightMm, opts.expectHeightMm ?? TRUE_HEIGHT_MM, tol)
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
run('10度傾き・50cm定規・透明', { rulerId: 'r50', tiltDeg: 10, opaqueRuler: false, perspective: true })
run('20度傾き・50cm定規・透明', { rulerId: 'r50', tiltDeg: 20, opaqueRuler: false, perspective: true })
run('真上から・30cm定規・透明', { rulerId: 'r30', tiltDeg: 0, opaqueRuler: false })
run('10度傾き・50cm定規・不透明', { rulerId: 'r50', tiltDeg: 10, opaqueRuler: true, perspective: true })

console.log('\n── 実物どおりの定規（赤みがかった半透明）を、型紙の上に載せた場合 ──')

run('大パーツ・定規は収まる', {
  rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
  rulerOriginMm: { x: 250, y: 60 },
  expectOverhang: false,
})
run('大パーツ・10度傾き', {
  rulerId: 'r50', tiltDeg: 10, opaqueRuler: false, tintedRuler: true, perspective: true,
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
  rulerId: 'r50', tiltDeg: 15, opaqueRuler: false, tintedRuler: true, perspective: true,
  pattern: SMALL_MM, rulerOriginMm: { x: 195, y: 10 },
  expectWidthMm: SMALL_WIDTH_MM, expectHeightMm: SMALL_HEIGHT_MM,
  expectOverhang: true,
})

/*
 * ベルト。定規（幅5cm）のほうがパーツ（幅3.2cm）より太いので、
 * 地の目に沿わせて載せると横へはみ出す。
 * 定規より長いパーツなので、両端の外側で幅が見えている。そこから縁をつなぐ。
 *
 * 許容を 12% にしているのは、タップのずれを見込んで縁から 3mm 残す作りのため。
 * 3mm は 32mm に対して 9% になる。多めに出るぶんには生地が足りなくならない。
 */
run('細長いパーツ・定規が横へはみ出す', {
  rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
  pattern: BELT_MM, rulerOriginMm: { x: 190, y: 130 },
  expectWidthMm: BELT_WIDTH_MM, expectHeightMm: BELT_HEIGHT_MM,
  expectOverhang: true, tolerancePercent: 12,
})
run('細長いパーツ・横へはみ出し・10度傾き', {
  rulerId: 'r50', tiltDeg: 10, opaqueRuler: false, tintedRuler: true, perspective: true,
  pattern: BELT_MM, rulerOriginMm: { x: 190, y: 130 },
  expectWidthMm: BELT_WIDTH_MM, expectHeightMm: BELT_HEIGHT_MM,
  expectOverhang: true, tolerancePercent: 12,
})

/*
  何枚も一度に撮る（依頼者の質問・2026-08-26）。
  定規は1本しかないので、写真のどこか一箇所にしか置けない。
  それでも写真の面の実寸は決まるので、写っているパーツは全部測れるはず。
*/
runMulti('2枚を一度に・定規は緑の上', {
  tiltDeg: 0, patterns: [TWIN_A_MM, TWIN_B_MM],
  rulerOriginMm: { x: 360, y: 70 }, expect: TWIN_EXPECT,
})
runMulti('2枚を一度に・定規は緑の上・12度傾き', {
  tiltDeg: 12, perspective: true, patterns: [TWIN_A_MM, TWIN_B_MM],
  rulerOriginMm: { x: 360, y: 70 }, expect: TWIN_EXPECT,
})
runMulti('2枚を一度に・定規は左のパーツの上', {
  tiltDeg: 0, patterns: [TWIN_A_MM, TWIN_B_MM],
  rulerOriginMm: { x: 110, y: 100 }, expect: TWIN_EXPECT,
})

/*
  4隅が指のぶんずれたとき、どれだけ持ちこたえるか。

  これが「射影変換をやめて相似変換を既定にした」根拠（2026-08-26）。
  4隅がぴったりなら射影変換のほうが正確だが、実際には指で合わせるので数画素ずれる。
  射影変換はそのずれを遠近だと受け取り、定規から遠いものほど大きく歪ませる。
  依頼者から「定規を片方のスカートに合わせたら、もう片方の形がいびつになる」
  という報告があり、原因はこれだった。
*/
console.log('\n■ 4隅が指のぶんずれたときの強さ（既定の相似変換 と 射影変換）')
{
  let seed = 4242
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }

  /** ずれを与えて何度も測り、幅と丈の誤差の大きいほうの平均と最悪を返す */
  const trial = (tiltDeg: number, jitterPx: number, perspective: boolean) => {
    const scene = buildScene({ rulerId: 'r50', tiltDeg, opaqueRuler: false })
    const image = scene.image as unknown as ImageData
    const green = { ...DEFAULT_GREEN, hueCenter: estimateHueCenter(image.data) }
    let sum = 0
    let worst = 0
    const runs = 8
    for (let k = 0; k < runs; k++) {
      const rulerQuad = scene.rulerQuad.map((p) => ({
        x: p.x + rnd() * jitterPx * 2,
        y: p.y + rnd() * jitterPx * 2,
      })) as Quad
      const out = analyze({ imageData: image, rulerQuad, ruler: RULERS.r50, green, perspective })
      if ('error' in out || out.parts.length === 0) {
        sum += 100
        worst = 100
        continue
      }
      const part = out.parts[0]
      const e =
        Math.max(
          Math.abs(part.widthMm - TRUE_WIDTH_MM) / TRUE_WIDTH_MM,
          Math.abs(part.heightMm - TRUE_HEIGHT_MM) / TRUE_HEIGHT_MM,
        ) * 100
      sum += e
      worst = Math.max(worst, e)
    }
    return { avg: sum / runs, worst }
  }

  for (const tiltDeg of [0, 10]) {
    for (const jitterPx of [4, 8]) {
      const sim = trial(tiltDeg, jitterPx, false)
      const per = trial(tiltDeg, jitterPx, true)
      console.log(
        `        傾き${String(tiltDeg).padStart(2)}度・4隅が±${jitterPx}画素ずれ  ` +
          `相似 平均${sim.avg.toFixed(1)}% 最悪${sim.worst.toFixed(1)}%   ` +
          `射影 平均${per.avg.toFixed(1)}% 最悪${per.worst.toFixed(1)}%`,
      )
      report(
        `傾き${tiltDeg}度・±${jitterPx}画素`,
        sim.worst < 6,
        `相似変換の最悪 ${sim.worst.toFixed(1)}%（6%未満であること）`,
      )
      report(
        '  射影変換より強いか',
        sim.worst < per.worst,
        `相似 ${sim.worst.toFixed(1)}% ＜ 射影 ${per.worst.toFixed(1)}%`,
      )
    }
  }
}

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

/**
 * 定規の自動あてはめ（src/lib/findRuler.ts）。
 *
 * ここで守らせたい性質は、`sweepGuess` と同じ考えでいる。
 * **当たることより、外れたまま通してしまわないこと。**
 * 四隅が外れると、そのあとの寸法がぜんぶ狂う。
 * 分からないときは黙って手で合わせてもらうほうが安い。
 */
function sweepFind() {
  console.log('\n■ 定規の自動あてはめ（真上から撮ったとき）')
  for (const rulerId of ['r50', 'r30'] as const) {
    for (const tiltDeg of [0, 5, 10]) {
      const scene = buildScene({ rulerId, tiltDeg, opaqueRuler: false, tintedRuler: true })
      const image = scene.image as unknown as ImageData
      const hue = estimateHueCenter(image.data)
      const found = findRulerQuad(image, { ...DEFAULT_GREEN, hueCenter: hue })
      if (!found) {
        report(`${rulerId} 傾き${tiltDeg}度`, false, '見つけられなかった')
        continue
      }
      const err = quadError(found.quad, scene.rulerQuad)
      const long = Math.max(
        dist(scene.rulerQuad[0], scene.rulerQuad[1]),
        dist(scene.rulerQuad[1], scene.rulerQuad[2]),
      )
      report(
        `${rulerId} 傾き${tiltDeg}度`,
        err / long < 0.02,
        `四隅のずれ 最大 ${err.toFixed(1)}px（長辺の ${((err / long) * 100).toFixed(1)}%）`,
      )
    }
  }

  console.log('\n■ 定規の自動あてはめ（当ててはいけないとき）')
  {
    // 定規が写っていない写真。黙って手で合わせてもらう
    const scene = buildScene({ rulerId: 'r50', tiltDeg: 0, opaqueRuler: false })
    const image = scene.image as unknown as ImageData
    const hue = estimateHueCenter(image.data)
    const found = findRulerQuad(image, { ...DEFAULT_GREEN, hueCenter: hue })
    report('定規が写っていない', found === null, found ? '当ててしまった' : '当てなかった')
  }
  {
    // 細長い型紙（ベルトなど）を、定規と取り違えないこと。
    // 見本の写真では、ベルトの縦横比 20.6 のほうが定規の 9.72 より細長かった
    const belt: Point[] = [
      { x: 700, y: 20 }, { x: 760, y: 20 }, { x: 760, y: 640 }, { x: 700, y: 640 },
    ]
    const scene = buildScene({
      rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
      patterns: [PATTERN_MM, belt],
    })
    const image = scene.image as unknown as ImageData
    const hue = estimateHueCenter(image.data)
    const found = findRulerQuad(image, { ...DEFAULT_GREEN, hueCenter: hue })
    const err = found ? quadError(found.quad, scene.rulerQuad) : Infinity
    report('細長い型紙が並んでいる', err < 8, found ? `四隅のずれ ${err.toFixed(1)}px` : '見つけられなかった')
  }
  {
    // 定規とまったく同じ形の紙が並んでいる。透けているかどうかだけが手がかり
    const strip: Point[] = [
      { x: 700, y: 20 }, { x: 750, y: 20 }, { x: 750, y: 520 }, { x: 700, y: 520 },
    ]
    const scene = buildScene({
      rulerId: 'r50', tiltDeg: 0, opaqueRuler: false, tintedRuler: true,
      patterns: [PATTERN_MM, strip],
    })
    const image = scene.image as unknown as ImageData
    const hue = estimateHueCenter(image.data)
    const found = findRulerQuad(image, { ...DEFAULT_GREEN, hueCenter: hue })
    const err = found ? quadError(found.quad, scene.rulerQuad) : Infinity
    report(
      '定規と同じ形の紙が並ぶ',
      found === null || err < 8,
      found ? `四隅のずれ ${err.toFixed(1)}px（紙のほうを選んだら NG）` : '当てなかった（手で合わせてもらう）',
    )
  }
}

/** 2つの四角形の、いちばん離れた角どうしの距離。角の順番は問わない */
function quadError(a: Quad, b: Quad): number {
  let worst = 0
  for (const p of b) {
    let near = Infinity
    for (const q of a) near = Math.min(near, dist(p, q))
    worst = Math.max(worst, near)
  }
  return worst
}

sweepFind()

console.log(failures === 0 ? '\nすべて通りました。' : `\n${failures} 件、期待どおりになりませんでした。`)
process.exit(failures === 0 ? 0 : 1)
