/**
 * アプリ全体で使う「絵ことば」（判断23）。
 *
 * 絵は全部、**裁縫室にある物をそのまま横から見た形**で描く。
 * 生地の絵と同じ見方にそろえてあるので、
 * 生地の絵が読める人には、この小さい絵もそのまま読める。
 *
 *   横棒1本   一重
 *   横棒2本   二重
 *   ヘアピン形 折り山（わ）
 *   はさみ    裁ち端・裁ち切り
 *   点々      みみ
 *
 * 絵だけで意味が決まるとは考えていない。**必ず言葉と並べて出す**。
 * 絵は、読む前に「どのあたりの話か」を目で拾うための手がかりであって、
 * 言葉の代わりではない。だから絵には読み上げの名前を付けず（aria-hidden）、
 * 画面読み上げには言葉のほうだけが読まれるようにしてある。
 *
 * 色は指定しない。置いた場所の文字色をそのまま継ぐ（currentColor）ので、
 * 赤い注意文の中なら赤く、緑の見出しの中なら緑になる。
 */

import { useState } from 'react'
import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'camera' | 'photo' | 'ruler' | 'measure'
  | 'part' | 'seam' | 'scissors' | 'fold'
  | 'cloth' | 'selvage' | 'clothWidth' | 'yardage' | 'layout' | 'hold'
  | 'grain' | 'grainSide' | 'nap' | 'napNone' | 'flip' | 'mirror' | 'nest'
  | 'question' | 'hint' | 'warn' | 'check'
  | 'plus' | 'trash' | 'back' | 'undo' | 'redo' | 'save'
  | 'turnLeft' | 'turnRight'

/**
 * みみのピン穴。生地の絵で使っている点々と同じもの。
 *
 * 実物どおりに細かく打つと、16px まで縮めたときに消えてしまう。
 * 数を減らして、粒を大きくしてある
 */
const holes = (x: number, ys: number[] = [7.5, 12, 16.5]) =>
  ys.map((y) => <circle key={y} cx={x} cy={y} r={1} fill="currentColor" stroke="none" />)

/**
 * 寸法線の矢じり。(x,y) が先端で、(dx,dy) は線がのびていく向き。
 * 羽根は、のびていく向きへ戻りながら左右へ開く
 */
const head = (x: number, y: number, dx: number, dy: number) => {
  const a = 1.9
  const p = (sx: number, sy: number) =>
    `${(x + dx * a + sx).toFixed(2)} ${(y + dy * a + sy).toFixed(2)}`
  return `M${p(-dy * a, dx * a)}L${x} ${y}L${p(dy * a, -dx * a)}`
}

