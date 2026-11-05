import { Delta } from '@/components/Delta';
import { compareLabel } from '@/components/usePeriod';
import { compare } from '@/lib/derive';
import type { Masked, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';

export type ComparisonLinesProps = {
  period: Period;
  /** この期間の値。null は伏せ値。 */
  current: Masked;
  /** 前の期間の値。undefined は、前の期間のデータがない。 */
  prev: Masked | undefined;
  /** 前年同月の値（月だけ使う）。undefined は、前年のデータがない。 */
  yoy: Masked | undefined;
};

/**
 * 比較の相手の文（05 §2.2）。「前の 28 日と比べて ▲ +320（+8%）」。
 * 月を選んだときは、前の月に加えて、去年の同じ月も並べる（FR-01）。
 */
export function ComparisonLines({ period, current, prev, yoy }: ComparisonLinesProps) {
  return (
    <>
      <span className={styles.compareLine} data-compare="prev">
        {prev === undefined ? (
          t('s01.absent.prev')
        ) : (
          <>
            <span className={styles.compareLabel}>{compareLabel(period, 'prev')}</span>
            <Delta comparison={compare(current, prev)} />
          </>
        )}
      </span>
      {period.kind === 'month' ? (
        <span className={styles.compareLine} data-compare="yoy">
          {yoy === undefined ? (
            t('absent.yoy')
          ) : (
            <>
              <span className={styles.compareLabel}>{compareLabel(period, 'yoy')}</span>
              <Delta comparison={compare(current, yoy)} />
            </>
          )}
        </span>
      ) : null}
    </>
  );
}
