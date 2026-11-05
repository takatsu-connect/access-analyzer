'use client';

import { useId } from 'react';

import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { CHANNEL_BUCKETS, SNS_BUCKETS } from '@/lib/config';
import { formatNumber } from '@/lib/format';
import type { DashboardData, Period, SitePeriodValue } from '@/lib/page-data';
import { metricLabel, metricNote, t } from '@/lib/ui-text';

import { Breakdown } from './Breakdown';
import { MonthTable } from './MonthTable';
import styles from './s01.module.css';
import { pick } from './series';

export type SourceSectionProps = {
  data: DashboardData;
  period: Period;
  site: SitePeriodValue;
};

/**
 * 読者はどこから来たか（M-10、M-11、M-12。FR-13）。
 * 流入チャネルの 5 区分（前の期間の構成比つき）、SNS の種類、リンク元のサイト（月ごとの集計）。
 */
export function SourceSection({ data, period, site }: SourceSectionProps) {
  const headingId = useId();
  const breakdown = data.breakdown[period.id];
  const prevSite = pick(data.sitePeriod, period.prevId);
  const prevBreakdown = pick(data.breakdown, period.prevId);
  // SNS の内訳の分母。SNS 5 区分の合計の列はないので、流入チャネルの SNS の値を使う。
  const social = breakdown?.channel.social ?? null;

  return (
    <section className={styles.section} aria-labelledby={headingId} data-section="source">
      <h2 id={headingId} className={styles.h2}>
        {metricLabel('M10')}
      </h2>

      {breakdown === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <div data-part="channel">
            <Breakdown
              title={metricLabel('M10')}
              lead={t('lead.sessions', { n: formatNumber(site.sessions) })}
              valueHeader={metricLabel('M02')}
              items={CHANNEL_BUCKETS.map((bucket) => ({
                key: bucket,
                label: t(`channel.${bucket}`),
                value: breakdown.channel[bucket],
              }))}
              total={site.sessions}
              prev={
                prevSite === undefined || prevBreakdown === undefined
                  ? undefined
                  : {
                      values: CHANNEL_BUCKETS.map((bucket) => prevBreakdown.channel[bucket]),
                      total: prevSite.sessions,
                    }
              }
            />
            <Notice>{metricNote('M10')}</Notice>
            <Details summary={t('s01.channel.other.summary')}>
              <p className={styles.text}>{t('s01.channel.other.body')}</p>
            </Details>
          </div>

          <div data-part="sns">
            <h3 className={styles.h3}>{metricLabel('M11')}</h3>
            <Breakdown
              title={metricLabel('M11')}
              lead={social === null ? null : t('lead.sessions', { n: formatNumber(social) })}
              valueHeader={metricLabel('M02')}
              items={SNS_BUCKETS.map((bucket) => ({
                key: bucket,
                label: t(`sns.${bucket}`),
                value: breakdown.sns[bucket],
              }))}
              total={social}
            />
            <Notice>{metricNote('M11')}</Notice>
          </div>
        </>
      )}

      <div data-part="referrer">
        <h3 className={styles.h3}>{t('s01.monthly.heading', { label: metricLabel('M12') })}</h3>
        <MonthTable
          caption={metricLabel('M12')}
          nameHeader={t('column.domain')}
          table={data.monthReferrer}
          toRow={(row) => ({ key: row.domain, name: row.domain, sessions: row.sessions })}
          periods={data.periods}
          selected={period}
        />
      </div>
    </section>
  );
}
