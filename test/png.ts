/**
 * 検算用の、ごく小さな PNG 読み取り。
 *
 * 実写のかわりに使う画像（イラストレーターから書き出したもの）を
 * Node で読むためだけのもの。外部のライブラリを入れたくないので、
 * Node に最初から入っている zlib だけで書いてある。
 *
 * 対応しているのは 8bit の色（グレー・RGB・RGBA・パレット）で、
 * インターレースなし。書き出した PNG はこの形になる。
 */

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export type Rgba = { width: number; height: number; data: Uint8ClampedArray }

const BYTES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function readPng(path: string): Rgba {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません')

  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Buffer | null = null
  let alpha: Buffer | null = null
  const chunks: Buffer[] = []

  let at = 8
  while (at < buf.length) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const body = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
      if (body[12] !== 0) throw new Error('インターレースには対応していません')
    } else if (type === 'PLTE') palette = Buffer.from(body)
    else if (type === 'tRNS') alpha = Buffer.from(body)
    else if (type === 'IDAT') chunks.push(Buffer.from(body))
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (depth !== 8) throw new Error(`8bit 以外には対応していません（${depth}bit）`)

  const channels = BYTES[colorType]
  if (!channels) throw new Error(`未対応の色の形式です（${colorType}）`)

  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const lines = new Uint8Array(height * stride)

  // PNG は行ごとに「前の行との差」で縮めてある。それを戻す
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    const row = y * stride
    const prev = row - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src++]
      const a = i >= channels ? lines[row + i - channels] : 0
      const b = y > 0 ? lines[prev + i] : 0
      const c = y > 0 && i >= channels ? lines[prev + i - channels] : 0
      let v: number
      switch (filter) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`未対応のフィルタ（${filter}）`)
      }
      lines[row + i] = v & 0xff
    }
  }

  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels
    const d = i * 4
    if (colorType === 0) {
      data[d] = data[d + 1] = data[d + 2] = lines[s]
      data[d + 3] = 255
    } else if (colorType === 2) {
      data[d] = lines[s]; data[d + 1] = lines[s + 1]; data[d + 2] = lines[s + 2]; data[d + 3] = 255
    } else if (colorType === 3) {
      const p = lines[s] * 3
      data[d] = palette![p]; data[d + 1] = palette![p + 1]; data[d + 2] = palette![p + 2]
      data[d + 3] = alpha && lines[s] < alpha.length ? alpha[lines[s]] : 255
    } else if (colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = lines[s]
      data[d + 3] = lines[s + 1]
    } else {
      data[d] = lines[s]; data[d + 1] = lines[s + 1]
      data[d + 2] = lines[s + 2]; data[d + 3] = lines[s + 3]
    }
  }
  return { width, height, data }
}

/**
 * 長辺が max になるまで縮める。アプリ側（image.ts）と同じ 1400px に合わせて使う。
 * 元の画素を平均して縮めるので、細い線が消えにくい。
 */
export function downscale(img: Rgba, max: number): Rgba {
  const ratio = Math.min(1, max / Math.max(img.width, img.height))
  if (ratio === 1) return img
  const w = Math.max(1, Math.round(img.width * ratio))
  const h = Math.max(1, Math.round(img.height * ratio))
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * img.width + xx) * 4
          r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; a += img.data[s + 3]
          n++
        }
      }
      const d = (y * w + x) * 4
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n
    }
  }
  return { width: w, height: h, data: out }
}
