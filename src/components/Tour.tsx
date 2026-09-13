/**
 * はじめて開いた画面で、実物を指さしながら順に説明する案内。
 *
 * 説明文を減らすほど、はじめての人の手がかりも減る。
 * そこで「常に画面に置いておく文章」を減らすかわりに、
 * **最初の1回だけ、実際の部品を光らせて説明する**（依頼者の提案・2026-08-27）。
 * 読み終われば二度と出ない。あとから見たいときは、見出しの「？」で呼び戻せる。
 *
 * 書く相手は学生。服作りは分かっている前提なので、
 * 「わ」「地の目」「みみ」といった言葉そのものは説明しない。
 * 説明するのは、この画面のどこを押せば何が起きるか、だけにする。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type TourId = 'photo' | 'ruler' | 'result' | 'parts' | 'layout'

/**
 * 出す（依頼者の指示・2026-09-13「アプリの中の案内を出す」）。
 *
 * 2026-08-27 から止めてあった。機能の直しと画面の調整が続くあいだは、
 * 案内の文面と実物が食い違いやすかったため。4段階に落ち着いたので出す。
 *
 * 出すにあたって、止めていたあいだに増えたずれを直してある。
 *   - 「縫い代」の画面に案内が2つ（parts と seam）掛かっていて、
 *     同時に開いていた。1つにまとめた
 *   - 「測る」の画面には案内が無かった。ここがいちばん迷うので足した
 *   - `seam-open` の印が、開いているカードに付いていて当たらなかった。
 *     閉じているカードに付け替えた
 *   - 案内と同じことを言っていた常設の説明（パーツ一覧の
 *     「枚数はできあがりに必要な数」）を消した
 *
 * この先また画面を変えるときは、**指す相手（data-tour の印）が
 * そのときの画面にあるか**を必ず確かめること。無い印はだまって飛ばされるので、
 * 案内が1つ減っていても画面上は何も起きない
 */
export const TOUR_ON: boolean = true

/** 案内の1つぶん。target は、指す相手に付けた data-tour の値 */
type Spot = {
  target: string
  title: ReactNode
  body: ReactNode
}

/*
  中身を書き替えたら、この番号を上げる。
  一度読んだ人にも、新しい案内をもう一度出すため。
  tour1 → tour2（2026-09-13、案内を出すのにあわせて全部書き直した）
*/
const KEY = 'yojaku.tour2.'

