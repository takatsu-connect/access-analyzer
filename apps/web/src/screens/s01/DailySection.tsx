'use client';

import { useId, useMemo, useState } from 'react';

import a11y from '@/components/a11y.module.css';
import { LineChart } from '@/components/charts';
import type { LineChartPoint, LineChartProps } from '@/components/charts';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { latestConfirmedDay, unconfirmedFrom } from '@/lib/derive';
import { formatDateRange, formatMonthDay, formatNumber } from '@/lib/format';
import type { DashboardData, Period } from '@/lib/page-data';
import type { QueryState } from '@/lib/query';
import { metricLabel, t } from '@/lib/ui-text';

import styles from './s01.module.css';
import { Segment } from './Segment';
import { sliceDaily, toRows } from './series';

type Grain = 'week' | 'day';

export type DailySectionProps = {
  data: DashboardData;
  period: Period;
  /** 図に出す数字（URL のクエリ line）。 */
  line: QueryState['line'];
  onLineChange: (line: QueryState['line']) => void;
};

/**
 * 日ごとの読まれた回数（M-01、M-02、M-26。FR-11、FR-02）。
 * 当期間の線に、前の期間の線（点線）と、公開した日の点を重ねる。直近 90 日は週別が既定。
 * 読んだ人の数の切り替えは作らない（Q-35）。
 */
export function DailySection({ data, period, line, onLineChange }: DailySectionProps) {
  const headingId = useId();
  // 週別と日別の切り替えは URL に持たない（画面の中の状態）。
  const [grain, setGrain] = useState<Grain>('week');
  const canFold = period.id === 'last90';
  const weekly = canFold && grain === 'week';

  const metric = line === 'sessions' ? 'sessions' : 'pageviews';
  const label = metricLabel(line === 'sessions' ? 'M02' : 'M01');
  const series = useMemo(() => sliceDaily(data, period, metric), [data, period, metric]);
  const firstUnconfirmed = unconfirmedFrom(data.meta.baseDate);
  const latestConfirmed = latestConfirmedDay(data.meta.baseDate);
  // 固定行の既定は最新の確定日。期間の外なら、期間の最後の日。
  const defaultDate = series.dates.includes(latestConfirmed)
    ? latestConfirmed
    : series.dates.at(-1);
  const rows = toRows(series, weekly, firstUnconfirmed);
  const title = t(weekly ? 's01.daily.title.week' : 's01.daily.title', { label });

  const weekText = (point: LineChartPoint): string => {
    const range = formatDateRange(point.start, point.end);
    const value = formatNumber(point.value);
    const text =
      point.prev === null
        ? t('chart.fixedRow.week.single', { range, label, value })
        : t('chart.fixedRow.week', { range, label, value, prev: formatNumber(point.prev) });
    return point.published > 0
      ? `${text}${t('s01.daily.fixedRow.week.published', { n: point.published })}`
      : text;
  };

  const chartProps: LineChartProps = {
    title,
    valueLabel: label,
    dates: series.dates,
    values: series.values,
    unconfirmedFrom: firstUnconfirmed,
    publishedCounts: series.publishedCounts,
    weekly,
    ...(series.prevValues === undefined ? {} : { prevValues: series.prevValues }),
    ...(defaultDate === undefined ? {} : { defaultDate }),
    ...(weekly
      ? { fixedRowText: weekText }
      : { publishedText: (count: number) => t('chart.fixedRow.published', { n: count }) }),
  };

  return (
    <section className={styles.section} aria-labelledby={headingId} data-section="daily">
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.h2}>
          {t('s01.daily.h2')}
        </h2>
        <div className={styles.controls}>
          <Segment
            label={t('s01.daily.metric.aria')}
            options={[
              { value: 'pv', label: metricLabel('M01') },
              { value: 'sessions', label: metricLabel('M02') },
            ]}
            value={line}
            onChange={onLineChange}
          />
          {canFold ? (
            <Segment
              label={t('s01.daily.grain.aria')}
              options={[
                { value: 'week', label: t('s01.daily.grain.week') },
                { value: 'day', label: t('s01.daily.grain.day') },
              ]}
              value={grain}
              onChange={setGrain}
            />
          ) : null}
        </div>
      </div>

      {series.dates.length === 0 ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          {/* 期間か、週別と日別が変わったら、選んでいる点を既定に戻す（数字の切り替えでは保つ）。 */}
          <LineChart key={`${period.id}:${weekly ? 'week' : 'day'}`} {...chartProps} />
          <Details summary={t('s01.table.summary')}>
            <table className={styles.table}>
              <caption className={a11y.srOnly}>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(weekly ? 's01.daily.table.week' : 's01.daily.table.date')}</th>
                  <th scope="col" className={styles.num}>
                    {label}
                  </th>
                  {series.prevValues === undefined ? null : (
                    <th scope="col" className={styles.num}>
                      {t('legend.prev')}
                    </th>
                  )}
                  <th scope="col" className={styles.num}>
                    {t('s01.daily.table.published')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const date = weekly
                    ? formatDateRange(row.start, row.end)
                    : formatMonthDay(row.start);
                  return (
                    <tr key={row.start}>
                      <th scope="row">
                        {row.unconfirmed ? t('s01.daily.table.unconfirmed', { date }) : date}
                      </th>
                      <td className={styles.num}>{formatNumber(row.value)}</td>
                      {series.prevValues === undefined ? null : (
                        <td className={styles.num}>
                          {row.prev === null ? (
                            <span className={styles.absent}>{t('s01.absent.prev')}</span>
                          ) : (
                            formatNumber(row.prev)
                          )}
                        </td>
                      )}
                      <td className={styles.num}>{formatNumber(row.published)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Notice>{t('s01.daily.table.note')}</Notice>
          </Details>
        </>
      )}
    </section>
  );
}