const SHAPES: Record<IconName, ReactNode> = {
  /* ---------------------------------------------------------- 撮る・測る */

  camera: (
    <>
      <path d="M9 6.4l1.3-2.1h3.4l1.3 2.1h3.9A2.1 2.1 0 0 1 21 8.5v9.4a2.1 2.1 0 0 1-2.1 2.1H5.1A2.1 2.1 0 0 1 3 17.9V8.5a2.1 2.1 0 0 1 2.1-2.1z" />
      <circle cx="12" cy="13.2" r="3.7" />
    </>
  ),

  photo: (
    <>
      <rect x="2.8" y="4.6" width="18.4" height="14.8" rx="2.1" />
      <circle cx="8.2" cy="9.6" r="1.7" />
      <path d="M3.4 16.6l4.4-4.3 3.7 3.6 3.1-2.6 6.4 5.8" />
    </>
  ),

  /** 方眼定規。透けていて、目が引いてある */
  ruler: (
    <>
      <rect x="2.6" y="7.6" width="18.8" height="8.8" rx="1.1" />
      <path d="M7.3 7.6v8.8M12 7.6v8.8M16.7 7.6v8.8M2.6 12h18.8" />
    </>
  ),

  /** 寸法線。実寸に直したことの印 */
  measure: (
    <>
      <path d="M3.4 6.6v10.8M20.6 6.6v10.8" />
      <path d="M3.4 12h17.2" />
      <path d={head(3.4, 12, 1, 0)} />
      <path d={head(20.6, 12, -1, 0)} />
    </>
  ),

  /* ------------------------------------------------------ 型紙・縫い代・わ */

  /**
   * 型紙1枚。すそへ向かって少し広がった形と、まん中の地の目線。
   * 矢じりまで描くと 16px では中が潰れるので、線一本にとどめてある
   */
  part: (
    <>
      <path d="M6.6 3.6h5.4l4.8 5.4-1.4 11.4H8z" />
      <path d="M11.6 11.4v6" />
    </>
  ),

  /** みみ。生地のはしの、機械の穴が並んでいる帯 */
  selvage: (
    <>
      <rect x="2.8" y="3.6" width="18.4" height="16.8" rx="1.2" />
      <path d="M8.2 3.6v16.8" />
      {holes(5.5, [7, 12, 17])}
    </>
  ),

  /** 出来上がり線（内）と、外へ足した縫い代（外の破線） */
  seam: (
    <>
      <path d="M8.6 17.4V9.9a1.3 1.3 0 0 1 1.3-1.3h7.5" />
      <path d="M4.2 17.4V9.9A5.7 5.7 0 0 1 9.9 4.2h7.5" strokeDasharray="2.6 2.1" />
    </>
  ),

  scissors: (
    <>
      <circle cx="5.4" cy="5.6" r="2.4" />
      <circle cx="5.4" cy="18.4" r="2.4" />
      <path d="M7.4 6.9L19.4 18.6M7.4 17.1L19.4 5.4" />
    </>
  ),

  /** 折り山。生地を横から見た、折り返しのヘアピン形 */
  fold: <path d="M18.6 6.6H9.4a5.4 5.4 0 0 0 0 10.8h9.2" />,

  /* ------------------------------------------------------------- 生地 */

  /** 一枚の生地。両はしにみみのピン穴 */
  cloth: (
    <>
      <rect x="2.8" y="4.8" width="18.4" height="14.4" rx="1.2" />
      {holes(5.2)}
      {holes(18.8)}
    </>
  ),

  /** 生地幅。みみからみみまでの差し渡し */
  clothWidth: (
    <>
      <rect x="2.8" y="5.6" width="18.4" height="12.8" rx="1.2" />
      {holes(5.2, [8.4, 15.6])}
      {holes(18.8, [8.4, 15.6])}
      <path d="M7.6 12h8.8" />
      <path d={head(7.6, 12, 1, 0)} />
      <path d={head(16.4, 12, -1, 0)} />
    </>
  ),

  /** 買う長さ。生地の丈のほうを測っている */
  yardage: (
    <>
      <rect x="7.4" y="2.8" width="13.8" height="18.4" rx="1.2" />
      {holes(9.6)}
      <path d="M3.6 5.4v13.2" />
      <path d={head(3.6, 5.4, 0, 1)} />
      <path d={head(3.6, 18.6, 0, -1)} />
    </>
  ),

  /**
   * 後で裁つぶんの余白。生地の上に出る印と同じ、破線の枠に斜線。
   * ここだけは「物の形」ではなく「図の上の印」だが、
   * 空けておく場所そのものに形が無い以上、印を借りるほうが分かる
   */
  hold: (
    <>
      <rect x="2.8" y="5.4" width="18.4" height="13.2" rx="1.2" strokeDasharray="3.1 2.5" />
      <path d="M7.4 16.4l3.4-6.6M12.4 16.4l3.4-6.6" />
    </>
  ),

  /*
    しまっておく＝しおり。
    「後で裁つぶんの余白（hold）」と同じ絵を使い回すと、
    同じ画面に二通りの意味で出てしまうので、別の絵にしてある
  */
  save: (
    <path d="M6.6 3.6h10.8a1.4 1.4 0 0 1 1.4 1.4v15.1a.7.7 0 0 1-1.07.6L12 17.3l-5.73 3.4A.7.7 0 0 1 5.2 20.1V5a1.4 1.4 0 0 1 1.4-1.4z" />
  ),

  /** 生地の上に型紙を並べたところ */
  layout: (
    <>
      <rect x="2.6" y="3.4" width="18.8" height="17.2" rx="1.4" />
      <path d="M5.4 6.2h6.1v7.4H5.4zM13.4 9.1h5.2v8.7h-5.2z" />
    </>
  ),

  /* --------------------------------------------------------- 向き・地の目 */

  /** 地の目（たて） */
  grain: (
    <>
      <path d="M12 3.6v16.8" />
      <path d={head(12, 3.6, 0, 1)} />
      <path d={head(12, 20.4, 0, -1)} />
    </>
  ),

  /** 地の目を横に倒す */
  grainSide: (
    <>
      <path d="M3.6 12h16.8" />
      <path d={head(3.6, 12, 1, 0)} />
      <path d={head(20.4, 12, -1, 0)} />
    </>
  ),

  /** 上下の向きがある生地。上がひとつに決まっている */
  nap: (
    <>
      <rect x="4.4" y="2.9" width="15.2" height="18.2" rx="1.3" />
      <path d="M12 17.4V8.2M8.8 11.4L12 8.2l3.2 3.2" />
    </>
  ),

  /** 上下の向きがない生地。どちらを上にしてもよい */
  napNone: (
    <>
      <rect x="4.4" y="2.9" width="15.2" height="18.2" rx="1.3" />
      <path d="M12 7.6v8.8M9.4 10.2L12 7.6l2.6 2.6M9.4 13.8L12 16.4l2.6-2.6" />
    </>
  ),

  /** 上下を入れかえる */
  flip: (
    <>
      <path d="M8.6 4.8v14.4M6.4 7L8.6 4.8 10.8 7" />
      <path d="M15.4 19.2V4.8M13.2 17l2.2 2.2 2.2-2.2" />
    </>
  ),

  /** 裏返す。破線をはさんで左右が鏡になる */
  mirror: (
    <>
      <path d="M12 3.2v17.6" strokeDasharray="2.4 2.2" />
      <path d="M9.2 7.4L3.8 12l5.4 4.6zM14.8 7.4L20.2 12l-5.4 4.6z" />
    </>
  ),

  /**
   * 差し込む。上下を逆にした型紙を、となりへ噛み合わせる。
   * 二つの三角がすそ野で食い違っていることが、この絵の全部。
   * 離して描くと「ただの二つの形」に見えるので、横幅をわざと重ねてある
   */
  nest: (
    <>
      <path d="M1.8 20.2h10.6L7.1 3.8z" />
      <path d="M11.6 3.8h10.6L16.9 20.2z" />
    </>
  ),

  /* ------------------------------------------------------- 問い・注意・補足 */

  question: (
    <>
      <circle cx="12" cy="12" r="8.9" />
      <path d="M9.4 9.5a2.7 2.7 0 0 1 5.3.7c0 1.8-2.6 2.2-2.6 3.9" />
      <circle cx="12" cy="17.3" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),

  /** 補足・こつ */
  hint: (
    <>
      <path d="M12 2.9a6.1 6.1 0 0 0-3.5 11.1c.6.4.9 1 .9 1.7v.5h5.2v-.5c0-.7.3-1.3.9-1.7A6.1 6.1 0 0 0 12 2.9z" />
      <path d="M9.9 19.1h4.2M10.7 21.3h2.6" />
    </>
  ),

  warn: (
    <>
      <path d="M10.7 4.2L2.3 18.7a1.5 1.5 0 0 0 1.3 2.3h16.8a1.5 1.5 0 0 0 1.3-2.3L13.3 4.2a1.5 1.5 0 0 0-2.6 0z" />
      <path d="M12 9.6v4.7" />
      <circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),

  check: <path d="M4.4 12.6l5 5 10.2-11.2" />,

  /* ----------------------------------------------------------- 操作 */

  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,

  trash: (
    <>
      <path d="M4.4 6.9h15.2M9.4 4.4h5.2" />
      <path d="M6.4 6.9l1 12.9h9.2l1-12.9" />
      <path d="M10.2 10.4v6M13.8 10.4v6" />
    </>
  ),

  back: <path d="M15 4.6L7.6 12l7.4 7.4" />,

  /*
    1つ戻る／1つ進む。
    しつけ糸をほどいて縫い直すように、来た道をぐるりと戻る矢印で描く。
    左右を鏡にしただけの一対にしてあるので、並べたときに対の関係が目で分かる
  */
  undo: (
    <>
      <path d="M4.6 8.3h9.1a5.1 5.1 0 0 1 0 10.2H7.2" />
      <path d="M8.4 4.5L4.6 8.3l3.8 3.8" />
    </>
  ),
  redo: (
    <>
      <path d="M19.4 8.3h-9.1a5.1 5.1 0 0 0 0 10.2h6.5" />
      <path d="M15.6 4.5l3.8 3.8-3.8 3.8" />
    </>
  ),

  /*
    型紙を左右へ90度ずつ回す（依頼者の指摘・2026-08-31）。

    はじめは「四角（型紙）の上に弧」で描いていたが、16px まで縮めると
    弧と四角がくっついて、ふたの付いた箱に見えた。
    まわる向きだけを、ほぼ一周する弧で描くほうが小さくても読める。
    「1つ戻る／1つ進む」と同じく、左右を鏡にしただけの一対にしてある
  */
  turnLeft: (
    <>
      <path d="M5 12A7 7 0 1 0 8.6 5.9" />
      <path d="M12.4 6.2l-3.8-.3-.4 3.8" />
    </>
  ),
  turnRight: (
    <>
      <path d="M19 12A7 7 0 1 1 15.4 5.9" />
      <path d="M11.6 6.2l3.8-.3.4 3.8" />
    </>
  ),
}

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName
  /** 既定は文字と同じ高さ。文の頭に置くときだけ大きさを変える */
  className?: string
}

