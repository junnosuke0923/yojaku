/**
 * 出来あがった裁ち合わせ図を、1枚の画像にして端末へ書き出す。
 *
 * 依頼者の指示（2026-09-01）は2つ。
 *
 *   「完了したパターン配置の配置図のみを画像として端末に保存できるようにしたい」
 *   「生地幅と買う長さは入れていいが、図にはかからないように。
 *     授業資料に添付するとき不要なこともあるので、トリミングで削れるレイアウトで」
 *
 * そこで**数字は下端の帯にまとめてある**。図の下に、色を変えた帯を1本敷くだけ。
 * 帯は図と重ならないので、下を切り落とせば図だけが残る。
 * 帯の色を変えてあるのは、切る場所を目で決められるようにするため。
 *
 * 画面に出ている SVG をそのまま材料にしている。別に描き直すと、
 * 画面と書き出しで絵が食い違うようになる（描き方を直すたびに2か所直すことになる）。
 * ただし画面のほうは指で拡大できるので、その**倍率は無視して、
 * ぜんぶ見えている状態の viewBox** を渡してもらう。
 */

/** 書き出す幅（px）。資料に貼っても粗くならない大きさ */
const OUT_W = 2000
/** これ以上は縦に伸ばさない。長い生地でも端末が扱える大きさに収める */
const MAX_H = 8000
/** 図のまわりの余白 */
const MARGIN = 48
/** 区間どうしのすきま */
const GAP = 56
/** 区間の見出しに使う高さ */
const LABEL_H = 58
/** 下端の帯の高さ。ここを切り落とせば図だけになる */
const CAPTION_H = 112

const PAPER = '#ffffff'
const BAND = '#f1efe7'
const RULE = '#dfe4df'
const INK = '#2b332d'
const INK_SOFT = '#5c665f'
const FONT = '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif'

export type Sheet = {
  /** 画面に出ている、そのままの SVG */
  svg: SVGSVGElement
  /** 拡大していない、ぜんぶ見えている状態の viewBox */
  viewBox: string
  /** 区間が2つ以上あるときだけ付ける見出し */
  label?: string
}

/** SVG を1枚の画像として読み込む。画面の CSS は届かないので、字の書体だけ持たせる */
function loadSheet(sheet: Sheet, width: number, height: number): Promise<HTMLImageElement> {
  const clone = sheet.svg.cloneNode(true) as SVGSVGElement
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  clone.removeAttribute('data-tour')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', sheet.viewBox)
  clone.setAttribute('width', String(Math.round(width)))
  clone.setAttribute('height', String(Math.round(height)))
  clone.setAttribute('font-family', FONT)
  /*
    画面でだけ使う持ち手（折り返す幅を変えるつまみと、その指の的）は取り除く。
    裁ち合わせ図として見せる絵に、操作のための矢が入っていてはいけない
  */
  for (const el of [...clone.querySelectorAll('[data-ui]')]) el.remove()

  const text = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')) }
    img.src = url
  })
}

/**
 * 裁ち合わせ図を1枚の PNG にする。
 * `caption` を渡さなければ、帯そのものを付けない。
 */
export async function renderLayoutImage(sheets: Sheet[], caption: string | null): Promise<Blob> {
  if (sheets.length === 0) throw new Error('empty')

  const inner = OUT_W - MARGIN * 2
  // それぞれの絵の高さは、viewBox の縦横比から決まる
  const rows = sheets.map((s) => {
    const [, , w, h] = s.viewBox.trim().split(/\s+/).map(Number)
    return { sheet: s, h: inner * (h / Math.max(w, 1e-6)) }
  })

  let y = MARGIN
  const tops: number[] = []
  rows.forEach((r, i) => {
    if (i > 0) y += GAP
    if (r.sheet.label) y += LABEL_H
    tops.push(y)
    y += r.h
  })
  const figureH = y + MARGIN
  const fullH = figureH + (caption ? CAPTION_H : 0)

  // 長い生地では縦が伸びすぎるので、そのぶん全体を小さくする
  const scale = fullH > MAX_H ? MAX_H / fullH : 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(OUT_W * scale)
  canvas.height = Math.round(fullH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.scale(scale, scale)

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, OUT_W, fullH)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const img = await loadSheet(r.sheet, inner, r.h)
    if (r.sheet.label) {
      ctx.fillStyle = INK
      ctx.font = `bold 34px ${FONT}`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(r.sheet.label, MARGIN, tops[i] - 18)
    }
    ctx.drawImage(img, MARGIN, tops[i], inner, r.h)
  }

  if (caption) {
    // 図には決してかからない、下端の帯。ここを切り落とせば図だけが残る
    ctx.fillStyle = BAND
    ctx.fillRect(0, figureH, OUT_W, CAPTION_H)
    ctx.fillStyle = RULE
    ctx.fillRect(0, figureH, OUT_W, 2)
    ctx.fillStyle = INK_SOFT
    ctx.font = `bold 38px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.fillText(caption, MARGIN, figureH + CAPTION_H / 2)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png')
  })
}

export type SaveResult = 'shared' | 'downloaded' | 'canceled'

/**
 * 出来た画像を端末に渡す。
 *
 * 指で使う端末では**共有の口**を開く。iPhone では、これが
 * 「写真に保存」への唯一まともな道で、ふつうの取り込みだと
 * 別のページが開いてしまうことがある。
 * パソコンではそのまま取り込む（資料に貼るのが目的なので、
 * 共有の窓を挟むとかえって遠回りになる）。
 */
export async function saveImage(blob: Blob, filename: string): Promise<SaveResult> {
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'canceled'
      // 共有が使えなかったときは、そのまま取り込みに回す
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return 'downloaded'
}
