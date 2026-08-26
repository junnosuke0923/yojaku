/**
 * 第1フェーズ：撮影と実寸換算。
 *
 *   1. 写真を選ぶ
 *   2. 定規の四隅を合わせ、定規の種類を確かめる
 *   3. 実寸に直した型紙のシルエットと、最大丈・最大幅を見る
 *
 * この3画面の精度が出てから、パーツの蓄積・縫い代・配置へ進む。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CornerPicker, rectifyQuad } from './components/CornerPicker'
import { Heading, Icon, Note, type IconName } from './components/Icon'
import { LayoutView } from './components/LayoutView'
import { GreenTuner } from './components/GreenTuner'
import { PartsView } from './components/PartsView'
import { ResultView } from './components/ResultView'
import { RulerToggle } from './components/RulerToggle'
import { DEFAULT_GREEN, estimateHueCenter, type GreenParams } from './lib/hsv'
import { loadImageFile, type LoadedImage } from './lib/image'
import { analyze, previewGreenMask, type AnalyzeResult } from './lib/pipeline'
import { defaultRulerQuad, guessRuler, RULERS, type RulerId } from './lib/ruler'
import { EMPTY, load as loadParts, save as saveParts, toStored, type PartsState } from './lib/store'
import type { Quad } from './lib/geom'

type Step = 'photo' | 'ruler' | 'result' | 'parts' | 'layout'

const RULER_KEY = 'yojaku.ruler'

/**
 * 開発用の入口。URL のうしろに ?dev を付けて開いたときだけ出る。
 *
 * 縫い代や配置の画面を触るたびに、写真を選んで定規を合わせ直すのは手間なので、
 * 「もう撮り終えた状態」から始められるようにしてある。
 * 中身は依頼者のスカートの図（前・後ろ・ベルト）を、
 * ふだんと同じ処理にかけて取り出した実寸の輪郭（devSeed.ts）。
 *
 * 学生が開くふつうの URL には出てこない。
 * データ自体も、押したときにはじめて読み込む別ファイルにしてあるので、
 * ふだんの配信ファイルには混ざらない。
 */
const DEV = typeof location !== 'undefined'
  && (new URLSearchParams(location.search).has('dev') || location.hash === '#dev')

const loadSavedRuler = (): RulerId =>
  (localStorage.getItem(RULER_KEY) as RulerId | null) ?? 'r50'

