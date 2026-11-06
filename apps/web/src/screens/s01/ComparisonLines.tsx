import { Delta } from '@/components/Delta';
import { MaskedMark } from '@/components/MaskedCell';
import { absentCompareText, type PeriodChoice } from '@/components/usePeriod';
import { compare } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { Masked, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';

export type ComparisonLinesProps = {
  /** resolvePeriod の結果（period は null でない）。 */
  choice: PeriodChoice & { period: Period };
  /** この期間の値。null は伏せ値。 */
  current: Masked;
  /** 前の期間の値。undefined は、前の期間のデータがない（または比較を止めた）。 */
  prev: Masked | undefined;
  /** 前年同月の値（月だけ使う）。undefined は、前年のデータがない（または比較を止めた）。 */
  yoy: Masked | undefined;
  /**
   * 数え始めた月を相手にするとき、差を出さずに数字を並べるか。既定は true。
   * 公開本数のように WordPress から数える値は、数え始めた日に関係なくそろっているので false。
   */
  partialAware?: boolean;
};

type LineProps = {
  target: 'prev' | 'yoy';
  label: string | null;
  current: Masked;
  other: Masked | undefined;
  partialDay: number | null;
  choice: PeriodChoice;
};

function Line({ target, label, current, other, partialDay, choice }: LineProps) {
  if (other === undefined || label === null) {
    return <>{absentCompareText(choice.withheld, target)}</>;
  }
  if (partialDay !== null) {
    // 日数がそろわないので、差を出さずに相手の数字を並べる（助言 B-2）。
    if (other === null) return <MaskedMark />;
    return <>{t(`compare.partial.${target}`, { value: formatNumber(other), day: partialDay })}</>;
  }
  return (
    <>
      <span className={styles.compareLabel}>{label}</span>
      <Delta comparison={compare(current, other)} />
    </>
  );
}

/**
 * 比較の相手の文（05 §2.2）。「前の 28 日と比べて ▲ +320（+8%）」。
 * 月を選んだときは、前の月に加えて、去年の同じ月も並べる（FR-01）。
 * 月の途中の月では差を出さず「月が終わると、前の月と比べた数字が出ます」。
 */
export function ComparisonLines({
  choice,
  current,
  prev,
  yoy,
  partialAware = true,
}: ComparisonLinesProps) {
  return (
    <>
      <span className={styles.compareLine} data-compare="prev">
        <Line
          target="prev"
          label={choice.prevLabel}
          current={current}
          other={prev}
          partialDay={partialAware ? choice.prevPartialDay : null}
          choice={choice}
        />
      </span>
      {choice.period.kind === 'month' ? (
        <span className={styles.compareLine} data-compare="yoy">
          <Line
            target="yoy"
            label={choice.yoyLabel}
            current={current}
            other={yoy}
            partialDay={partialAware ? choice.yoyPartialDay : null}
            choice={choice}
          />
        </span>
      ) : null}
    </>
  );
}
