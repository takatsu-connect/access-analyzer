import type { ReactNode } from 'react';

import { Delta } from '@/components/Delta';
import { compare } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import { t } from '@/lib/ui-text';

import styles from './parts.module.css';

export type TotalItem = {
  /** 指標の名称（「読まれた回数」「前の 28 日と比べて」など）。 */
  label: string;
  value: ReactNode;
};

export type TotalsProps = {
  /** 枠の名前（「合計」）。 */
  label: string;
  /** 先頭の値を大きく書く。 */
  items: readonly TotalItem[];
};

/** 合計の枠（S-06 の軸ごとの合計、S-07b の合計）。数に、比較の相手を 1 つ添える（05 §2.2）。 */
export function Totals({ label, items }: TotalsProps) {
  return (
    <div className={styles.totalsBox}>
      <p className={styles.totalsLabel}>{label}</p>
      <dl className={styles.totals}>
        {items.map((item) => (
          <div key={item.label} className={styles.total}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type PrevDeltaProps = {
  current: number;
  /** 前の期間の値。前の期間の行がなければ undefined。 */
  previous: number | undefined;
  /** 前の期間の値がないときの文（「前の期間のデータなし」）。伏せ値の印は使わない。 */
  absentText: string;
  /** 比率を出さず、差の数だけにする（本数の差）。 */
  diffOnly?: boolean;
  /**
   * 前の期間が数え始めた月なら、数え始めた日（resolvePeriod の prevPartialDay）。
   * 日数がそろわないので、差を出さずに「前の月は {value}（{day} 日からの数字）」と並べる。
   */
  partialDay?: number | null;
};

/**
 * 前の期間との差。差の数と、分母が 20 以上のときだけ比率（compare と Delta に任せる）。
 * 前の期間の値がないときは、伏せ値ではないので、文字で書く（05 §2.3）。
 */
export function PrevDelta({
  current,
  previous,
  absentText,
  diffOnly = false,
  partialDay = null,
}: PrevDeltaProps) {
  if (previous === undefined) return <span className={styles.absent}>{absentText}</span>;
  if (partialDay !== null) {
    return (
      <span className={styles.absent}>
        {t('compare.partial.prev', { value: formatNumber(previous), day: partialDay })}
      </span>
    );
  }
  const comparison = compare(current, previous);
  return <Delta comparison={diffOnly ? { diff: comparison.diff, ratio: null } : comparison} />;
}