export function App() {
  const [step, setStep] = useState<Step>('photo')
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [quad, setQuad] = useState<Quad | null>(null)
  // 四隅をまだ一度も動かしていないうちは、初期位置の形を測っても意味がない
  const [quadAdjusted, setQuadAdjusted] = useState(false)
  const [rulerId, setRulerId] = useState<RulerId>(loadSavedRuler)
  const [rulerChosenByHand, setRulerChosenByHand] = useState(false)
  /**
   * 4隅を自由に置くか（斜めから撮ってしまったときの逃げ道）。
   * ふだんは偽で、長方形のまま定規へ持っていってもらう。理由は CornerPicker の先頭を参照
   */
  const [perspective, setPerspective] = useState(false)
  const [green, setGreen] = useState<GreenParams>(DEFAULT_GREEN)
  const [tunerOpen, setTunerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 取り込んだパーツと生地の設定は端末の中に持つ。何度も撮り足す途中で閉じても消えないように
  const [parts, setParts] = useState<PartsState>(loadParts)
  /** 取り込もうとしている型紙に、もう縫い代が付いているか */
  const [seamIncluded, setSeamIncluded] = useState(false)

  const updateParts = (next: PartsState) => {
    setParts(next)
    saveParts(next)
  }

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const loaded = await loadImageFile(file)
      setImage(loaded)
      setGreen({ ...DEFAULT_GREEN, hueCenter: estimateHueCenter(loaded.imageData.data) })
      setQuad(defaultRulerQuad(loaded.width, loaded.height))
      setQuadAdjusted(false)
      setRulerChosenByHand(false)
      setPerspective(false)
      setResult(null)
      setStep('ruler')
    } catch {
      setError('写真を読み込めませんでした。別の写真で試してください。')
    } finally {
      setBusy(false)
    }
  }

  const guess = useMemo(
    () => (quad && quadAdjusted ? guessRuler(quad) : null),
    [quad, quadAdjusted],
  )

  const adjustQuad = (next: Quad) => {
    setQuad(next)
    setQuadAdjusted(true)
  }

  // 自動判別は「初期値の提案」まで。学生が一度でも選び直したら、もう上書きしない。
  useEffect(() => {
    if (rulerChosenByHand) return
    if (guess?.confident && guess.suggested) setRulerId(guess.suggested)
  }, [guess, rulerChosenByHand])

  const chooseRuler = (id: RulerId) => {
    setRulerId(id)
    setRulerChosenByHand(true)
    localStorage.setItem(RULER_KEY, id)
  }

  const maskPreview = useMemo(
    () => (image && tunerOpen ? previewGreenMask(image.imageData, green) : null),
    [image, green, tunerOpen],
  )

  const run = useCallback(() => {
    if (!image || !quad) return
    setBusy(true)
    setError(null)
    // 画面に「計算中」を出してから、重い処理に入る
    setTimeout(() => {
      const out = analyze({
        imageData: image.imageData, rulerQuad: quad, ruler: RULERS[rulerId], green, perspective,
      })
      if ('error' in out) {
        setError(out.error)
      } else {
        setResult(out)
        setStep('result')
      }
      setBusy(false)
    }, 30)
    // perspective を入れ忘れると、「斜めから撮った」に切り替えた直後に
    // 四隅を動かさずそのまま進んだとき、切り替える前の計算のままになる
  }, [image, quad, rulerId, green, perspective])

  const restart = () => {
    setStep('photo')
    setResult(null)
  }

  /**
   * いま写っているパーツを、一覧のほうへ移す。
   *
   * 縫い代なしなら既定の縫い代（1cm）が全周に付き、次の画面で辺ごとに直す。
   * 縫い代つきなら何も足さず、「わ」の辺の指定だけを聞く（依頼者の指示）。
   */
  const keep = () => {
    if (!result) return
    const added = result.parts.map((p, i) =>
      toStored(p.outlineMm, p.widthMm, p.heightMm, parts.parts.length + i, seamIncluded),
    )
    updateParts({ ...parts, parts: [...parts.parts, ...added] })
    setStep('parts')
  }

  /** 開発用：撮り終えた状態にする。ふだんの取り込みと同じ道を通す */
  const seedDev = async () => {
    setBusy(true)
    try {
      const { DEV_SEEDS } = await import('./lib/devSeed')
      const added = DEV_SEEDS.map((s, i) => ({
        ...toStored(
          s.outline.map(([x, y]) => ({ x, y })), s.widthMm, s.heightMm, i, false,
        ),
        name: s.name,
        needed: s.needed,
      }))
      updateParts({ ...EMPTY, parts: added })
      setStep('parts')
    } catch {
      setError('開発用のデータを読み込めませんでした。')
    } finally {
      setBusy(false)
    }
  }

  /** 開発用：貯めたものを全部捨てて、最初の状態に戻す */
  const clearAll = () => {
    updateParts(EMPTY)
    setResult(null)
    setStep('photo')
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col">
      <header className="flex items-baseline justify-between px-4 pt-6 pb-4">
        <h1 className="text-lg font-bold tracking-wide text-ink-900">要尺シミュレーター</h1>
        <span className="text-xs text-ink-300">
          {step === 'layout'
            ? '第4段階：生地の上に並べる'
            : step === 'parts'
              ? seamIncluded
                ? '第2段階：取り込んで、わの辺を決める'
                : '第2・3段階：取り込んで、縫い代を付ける'
              : '第1段階：実寸をつかむ'}
        </span>
      </header>

      <StepBar step={step} />

      <main className="safe-b flex flex-1 flex-col gap-5 px-4 py-5">
        {error && (
          <p className="flex gap-2 rounded-xl border border-seam bg-white px-4 py-3 text-sm leading-relaxed text-seam">
            <Icon name="warn" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </p>
        )}

        {step === 'photo' && (
          <section className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-ink-500">
              緑のマットの上に型紙を置き、
              <span className="font-bold text-ink-700">地の目線に沿わせて方眼定規</span>
              を載せて、真上から撮ってください。
            </p>

            {/*
              「定規は1本でいい」「地の目はそろえる」の2つは、
              何枚も一度に撮るときにいちばん間違えやすいところ（依頼者の質問・2026-08-26）。
              定規は写真の面そのものの実寸を決めているので、写真に1本あれば全部測れる。
              一方で地の目の向きも定規から取っているため、そこだけは全部そろえてもらう。
            */}
            <Note icon="ruler">
              <span className="font-bold text-ink-700">定規は写真に1本で足ります。</span>
              何枚か並べて一度に撮るときも、どれか1枚に載せるか、
              マットの上の空いたところに置くだけでかまいません。
              全部のパーツが同じ実寸に直ります。
            </Note>
            <Note icon="grain">
              そのかわり、
              <span className="font-bold text-ink-700">
                並べたパーツの地の目は、全部そろえて定規と平行に
              </span>
              してください。地の目の向きはこの定規1本から決めています。
              向きの違うものは、分けて撮ってください。
            </Note>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />

            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-5 py-4 text-base font-bold text-white active:bg-mat-600"
            >
              <Icon name="camera" className="h-5 w-5 shrink-0" />
              カメラで撮る
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-mat-500 px-5 py-4 text-base font-bold text-mat-700"
            >
              <Icon name="photo" className="h-5 w-5 shrink-0" />
              写真を選ぶ
            </button>

            {parts.parts.length > 0 && (
              <button
                type="button"
                onClick={() => setStep('parts')}
                className="flex items-center gap-1.5 text-sm font-bold text-mat-700"
              >
                <Icon name="part" className="h-4 w-4 shrink-0" />
                取り込んだ {parts.parts.length} 個のパーツを見る →
              </button>
            )}

            {DEV && (
              <div className="mt-2 flex flex-col gap-3 rounded-xl border-2 border-dashed border-hold-400 bg-hold-50 px-4 py-4">
                <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-hold-700">
                  <Icon name="hold" className="h-4 w-4 shrink-0" />
                  開発用（?dev を付けて開いたときだけ出ます）
                </p>
                <p className="text-sm leading-relaxed text-ink-500">
                  スカートの図を撮り終えた状態から始めます。
                  <span className="font-bold text-ink-700">
                    前スカート・後ろスカート・ベルトの3点
                  </span>
                  が入り、縫い代の画面へ進みます。
                </p>
                <button
                  type="button"
                  onClick={seedDev}
                  disabled={busy}
                  className="flex items-center justify-center gap-2 rounded-xl bg-hold-600 px-5 py-3.5 text-base font-bold text-white active:bg-hold-700 disabled:opacity-50"
                >
                  <Icon name="part" className="h-5 w-5 shrink-0" />
                  撮影ずみのパーツを入れる
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-hold-400 px-5 py-3 text-sm font-bold text-hold-700"
                >
                  <Icon name="trash" className="h-4 w-4 shrink-0" />
                  ぜんぶ消して、まっさらにする
                </button>
              </div>
            )}
          </section>
        )}

        {step === 'ruler' && image && quad && (
          <section className="flex flex-col gap-5">
            {perspective ? (
              <p className="text-sm leading-relaxed text-ink-500">
                <span className="font-bold text-ink-700">4つの丸を、定規の角に合わせてください。</span>
                <br />
                台形にゆがんだ形にも合わせられます。そのかわり、角は正確に合わせてください。
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-ink-500">
                <span className="font-bold text-ink-700">緑の枠を、定規にぴったり重ねてください。</span>
                <br />
                中を押して動かす、角をつまんで伸ばす、上の丸をつまんで回す。
              </p>
            )}

            <CornerPicker
              bitmap={image.bitmap}
              imageWidth={image.width}
              imageHeight={image.height}
              quad={quad}
              mode={perspective ? 'free' : 'rect'}
              onChange={adjustQuad}
            />

            {/*
              斜め撮りの逃げ道。ふだんは開かない。
              4隅を自由にすると指のずれがそのまま歪みになるので、既定にはしない
              （lib/ruler.ts の buildScale を参照）
            */}
            <button
              type="button"
              onClick={() => {
                // 台形から戻るときは、いちばん近い長方形に直してから渡す
                if (perspective && quad) adjustQuad(rectifyQuad(quad))
                setPerspective((v) => !v)
              }}
              className="flex items-center gap-1.5 self-start text-xs font-bold text-mat-700"
            >
              <Icon name={perspective ? 'back' : 'hint'} className="h-4 w-4 shrink-0" />
              {perspective ? '長方形のまま合わせる（おすすめ）' : '斜めから撮ってしまった（ゆがみに合わせる）'}
            </button>
            {perspective && (
              <Note icon="warn" tone="warn">
                4つの角を1つずつ合わせます。
                <span className="font-bold">数画素のずれが、離れた型紙を大きく歪ませます。</span>
                拡大して丁寧に合わせるか、真上から撮り直すほうが確実です。
              </Note>
            )}

            <RulerToggle value={rulerId} guess={guess} onChange={chooseRuler} />

            <details
              open={tunerOpen}
              onToggle={(e) => setTunerOpen((e.target as HTMLDetailsElement).open)}
              className="rounded-xl border border-ink-100 bg-white px-4 py-3"
            >
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-ink-700">
                <Icon name="hint" className="h-4 w-4 shrink-0 text-mat-600" />
                うまく切り抜けないとき（緑の調整）
              </summary>
              <div className="pt-4">
                <GreenTuner value={green} onChange={setGreen} preview={maskPreview} />
              </div>
            </details>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={restart}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-ink-100 px-5 py-4 text-base font-bold text-ink-500"
              >
                <Icon name="camera" className="h-5 w-5 shrink-0" />
                撮り直す
              </button>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mat-500 px-5 py-4 text-base font-bold text-white active:bg-mat-600 disabled:opacity-50"
              >
                {!busy && <Icon name="measure" className="h-5 w-5 shrink-0" />}
                {busy ? '計算中…' : '実寸に直す'}
              </button>
            </div>
          </section>
        )}

        {step === 'result' && image && result && (
          <section className="flex flex-col gap-5">
            <ResultView bitmap={image.bitmap} result={result} />

            {/*
              持ってくる型紙は、出来上がり線で切ってあるとは限らない（依頼者の指摘）。
              先にここで聞いておけば、縫い代を足す画面は要る人にだけ出せる
            */}
            <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-white px-4 py-4">
              {/* 問いかけには「？」を付ける。答えを選ぶところだと、読む前に分かる */}
              <Heading icon="question">この型紙は、どちらですか</Heading>
              <p className="text-xs leading-relaxed text-ink-500">
                切ってある線が、出来上がり線か、縫い代まで含んだ線かということです。
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSeamIncluded(false)}
                  className={`rounded-lg px-3 py-3 text-left ${
                    seamIncluded ? 'border border-ink-100' : 'bg-mat-500 text-white'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <Icon name="seam" className="h-4 w-4 shrink-0" />
                    縫い代なし
                  </span>
                  <span className={`block pt-0.5 text-xs ${seamIncluded ? 'text-ink-500' : 'text-mat-50'}`}>
                    出来上がり線。次の画面で縫い代を足します
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSeamIncluded(true)}
                  className={`rounded-lg px-3 py-3 text-left ${
                    seamIncluded ? 'bg-mat-500 text-white' : 'border border-ink-100'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <Icon name="scissors" className="h-4 w-4 shrink-0" />
                    縫い代つき
                  </span>
                  <span className={`block pt-0.5 text-xs ${seamIncluded ? 'text-mat-50' : 'text-ink-500'}`}>
                    このまま裁てる線。足しません
                  </span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={keep}
              disabled={result.parts.length === 0}
              className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-5 py-4 text-base font-bold text-white active:bg-mat-600 disabled:opacity-50"
            >
              <Icon name="part" className="h-5 w-5 shrink-0" />
              このパーツを取り込む（{result.parts.length}）
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('ruler')}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-mat-500 px-5 py-4 text-base font-bold text-mat-700"
              >
                <Icon name="ruler" className="h-5 w-5 shrink-0" />
                四隅を直す
              </button>
              <button
                type="button"
                onClick={restart}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-ink-100 px-5 py-4 text-base font-bold text-ink-500"
              >
                <Icon name="camera" className="h-5 w-5 shrink-0" />
                撮り直す
              </button>
            </div>
          </section>
        )}
        {step === 'parts' && (
          <PartsView
            state={parts}
            onChange={updateParts}
            onAddMore={restart}
            onLayout={() => setStep('layout')}
          />
        )}
        {step === 'layout' && (
          <LayoutView state={parts} onChange={updateParts} onBack={() => setStep('parts')} />
        )}
      </main>
    </div>
  )
}

/**
 * 段階ごとの絵。ここだけは、言葉より先に絵が目に入ってほしい。
 * いま自分が「撮るところ」なのか「並べるところ」なのかは、
 * 画面のいちばん上で一目で分かるべきだから
 */
const STEPS: Array<{ id: Step; label: string; icon: IconName }> = [
  { id: 'photo', label: '撮る', icon: 'camera' },
  { id: 'ruler', label: '定規', icon: 'ruler' },
  { id: 'result', label: '実寸', icon: 'measure' },
  { id: 'parts', label: '縫い代', icon: 'seam' },
  { id: 'layout', label: '並べる', icon: 'layout' },
]

function StepBar({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="flex gap-1 px-4">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex flex-1 flex-col gap-1.5">
          <span className={`h-1 rounded-full ${i <= index ? 'bg-mat-500' : 'bg-ink-100'}`} />
          <span
            className={`flex items-center gap-1 text-xs ${
              i === index ? 'font-bold text-mat-700' : 'text-ink-300'
            }`}
          >
            <Icon name={s.icon} className="h-3.5 w-3.5 shrink-0" />
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
