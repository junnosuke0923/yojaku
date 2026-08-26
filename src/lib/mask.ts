/**
 * 白黒マスクの生成と整形。
 *
 * 「緑でない画素＝物体」という単純な判定から始めて、
 * ざらつきを削り、穴を埋め、つながりごとに切り分ける。
 *
 * ここは1枚の写真で100万画素を何度も舐める場所なので、
 * 読みやすさを損ねない範囲で、素直な書き方より速い書き方を選んでいる。
 * 学生のスマホは開発機より数倍遅いため、ここが体感の待ち時間を決める。
 */

import { DEFAULT_GREEN, type GreenParams } from './hsv'

export type Mask = {
  width: number
  height: number
  /** 1 = 物体（型紙）、0 = 背景（緑マット） */
  data: Uint8Array
}

/**
 * 緑でない画素を 1 にしたマスクを作る。
 *
 * 色相・鮮やかさ・明るさの計算は hsv.ts と同じだが、
 * 1画素ごとに配列を作らないよう、ここに展開してある。
 */
export function buildObjectMask(image: ImageData, params: GreenParams = DEFAULT_GREEN): Mask {
  const { width, height, data } = image
  const out = new Uint8Array(width * height)

  const center = params.hueCenter
  const tol = params.hueTolerance
  const minSat = params.minSaturation
  const minVal = params.minValue * 255

  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2]

    const max = r > g ? (r > b ? r : b) : g > b ? g : b
    if (max < minVal) { out[p] = 1; continue }   // 暗すぎる＝影。背景とみなさない

    const min = r < g ? (r < b ? r : b) : g < b ? g : b
    const d = max - min
    if (d < minSat * max) { out[p] = 1; continue } // 色がない＝白い紙

    let h: number
    if (max === r) h = (g - b) / d
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360

    // 色相は円環なので、差は回り込みを考える
    let hd = h - center
    if (hd < 0) hd = -hd
    if (hd > 180) hd = 360 - hd

    out[p] = hd <= tol ? 0 : 1
  }

  return { width, height, data: out }
}

/**
 * 3×3 の膨張・収縮。
 *
 * 3×3 の正方形は「横3つ」と「縦3つ」に分けて2回かけても同じ結果になる。
 * 9回の参照が 3+3 回で済み、内側のループも素直になる。
 */
function morph(
  src: Uint8Array,
  width: number,
  height: number,
  mode: 'erode' | 'dilate',
  tmp: Uint8Array,
  dst: Uint8Array,
): void {
  const erode = mode === 'erode'

  // 横方向。画像の外は背景（0）とみなす。
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const c = src[row + x]
      const l = x > 0 ? src[row + x - 1] : 0
      const r = x < width - 1 ? src[row + x + 1] : 0
      tmp[row + x] = erode ? (l & c & r) : (l | c | r)
    }
  }

  // 縦方向
  for (let y = 0; y < height; y++) {
    const row = y * width
    const up = row - width
    const down = row + width
    for (let x = 0; x < width; x++) {
      const c = tmp[row + x]
      const u = y > 0 ? tmp[up + x] : 0
      const d = y < height - 1 ? tmp[down + x] : 0
      dst[row + x] = erode ? (u & c & d) : (u | c | d)
    }
  }
}

function applySequence(mask: Mask, steps: Array<'erode' | 'dilate'>): Mask {
  const { width, height } = mask
  const size = width * height
  const tmp = new Uint8Array(size)
  // 元のマスクを壊さないよう複製し、以後は2つの入れ物を交互に使い回す
  let a = new Uint8Array(mask.data)
  let b = new Uint8Array(size)

  for (const step of steps) {
    morph(a, width, height, step, tmp, b)
    const swap = a
    a = b
    b = swap
  }

  return { width, height, data: a }
}

/** 収縮→膨張。ごま塩のような小さな誤検出を消す。 */
export function opening(mask: Mask, times = 1): Mask {
  const steps: Array<'erode' | 'dilate'> = []
  for (let i = 0; i < times; i++) steps.push('erode')
  for (let i = 0; i < times; i++) steps.push('dilate')
  return applySequence(mask, steps)
}

