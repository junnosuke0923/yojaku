/**
 * 使い方の動画を、アプリの中から見られるようにする札
 * （依頼者の指示・2026-09-13「アプリの中にボタンを付けて公開」）。
 *
 * ## 閉じる道を付けていない
 *
 * ホーム画面に置く札（InstallCard）は「あとで」で消せるようにしてある。
 * あちらは一度きりの用事だから消えてよい。こちらは違う。
 * 学期のあいだ、何度でも見に戻る先になるので、
 * **いつ来ても同じ場所にある**ことのほうが大事になる。
 *
 * そのかわり、ふだんは1行に畳んである。押したときだけ絵が開く。
 * 撮る画面のふだんの仕事は「撮る」なので、その上に場所を取らない。
 *
 * ## 先に読み込ませない
 *
 * `preload="none"` を付けてある。約 4.8MB あるので、
 * 見ない人にまで落とさせない。表紙の絵（43KB）だけ先に出して、
 * 中身は再生を押した人のぶんだけ取りにいく。
 *
 * 覚えておく係（service worker）も、この動画には手を出さない。
 * 動画は「ここからここまで」と切り分けて取りにいくので、
 * その切れはしを覚えてしまうと、次に通しで見ようとしたときに
 * 途中までしか返らない（vite.config.ts の fetch のところを参照）
 */

import { useState } from 'react'
import { Icon } from './Icon'

export function HowToCard() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left"
      >
        <Icon name="play" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="text-sm font-bold text-ink-700">使い方の動画</span>
        <span className="tnum shrink-0 text-xs text-ink-300">3分</span>
        {/* 開け閉めの向きは、アプリのほかの畳みものと同じ（閉→下、開→上） */}
        <Icon
          name="chevron"
          className={`ml-auto h-4 w-4 shrink-0 text-ink-300 transition-transform ${
            open ? '-rotate-90' : 'rotate-90'
          }`}
        />
      </button>

      {open && (
        <>
          {/*
            縦長（1080×1920）。スマホで見る人がそのまま画面いっぱいにできる向き。
            枠は付けず、動画そのものの角だけ丸める
          */}
          <video
            controls
            playsInline
            preload="none"
            poster="./tsukaikata.jpg"
            className="w-full rounded-lg bg-ink-100"
          >
            <source src="./tsukaikata.mp4" type="video/mp4" />
          </video>
          <p className="text-xs leading-relaxed text-ink-500">
            撮るところから、買ってくる長さが出るまでを通して見せています。
            電波の届かないところでは開けません。
          </p>
        </>
      )}
    </div>
  )
}
