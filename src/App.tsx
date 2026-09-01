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
import { Heading, Hint, Icon, Note, type IconName } from './components/Icon'
import { LayoutView } from './components/LayoutView'
import { GreenTuner } from './components/GreenTuner'
import { FabricView } from './components/FabricView'
import { PartsView } from './components/PartsView'
import { ResultView } from './components/ResultView'
import { RulerToggle } from './components/RulerToggle'
import { WarpEditor } from './components/WarpEditor'
import { replayTour, Tour, TOUR_ON } from './components/Tour'
import { DEFAULT_GREEN, estimateHueCenter, type GreenParams } from './lib/hsv'
import { loadImageFile, type LoadedImage } from './lib/image'
import { analyze, DEFAULT_SMOOTH, previewGreenMask, resmooth, type AnalyzeResult } from './lib/pipeline'
import type { SmoothLevel } from './lib/smooth'
import { defaultRulerQuad, guessRuler, RULERS, type RulerId } from './lib/ruler'
import { findRulerQuad } from './lib/findRuler'
import { loadSaves, removeSave, whenOf, type Save } from './lib/saves'
import { EMPTY, load as loadParts, save as saveParts, toStored, type PartsState } from './lib/store'
import type { Quad } from './lib/geom'
import { applyWarp, isWarped, NO_WARP, type Keystone } from './lib/warp'

/*
  生地は独立した段階（依頼者の指示・2026-09-01）。
  もとは生地幅と差し込みが「縫い代」の中に、折り方が「並べる」の上にあった。
  生地についての判断だけを1画面に集めてある
*/
type Step = 'photo' | 'ruler' | 'result' | 'parts' | 'fabric' | 'layout'

const RULER_KEY = 'yojaku.ruler'

/** 控えておく操作の数。これ以上は古いほうから捨てる */
const HISTORY_MAX = 40

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
const DEV_KEY = 'yojaku.dev'

/**
 * 一度 ?dev で開いたら、そのあとは付けなくても開発用の口が出るようにしてある。
 *
 * スマホでホーム画面に登録したり、「読み込み直す」を押したりすると
 * ?dev が落ちてしまい、そのたびに URL を打ち直すことになるため。
 * `?dev=0` で消せる。学生の URL には最初から出てこない
 */
const DEV = (() => {
  if (typeof location === 'undefined') return false
  const q = new URLSearchParams(location.search).get('dev')
  if (q === '0' || q === 'off') {
    localStorage.removeItem(DEV_KEY)
    return false
  }
  if (q !== null || location.hash === '#dev') {
    localStorage.setItem(DEV_KEY, '1')
    return true
  }
  return localStorage.getItem(DEV_KEY) === '1'
})()

const loadSavedRuler = (): RulerId =>
  (localStorage.getItem(RULER_KEY) as RulerId | null) ?? 'r50'