const TOURS: Record<TourId, Spot[]> = {
  photo: [
    {
      target: 'steps',
      title: 'いまどこにいるか、この帯で分かります',
      body: '撮る → 測る → 縫い代 → 並べる の順に進みます。色が付いているところが、いまの場所です。',
    },
    {
      target: 'photo-hint',
      title: 'この行は、どこを押しても開きます',
      body: 'くわしい話は「？」の中に畳んであります。読まなくても先へ進めるので、引っかかったときだけ開いてください。',
    },
    {
      target: 'photo-camera',
      title: '無地で色のついた台に置いて、真上から撮ります',
      body: '型紙といっしょに方眼定規を1本置いてください。その定規が、写真を実寸に直すものさしになります。',
    },
  ],
  /*
    「測る」の1枚目。写真の上に当てた枠を、定規に合わせてもらう画面。
    ここを外すと、このあとの寸法がまるごとずれる。
    それなのに、何を合わせているのかが絵だけでは伝わりにくい
  */
  ruler: [
    {
      target: 'ruler-quad',
      title: 'この枠を、定規のふちに合わせます',
      body: '写真から定規をさがして、枠を当ててあります。ずれていたら角をつまんで直してください。ここがこのあとの寸法のもとになります。',
    },
    {
      target: 'ruler-kind',
      title: '使った定規は、どちらですか',
      body: '選んだ定規の実際の長さを、ものさしにします。50cm と 30cm で答えが変わるので、ここだけは見ておいてください。',
    },
    {
      target: 'ruler-go',
      title: '合ったら、実寸に直します',
      body: '写真の中の型紙を切り抜いて、センチの形にします。少し時間がかかります。',
    },
  ],

  /*
    「測る」の2枚目。切り抜けた形と寸法を確かめるところ。
    ここで数字を見ないまま進むと、あとの計算がぜんぶ狂う
  */
  result: [
    {
      target: 'result-card',
      title: 'この丈と幅が、実物と近いか',
      body: '近くなければ、定規の種類か四隅がずれています。型紙でないもの（手や消しゴム）は、左の ✓ を押して外してください。',
    },
    {
      target: 'result-seam',
      title: '持ってきた型紙は、どちらの線ですか',
      body: '出来上がり線なら「縫い代なし」。裁ち切り線まで引いてあるなら「縫い代つき」。この写真から取り込むもの全部に効きます。',
    },
    {
      target: 'result-go',
      title: '取り込むと、縫い代の画面へ',
      body: '写真が何枚かあるときは、続けて次の写真になります。あとから「撮り足す」で足すこともできます。',
    },
  ],

  /*
    「縫い代」の画面。カードの一覧と、開いているカードの中身は
    ひと続きの画面なので、案内も1つにまとめてある
    （前は parts と seam の2つが同時に開いていた）
  */
  parts: [
    {
      target: 'part-row',
      title: '取り込んだ型紙が、1枚ずつカードに',
      body: '名前は一覧から選べます（スカート前、ベルト…）。枚数は、できあがりに必要な数です——左右で使うなら 2 にしてください。',
    },
    {
      target: 'seam-figure',
      title: '辺を押すと、その辺を選べます',
      body: '番号の付いているところが辺です。選んだ辺は赤くなります。青く出ているのが、足した縫い代のぶんです。',
    },
    {
      target: 'seam-bulk',
      title: '同じ量を、いちどに全部の辺へ',
      body: '先にまとめて付けてから、裾など量の違う辺だけを直すのが早いです。',
    },
    {
      target: 'seam-steps',
      title: '選んだ辺を、ここで決めます',
      body: '数字は縫い代の量（cm）。「わ 0」は縫い代を付けない、つまりその辺を生地の折り山に当てる、という意味です。',
    },
    {
      target: 'seam-open',
      title: '別の型紙は、その行を押します',
      body: '「縫い代を決める」の行を押すと、その型紙のパネルが開きます。開くのは1つだけで、もう一度押せば畳めます。',
    },
    {
      target: 'to-layout',
      title: 'ぜんぶ決まったら、生地の上へ',
      body: 'あとから戻って直せます。並べてみてから枚数を変えても、長さは計算し直されます。',
    },
  ],
  layout: [
    {
      target: 'fabric-width',
      title: 'まず、使う生地の幅を選びます',
      body: '両端のみみは使えないので、そのぶんを引いた幅で並べます。一覧にない幅は、右の欄に数字で入れてください。',
    },
    {
      target: 'fabric-nap',
      title: '毛並みや柄に上下がある生地は、ここ',
      body: '押すと「一方裁ち」に変わり、型紙を上下逆に入れられなくなります。ふだんの生地は「差し込み可」のままで大丈夫です。',
    },
    {
      target: 'fabric',
      title: 'これが生地です',
      body: '上下の波線が、はさみで切る裁ち端。左右の細い帯がみみです。置いた型紙は、指でつまんで動かせます。上の断面図の辺を押すと、折り山の位置を変えられます。',
    },
    {
      target: 'tray',
      title: '押すと、生地の上に出ます',
      body: 'まだ置いていない枚数がここに出ます。ぜんぶ 0 になれば、必要な数がそろっています。',
    },
    {
      target: 'totals',
      title: '並べ終えたら、ここが買う長さ',
      body: '並べるたびに変わります。ゆとりを足したうえで、10cm 単位に切り上げた数です。',
    },
  ],
}

/*
  見出しの「？」から呼び戻すための、小さな呼び出し口。
  いま出ている画面の Tour だけが応えるので、どの画面から押しても
  その画面の案内が出る
*/
const listeners = new Set<() => void>()

export function replayTour() {
  if (!TOUR_ON) return
  listeners.forEach((f) => f())
}

