/** cm 表示。要尺の話は cm で通すので、mm は内部だけに留める。 */
export const cm = (mm: number, digits = 1): string => (mm / 10).toFixed(digits)

/** m 表示。要尺の最終出力用。 */
export const m = (mm: number, digits = 2): string => (mm / 1000).toFixed(digits)

/** 面積を cm² で。 */
export const cm2 = (mm2: number): string => (mm2 / 100).toFixed(0)
