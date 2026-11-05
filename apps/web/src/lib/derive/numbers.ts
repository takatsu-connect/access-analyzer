/**
 * 比較、構成比、「10 人中 ◯人」（05 §2.3、NFR-96、U-14〜U-16）。
 *
 * 比率は分母が RATIO_MIN_DENOMINATOR（20）以上のときだけ出す。未満のときは null を返し、
 * 画面は差の数や元の数だけを出す。伏せ値（null）からは何も計算しない。
 */
import { RATIO_MIN_DENOMINATOR } from '@/lib/config';
import type { Masked } from '@/lib/page-data';

export type Comparison = {
  /** 差（cur − prev）。 */
  diff: number;
  /** 変化率（差 ÷ prev）。0.08 は +8%。分母が 20 未満なら null。 */
  ratio: number | null;
};

/**
 * 前の期間との差と変化率（U-14）。
 * どちらかが伏せ値のときは null（差から伏せた数が分かってしまうので、差も出さない）。
 */
export function compare(cur: number, prev: number): Comparison;
export function compare(cur: Masked, prev: Masked): Comparison | null;
export function compare(cur: Masked, prev: Masked): Comparison | null {
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  return { diff, ratio: prev >= RATIO_MIN_DENOMINATOR ? diff / prev : null };
}

function shareOne(value: Masked, total: Masked): number | null {
  if (value === null || total === null || total < RATIO_MIN_DENOMINATOR) return null;
  return value / total;
}

/**
 * 構成比（U-15）。分母は「見えている値の和」ではなく、合計の列（total）。
 * 伏せ値のセルの構成比は null。合計が 20 未満か伏せ値のときは、すべて null。
 */
export function share(values: readonly Masked[], total: Masked): (number | null)[] {
  return values.map((value) => shareOne(value, total));
}

/** share の、区分の名前つきの形（Record<Channel, Masked> など）。 */
export function shareOf<Key extends string>(
  record: Readonly<Record<Key, Masked>>,
  total: Masked,
): Record<Key, number | null> {
  const result = {} as Record<Key, number | null>;
  for (const key of Object.keys(record) as Key[]) {
    result[key] = shareOne(record[key], total);
  }
  return result;
}

/**
 * 「10 人中 ◯人」の ◯（M-09、U-16）。分母が 20 未満か、どちらかが伏せ値なら null。
 * 0〜10 に収める。
 */
export function tenOf(numerator: Masked, denominator: Masked): number | null {
  if (numerator === null || denominator === null || denominator < RATIO_MIN_DENOMINATOR) {
    return null;
  }
  return Math.min(10, Math.max(0, Math.round((numerator / denominator) * 10)));
}
