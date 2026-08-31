/**
 * 台（背景）の色の判定を、手で微調整する画面。
 *
 * 教室の照明やスマホの機種で、台の色の写りかたは変わる。
 * 既定値は写真そのものから自動で決めるが、うまく切り抜けないときは
 * ここで直せるようにしてある。
 *
 * 色あいのつまみは 0〜359 度の全周。以前は 60〜210 度（黄緑〜水色）に
 * 縛っていたので、暖色の台は手で指定することすらできなかった
 * （依頼者の指示・2026-08-31「緑のマットで撮れるとはかぎらない」）。
 *
 * つまみより先に、**写真の台を1回押す**道を上に置いてある。
 * つまみを4本動かして色を当てにいくのは、学生の仕事ではない。
 * 「ここが台です」と一度教えてもらえれば、その点の色から4つとも決められる
 * （依頼者の指示・2026-08-31）。
 */

import { useEffect, useRef } from 'react'
import { rgbToHsv, type GreenParams } from '../lib/hsv'

type Props = {
  value: GreenParams
  onChange: (v: GreenParams) => void
  /** 台を押してもらうための、撮った写真そのもの */
  photo: ImageData | null
  preview: ImageData | null
}

const FIELDS: Array<{
  key: keyof GreenParams
  label: string
  hint: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}> = [
  { key: 'hueCenter', label: '台の色あい', hint: '写真の台（マットや布）の色に合わせる', min: 0, max: 359, step: 1, format: (v) => `${v.toFixed(0)}°` },
  { key: 'hueTolerance', label: '許容する幅', hint: '広げると台を拾いやすくなる', min: 10, max: 80, step: 1, format: (v) => `±${v.toFixed(0)}°` },
  { key: 'minSaturation', label: '鮮やかさの下限', hint: '上げると白い型紙を拾いにくくなる', min: 0.02, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'minValue', label: '明るさの下限', hint: '上げると影を台扱いしなくなる', min: 0.02, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
]

/** つまみの範囲からはみ出さないように丸める */
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 押されたところの色を読む。
 *
 * 1画素だけ見ると、写真のざらつきや繊維の織り目を拾ってしまう。
 * 前後2画素の四角（5×5）をならしてから色に直す。
 */
function sampleHsv(img: ImageData, cx: number, cy: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  for (let y = cy - 2; y <= cy + 2; y++) {
    if (y < 0 || y >= img.height) continue
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || x >= img.width) continue
      const i = (y * img.width + x) * 4
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++
    }
  }
  if (n === 0) return [0, 0, 0]
  return rgbToHsv(r / n, g / n, b / n)
}

export function GreenTuner({ value, onChange, photo, preview }: Props) {
  const maskRef = useRef<HTMLCanvasElement>(null)
  const photoRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = maskRef.current
    if (!canvas || !preview) return
    canvas.width = preview.width
    canvas.height = preview.height
    canvas.getContext('2d')?.putImageData(preview, 0, 0)
  }, [preview])

  useEffect(() => {
    const canvas = photoRef.current
    if (!canvas || !photo) return
    canvas.width = photo.width
    canvas.height = photo.height
    canvas.getContext('2d')?.putImageData(photo, 0, 0)
  }, [photo])

  /**
   * 押された場所の色を、そのまま台の色として採る。
   *
   * 色あいだけでなく、鮮やかさと明るさの下限も一緒に決める。
   * 淡い台や暗い台だと、色あいが合っていても下限に引っかかって
   * 台ぜんぶが「型紙」に化けるため。押した点は必ず台に入るように、
   * その点の値より下へ置く。
   */
  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!photo) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) / rect.width * photo.width)
    const y = Math.round((e.clientY - rect.top) / rect.height * photo.height)
    const [h, s, v] = sampleHsv(photo, x, y)
    onChange({
      ...value,
      hueCenter: Math.round(h),
      minSaturation: clamp(s * 0.55, 0.02, 0.5),
      minValue: clamp(v * 0.5, 0.02, 0.5),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {photo && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-sm font-bold text-ink-700">
            <span
              className="h-4 w-4 shrink-0 rounded-full border border-ink-100"
              style={{ background: `hsl(${value.hueCenter} 55% 45%)` }}
            />
            写真の<b className="text-mat-700">台（型紙の外側）</b>を1回押してください
          </span>
          <canvas
            ref={photoRef}
            onPointerDown={pick}
            className="w-full cursor-crosshair rounded-lg border border-ink-100"
          />
          <span className="text-xs text-ink-300">
            押したところの色を「台の色」とみなします。左の丸がいまの色です。
          </span>
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-500">
            白い部分が「型紙」として拾われた場所です。型紙の形になっていれば成功。
          </span>
          <canvas
            ref={maskRef}
            className="w-full rounded-lg border border-ink-100"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between text-sm">
            <span className="font-bold text-ink-700">{f.label}</span>
            <span className="tnum text-ink-500">{f.format(value[f.key])}</span>
          </span>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={value[f.key]}
            onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
            className="w-full"
          />
          <span className="text-xs text-ink-300">{f.hint}</span>
        </label>
      ))}
    </div>
  )
}
