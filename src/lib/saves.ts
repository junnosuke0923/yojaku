/**
 * 出した見積もりを、名前を付けてしまっておく（依頼者の指示・2026-08-28）。
 *
 * しまうのは**作業まるごと**——型紙・縫い代・生地の設定・並べ方まで。
 * あとから開いて続きから直せるし、一覧では出た数字だけを読める。
 * 「結果の数字だけ」にすると、直したくなったときに何もできないので、
 * まるごと持たせて、一覧に出すぶんだけを別に取り出してある。
 *
 * 置き場所はこの端末の中（ブラウザ）だけ。外へは何も送らない。
 * 学校の管理端末で使うものなので、写真から取った型紙の形も、この端末から出ない。
 */

import type { PartsState } from './store'

const KEY = 'yojaku.saves.v1'

/**
 * しまっておける数。
 *
 * 1件に型紙の輪郭がまるごと入るので、際限なく増やすとブラウザの置き場所が尽きる。
 * 尽きたときに黙って消えるのがいちばん困るので、先に上限で止めて知らせる。
 */
export const MAX_SAVES = 20

/** 一覧に出すぶんだけ。開かなくても読める数字 */
export type SaveSummary = {
  /** 買ってくる長さ(mm) */
  purchaseMm: number
  /** 並べたぶんの長さ(mm) */
  totalMm: number
  fabricWidthMm: number
  /** 取り込んだ型紙の数 */
  partCount: number
  /** 生地の上に置いた数 */
  placementCount: number
}

export type Save = {
  id: string
  name: string
  /** しまった時刻。並べ替えと、一覧に出す日付に使う */
  savedAt: number
  summary: SaveSummary
  state: PartsState
}

export type PutResult =
  | { ok: true; saves: Save[]; overwrote: boolean }
  | { ok: false; reason: 'full' | 'space' }

/**
 * 座標を 0.1mm きざみに丸めてからしまう。
 *
 * 輪郭は写真から取っているので、小数が延々と続く点が並ぶ。
 * 0.1mm より細かい桁は裁つときに意味を持たないのに、
 * 置き場所だけはその桁のぶんきっちり食う。
 */
const rounded = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value),
    (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v),
  ) as T

export function loadSaves(): Save[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Save[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s) => s && typeof s.id === 'string' && s.state)
  } catch {
    // 壊れていたら「何もしまっていない」ことにする。学生に JSON の話をしても仕方がない
    return []
  }
}

function write(saves: Save[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(saves))
    return true
  } catch {
    return false
  }
}

/**
 * しまう。同じ名前のものがあれば、それを書きかえる。
 *
 * 名前がそのまま行き先になるので、「同じ名前＝同じもの」と読めるほうが分かりやすい。
 * 開いたものを直してもう一度しまうと、増やさずに上書きされる。
 */
export function putSave(
  name: string, summary: SaveSummary, state: PartsState,
): PutResult {
  const saves = loadSaves()
  const at = saves.findIndex((s) => s.name === name)
  const entry: Save = {
    id: at >= 0 ? saves[at].id : `s${Date.now().toString(36)}`,
    name,
    savedAt: Date.now(),
    summary,
    state: rounded(state),
  }
  let next: Save[]
  if (at >= 0) {
    next = [...saves]
    next[at] = entry
  } else {
    if (saves.length >= MAX_SAVES) return { ok: false, reason: 'full' }
    next = [entry, ...saves]
  }
  next.sort((a, b) => b.savedAt - a.savedAt)
  if (!write(next)) return { ok: false, reason: 'space' }
  return { ok: true, saves: next, overwrote: at >= 0 }
}

export function removeSave(id: string): Save[] {
  const next = loadSaves().filter((s) => s.id !== id)
  write(next)
  return next
}

/** 一覧に出す日付。年は出さない。同じ学期のうちに何度も開くものなので */
export function whenOf(savedAt: number): string {
  const d = new Date(savedAt)
  const two = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** 名前を入れずにしまったときの、既定の名前 */
export function defaultName(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日の見積もり`
}
