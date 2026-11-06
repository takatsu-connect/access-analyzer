'use client';

import { useState } from 'react';

import a11y from '@/components/a11y.module.css';
import { LineChart } from '@/components/charts';
import type { LineChartPoint } from '@/components/charts/types';
import { Details } from '@/components/Details';
import { StateMessage } from '@/components/Notice';
import { addDays, diffDays, latestConfirmedDay, unconfirmedFrom } from '@/lib/derive';
import { formatDate, formatDateRange, formatNumber } from '@/lib/format';
import type { ArticleDetailData, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';
import { TableSummary } from './TableSummary';

export type DailySectionProps = {
  /** 選んだ期間。 */
  period: Period;
  daily: ArticleDetailData['daily'];
  /** 基準日（meta.baseDate）。 */
  baseDate: string;
  /** 読まれた回数を数え始めた日（meta.measureStart）。 */
  measureStart: string;
  isPreMeasure: boolean;
};

/** 選んだ期間と、日別の値がある範囲の重なり。重ならなければ null。 */
function overlap(
  period: Period,
  daily: ArticleDetailData['daily'],
): { dates: string[]; values: number[] } | null {
  if (daily.pageviews.length === 0) return null;
  const lastDay = addDays(daily.firstDay, daily.pageviews.length - 1);
  // 'YYYY-MM-DD' は文字列のまま大小を比べられる。
  const from = period.start > daily.firstDay ? period.start : daily.firstDay;
  const to = period.end < lastDay ? period.end : lastDay;
  if (from > to) return null;
  const offset = diffDays(from, daily.firstDay);
  const count = diffDays(to, from) + 1;
  const values = daily.pageviews.slice(offset, offset + count);
  return { dates: values.map((_, index) => addDays(from, index)), values };
}

/**
 * 日ごとの読まれた回数（M-01。FR-23 (2)、FR-02）。
 * 前の期間の線は描かない（記事は公開直後に読まれて減るのが普通で、減り方が「前より下」に見えるため）。
 * 直近 90 日は週ごとを既定にし、日ごとに切り替えられる（05 §2.6）。表は、いつも日ごとの値。
 */
export function DailySection({
  period,
  daily,
  baseDate,
  measureStart,
  isPreMeasure,
}: DailySectionProps) {
  const [showDaily, setShowDaily] = useState(false);
  const range = overlap(period, daily);
  const isLong = period.id === 'last90';
  const weekly = isLong && !showDaily;
  const valueLabel = t('metric.M01.label');
  const softFrom = unconfirmedFrom(baseDate);

  const weeklyRow = (point: LineChartPoint): string =>
    t('chart.fixedRow.week.single', {
      range: formatDateRange(point.start, point.end),
      label: valueLabel,
      value: formatNumber(point.value),
    });

  /** 値がない理由。期間が、日別の値の始まりより前なら、その旨を書く。 */
  const emptyMessage = (): string => {
    if (daily.pageviews.length > 0 && period.end >= daily.firstDay) return t('state.empty');
    return isPreMeasure
      ? t('s03.daily.beforeMeasure', { start: formatDate(measureStart) })
      : t('s03.daily.beforePublish');
  };

  return (
    <section className={styles.section} aria-labelledby="s03-daily">
      <h2 id="s03-daily">{t('s03.daily.h2')}</h2>
      {range === null ? (
        <StateMessage kind="empty">{emptyMessage()}</StateMessage>
      ) : (
        <>
          {isLong ? (
            <div className={styles.viewToggle} role="group" aria-label={t('s03.daily.view.label')}>
              <button
                type="button"
                className={styles.viewButton}
                aria-pressed={weekly}
                onClick={() => setShowDaily(false)}
              >
                {t('s03.daily.view.weekly')}
              </button>
              <button
                type="button"
                className={styles.viewButton}
                aria-pressed={!weekly}
                onClick={() => setShowDaily(true)}
              >
                {t('s03.daily.view.daily')}
              </button>
            </div>
          ) : null}
          <LineChart
            title={t('s03.daily.h2')}
            valueLabel={valueLabel}
            dates={range.dates}
            values={range.values}
            unconfirmedFrom={softFrom}
            defaultDate={latestConfirmedDay(baseDate)}
            weekly={weekly}
            fixedRowText={weekly ? weeklyRow : undefined}
          />
          <Details summary={<TableSummary name={t('s03.daily.h2')} />}>
            <table className={styles.table}>
              <caption className={a11y.srOnly}>{t('s03.daily.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('s03.daily.table.day')}</th>
                  <th scope="col" className={styles.num}>
                    {valueLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {range.dates.map((date, index) => (
                  <tr key={date}>
                    <th scope="row">{formatDate(date)}</th>
                    <td className={styles.num}>
                      {formatNumber(range.values[index] ?? 0)}
                      {date >= softFrom ? (
                        <small className={styles.cellNote}>
                          {t('s03.daily.table.unconfirmed')}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Details>
        </>
      )}
    </section>
  );
}
