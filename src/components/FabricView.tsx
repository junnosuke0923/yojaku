/**
 * 生地を決める画面（第4段階）。
 *
 * もともと生地幅と差し込みの可否は「縫い代」の画面の上に、
 * 折り方は「並べる」の画面の上に置いてあった。
 * 依頼者の指摘（2026-09-01）は2つ——
 *
 *   「生地幅の設定は縫い代とは無関係なのに、そのセクション内にあることに違和感」
 *   「パーツが多い場合に、パーツリストの表示を他のもので圧迫させない方がいい」
 *
 * どちらも当たっているので、生地についての判断だけを1画面にまとめた。
 * 置き場所が「縫い代のあと・並べるの前」なのは、
 * パーツの手当てが済んでから、そのパーツを何に載せるかを決める、という順になるため。
 *
 * ここで決めるのは**はじめの折り方**まで。
 * 生地を切り分けて区間が2つ以上になったあとは、折り方も区間の数だけあるので、
 * そちらは「並べる」の画面に残る。切り分けは並べていて入りきらなかった、
 * という並べる作業の中の出来事なので、そこにあるのが筋。
 */

import { useMemo } from 'react'
import {
  computeYardage, foldScaleOf, isHalfFold, isHorizontalFold,
  type Fabric, type FoldMode, type Side,
} from '../lib/fabric'
import { applyFoldChange, placedPartOf, type PartsState } from '../lib/store'
import type { PlacedPart } from '../lib/fabric'
import { FabricSetup } from './FabricSetup'
import { FoldDiagram } from './FoldDiagram'
import { FoldSetup } from './FoldSetup'
import { Icon } from './Icon'
import { T } from './TextTools'

type Props = {
  state: PartsState
  onChange: (state: PartsState, group?: string) => void
  onLayout: () => void
}

export function FabricView({ state, onChange, onLayout }: Props) {
  const partMap = useMemo(() => {
    const m = new Map<string, PlacedPart>()
    for (const p of state.parts) {
      const placed = placedPartOf(p)
      if (placed) m.set(p.id, placed)
    }
    return m
  }, [state.parts])

  const fabric: Fabric = useMemo(
    () => ({ widthMm: state.fabricWidthMm, hasNap: state.hasNap, sections: state.sections }),
    [state.fabricWidthMm, state.hasNap, state.sections],
  )
  const report = useMemo(
    () => computeYardage(fabric, state.placements, partMap),
    [fabric, state.placements, partMap],
  )

  /*
    ここで触るのは、いつでも**いちばん最初の区間**。
    切り分けたあとの2つめ以降は「並べる」の画面が持っている。
    2つ以上あるときは、そのことをひと言だけ言って、続きはあちらへ送る
  */
  const section = state.sections[0]
  const sr = report.sections[0]
  const split = state.sections.length > 1

  const setFold = (
    fold: FoldMode, halfFold?: boolean, depth?: Partial<Record<Side, number | null>>,
  ) => onChange(applyFoldChange(state, section.id, fold, halfFold, depth))

  return (
    <section className="flex flex-col gap-2.5">
      <FabricSetup
        widthMm={state.fabricWidthMm}
        hasNap={state.hasNap}
        onWidth={(fabricWidthMm) => onChange({ ...state, fabricWidthMm })}
        onNap={(hasNap) => onChange({ ...state, hasNap })}
      />

      <FoldSetup
        section={section}
        half={isHalfFold(section)}
        prefix={split ? '1 つめ・' : undefined}
        onFold={setFold}
        onHalf={(halfFold) => setFold(section.fold, halfFold)}
        scale={foldScaleOf(state.fabricWidthMm, sr)}
      />

      {/* 平面図に線を引くだけでは、折っていることが伝わらない。横から見た形を添える */}
      <FoldDiagram
        fold={section.fold}
        half={isHalfFold(section)}
        nearMm={isHorizontalFold(section.fold) ? sr.foldDepth.top : sr.foldDepth.left}
        farMm={isHorizontalFold(section.fold) ? sr.foldDepth.bottom : sr.foldDepth.right}
        spanMm={isHorizontalFold(section.fold)
          ? Math.max(sr.surfaceLengthMm, 400) : sr.surfaceWidthMm}
      />

      {split && (
        <p className="flex gap-2 px-1 text-xs leading-relaxed text-ink-300">
          <Icon name="scissors" className="mt-[0.2em] h-[1.15em] w-[1.15em] shrink-0" />
          <span className="min-w-0 flex-1">
            <T id="fabric.split.note" vars={{ n: state.sections.length }} />
          </span>
        </p>
      )}

      <button
        type="button"
        onClick={onLayout}
        className="flex items-center justify-center gap-2 rounded-xl bg-mat-500 px-4 py-2.5 text-base font-bold text-white active:bg-mat-600"
      >
        <Icon name="layout" className="h-5 w-5 shrink-0" />
        生地の上に並べる →
      </button>
    </section>
  )
}
