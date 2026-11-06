import a11y from '@/components/a11y.module.css';
import { Details } from '@/components/Details';
import { KpiCard, KpiGrid } from '@/components/KpiCard';
import { Notice, StateMessage } from '@/components/Notice';
import { absentCompareText, type PeriodChoice } from '@/components/usePeriod';
import { FRESHNESS_BUCKETS, RATIO_MIN_DENOMINATOR } from '@/lib/config';
import { formatDuration, formatNumber } from '@/lib/format';
import type { DashboardData, Period, SitePeriodValue } from '@/lib/page-data';
import { metricLabel, metricNote, t } from '@/lib/ui-text';

import { ComparisonLines } from './ComparisonLines';
import styles from './s01.module.css';
import { pick } from './series';

export type MoreSectionProps = {
  data: DashboardData;
  /** resolvePeriod の結果。 */
  choice: PeriodChoice & { period: Period };
  site: SitePeriodValue;
};

/** 読まれていた時間（1 回あたりの目安。M-06）。分母（読まれた回数）が 20 未満なら null。 */
function secondsPerView(site: SitePeriodValue | undefined): number | null {
  if (site === undefined || site.pageviews < RATIO_MIN_DENOMINATOR) return null;
  return site.engagementSeconds / site.pageviews;
}

/**
 * 「もっと見る」（閉じた状態から始まる）: 訪問回数 M-02、読まれていた時間 M-06、
 * 公開した時期ごとの読まれ方 M-25（FR-10）。
 */
export function MoreSection({ data, choice, site }: MoreSectionProps) {
  const { period } = choice;
  const prevSite = pick(data.sitePeriod, choice.prevId);
  const yoySite = pick(data.sitePeriod, choice.yoyId);
  const duration = secondsPerView(site);
  const prevDuration = secondsPerView(prevSite);
  const freshness = data.freshness[period.id];
  // 前の期間はあるが、読まれた回数が 20 未満で目安を出せないときは、その理由を書く。
  const prevDurationText =
    prevDuration !== null
      ? t('s01.engagement.prev', { value: formatDuration(prevDuration) })
      : prevSite !== undefined
        ? t('s01.engagement.prev.ratio20')
        : absentCompareText(choice.withheld, 'prev');

  return (
    <Details summary={t('s01.more.summary')} className={styles.block}>
      <KpiGrid>
        <KpiCard
          label={metricLabel('M02')}
          value={site.sessions}
          comparison={
            <ComparisonLines
              choice={choice}
              current={site.sessions}
              prev={prevSite?.sessions}
              yoy={yoySite?.sessions}
            />
          }
          note={t('metric.M02.note.first')}
        />
        <KpiCard
          label={metricLabel('M06')}
          value={duration === null ? t('absent.ratio20') : formatDuration(duration)}
          comparison={prevDurationText}
          note={metricNote('M06')}
        />
      </KpiGrid>

      <h3 className={styles.h3}>{t('s01.freshness.h3')}</h3>
      {freshness === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <table className={styles.table}>
            <caption className={a11y.srOnly}>{t('s01.freshness.h3')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('s01.freshness.column')}</th>
                <th scope="col" className={styles.num}>
                  {t('column.postCount')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('column.pageviews')}
                </th>
              </tr>
            </thead>
            <tbody>
              {FRESHNESS_BUCKETS.map((bucket) => (
                <tr key={bucket}>
                  <th scope="row">{t(`freshness.${bucket}`)}</th>
                  <td className={styles.num}>{formatNumber(freshness[bucket].postCount)}</td>
                  <td className={styles.num}>{formatNumber(freshness[bucket].pageviews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Notice>{t('s01.freshness.note')}</Notice>
        </>
      )}
    </Details>
  );
}
