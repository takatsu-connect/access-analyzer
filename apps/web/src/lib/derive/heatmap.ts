/**
 * ヒートマップをスマホの 6 区分に畳む（05 §2.6、U-17）。
 */
import type { Masked } from '@/lib/page-data';

export const HEATMAP_DAYS = 7;
export const HEATMAP_HOURS = 24;
export const HEATMAP_SLOTS = 6;
const HOURS_PER_SLOT = HEATMAP_HOURS / HEATMAP_SLOTS;

/**
 * 168 要素（index = 曜日 * 24 + 時。曜日 0 = 日曜）を 7 × 6 に畳む。
 *
 * - 区分は 0〜3 時、4〜7 時、…、20〜23 時。値は区分の中の合計
 *   （1 日あたり平均のヒートマップなら、平均の合計）。
 * - 区分の中に伏せ値（null）が 1 つでもあれば、その区分は null。
 *   見えている値だけを足すと、実際より小さい数を出してしまうため。
 */
export function fold6(heatmap168: readonly Masked[]): Masked[][] {
  if (heatmap168.length !== HEATMAP_DAYS * HEATMAP_HOURS) {
    throw new RangeError('ヒートマップは 168 要素で渡します。');
  }
  const folded: Masked[][] = [];
  for (let dow = 0; dow < HEATMAP_DAYS; dow += 1) {
    const row: Masked[] = [];
    for (let slot = 0; slot < HEATMAP_SLOTS; slot += 1) {
      const start = dow * HEATMAP_HOURS + slot * HOURS_PER_SLOT;
      let sum: Masked = 0;
      for (const cell of heatmap168.slice(start, start + HOURS_PER_SLOT)) {
        sum = sum === null || cell === null ? null : sum + cell;
      }
      row.push(sum);
    }
    folded.push(row);
  }
  return folded;
}