export function App() {
  const [step, setStep] = useState<Step>('photo')
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [quad, setQuad] = useState<Quad | null>(null)
  // 四隅をまだ一度も動かしていないうちは、初期位置の形を測っても意味がない
  const [quadAdjusted, setQuadAdjusted] = useState(false)
  /**
   * 四隅を、こちらで当てたか（依頼者の質問・2026-09-01）。
   *
   * 当てられたときは、画面の言い方を「合わせてください」から
   * 「合っているか確かめてください」に変える。
   * 学生が四隅に触れたら下ろす——そこから先は本人が合わせた枠なので、
   * こちらが当てたという話は用済みになる
   */
  const [rulerAuto, setRulerAuto] = useState(false)
  /**
   * こちらで当てたときの、すぼまりを均した長方形。
   *
   * 斜めから撮られていると四隅は台形になる。台形をそのまま
   * `guessRuler` に渡すと「斜めなので形からは分からない」と言われてしまうが、
   * 縦横比そのものは傾き35度でも 10.0 から 0.25 しかずれない（合成画像で実測）。
   * そこで、解析には台形を渡しつつ、**種類の見分けだけは長方形で**する
   */
  const [autoRect, setAutoRect] = useState<Quad | null>(null)
  /**
   * すぼまりから採れた**台形**の四隅。すぼまりが出なければ null。
   *
   * ここに置いてあるだけで、当ててはいない（依頼者の報告・2026-09-01
   * 「以前は同じ画像で一発できれいにいっていたのですが、
   * 色々機能の修正を加えてからゆがみ方がおかしくなるようになりました」）。
   * すぼまりを測ると自動で「ゆがみに合わせる」へ切り替えていたが、
   * 見本の写真はほとんど傾いていないのに、すぼまりが 1.0686 と出て
   * 境目（1.03）を越えてしまい、パーツごとに 1.2〜3.3 度の傾きが出ていた。
   * 「学生が押したら、そのとき渡す」に変えてある
   */
  const [autoTaper, setAutoTaper] = useState<Quad | null>(null)
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
  /**
   * 輪郭のガタガタをならす強さ（依頼者の指示・2026-08-31）。
   *
   * 写真から切り抜いた線は、そのままだと 1mm ほど波打つ。
   * 既定でならしておくが、実物の線をそのまま写し取りたい人のために
   * 「なし」も選べるようにしてある。
   */
  const [smooth, setSmooth] = useState<SmoothLevel>(DEFAULT_SMOOTH)
  /**
   * 画面に出す結果。なめらかさを変えたときは、
   * 写真の読み直しはせず、輪郭の作り直しだけをする（そのほうが速い）
   */
  const smoothed = useMemo(() => (result ? resmooth(result, smooth) : null), [result, smooth])
  /**
   * ゆがみの手直し（依頼者の相談・2026-09-01。詳しくは lib/warp.ts）。
   *
   * 型紙の四つ角を引いて、形ぜんぶをゆがませ直す。
   * 既定は**写真ぜんぶに当てる**——ゆがみの原因（定規の枠のずれ・斜め撮り）は
   * たいてい写真に共通なので、1枚直せば残りも同じだけずれている
   */
  const [warp, setWarp] = useState<Keystone>(NO_WARP)
  /** 直しを当てる先。true なら写真ぜんぶ、false なら下の1枚だけ */
  const [warpAll, setWarpAll] = useState(true)
  /** いま持ち手を出している型紙（`smoothed.parts` の何番め） */
  const [warpIndex, setWarpIndex] = useState(0)
  const [warpOpen, setWarpOpen] = useState(false)
  /** 画面に出す結果。ならしたあと、手直しを当てたもの */
  const shown = useMemo(() => {
    if (!smoothed) return null
    const only = warpAll ? null : (smoothed.parts[warpIndex]?.id ?? null)
    return applyWarp(smoothed, warp, only)
  }, [smoothed, warp, warpAll, warpIndex])
  /**
   * 見つかったが、取り込まないことにした形の id。
   *
   * 写真には型紙のほかに消しゴムや紙片や手が写る。それを機械に見分けさせるのではなく、
   * **外すのを1タップにする**（依頼者の指示・2026-08-31）。既定は全部入り。
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  /** 取り込むことにした形の数。ボタンの文字と、押せるかどうかに使う */
  const chosenCount = result ? result.parts.filter((p) => !excluded.has(p.id)).length : 0

  const [error, setError] = useState<string | null>(null)
  // 取り込んだパーツと生地の設定は端末の中に持つ。何度も撮り足す途中で閉じても消えないように
  const [parts, setParts] = useState<PartsState>(loadParts)
  /** 取り込もうとしている型紙に、もう縫い代が付いているか */
  const [seamIncluded, setSeamIncluded] = useState(false)
  /**
   * 開いたときに、前回のパーツが端末に残っていたか（依頼者の指摘・2026-09-01）。
   *
   * 取り込んだものは端末に残す作りなので、読み込み直しても続きから触れる。
   * それ自体は狙いどおりなのだけれど、**次の課題を始めるつもりで開いた人**にとっては、
   * 残っていることに気づかないまま撮ることになり、縫い代の画面でパーツが
   * どんどん増えていく。依頼者から「写真を撮り込む場面で、前回からの続きで
   * 追加するのか、リセットして新たに取り込むのかを一度聞いたほうがいい」と言われた。
   *
   * 聞くのは**開いたときに残っていたときの一度だけ**。1枚撮るたびに聞くと、
   * 大きいパーツを1枚ずつ撮り足していく本来の使い方の邪魔になる。
   */
  const [askCarry, setAskCarry] = useState(parts.parts.length > 0)
  /**
   * **いま写っている写真から**取り込んだパーツの id（依頼者の指摘・2026-09-01）。
   *
   * 「定規へ戻って四隅を直し、もう一度取り込む」をすると、
   * 前のぶんが残ったまま同じパーツがもう一組増えていた。
   * 直したくて戻ったのに増える、というのは筋が通らない。
   *
   * とはいえ**足したい**ときもある——大きいパーツを1枚ずつ撮り足していく使い方や、
   * さっきは選ばなかったパーツを追加で取り込む、という道もあるので、
   * こちらで決めずに一度たずねる。
   *
   * 写真を選び直したら空にする。別の写真から足すのは、ふつうの「足す」なので
   */
  const [kept, setKept] = useState<string[]>([])
  /** 取り込み直しの問いを出しているか */
  const [askAgain, setAskAgain] = useState(false)
  /**
   * 「はじめから」を押したあと、本当に消してよいかを聞いている最中か。
   *
   * 取り込んだものは端末の中に残るので、閉じても次に開いたとき続きから触れる。
   * それは狙いどおりなのだけれど、次の課題に移るときや、
   * 人に渡して試してもらうときに戻せないと困る、という指摘を受けて付けた
   * （依頼者・2026-08-27）。何がいくつ消えるのかを、押す前に数字で見せておく。
   *
   * なお、消したぶんは控えに積んであるので「1つ戻る」で戻せる。
   * 以前ここに「戻せません」と書いてあったが、それは事実と違っていた（2026-09-01）。
   * ただし控えは画面の中だけに持っているので、閉じたり読み込み直したりすると消える
   */
  const [askReset, setAskReset] = useState(false)
  /**
   * しまってある見積もり（依頼者の指示・2026-08-28）。
   *
   * この端末の中だけに置く。`parts` とは別の引き出しで、
   * いま触っている作業を上書きしない。開いたときに初めて入れかわる。
   */
  const [saves, setSaves] = useState<Save[]>(loadSaves)
  /** しまうときの名前。しまってあるものを開いたときは、その名前が入る */
  const [saveName, setSaveName] = useState('')
  /** 「開く」を押したが、いまの作業が消えてよいかまだ聞いていないもの */
  const [askOpen, setAskOpen] = useState<Save | null>(null)
  /** 「消す」を押したが、まだ聞いている最中のもの。消すと戻せないので必ず一度たずねる */
  const [askDrop, setAskDrop] = useState<string | null>(null)
  /** しまってあるものを、最近の3件だけにしているか */
  const [foldSaves, setFoldSaves] = useState(true)
  /**
   * 置きなおした新しい版が出ているのに、古いページを開いたままか。
   *
   * 置きなおすたびに JS のファイル名が変わるので、スマホが古い index.html を
   * 持ったままだと、そこに書いてある名前のファイルはもうサーバーに無い。
   * 実機では「撮影ずみのパーツを入れる」が読み込みに失敗する形で出た（2026-08-27）。
   * 黙って読み込み直すと作業中の指の動きを取り上げてしまうので、
   * 気づいたことだけを伝えて、押すかどうかは本人に決めてもらう
   */
  const [stale, setStale] = useState(false)

  /**
   * 1つ戻る／1つ進むための控え（依頼者の指示・2026-08-27）。
   *
   * 取り込んだパーツ・生地の設定・並べた場所は、まとめて1つの塊で持っている。
   * だから「変える前の塊を積んでおく」だけで、どの画面の操作でも戻せる。
   *
   * 指で引きずっているあいだは 1mm 動くたびに変わるので、
   * そのまま積むと、戻すのに何十回も押すことになる。
   * ひと続きの操作には同じ合図（group）を付けてもらい、それは1回ぶんにまとめる。
   * 「何ミリ秒以内なら同じ操作」という決め方はしない。
   * 絵が重いときは指を動かしている最中でも間隔が開いてしまい、当てにならないため
   */
  const history = useRef<{ past: PartsState[]; future: PartsState[]; group: string | null }>({
    past: [], future: [], group: null,
  })
  /** 戻る／進むが押せるかどうかを画面に伝えるためだけの数 */
  const [, bumpHistory] = useState(0)

  const updateParts = (next: PartsState, group?: string) => {
    const h = history.current
    // 同じ合図が続いているあいだ（＝1回の引きずりの最中）は、控えを積み増さない
    if (!(group && group === h.group)) {
      h.past.push(parts)
      if (h.past.length > HISTORY_MAX) h.past.shift()
    }
    h.group = group ?? null
    h.future = []
    setParts(next)
    saveParts(next)
    bumpHistory((t) => t + 1)
  }

  /** 控えから1つ取り出して入れ替える。戻ると進むは向きが違うだけ */
  const step1 = (back: boolean) => {
    const h = history.current
    const from = back ? h.past : h.future
    const to = back ? h.future : h.past
    const prev = from.pop()
    if (!prev) return
    to.push(parts)
    h.group = null
    setParts(prev)
    saveParts(prev)
    bumpHistory((t) => t + 1)
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
      const nextGreen = { ...DEFAULT_GREEN, hueCenter: estimateHueCenter(loaded.imageData.data) }
      setGreen(nextGreen)
      /*
        定規をこちらでさがして、見つかったら四隅を当てておく（lib/findRuler.ts）。
        見つからなければ今までどおり、まん中に細長い枠を置くだけ。
        当てられたときは quadAdjusted も立てる——枠はもう意味のある場所に
        あるので、定規の種類の判別（guessRuler）もその場で働いてよい
      */
      const found = findRulerQuad(loaded.imageData, nextGreen)
      setQuad(found ? found.rect : defaultRulerQuad(loaded.width, loaded.height))
      setQuadAdjusted(!!found)
      setRulerAuto(!!found)
      setAutoRect(found ? found.rect : null)
      setRulerChosenByHand(false)
      /*
        すぼまりが出ていても、こちらでは切り替えない。**言うだけ**にする。

        以前はここで自動で「ゆがみに合わせる」に切り替えていた。
        合成画像では効いた（傾き20度で幅のずれが +11.7% から +2.5% へ）のだが、
        合成画像はすぼまりが正確に測れるので、実写とは前提が違っていた。
        見本の写真は、長方形で渡せば型紙3枚とも 0.2 度以内でまっすぐ立つ
        ＝ほとんど傾いていないのに、すぼまりは 1.0686 と出る。
        境目の 1.03 は合成画像で決めた値なので、実写の測り誤差に届いていなかった。

        定規の四隅を「当てるのは提案であって、決定ではない」（lib/findRuler.ts）
        という作りにしてあるのに、計算のしかたのほうだけ決めてしまっていた
      */
      setPerspective(false)
      setAutoTaper(found?.tilted ? found.quad : null)
      setResult(null)
      setKept([])
      setWarp(NO_WARP)
      setWarpOpen(false)
      setStep('ruler')
    } catch {
      setError('写真を読み込めませんでした。別の写真で試してください。')
    } finally {
      setBusy(false)
    }
  }

  const guess = useMemo(
    () => {
      // こちらで当てたときは、台形ではなく、均した長方形で見分ける
      const target = autoRect ?? (quadAdjusted ? quad : null)
      return target ? guessRuler(target) : null
    },
    [autoRect, quad, quadAdjusted],
  )

  const adjustQuad = (next: Quad) => {
    setQuad(next)
    setQuadAdjusted(true)
    setRulerAuto(false)
    setAutoRect(null)
    setAutoTaper(null)
  }

  /*
    置きなおした版が出ていないかを、サーバーの version.txt で確かめる。

    見にいくのは、開いたとき・画面に戻ってきたとき・5分おき。
    `cache: 'no-store'` を付けないと、この確認そのものが古い答えを返してしまう。
    圏外や、まだ version.txt を置いていない古い配信では、黙って何もしない。
  */
  /**
   * ただの読み込み直しでは、古いページがそのまま出てくることがある。
   *
   * GitHub Pages は index.html を10分ぶん持たせる指定で返すので、
   * 端末や途中の配信網が、まだ古いほうを持っている。
   * URL のうしろに違う印を付けると、同じ住所と見なされず、必ず取りに行く。
   * 付けた印は、開いたあとに履歴から消しておく（下の useEffect）
   */
  const hardReload = () => {
    const u = new URL(location.href)
    u.searchParams.set('v', Date.now().toString(36))
    location.replace(u.toString())
  }

  // 読み込み直しに使った印を、見えないところで消しておく
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('v')) return
    const u = new URL(location.href)
    u.searchParams.delete('v')
    window.history.replaceState(null, '', u.toString())
  }, [])

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('./version.txt', { cache: 'no-store' })
        if (!res.ok) return
        const latest = (await res.text()).trim()
        /*
          version.txt が無いとき、代わりに index.html を返してくる配信がある
          （開発中のサーバーがそう。Wi-Fi のログイン画面なども同じことをする）。
          目印は日時の一行なので、それらしくない返事は無かったことにする
        */
        if (!latest || latest.length > 40 || latest.includes('<')) return
        if (alive && latest !== __BUILD_ID__) setStale(true)
      } catch {
        // 通信できないだけなので、何も言わない
      }
    }
    // 開いたときは必ず1回見る。そのあとの繰り返しだけ、裏に回っているあいだ休む
    void check()
    const visible = () => document.visibilityState === 'visible'
    const onVisible = () => { if (visible()) void check() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => { if (visible()) void check() }, 5 * 60 * 1000)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

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
        smooth,
      })
      if ('error' in out) {
        setError(out.error)
      } else {
        setResult(out)
        setExcluded(new Set())
        setStep('result')
      }
      setBusy(false)
    }, 30)
    // perspective を入れ忘れると、「斜めから撮った」に切り替えた直後に
    // 四隅を動かさずそのまま進んだとき、切り替える前の計算のままになる
  }, [image, quad, rulerId, green, perspective, smooth])

  const restart = () => {
    setAskAgain(false)
    setStep('photo')
    setResult(null)
    setExcluded(new Set())
  }

  /**
   * いま写っているパーツを、一覧のほうへ移す。
   *
   * 縫い代なしなら既定の縫い代（1cm）が全周に付き、次の画面で辺ごとに直す。
   * 縫い代つきなら何も足さず、「わ」の辺の指定だけを聞く（依頼者の指示）。
   */
  const keep = () => {
    // 同じ写真からもう一度取り込もうとしている。置きかえるのか足すのかを聞く
    if (kept.length > 0) setAskAgain(true)
    else doKeep(false)
  }

  /** @param replace この写真から前に取り込んだぶんを、いったん消してから入れる */
  const doKeep = (replace: boolean) => {
    if (!shown) return
    const gone = replace ? new Set(kept) : new Set<string>()
    const left = parts.parts.filter((p) => !gone.has(p.id))
    const added = shown.parts
      .filter((p) => !excluded.has(p.id))
      .map((p, i) =>
        toStored(p.outlineMm, p.widthMm, p.heightMm, left.length + i, seamIncluded),
      )
    updateParts({
      ...parts,
      parts: [...left, ...added],
      // 置きかえたパーツを指していた配置は、行き先が無くなるのでいっしょに外す
      placements: replace
        ? parts.placements.filter((pl) => !gone.has(pl.partId))
        : parts.placements,
    })
    setKept(replace ? added.map((p) => p.id) : [...kept, ...added.map((p) => p.id)])
    setAskAgain(false)
    setStep('parts')
  }

  /**
   * 開発用：見本の写真を、いま撮ったものとして読み込む（依頼者の指示・2026-08-31）。
   *
   * もとは「撮り終えた形（実寸の輪郭）」を流し込んでいたが、
   * それだと**写真そのものが無い**ので、定規を合わせる画面から先を見られなかった。
   * 依頼者から「画像として見ることができない」と指摘されて作り直した。
   *
   * ふだんの取り込みとまったく同じ道を通す。
   * 写真を選んだときと同じ `pickFile` に渡すので、
   * 定規 → 実寸 → 縫い代 → 並べる が、学生と同じ順番でそのまま出る。
   *
   * 見本は `public/` に置いてある。名前が置きなおしても変わらないため、
   * 古いページを開いたままの端末でも読める（`devSeed` を別ファイルにしていたころ、
   * 名前が毎回変わって読めなくなった失敗の裏返し）。
   */
  const loadSample = async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample-photo.jpg`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      await pickFile(new File([blob], 'sample-photo.jpg', { type: 'image/jpeg' }))
    } catch {
      setError('見本の写真を読み込めませんでした。読み込み直してから、もう一度試してください。')
      setBusy(false)
    }
  }

  /**
   * 「はじめから」が消すのは、**いま出ている画面のぶんだけ**（依頼者の指示・2026-08-27）。
   *
   * 並べる画面で押したら、並べた場所だけを戻す。取り込んだパーツまで消えてしまうと、
   * 置きなおしたいだけなのに撮るところからやり直しになる（実際にそうなった）。
   * 生地幅・向き・折り方も、並べ方とは別の決めごとなので残す。
   */
  const resetLayout = () => {
    updateParts({ ...parts, placements: [] })
    setError(null)
  }

  /**
   * しまってあるものを開く（依頼者の指示・2026-08-28）。
   *
   * しまってあるのは作業まるごとなので、そのまま `parts` に入れれば続きから触れる。
   * 写真そのものは持っていない（型紙の形はもう実寸で入っている）ので、
   * 撮るところの状態は捨てて、並べる画面から始める。
   *
   * いまの作業は消えるので、何か触っていたら必ず一度たずねる。
   * 1つ戻るの控えには積むので、開いてしまってからでも戻せる。
   */
  const openSave = (s: Save) => {
    updateParts(s.state)
    setSaveName(s.name)
    setResult(null)
    setImage(null)
    setQuad(null)
    setQuadAdjusted(false)
    setError(null)
    setAskOpen(null)
    setStep('layout')
  }

  /** 貯めたものを全部捨てて、最初の状態に戻す */
  const clearAll = () => {
    updateParts(EMPTY)
    setResult(null)
    setKept([])
    setImage(null)
    setQuad(null)
    setQuadAdjusted(false)
    setError(null)
    setStep('photo')
  }

  /**
   * 上の帯を押して、その段階へ行けるか。**前へも後ろへも同じ決まりで見る**
   * （依頼者の指示・2026-08-27）。
   *
   * 見るのは「その段階で見せるものが、もう揃っているか」だけ。
   * 揃っていれば行ったり来たりできる。縫い代を一本だけ直して、
   * 並べる画面の続きへ戻る——という往復ができないと、
   * 直すたびに前の画面をひとつずつたどり直すことになる。
   *
   * 取り込んだものも並べたものも端末に残してあるので、
   * 往復しても、直したところは直ったまま戻ってくる
   */
  const canGo = (to: Step) => {
    switch (to) {
      case 'photo': return true
      case 'ruler': return !!(image && quad)
      case 'result': return !!(image && result)
      case 'parts': return parts.parts.length > 0
      case 'fabric': return parts.parts.length > 0
      case 'layout': return parts.parts.length > 0
      default: return false
    }
  }

  const onLayout = step === 'layout'
  /** 消すものが何かあるか。まっさらのときに「はじめから」を出しても意味がない */
  const hasWork = onLayout
    ? parts.placements.length > 0
    : parts.parts.length > 0 || result !== null || image !== null
  /** この画面に、呼び戻せる案内があるか（いまは案内そのものを止めてある） */
  const hasTour = TOUR_ON && (step === 'photo' || step === 'parts' || step === 'layout')

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col">
      <header className="flex items-start justify-between gap-3 px-4 pt-5 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-base font-bold tracking-wide text-ink-900">要尺シミュレーター</h1>
          <span className="text-xs text-ink-300">
            {step === 'fabric' || step === 'layout'
              ? '第4段階：生地を決めて、上に並べる'
              : step === 'parts'
                ? seamIncluded
                  ? '第2段階：取り込んで、わの辺を決める'
                  : '第2・3段階：取り込んで、縫い代を付ける'
                : '第1段階：実寸をつかむ'}
          </span>
        </div>
        {/*
          1つ戻る／1つ進む。どの画面にいても同じ場所にある。
          押せないときは薄くして、その場に残す。
          消えたり出たりすると、隣の「はじめから」の位置が動いて押し間違える
        */}
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
          {/*
            はじめて開いたときの案内を、もう一度呼ぶための口。
            案内は1回きりで消えるので、あとから見たい人の逃げ場がなくなる。
            案内を持っている画面にだけ出す
          */}
          {hasTour && (
            <button
              type="button"
              onClick={replayTour}
              aria-label="この画面の使い方"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-100 bg-white text-ink-500 active:bg-chalk"
            >
              <Icon name="question" className="h-4 w-4 shrink-0" />
            </button>
          )}
          <div className="flex overflow-hidden rounded-lg border border-ink-100 bg-white">
            <button
              type="button"
              onClick={() => step1(true)}
              disabled={history.current.past.length === 0}
              aria-label="1つ戻る"
              className="flex h-9 w-10 items-center justify-center text-ink-700 active:bg-chalk disabled:text-ink-100"
            >
              <Icon name="undo" className="h-4 w-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => step1(false)}
              disabled={history.current.future.length === 0}
              aria-label="1つ進む"
              className="flex h-9 w-10 items-center justify-center border-l border-ink-100 text-ink-700 active:bg-chalk disabled:text-ink-100"
            >
              <Icon name="redo" className="h-4 w-4 shrink-0" />
            </button>
          </div>
          {hasWork && !askReset && (
            <button
              type="button"
              onClick={() => setAskReset(true)}
              aria-label={onLayout ? '並べたものを、ぜんぶ戻す' : 'ぜんぶ消して、はじめから'}
              className="flex h-9 w-10 items-center justify-center rounded-lg border border-ink-100 bg-white text-ink-500 active:bg-chalk"
            >
              <Icon name="trash" className="h-4 w-4 shrink-0" />
            </button>
          )}
        </div>
      </header>

      <StepBar step={step} canGo={canGo} onGo={setStep} />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {/*
          置きなおした版が出ているのに、古いページを開いたまま。
          この状態だと、押しても何も起きないところが出る。
          取り込んだものは端末に残るので、読み込み直しても消えない
        */}
        {stale && (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-4">
            <p className="flex gap-2 text-sm leading-relaxed text-mat-700">
              <Icon name="hint" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="font-bold">新しい版が出ています。</span>
                いま開いているのは古いページなので、押しても動かないところがあります。
                読み込み直してください。
                <span className="text-mat-600">取り込んだパーツは消えません。</span>
              </span>
            </p>
            <button
              type="button"
              onClick={hardReload}
              className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-3 text-sm font-bold text-white active:bg-mat-600"
            >
              <Icon name="back" className="h-4 w-4 shrink-0" />
              読み込み直す
            </button>
          </div>
        )}

        {/*
          消すと戻せないので、押したその場では消さずに一度たずねる。
          何がいくつ消えるのかを、押す前に数字で見せておく
        */}
        {askReset && (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-seam bg-white px-4 py-4">
            <p className="flex gap-2 text-sm leading-relaxed text-ink-700">
              <Icon name="warn" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0 text-seam" />
              <span className="min-w-0 flex-1">
                {onLayout ? (
                  <>
                    生地の上に並べた
                    <span className="font-bold"> {parts.placements.length} 個</span>
                    を、ぜんぶ<span className="font-bold">置く前に戻します</span>。
                    取り込んだパーツと生地の設定は、そのまま残ります。
                  </>
                ) : (
                  <>
                    取り込んだパーツ
                    <span className="font-bold"> {parts.parts.length} 個</span>
                    と、生地の設定・並べた場所を
                    <span className="font-bold">ぜんぶ消して</span>、
                    写真を撮るところからやり直します。
                    消したものは、すぐなら「1つ戻る」で戻せます。
                  </>
                )}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (onLayout) resetLayout()
                  else clearAll()
                  setAskReset(false)
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-seam px-4 py-3 text-sm font-bold text-white"
              >
                <Icon name="trash" className="h-4 w-4 shrink-0" />
                {onLayout ? '並べたものを戻す' : '消して、はじめから'}
              </button>
              <button
                type="button"
                onClick={() => setAskReset(false)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-ink-100 px-4 py-3 text-sm font-bold text-ink-700"
              >
                <Icon name="back" className="h-4 w-4 shrink-0" />
                やめる
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="flex gap-2 rounded-xl border border-seam bg-white px-4 py-3 text-sm leading-relaxed text-seam">
            <Icon name="warn" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </p>
        )}

        {step === 'photo' && (
          <section className="flex flex-col gap-4">
            <Tour id="photo" />

            {/*
              ここで出るのは概算だということ（依頼者の指示・2026-08-28）。
              最初の画面と、要尺が出たところの2か所に置く。
              いちばん上に出しておかないと、数字を見てから初めて知ることになる。
              ひと言だけ出して、理由は「？」の中に畳んでおく
            */}
            <div className="rounded-xl border border-ink-100 bg-white px-3 py-1">
              <Hint icon="warn" summary={<>ここで出るのは生地の<b className="text-ink-700">概算</b>です</>}>
                型紙の形は写真から読み取っているので、実物とは数ミリの差が出ます。
                地直しの縮みや裁つときのくせでも変わるので、心配なときは少し多めに見てください。
              </Hint>
            </div>

            {/*
              前回のぶんが残ったまま撮り始めてしまう問題（依頼者の指摘・2026-09-01）。

              開いたときにパーツが残っていたときだけ、撮る前に一度たずねる。
              「足す」か「はじめから」かは、こちらでは決められない——
              大きいパーツを1枚ずつ撮り足していくのも、次の課題を始めるのも、
              どちらも実際にある使い方なので、本人に選んでもらう。

              このカードが出ているあいだは、下の見本の写真を引っ込めてある。
              先に答えてほしい問いなので、答える前から撮るボタンを
              画面の外へ押し出してしまうと、かえって撮りに行ける状態に見える
            */}
            {askCarry && (
              <div className="flex flex-col gap-3 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-4">
                <p className="flex gap-2 text-sm leading-relaxed text-mat-700">
                  <Icon name="part" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">
                      前に取り込んだパーツが {parts.parts.length} 個 残っています。
                    </span>
                    このまま撮ると、そこに足していきます。
                    <span className="text-mat-600">消しても、すぐなら「1つ戻る」で戻せます。</span>
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAskCarry(false)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mat-500 px-3 py-3 text-sm font-bold text-white active:bg-mat-600"
                  >
                    <Icon name="part" className="h-4 w-4 shrink-0" />
                    このまま足す
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearAll()
                      setAskCarry(false)
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-seam bg-white px-3 py-3 text-sm font-bold text-seam"
                  >
                    <Icon name="trash" className="h-4 w-4 shrink-0" />
                    消して、はじめから
                  </button>
                </div>
              </div>
            )}

            {/*
              しまってあるものを開くと、いま触っているぶんは置きかわる。
              戻せない操作ではない（1つ戻るの控えに積んである）が、
              黙って置きかえると何が起きたのか分からないので、一度たずねる
            */}
            {askOpen && (
              <div className="flex flex-col gap-3 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-4">
                <p className="flex gap-2 text-sm leading-relaxed text-mat-700">
                  <Icon name="hint" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">「{askOpen.name}」を開きます。</span>
                    いま触っているぶんは置きかわります。
                    <span className="text-mat-600">上の「1つ戻る」で戻せます。</span>
                  </span>
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => openSave(askOpen)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-3 text-sm font-bold text-white active:bg-mat-600"
                  >
                    <Icon name="layout" className="h-4 w-4 shrink-0" />
                    開く
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskOpen(null)}
                    className="flex flex-1 items-center justify-center rounded-xl border-2 border-ink-100 px-4 py-3 text-sm font-bold text-ink-500"
                  >
                    やめる
                  </button>
                </div>
              </div>
            )}

            {/*
              撮り方は、文で言うより見せたほうが早い（依頼者の指示・2026-09-01）。
              置いてあるのは、開発モードで読み込むのとまったく同じ1枚。
              つまりここに出ている見本は、この道を最後まで通ることが
              確かめてある写真そのものになっている。
              注意書きは、その絵と同じ枠の中に入れてある
            */}
            <div
              className={`flex-col gap-2.5 rounded-xl border border-ink-100 bg-white px-4 py-3.5 ${
                askCarry ? 'hidden' : 'flex'
              }`}
            >
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Icon name="camera" className="h-4 w-4 shrink-0 text-mat-600" />
                <span className="min-w-0 flex-1">
                  無地で色のついた台に型紙と
                  <span className="font-bold text-ink-700">方眼定規</span>
                  を置いて、真上から
                </span>
              </p>
              <img
                src={`${import.meta.env.BASE_URL}sample-photo.jpg`}
                alt="緑の台の上に、スカートの後ろ・方眼定規・前・ベルトを、すべて縦向きにそろえて並べた見本の写真"
                width={937}
                height={751}
                /*
                  丈を抑えてあるのは、撮るボタンを画面の中に残すため。
                  絵は横長なので、幅いっぱいに広げると縦を 280px 使ってしまい、
                  小さい端末で「カメラで撮る」が下に押し出される
                */
                className="mx-auto h-[240px] w-auto rounded-lg border border-ink-100 bg-chalk"
              />
              {/*
                「定規は1本でいい」「地の目はそろえる」は、
                何枚も一度に撮るときにいちばん間違えやすいところ（依頼者の質問・2026-08-26）。
                もとは2行に分けていたが、どちらもこの定規1本の話なので1行にまとめた
                （説明を整理する、という依頼者の指示・2026-08-31）。
                結論だけ出して、理由は「？」の中に畳んでおく
              */}
              <div data-tour="photo-hint">
                <Hint icon="ruler" summary={<>定規は<b className="text-ink-700">1本</b>だけ、地の目と<b className="text-ink-700">平行に</b></>}>
                  写真の実寸も地の目の向きも、この定規1本から決めています。
                  1本あれば写っているパーツは全部測れます。
                  地の目の向きが違うものが混ざっていると斜めに読まれるので、分けて撮ってください。
                </Hint>
              </div>
            </div>

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
              data-tour="photo-camera"
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

            {/*
              しまってある見積もり（依頼者の指示・2026-08-28）。
              撮るボタンより下に置く。ふだんの入口は「撮る」なので、
              上に積むと毎回それをまたぐことになる。
              ふだんは最近の3件だけ。溜まってきたら開いて全部見る
            */}
            {saves.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon name="save" className="h-4 w-4 shrink-0 text-mat-600" />
                  <span className="text-sm font-bold text-ink-700">しまってある見積もり</span>
                  <span className="tnum ml-auto text-xs text-ink-300">{saves.length} 件</span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {(foldSaves ? saves.slice(0, 3) : saves).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2"
                    >
                      {askDrop === s.id ? (
                        <>
                          <span className="min-w-0 flex-1 text-sm text-ink-700">
                            消すと戻せません。よろしいですか？
                          </span>
                          <button
                            type="button"
                            onClick={() => { setSaves(removeSave(s.id)); setAskDrop(null) }}
                            className="shrink-0 rounded-lg bg-seam px-3 py-1.5 text-xs font-bold text-white"
                          >
                            消す
                          </button>
                          <button
                            type="button"
                            onClick={() => setAskDrop(null)}
                            className="shrink-0 rounded-lg border border-ink-100 px-3 py-1.5 text-xs font-bold text-ink-500"
                          >
                            やめる
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => (hasWork ? setAskOpen(s) : openSave(s))}
                            className="flex min-w-0 flex-1 flex-col text-left active:opacity-60"
                          >
                            <span className="truncate text-sm font-bold text-ink-900">{s.name}</span>
                            <span className="tnum flex flex-wrap items-baseline gap-x-2 text-xs text-ink-300">
                              <span>{whenOf(s.savedAt)}</span>
                              <span>生地幅 {s.summary.fabricWidthMm / 10} cm</span>
                              <span className="font-bold text-mat-600">
                                {(s.summary.purchaseMm / 10).toFixed(0)} cm
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAskDrop(s.id)}
                            aria-label={`${s.name}を消す`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-100 text-ink-300 active:bg-chalk"
                          >
                            <Icon name="trash" className="h-4 w-4 shrink-0" />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {saves.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setFoldSaves(!foldSaves)}
                    className="text-left text-xs font-bold text-mat-700"
                  >
                    {foldSaves ? `ぜんぶ見る（${saves.length} 件）` : '最近の3件だけ見る'}
                  </button>
                )}
              </div>
            )}

            {DEV && (
              <div className="mt-2 flex flex-col gap-3 rounded-xl border-2 border-dashed border-hold-400 bg-hold-50 px-4 py-4">
                <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-hold-700">
                  <Icon name="hold" className="h-4 w-4 shrink-0" />
                  開発用（?dev を付けて開いたときだけ出ます）
                </p>
                <p className="text-sm text-ink-500">
                  見本の写真を、いま撮ったものとして読み込みます。定規から先は学生と同じ道です。
                </p>
                <button
                  type="button"
                  onClick={loadSample}
                  disabled={busy}
                  className="flex items-center justify-center gap-2 rounded-xl bg-hold-600 px-5 py-3.5 text-base font-bold text-white active:bg-hold-700 disabled:opacity-50"
                >
                  <Icon name="camera" className="h-5 w-5 shrink-0" />
                  見本を撮った写真として読む
                </button>
                {/* 「ぜんぶ消す」は見出しの「はじめから」に移した（学生も使うため） */}
              </div>
            )}
          </section>
        )}

        {step === 'ruler' && image && quad && (
          <section className="flex flex-col gap-5">
            {/*
              こちらで四隅を当てられたときは、頼むことが変わる（依頼者の質問・2026-09-01）。
              「合わせてください」のままだと、もう合っている枠を
              もう一度合わせに行くことになる。**確かめてほしい**とだけ言う。
              角に触れた時点でこの行は下り、ふだんの言い方に戻る
            */}
            {rulerAuto ? (
              <p className="flex gap-2 text-sm leading-relaxed text-mat-700">
                <Icon name="ruler" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">
                    定規をさがして、枠を当てておきました。
                  </span>
                  合っているか確かめてください。ずれていたら、角をつまんで直せます。
                </span>
              </p>
            ) : perspective ? (
              <p className="text-sm leading-relaxed text-ink-500">
                <span className="font-bold text-ink-700">4つの丸を、定規の角に合わせてください。</span>
                <br />
                台形にゆがんだ形にも合わせられます。2本の指で広げると大きくできます。
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-ink-500">
                <span className="font-bold text-ink-700">緑の枠を、定規にぴったり重ねてください。</span>
                <br />
                中を押して動かす、角をつまんで伸ばす、上の丸をつまんで回す、
                2本の指で広げて大きくする。
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
              すぼまりが出ていたときの知らせ。**切り替えずに言うだけ**。
              押すかどうかは学生に決めてもらう（依頼者の報告・2026-09-01）
            */}
            {!perspective && autoTaper && (
              <Note icon="hint">
                <span className="font-bold">少し斜めから撮られているかもしれません。</span>
                形がゆがんで見えるときだけ、下の「斜めから撮ってしまった」を押してください。
                ふだんは長方形のままのほうが正確です。
              </Note>
            )}

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
                // 行くときは、すぼまりから採れた台形があればそれを渡す。
                // 自動では当てないが、押した人には手間をかけさせない
                if (!perspective && autoTaper) setQuad(autoTaper)
                setPerspective((v) => !v)
              }}
              className="flex items-center gap-1.5 self-start text-xs font-bold text-mat-700"
            >
              <Icon name={perspective ? 'back' : 'hint'} className="h-4 w-4 shrink-0" />
              {perspective ? '長方形のまま合わせる（おすすめ）' : '斜めから撮ってしまった（ゆがみに合わせる）'}
            </button>
            {/*
              「ゆがみに合わせる」ときの注意。こちらで切り替えたときと、
              学生が自分で押したときとで、言うべきことが違う。
              自分で押した人には四隅の置き方の話をし、
              こちらで切り替えたぶんには、撮り方そのものの話をする
            */}
            {perspective && (
              <Note icon="warn" tone="warn">
                {rulerAuto ? (
                  <>
                    <span className="font-bold">斜めのぶんは計算で戻していますが、完全ではありません。</span>
                    真上から撮り直すほうが確実です。
                  </>
                ) : (
                  <>
                    <span className="font-bold">数画素のずれが、離れた型紙を大きく歪ませます。</span>
                    真上から撮り直すほうが確実です。
                  </>
                )}
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
                うまく切り抜けないとき（台の色の調整）
              </summary>
              <div className="pt-4">
                <GreenTuner
                  value={green}
                  onChange={setGreen}
                  photo={image?.imageData ?? null}
                  preview={maskPreview}
                />
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

        {step === 'result' && image && shown && (
          <section className="flex flex-col gap-5">
            <ResultView
              bitmap={image.bitmap}
              result={shown}
              smooth={smooth}
              onSmooth={setSmooth}
              excluded={excluded}
              onToggle={(id) => setExcluded((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
            />

            {/*
              ゆがみの手直し（依頼者の相談・2026-09-01）。

              **最後の手段**なので、ふだんは1行の入口だけにしてある。
              ゆがみの本当の直し場所は定規の四隅で、そちらを直せば全部いっぺんに直る。
              ここを大きく出すと、上流で直せるものを下流で直しに行かせてしまう
            */}
            {warpOpen && smoothed && smoothed.parts[warpIndex] ? (
              <WarpEditor
                part={smoothed.parts[warpIndex]}
                warp={warp}
                onChange={setWarp}
                index={warpIndex}
                count={smoothed.parts.length}
                onIndex={setWarpIndex}
                all={warpAll}
                onAll={setWarpAll}
                onClose={() => setWarpOpen(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setWarpOpen(true)}
                className="flex items-center gap-1.5 self-start text-xs font-bold text-mat-700"
              >
                <Icon name={isWarped(warp) ? 'back' : 'hint'} className="h-4 w-4 shrink-0" />
                {isWarped(warp)
                  ? 'ゆがみを直してあります（もう一度開く）'
                  : '形がゆがんで見える（台形で直す）'}
              </button>
            )}

            {/*
              持ってくる型紙は、出来上がり線で切ってあるとは限らない（依頼者の指摘）。
              先にここで聞いておけば、縫い代を足す画面は要る人にだけ出せる
            */}
            <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-white px-4 py-4">
              {/* 問いかけには「？」を付ける。答えを選ぶところだと、読む前に分かる */}
              <Heading icon="question">この型紙は、どちらですか</Heading>
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

            {/*
              同じ写真から二度目の取り込み（依頼者の指示・2026-09-01）。

              四隅を直しに戻ってきたのなら「置きかえる」が求めていること。
              選ばなかったパーツを足しに戻ってきたのなら「足す」。
              どちらも実際にある道なので、こちらでは決めない。

              ここに出すのは、押す直前に読めるようにするため。
              取り込みボタンの上に置いて、答えるまでボタンは押せないままにしてある
            */}
            {askAgain && (
              <div className="flex flex-col gap-3 rounded-xl border-2 border-mat-500 bg-mat-50 px-4 py-4">
                <p className="flex gap-2 text-sm leading-relaxed text-mat-700">
                  <Icon name="part" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">
                      この写真からは、もう {kept.length} 個 取り込んであります。
                    </span>
                    四隅を直しに戻ってきたのなら「取り込み直す」。
                    <span className="text-mat-600">
                      縫い代を付けたぶんは、取り込み直すと消えます。
                    </span>
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => doKeep(true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mat-500 px-3 py-3 text-sm font-bold text-white active:bg-mat-600"
                  >
                    <Icon name="undo" className="h-4 w-4 shrink-0" />
                    取り込み直す
                  </button>
                  <button
                    type="button"
                    onClick={() => doKeep(false)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-mat-500 bg-white px-3 py-3 text-sm font-bold text-mat-700"
                  >
                    <Icon name="plus" className="h-4 w-4 shrink-0" />
                    そのまま足す
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={keep}
              disabled={chosenCount === 0 || askAgain}
              className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-5 py-4 text-base font-bold text-white active:bg-mat-600 disabled:opacity-50"
            >
              <Icon name="part" className="h-5 w-5 shrink-0" />
              {chosenCount === shown.parts.length
                ? `このパーツを取り込む（${chosenCount}）`
                : `選んだ ${chosenCount} 個を取り込む`}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setAskAgain(false); setStep('ruler') }}
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
        {step === 'fabric' && (
          <FabricView state={parts} onChange={updateParts} onLayout={() => setStep('layout')} />
        )}
        {step === 'parts' && (
          <PartsView
            state={parts}
            onChange={updateParts}
            onAddMore={restart}
            onLayout={() => setStep('fabric')}
          />
        )}
        {step === 'layout' && (
          <LayoutView
            state={parts}
            onChange={updateParts}
            onBack={() => setStep('fabric')}
            saveName={saveName}
            onSaveName={setSaveName}
            onSaved={setSaves}
          />
        )}
      </main>

      {/*
        名義（依頼者の指示・2026-08-31）。どの画面にもいちばん下に出る。
        `main` が `flex-1` なので、中身が短い画面では画面の底に、
        長い画面では最後までたどり着いたところに出る。

        操作するものではないので、いちばん薄い字にしてある。
        ここに置いたぶん画面は少しだけ長くなるが、
        押すものは上に出そろっているので、
        「スクロールしないと操作できない」ことにはならない。
        端末の下端（ホームバーなど）を避ける余白は、main から移してここに付けた
      */}
      <footer className="safe-b px-4 pt-1 text-center text-[10px] tracking-wide text-ink-300">
        制作：Junnosuke Kato
      </footer>
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
  { id: 'fabric', label: '生地', icon: 'cloth' },
  { id: 'layout', label: '並べる', icon: 'layout' },
]

/**
 * 段階の帯。**用意ができている段階は、前へも後ろへも押して行ける**
 * （依頼者の指示・2026-08-27）。
 *
 * 前の段階へ戻る道は、それぞれの画面の中にも置いてあるが、
 * 2つ以上動こうとすると、そのたびに1画面ずつ通ることになる。
 * 「いまここ」と言っている帯がそのまま行き先になっていれば、一度で行ける。
 *
 * まだ用意ができていない段階（写真も定規もまだ、など）は押せないままにしてある。
 * そこへ飛べてしまうと、何も無い画面が出るため。
 *
 * 上の細い線は3通りに塗り分ける。
 * 濃い緑＝ここまで来た、薄い緑＝押せば行ける、灰色＝まだ行けない
 */
function StepBar({ step, canGo, onGo }: {
  step: Step
  canGo: (id: Step) => boolean
  onGo: (id: Step) => void
}) {
  const index = STEPS.findIndex((s) => s.id === step)
  return (
    <ol data-tour="steps" className="flex gap-1 px-4">
      {STEPS.map((s, i) => {
        const here = i === index
        const ready = canGo(s.id)
        /** いまいるところ以外で、用意ができているところ＝押して行ける */
        const jump = !here && ready
        const label = (
          <>
            <span
              className={`h-1 rounded-full ${
                i <= index ? 'bg-mat-500' : ready ? 'bg-mat-300' : 'bg-ink-100'
              }`}
            />
            <span
              className={`flex items-center gap-1 text-xs ${
                here ? 'font-bold text-mat-700'
                  : jump ? 'text-mat-700' : 'text-ink-300'
              }`}
            >
              <Icon name={s.icon} className="h-3.5 w-3.5 shrink-0" />
              {s.label}
            </span>
          </>
        )
        return (
          <li key={s.id} className="flex flex-1 flex-col">
            {jump ? (
              <button
                type="button"
                onClick={() => onGo(s.id)}
                aria-label={`${s.label}へ${i < index ? '戻る' : '進む'}`}
                className="flex flex-col gap-1.5 text-left active:opacity-60"
              >
                {label}
              </button>
            ) : (
              <span className="flex flex-col gap-1.5">{label}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
