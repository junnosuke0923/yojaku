/**
 * ホーム画面に置くことを勧める札（依頼者の指示・2026-09-13
 * 「アプリのホーム画面に、ショートカットを追加するのを促すボタンを
 *  表示させることは出来ますか？」）。
 *
 * ## 端末によって、できることが違う
 *
 * Android（Chrome など）には、ページの中から追加をお願いする仕組みがある。
 * `beforeinstallprompt` という知らせを受け取っておくと、こちらの好きな
 * ボタンを押したときに、端末の「ホーム画面に追加しますか」を開ける。
 * つまり**ひと押しで済む**。
 *
 * iPhone と iPad には、その仕組みが無い。Safari の「共有」から
 * 選んでもらうしかないので、**押せるボタンは出さず、手順だけを出す**。
 * ここで無理にボタンを出すと、押しても何も起きないボタンになる。
 *
 * どちらでもない（追加の仕組みが無い、あるいはもう入っている）ときは、
 * 何も出さない。押せないものを置いておくほうが分かりにくい。
 *
 * ## いつ消えるか
 *
 * - すでにホーム画面から開いているとき（`display-mode: standalone`）は出さない
 * - 追加が済んだら、その場で消える（`appinstalled`）
 * - 「あとで」を押したら、この端末ではもう出さない（`yojaku.install.v1`）
 *
 * 毎回出続けるものにはしない。撮る画面はふだんの入口なので、
 * 一度断ったものが毎回そこに居座ると、本来の仕事の邪魔になる。
 */

import { useEffect, useState } from 'react'
import { Icon, Hint, Note } from './Icon'
import { T } from './TextTools'

/**
 * Android が投げてくる知らせ。まだ標準の型が無いので、ここで書いておく。
 * `prompt()` は**押されたその場**でしか呼べない（指で触った流れの中でだけ効く）
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    /** index.html で先に受け取っておいた知らせ */
    __yojakuInstall?: InstallPrompt | null
  }
}

const HID_KEY = 'yojaku.install.v1'

/** もうホーム画面から開いているか */
function fromHome(): boolean {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iPhone はこちらしか持っていない
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone・iPad か（iPad は最近、机の上の端末を名乗ってくる） */
function isApplePhone(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function InstallCard() {
  /**
   * 'ask'  … 端末にお願いできる（ボタンを出す）
   * 'ios'  … 手順だけ出す
   * 'no'   … 何も出さない
   */
  const [mode, setMode] = useState<'ask' | 'ios' | 'no'>(() => {
    if (fromHome()) return 'no'
    if (window.__yojakuInstall) return 'ask'
    return isApplePhone() ? 'ios' : 'no'
  })
  const [hid, setHid] = useState(() => {
    try { return localStorage.getItem(HID_KEY) !== null } catch { return false }
  })

  /*
    最初の見立ては、上の1回で済ませてある（描く前に決められることなので、
    わざわざ描いたあとに決め直さない）。

    ここで待つのは、**あとから届くぶん**だけ。
    Android の知らせは画面が組み上がる前に飛んでくることが多く、
    それは index.html で受け取ってある。ただし遅れて届くこともある
  */
  useEffect(() => {
    const onReady = () => setMode('ask')
    const onDone = () => setMode('no')
    window.addEventListener('yojaku:installable', onReady)
    window.addEventListener('appinstalled', onDone)
    return () => {
      window.removeEventListener('yojaku:installable', onReady)
      window.removeEventListener('appinstalled', onDone)
    }
  }, [])

  if (hid || mode === 'no') return null

  const hide = () => {
    try { localStorage.setItem(HID_KEY, '1') } catch { /* 覚えられなくても閉じる */ }
    setHid(true)
  }

  const add = () => {
    const e = window.__yojakuInstall
    if (!e) { setMode('no'); return }
    /*
      この知らせは一度きり。押したら（入れても入れなくても）札は引っ込める。
      断られたぶんは覚えない——次に開いたときには、また出てよい
    */
    window.__yojakuInstall = null
    setMode('no')
    void e.prompt()
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon name="home" className="h-4 w-4 shrink-0 text-mat-600" />
        <span className="text-sm font-bold text-ink-700">ホーム画面に置く</span>
        <button
          type="button"
          onClick={hide}
          className="ml-auto shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-ink-300 active:bg-chalk"
        >
          あとで
        </button>
      </div>

      {mode === 'ask' ? (
        <button
          type="button"
          onClick={add}
          className="flex items-center justify-center gap-2 rounded-lg bg-mat-500 px-4 py-2.5 text-sm font-bold text-white active:bg-mat-600"
        >
          <Icon name="home" className="h-4 w-4 shrink-0" />
          ホーム画面に追加
        </button>
      ) : (
        <Note icon="share">
          <T id="photo.install.ios" strong="font-bold text-ink-700" />
        </Note>
      )}

      <Hint icon="home" summary={<T id="photo.install.summary" />}>
        <T id="photo.install.body" />
      </Hint>
    </div>
  )
}
