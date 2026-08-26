/**
 * 写真の読み込みと下ごしらえ。
 *
 * スマホの写真は 4000×3000 などとても大きい。そのまま扱うと重いので、
 * 長辺 1400px まで縮めてから解析する。要尺は 1mm きざみで足りるため、
 * この解像度で精度は十分。
 */

export const MAX_EDGE = 1400

export type LoadedImage = {
  imageData: ImageData
  /** 画面表示用の縮小済み画像 */
  bitmap: ImageBitmap
  width: number
  height: number
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const source = await createImageBitmap(file)
  const ratio = Math.min(1, MAX_EDGE / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * ratio))
  const height = Math.max(1, Math.round(source.height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画像を読み込めませんでした。')

  ctx.drawImage(source, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  source.close()

  const bitmap = await createImageBitmap(canvas)
  return { imageData, bitmap, width, height }
}
