/**
 * ヒートマップの濃淡の段階（05 §2.4「期間内のセルの分位で 5 段階」）。
 */
import type { Masked } from '@/lib/page-data';

export type HeatLevel = 1 | 2 | 3 | 4 | 5;

const LEVELS = 5;

/**
 * 値 → 段階（1 = いちばん薄い、5 = いちばん濃い）。伏せ値（null）は null のまま返す。
 *
 * - 段階は「その値より小さいセルの数」の割合で決める（小さい順に並べたときの分位）。同じ値は同じ段階になり、
 *   いちばん小さい値は必ず 1、いちばん大きい値は必ず 5 になる。0 が多くても 0 は 1 のまま。
 * - 全部が同じ値のときは、0 なら 1、それ以外は中央の 3。
 */
export function heatLevels(values: readonly (readonly Masked[])[]): (HeatLevel | null)[][] {
  const sorted = values
    .flat()
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) {
    return values.map((row) => row.map(() => null));
  }
  // 並べた配列で、その値が最初に現れる位置 = その値より小さいセルの数。
  const lessThan = (value: number): number => sorted.findIndex((other) => other >= value);
  const lessThanMax = lessThan(max);

  const levelOf = (value: number): HeatLevel => {
    if (max === min) return max === 0 ? 1 : 3;
    const step = Math.min(LEVELS - 1, Math.floor((LEVELS * lessThan(value)) / lessThanMax));
    return (step + 1) as HeatLevel;
  };
  return values.map((row) => row.map((value) => (value === null ? null : levelOf(value))));
}