/** 膨張→収縮。型紙の中にできた小さな穴を埋める。 */
export function closing(mask: Mask, times = 1): Mask {
  const steps: Array<'erode' | 'dilate'> = []
  for (let i = 0; i < times; i++) steps.push('dilate')
  for (let i = 0; i < times; i++) steps.push('erode')
  return applySequence(mask, steps)
}

export type Component = {
  /**
   * そのかたまりだけを 1 にしたマスク。
   * 元画像の全面ではなく、かたまりを囲む範囲だけを切り出してある
   * （周囲に1画素の余白つき。輪郭をなぞるとき端で困らないように）。
   */
  mask: Mask
  /** mask の座標に足すと、元画像の座標になる */
  offsetX: number
  offsetY: number
  /** 画素数 */
  area: number
  minX: number; minY: number; maxX: number; maxY: number
}

export type ComponentsResult = {
  components: Component[]
  /** 小さすぎて捨てたかたまりの数 */
  discarded: number
}

/**
 * つながっている画素をひとかたまりとして切り分ける（8近傍・Union-Find）。
 * 1枚の写真に複数のパーツが写っていても、それぞれ別のかたまりになる。
 *
 * 写真にはごま粒のような誤検出が数百〜数千個できる。
 * それら全部に画像1枚ぶんの配列を割り当てると、スマホでは固まってしまう。
 * そこで、大きさの足りたものだけを、それを囲む範囲に切り出して返す。
 */
export function connectedComponents(mask: Mask, minArea: number): ComponentsResult {
  const { width, height, data } = mask
  const labels = new Int32Array(data.length)
  const parent: number[] = [0]

  const find = (a: number): number => {
    let r = a
    while (parent[r] !== r) r = parent[r]
    while (parent[a] !== r) { const next = parent[a]; parent[a] = r; a = next }
    return r
  }
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  // 1回目：仮のラベルを振りながら、つながりを記録する
  for (let y = 0; y < height; y++) {
    const row = y * width
    const up = row - width
    for (let x = 0; x < width; x++) {
      if (data[row + x] === 0) continue

      let best = 0
      if (x > 0 && labels[row + x - 1] !== 0) best = labels[row + x - 1]
      if (y > 0) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const nl = labels[up + nx]
          if (nl === 0) continue
          if (best === 0) best = nl
          else union(best, nl)
        }
      }

      if (best === 0) {
        best = parent.length
        parent.push(best)
      }
      labels[row + x] = best
    }
  }

  // 2回目：代表ラベルにまとめ、大きさと範囲を数える
  const n = parent.length
  const area = new Int32Array(n)
  const minXs = new Int32Array(n).fill(width)
  const minYs = new Int32Array(n).fill(height)
  const maxXs = new Int32Array(n).fill(-1)
  const maxYs = new Int32Array(n).fill(-1)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const l = labels[row + x]
      if (l === 0) continue
      const root = find(l)
      labels[row + x] = root
      area[root]++
      if (x < minXs[root]) minXs[root] = x
      if (x > maxXs[root]) maxXs[root] = x
      if (y < minYs[root]) minYs[root] = y
      if (y > maxYs[root]) maxYs[root] = y
    }
  }

  // 残すかたまりだけ、それを囲む範囲に切り出す
  const boxes = new Map<number, Component>()
  let discarded = 0
  for (let root = 1; root < n; root++) {
    if (area[root] === 0) continue
    if (area[root] < minArea) { discarded++; continue }
    const w = maxXs[root] - minXs[root] + 3
    const h = maxYs[root] - minYs[root] + 3
    boxes.set(root, {
      mask: { width: w, height: h, data: new Uint8Array(w * h) },
      offsetX: minXs[root] - 1,
      offsetY: minYs[root] - 1,
      area: area[root],
      minX: minXs[root], minY: minYs[root], maxX: maxXs[root], maxY: maxYs[root],
    })
  }

  for (const [root, comp] of boxes) {
    const { mask: sub, offsetX, offsetY } = comp
    for (let y = comp.minY; y <= comp.maxY; y++) {
      const row = y * width
      const subRow = (y - offsetY) * sub.width
      for (let x = comp.minX; x <= comp.maxX; x++) {
        if (labels[row + x] === root) sub.data[subRow + (x - offsetX)] = 1
      }
    }
  }

  return {
    components: [...boxes.values()].sort((a, b) => b.area - a.area),
    discarded,
  }
}
