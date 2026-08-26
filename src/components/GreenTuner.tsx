/**
 * 緑の判定を手で微調整する画面。
 *
 * 教室の照明やスマホの機種で、マットの緑の写りかたは変わる。
 * 既定値は写真そのものから自動で決めるが、うまく切り抜けないときは
 * ここを動かして直せるようにしてある。
 */

import { useEffect, useRef } from 'react'
import type { GreenParams } from '../lib/hsv'

type Props = {
  value: GreenParams
  onChange: (v: GreenParams) => void
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
  { key: 'hueCenter', label: '緑の色あい', hint: '写真のマットの色に合わせる', min: 60, max: 210, step: 1, format: (v) => `${v.toFixed(0)}°` },
  { key: 'hueTolerance', label: '許容する幅', hint: '広げるとマットを拾いやすくなる', min: 10, max: 80, step: 1, format: (v) => `±${v.toFixed(0)}°` },
  { key: 'minSaturation', label: '鮮やかさの下限', hint: '上げると白い型紙を拾いにくくなる', min: 0.02, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'minValue', label: '明るさの下限', hint: '上げると影をマット扱いしなくなる', min: 0.02, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
]

export function GreenTuner({ value, onChange, preview }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview) return
    canvas.width = preview.width
    canvas.height = preview.height
    canvas.getContext('2d')?.putImageData(preview, 0, 0)
  }, [preview])

  return (
    <div className="flex flex-col gap-4">
      {preview && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-500">
            白い部分が「型紙」として拾われた場所です。型紙の形になっていれば成功。
          </span>
          <canvas
            ref={canvasRef}
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
