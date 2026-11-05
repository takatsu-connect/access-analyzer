import { Notice, StateMessage } from '@/components/Notice';
import { formatDate, formatNumber } from '@/lib/format';
import type { ArticleDetailData, ArticlePeriodValue } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';

export type PeriodSummarySectionProps = {
  /** 選んだ期間の値。その期間の行がなければ undefined（データなし）。 */
  value: ArticlePeriodValue | undefined;
  post: ArticleDetailData['post'];
  /** 読まれた回数を数え始めた日（meta.measureStart）。 */
  measureStart: string;
};

/**
 * この期間に読まれた回数（M-01。FR-23、FR-01）。
 * 前の期間との比較（▲▼）は出さない。比較の相手の代わりに、公開からの合計を添える。
 * 数え始める前に公開した記事は、合計の範囲を日付で書く（s03.period.since）。
 */
export function PeriodSummarySection({ value, post, measureStart }: PeriodSummarySectionProps) {
  return (
    <section className={styles.section} aria-labelledby="s03-period">
      <h2 id="s03-period">{t('s03.period.h2')}</h2>
      {value === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <p className={styles.lead}>
            {post.isPreMeasure
              ? t('s03.period.since', {
                  n: formatNumber(value.pageviews),
                  start: formatDate(measureStart),
                  total: formatNumber(post.pvTotal),
                })
              : t('s03.period', {
                  n: formatNumber(value.pageviews),
                  total: formatNumber(post.pvTotal),
                })}
          </p>
          <Notice>{t('metric.M01.note')}</Notice>
        </>
      )}
    </section>
  );
}
