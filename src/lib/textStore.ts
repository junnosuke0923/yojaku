/**
 * 画面に出る文言を、依頼者自身が打ち替えられるようにするしくみ
 * （依頼者の指示・2026-09-02）。
 *
 *   「各箇所に書かれている文言を僕の方でも打ち込みで修正し、
 *     最終的にはそれを本体に反映できるような、開発ページが欲しいです」
 *
 * ## 3つに分かれている
 *
 *   `text.ts`      … もとの文言そのもの（画面ごとに並べてある）
 *   `textStore.ts` … 打ち替えたぶんを覚えておくところ（この file）
 *   `TextTools.tsx`… 一覧の画面と、その場で打ち替える口
 *
 * ## 打ち替えは端末の中に残る
 *
 * 公開ページは置いてあるだけの静的なもので、書き換える先が無い。
 * だから打ち替えは、いったんこの端末の中（localStorage）に貯める。
 * 貯めたぶんは**そのまま画面に出る**ので、直した文言を実物で確かめられるし、
 * 人に見せることもできる。
 *
 * 本体へ入れるには「書き出す」でファイルに落として、それを開発の側で
 * `text.ts` に写す。ブラウザから元のファイルへ直接書き戻す道は無いので、
 * ここが唯一の橋になる。
 *
 * ## `?text` を付けたときだけ
 *
 * 打ち替えの口は、URL に `?text` が付いているときしか出ない
 * （依頼者の選択・2026-09-02）。ふつうに開いた学生の画面には何も出ない。
 * 開発用の見本読み込み（`?dev`）と同じ考えかた。
 */

import { useSyncExternalStore } from 'react'
import { TEXTS, type TextId } from './text'

/** 打ち替えの口を出すか。URL に `?text` が付いているときだけ */
export const TEXT_MODE =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('text')

const KEY = 'yojaku.text.v1'

/** id と、打ち替えた文 */
export type Overrides = Record<string, string>

const load = (): Overrides => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const got: unknown = JSON.parse(raw)
    if (!got || typeof got !== 'object') return {}
    const out: Overrides = {}
    for (const [id, v] of Object.entries(got as Record<string, unknown>)) {
      // 知らない id は捨てる。文言を消したあとの残りかすを持ち歩かない
      if (typeof v === 'string' && id in TEXTS) out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

let overrides: Overrides = load()
const subs = new Set<() => void>()

const publish = () => {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(overrides))
  } catch {
    // 端末がいっぱい、などで貯められなくても、画面はそのまま動いてよい
  }
  for (const fn of subs) fn()
}

const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** 打ち替えぶん全部。中身は作り直して渡すので、そのまま比べてよい */
export const useOverrides = (): Overrides =>
  useSyncExternalStore(subscribe, () => overrides, () => overrides)

/** その id の、いま出ている文 */
export const textOf = (id: TextId): string => overrides[id] ?? TEXTS[id].value

/** 打ち替える。もとの文と同じに戻したら、打ち替えとしては覚えない */
export function setText(id: TextId, value: string) {
  const next = { ...overrides }
  if (value === TEXTS[id].value || value.trim() === '') delete next[id]
  else next[id] = value
  overrides = next
  publish()
}

/** その1つを、もとの文に戻す */
export const resetText = (id: TextId) => setText(id, TEXTS[id].value)

/** 打ち替えを全部捨てる */
export function resetAllText() {
  overrides = {}
  publish()
}

/**
 * 書き出す中身。**もとの文もいっしょに入れてある**。
 *
 * 入れてあるのは、受け取った側で「どの文を直したつもりだったのか」を
 * 突き合わせるため。書き出したあとに本体の文言が変わっていた場合、
 * もとの文が食いちがうので、そこで気づける
 */
export function exportText(): string {
  const body: Record<string, { いま: string; もと: string; どこ: string }> = {}
  for (const id of Object.keys(overrides).sort()) {
    const entry = TEXTS[id as TextId]
    body[id] = { いま: overrides[id], もと: entry.value, どこ: `${entry.screen}／${entry.label}` }
  }
  return JSON.stringify({ 書き出した文言: body }, null, 2)
}

/** いま打ち替えてある数。帯に出す */
export const countChanged = (o: Overrides) => Object.keys(o).length

/* ------------------------------------------------------------------ *
 * どの文をいま開いているか / 一覧を出しているか
 * ------------------------------------------------------------------ */

let editing: TextId | null = null
let listOpen = false
const uiSubs = new Set<() => void>()
const uiPublish = () => { for (const fn of uiSubs) fn() }
const uiSubscribe = (fn: () => void) => {
  uiSubs.add(fn)
  return () => uiSubs.delete(fn)
}

export const useEditingId = (): TextId | null =>
  useSyncExternalStore(uiSubscribe, () => editing, () => editing)

export const useListOpen = (): boolean =>
  useSyncExternalStore(uiSubscribe, () => listOpen, () => listOpen)

/** その文の打ち替え口を開く。文字の上を押したときに呼ばれる */
export function openEditor(id: TextId | null) {
  editing = id
  uiPublish()
}

export function openList(open: boolean) {
  listOpen = open
  if (open) editing = null
  uiPublish()
}
