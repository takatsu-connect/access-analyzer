import { KpiCard, KpiGrid } from '@/components/KpiCard';
import { absentCompareText, prevCountText, type PeriodChoice } from '@/components/usePeriod';
import { formatNumber } from '@/lib/format';
import type { DashboardData, Period, SitePeriodValue } from '@/lib/page-data';
import { metricLabel, metricNote, t } from '@/lib/ui-text';

import { ComparisonLines } from './ComparisonLines';
import styles from './s01.module.css';
import { pick } from './series';

export type KpiSectionProps = {
  data: DashboardData;
  /** resolvePeriod の結果。月の途中の月では prevId と yoyId が null（比較を止める）。 */
  choice: PeriodChoice & { period: Period };
  site: SitePeriodValue;
};

/**
 * KPI 3 枚（読まれた回数 M-01、公開した記事の本数 M-30、読んだ人の数 M-03）と、
 * 多くの記事の帯の 1 文（M-27。FR-10、FR-17）。
 */
export function KpiSection({ data, choice, site }: KpiSectionProps) {
  const { period } = choice;
  const prevSite = pick(data.sitePeriod, choice.prevId);
  const yoySite = pick(data.sitePeriod, choice.yoyId);
  const posting = data.posting[period.id];
  const benchmark = data.benchmark30;

  return (
    <div className={styles.block} data-section="kpi">
      <KpiGrid layout="lead">
        <KpiCard
          headingLevel={2}
          label={t('metric.M01.label.first')}
          value={site.pageviews}
          comparison={
            <ComparisonLines
              choice={choice}
              current={site.pageviews}
              prev={prevSite?.pageviews}
              yoy={yoySite?.pageviews}
            />
          }
          note={metricNote('M01')}
        />
        <KpiCard
          headingLevel={2}
          size="compact"
          label={metricLabel('M30')}
          value={posting === undefined ? t('s01.absent.value') : posting.postCount}
          comparison={
            posting === undefined ? (
              absentCompareText(choice.withheld, 'prev')
            ) : (
              <CountLines
                choice={choice}
                prev={pick(data.posting, choice.prevId)}
                yoy={pick(data.posting, choice.yoyId)}
              />
            )
          }
          note={metricNote('M30')}
        />
        <KpiCard
          headingLevel={2}
          size="compact"
          label={metricLabel('M03')}
          value={site.activeUsers}
          comparison={
            <ComparisonLines
              choice={choice}
              current={site.activeUsers}
              prev={prevSite?.activeUsers}
              yoy={yoySite?.activeUsers}
            />
          }
          note={t('metric.M03.note.first')}
        />
      </KpiGrid>
      <p className={styles.benchmark} data-part="benchmark">
        {benchmark === null
          ? t('absent.band')
          : t('s01.benchmark', {
              p25: formatNumber(benchmark.p25),
              p50: formatNumber(benchmark.p50),
              p75: formatNumber(benchmark.p75),
            })}
      </p>
    </div>
  );
}

/** 期間ごとの公開本数（DashboardData.posting の値）。 */
type PostingValue = { postCount: number };

type CountLinesProps = {
  choice: PeriodChoice & { period: Period };
  prev: PostingValue | undefined;
  yoy: PostingValue | undefined;
};

/**
 * 公開した記事の本数の比較（助言 A-2）。▲▼ と差を付けず、前の期間の本数を並べる。
 * 「前の 28 日は 7 本」。月は「前の月は 3 本」と「去年の同じ月は 2 本」。
 * 月の途中の月は、ほかの KPI と同じく「月が終わると…」（resolvePeriod の withheld）。
 */
function CountLines({ choice, prev, yoy }: CountLinesProps) {
  const line = (target: 'prev' | 'yoy', other: PostingValue | undefined) =>
    other === undefined
      ? absentCompareText(choice.withheld, target)
      : prevCountText(choice.period, target, formatNumber(other.postCount));
  return (
    <>
      <span className={styles.compareLine} data-compare="prev">
        {line('prev', prev)}
      </span>
      {choice.period.kind === 'month' ? (
        <span className={styles.compareLine} data-compare="yoy">
          {line('yoy', yoy)}
        </span>
      ) : null}
    </>
  );
}
