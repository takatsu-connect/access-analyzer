/**
 * ヒートマップの濃淡の段階（05 §2.4「期間内のセルの分位で 5 段階」）。
 */
import type { Masked } from '@/lib/page-data';

export type HeatLevel = 1 | 2 | 3 | 4 | 5;

/**
 * 分位をどの範囲で取るか。
 * - 'all': 表全体で 1 つの分位（S-01 の曜日 × 時間帯）
 * - 'row': 行ごとに、その行の中の値で分位（S-06b の行 = カテゴリの図。助言 A-2）
 * - 'col': 列ごとに、その列の中の値で分位（S-06b の狭い画面。列 = カテゴリ）
 */
export type HeatScale = 'all' | 'row' | 'col';

const LEVELS = 5;

/**
 * 値の並び → 段階（1 = いちばん薄い、5 = いちばん濃い）。伏せ値（null）は null のまま返す。
 *
 * - 段階は「その値より小さいセルの数」の割合で決める（小さい順に並べたときの分位）。同じ値は同じ段階になり、
 *   いちばん小さい値は必ず 1、いちばん大きい値は必ず 5 になる。0 が多くても 0 は 1 のまま。
 * - 全部が同じ値のときは、0 なら 1、それ以外は中央の 3。
 */
function levelsOf(group: readonly Masked[]): (HeatLevel | null)[] {
  const sorted = group.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) return group.map(() => null);
  // 並べた配列で、その値が最初に現れる位置 = その値より小さいセルの数。
  const lessThan = (value: number): number => sorted.findIndex((other) => other >= value);
  const lessThanMax = lessThan(max);

  const levelOf = (value: number): HeatLevel => {
    if (max === min) return max === 0 ? 1 : 3;
    const step = Math.min(LEVELS - 1, Math.floor((LEVELS * lessThan(value)) / lessThanMax));
    return (step + 1) as HeatLevel;
  };
  return group.map((value) => (value === null ? null : levelOf(value)));
}

/** values[行][列] → 段階[行][列]。scale で分位を取る範囲を選ぶ（既定は表全体）。 */
export function heatLevels(
  values: readonly (readonly Masked[])[],
  scale: HeatScale = 'all',
): (HeatLevel | null)[][] {
  if (scale === 'row') return values.map((row) => levelsOf(row));
  if (scale === 'col') {
    const width = Math.max(0, ...values.map((row) => row.length));
    const columns = [...Array<undefined>(width)].map((_, col) =>
      levelsOf(values.map((row) => row[col] ?? null)),
    );
    return values.map((row, rowIndex) => row.map((_, col) => columns[col]?.[rowIndex] ?? null));
  }
  // 表全体: 平らにして 1 つの分位で付け、元の形に戻す。
  const flat = levelsOf(values.flat());
  let index = 0;
  return values.map((row) => row.map(() => flat[index++] ?? null));
}