/** その画面の案内を、まだ読んでいなければ出す */
export function Tour({ id }: { id: TourId }) {
  const spots = TOURS[id]
  const [at, setAt] = useState<number | null>(null)
  const [box, setBox] = useState<{ t: number; l: number; w: number; h: number } | null>(null)

  const finish = useCallback(() => {
    localStorage.setItem(KEY + id, '1')
    setAt(null)
    setBox(null)
  }, [id])

  /* はじめて開いたときだけ。画面が組み上がるのを少し待ってから出す */
  useEffect(() => {
    if (!TOUR_ON) return
    if (localStorage.getItem(KEY + id) === '1') return
    const timer = setTimeout(() => setAt(0), 450)
    return () => clearTimeout(timer)
  }, [id])

  /* 見出しの「？」から呼ばれたとき */
  useEffect(() => {
    const again = () => { setAt(0) }
    listeners.add(again)
    return () => { listeners.delete(again) }
  }, [])

  /* 指す相手の位置を測る。画面が動いても付いていく */
  useEffect(() => {
    if (at === null) return
    const spot = spots[at]

    const find = () => document.querySelector<HTMLElement>(`[data-tour="${spot.target}"]`)

    const el = find()
    if (!el) {
      /*
        その画面に無い部品（縫い代つきの型紙には「まとめて」が無い、など）は
        だまって飛ばす。案内のために画面を作り替えることはしない
      */
      const skip = setTimeout(() => {
        if (at + 1 >= spots.length) finish()
        else setAt(at + 1)
      }, 0)
      return () => clearTimeout(skip)
    }

    const first = el.getBoundingClientRect()
    if (first.top < 8 || first.bottom > window.innerHeight - 8) {
      el.scrollIntoView({ block: 'center' })
    }

    const measure = () => {
      const now = find()
      if (!now) return
      const r = now.getBoundingClientRect()
      setBox({ t: r.top, l: r.left, w: r.width, h: r.height })
    }

    /*
      いま測って、少しあとにもう一度測る。
      2回目は、上の scrollIntoView で画面が動いたぶんを拾うため。
      requestAnimationFrame は画面が隠れていると呼ばれないので、ここでは使わない
    */
    measure()
    const again = setTimeout(measure, 80)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(again)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [at, spots, finish])

  /* 閉じる的が小さいと逃げ場がなくなるので、Esc でも閉じられるようにする */
  useEffect(() => {
    if (at === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, finish])

  if (at === null || !box) return null

  const spot = spots[at]
  const last = at + 1 >= spots.length
  const next = () => { if (last) finish(); else setAt(at + 1) }

  /* 光らせる枠。指の太さぶん、少し外まで含める */
  const pad = 6
  const hole = { top: box.t - pad, left: box.l - pad, width: box.w + pad * 2, height: box.h + pad * 2 }

  /*
    ふきだしの置き場所。

    まず下、入らなければ上。**どちらにも入らないとき**は画面の下端に置く。
    指す相手が画面より高いことがあり（縫い代のカードなど）、
    そのときに上下どちらかへ寄せると、ふきだしがまるごと画面の外へ出て
    「次へ」が押せなくなる。案内が進まなくなり、うしろの板だけが残って
    画面そのものが触れなくなる——2026-09-13 に実際にそうなった。

    下端に置くときは、指す先を示す角（▲）を出さない。
    相手をまたいで指すことになり、線が嘘になるため
  */
  const room = 240
  const below = window.innerHeight - (box.t + box.h) > room
  const above = !below && box.t > room
  const floating = !below && !above
  const arrowX = Math.min(Math.max(box.l + box.w / 2, 28), window.innerWidth - 28)

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="使い方の案内">
      {/* うしろを押せないようにする板。案内の途中で誤って触らないため */}
      <div className="fixed inset-0 z-40" style={{ touchAction: 'none' }} />

      <div
        className="pointer-events-none fixed z-40 rounded-xl border-2 border-mat-500"
        style={{
          ...hole,
          boxShadow: '0 0 0 9999px rgba(21, 25, 22, 0.62)',
        }}
      />

      {/* ふきだしの角。どれを指しているのかを、線でも示す */}
      {!floating && (
        <div
          className="pointer-events-none fixed z-50 h-3 w-3 rotate-45 border-mat-500 bg-white"
          style={{
            left: arrowX - 6,
            top: below ? box.t + box.h + pad + 6 : undefined,
            bottom: below ? undefined : window.innerHeight - box.t + pad + 6,
            borderTopWidth: below ? 2 : 0,
            borderLeftWidth: below ? 2 : 0,
            borderRightWidth: below ? 0 : 2,
            borderBottomWidth: below ? 0 : 2,
          }}
        />
      )}

      <div
        className="fixed z-50 flex flex-col gap-2 rounded-2xl border-2 border-mat-500 bg-white px-4 py-3.5 shadow-lg"
        style={{
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(calc(100vw - 24px), 27rem)',
          top: below ? box.t + box.h + pad + 12 : undefined,
          bottom: below
            ? undefined
            : floating
              ? 12
              : window.innerHeight - box.t + pad + 12,
        }}
      >
        <div className="flex items-center gap-2">
          <Icon name="hint" className="h-4 w-4 shrink-0 text-mat-600" />
          <span className="text-xs font-bold tracking-wide text-mat-700">使い方</span>
          <span className="tnum text-xs text-ink-300">
            {at + 1} / {spots.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="ml-auto -mr-1 px-2 py-1 text-xs text-ink-300"
          >
            とばす
          </button>
        </div>

        <p className="text-sm font-bold leading-snug text-ink-900">{spot.title}</p>
        <p className="text-xs leading-relaxed text-ink-500">{spot.body}</p>

        <div className="flex items-center gap-2 pt-0.5">
          {at > 0 && (
            <button
              type="button"
              onClick={() => setAt(at - 1)}
              className="flex items-center gap-1 px-1 py-2 text-xs font-bold text-ink-500"
            >
              <Icon name="back" className="h-3.5 w-3.5 shrink-0" />
              もどる
            </button>
          )}
          <button
            type="button"
            onClick={next}
            autoFocus
            className="ml-auto flex items-center justify-center gap-1.5 rounded-xl bg-mat-500 px-5 py-2.5 text-sm font-bold text-white active:bg-mat-600"
          >
            {last ? 'はじめる' : '次へ'}
            <Icon name="back" className="h-4 w-4 shrink-0 rotate-180" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