export function Icon({ name, className = 'h-[1.15em] w-[1.15em] shrink-0', ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {SHAPES[name]}
    </svg>
  )
}

/**
 * 頭に絵の付いた、短い補足の一段落。
 *
 * 補足・注意・こつは、本文と同じ見た目で並べると読み飛ばされる。
 * 絵をひとつ左に出しておくと、読む前に「これは補足だ」と分かる。
 */
export function Note({
  icon = 'hint', tone = 'plain', children,
}: {
  icon?: IconName
  /** plain = 補足、warn = 気をつけること、good = うまくいっている印 */
  tone?: 'plain' | 'warn' | 'good'
  children: ReactNode
}) {
  const color =
    tone === 'warn' ? 'text-seam' : tone === 'good' ? 'text-mat-600' : 'text-ink-500'
  return (
    <p className={`flex gap-2 text-xs leading-relaxed ${color}`}>
      <Icon name={icon} className="mt-[0.15em] h-[1.15em] w-[1.15em] shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  )
}

/**
 * ひと言だけ出して、続きは畳んでおく補足。
 *
 * 「説明文がやたら長かったり多かったりして、感覚的にやれない」という
 * 指摘を受けて入れた（依頼者・2026-08-27）。
 * 説明そのものは要るのだけれど、**読まなくても手が動く状態**が先にあって、
 * 引っかかった人だけが「？」を押して読む、という順番にする。
 *
 * ひと言（summary）は、それだけで結論になっていること。
 * 「くわしくは？」の続きだと成り立たない書き方にはしない。
 */
export function Hint({
  icon = 'hint', summary, children,
}: {
  icon?: IconName
  /** 畳んだままでも意味が通る、ひと言 */
  summary: ReactNode
  /** 「？」を押したときに出る続き */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col text-xs leading-relaxed text-ink-500">
      {/*
        行そのものを押せるようにしてある。
        小さな「？」だけを的にすると、指では狙いにくい
      */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1 text-left"
      >
        <Icon name={icon} className="h-[1.15em] w-[1.15em] shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">{summary}</span>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
            open ? 'border-mat-500 bg-mat-50 text-mat-700' : 'border-ink-100 text-ink-300'
          }`}
        >
          <Icon name="question" className="h-3.5 w-3.5 shrink-0" />
        </span>
        <span className="sr-only">{open ? '説明を閉じる' : 'くわしく'}</span>
      </button>
      {open && (
        <p className="rounded-lg bg-chalk px-3 py-2 pl-[2.1em] text-ink-500">{children}</p>
      )}
    </div>
  )
}

/**
 * 絵の付いた小見出し。
 * 見出しの高さがそろわないと、絵が飾りに見えてしまうので、ここで固定する。
 */
export function Heading({
  icon, children, right,
}: {
  icon: IconName
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} className="h-4 w-4 shrink-0 text-mat-600" />
      <h2 className="min-w-0 flex-1 text-sm font-bold text-ink-700">{children}</h2>
      {right}
    </div>
  )
}
