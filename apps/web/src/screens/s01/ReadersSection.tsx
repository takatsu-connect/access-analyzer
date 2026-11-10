'use client';

import { Heatmap } from '@/components/charts';
import type { HeatmapCell } from '@/components/charts';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { ResponsiveDetails } from '@/components/ResponsiveDetails';
import { DEVICE_BUCKETS, LOCAL_BUCKETS, NEW_RETURNING_BUCKETS } from '@/lib/config';
import { HEATMAP_DAYS, HEATMAP_HOURS, heatmapView, orderDays } from '@/lib/derive';
import type { HeatmapMargins, HeatmapView } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { DashboardData, Masked, Period, SitePeriodValue } from '@/lib/page-data';
import type { QueryState } from '@/lib/query';
import { heatmapSlotLabels, metricLabel, metricNote, t } from '@/lib/ui-text';

import { Breakdown } from './Breakdown';
import { HeatmapTable } from './HeatmapTable';
import { MonthTable } from './MonthTable';
import styles from './s01.module.css';
import { Segment } from './Segment';
import { formatAverage } from './series';

/** 曜日の名前のキー（添字 0 = 日曜。GA4 の dayOfWeek と同じ）。画面の並びは orderDays で月曜始まり。 */
const WEEKDAY_KEYS = [
  'weekday.0',
  'weekday.1',
  'weekday.2',
  'weekday.3',
  'weekday.4',
  'weekday.5',
  'weekday.6',
] as const;

/** 24 列のとき、時刻の見出しを何列おきに出すか。 */
const HOUR_LABEL_EVERY = 3;

export type ReadersSectionProps = {
  data: DashboardData;
  period: Period;
  site: SitePeriodValue;
  /** ヒートマップの数字の出し方（URL のクエリ heat）。 */
  heat: QueryState['heat'];
  onHeatChange: (heat: QueryState['heat']) => void;
};

type HeatmapBlockProps = Pick<ReadersSectionProps, 'period' | 'site' | 'heat' | 'onHeatChange'> & {
  cells: readonly Masked[] | undefined;
  /** 曜日ごと・時間帯ごとの合計。なければ平均の列と行を出さない。 */
  margins: HeatmapMargins | undefined;
};

/** いつ読まれているか（M-16。FR-12）。広い画面は 7 × 24、狭い画面は 7 × 6 に畳む。 */
function HeatmapBlock({ cells, margins, period, site, heat, onHeatChange }: HeatmapBlockProps) {
  if (cells === undefined || cells.length !== HEATMAP_DAYS * HEATMAP_HOURS) {
    return <StateMessage kind="empty" />;
  }

  // 1 日あたりの平均 = マス ÷ 期間にその曜日があった日数。平均の列と行は、伏せる前の値から
  // 作った合計を、並んだマスの数で割る（heatmapView）。
  const isAverage = heat === 'avg' && site.days > 0;
  const view = heatmapView({
    cells,
    margins,
    start: period.start,
    end: period.end,
    mode: isAverage ? 'avg' : 'sum',
  });
  // 行は月曜始まり（土日を隣り合わせで見る。HEATMAP_DAY_ORDER）。
  const hourly = orderDays(view.hourly);
  const rowLabels = orderDays(WEEKDAY_KEYS).map((key) => t('s01.heat.row', { day: t(key) }));
  const hourLabels = [...new Array<undefined>(HEATMAP_HOURS).keys()].map((hour) =>
    t('s01.heat.hour', { hour }),
  );
  const formatValue = isAverage ? formatAverage : formatNumber;
  const label = t('s01.heat.label', {
    metric: metricLabel('M01'),
    mode: t(isAverage ? 'heat.avg' : 'heat.sum'),
  });
  // 固定行の文。平均のマスは「月曜（1 時間あたりの平均）」「9 時（7 曜日の平均）」の形で読む。
  // rowMeanName は右端の平均の単位（広い画面は 1 時間あたり、狭い画面は 4 時間あたり）。
  const cellTextFor =
    (rowMeanName: string) =>
    (cell: HeatmapCell): string => {
      if (cell.kind === 'cell') {
        return cell.value === null
          ? t('heatmap.fixedRow.masked', { row: cell.rowLabel, col: cell.colLabel, label })
          : t('heatmap.fixedRow', {
              row: cell.rowLabel,
              col: cell.colLabel,
              label,
              value: formatValue(cell.value),
            });
      }
      const name = cell.kind === 'rowMean' ? cell.rowLabel : cell.colLabel;
      const mean = cell.kind === 'rowMean' ? rowMeanName : t('s01.heat.mean.col');
      return cell.value === null
        ? t('s01.heat.mean.fixedRow.masked', { name, mean, label })
        : t('s01.heat.mean.fixedRow', { name, mean, label, value: formatAverage(cell.value) });
    };
  const hourlyMeanName = t('s01.heat.mean.row.hourly');
  const slotMeanName = t('s01.heat.mean.row.slot');
  const shared = {
    title: metricLabel('M16'),
    rowLabels,
    hint: t('heatmap.tap.hint'),
    legend: t('legend.heatmap'),
    formatValue,
  };
  // 期間が変わったら、選んでいるマスを既定に戻す（平均と合計の切り替えでは保つ）。
  const chartKey = period.id;
  const slotLabels = heatmapSlotLabels();
  const folded = orderDays(view.slots);
  const tableProps = { caption: metricLabel('M16'), valueHeader: label, rowLabels, formatValue };
  const meanLabel = t('s01.heat.mean');
  const colName = t('s01.heat.mean.col');
  // 平均の列と行（曜日の並びは月曜始まりにそろえる）。合計がない期間は出さない。
  const meansFor = (means: HeatmapView['hourlyMeans'], rowName: string) =>
    means === undefined
      ? { chart: {}, table: {} }
      : {
          chart: {
            formatMean: formatAverage,
            rowMeans: { label: meanLabel, values: orderDays(means.rows) },
            colMeans: { label: meanLabel, values: means.cols },
          },
          table: {
            means: {
              rows: orderDays(means.rows),
              cols: means.cols,
              rowName,
              colName,
              format: formatAverage,
            },
          },
        };
  const hourlyMeans = meansFor(view.hourlyMeans, hourlyMeanName);
  const foldedMeans = meansFor(view.slotMeans, slotMeanName);

  return (
    <>
      {site.days === 0 ? null : (
        // 日数が 0 のときは「1 日あたりの平均」を出せないので、切り替えを出さない（合計だけ）。
        <Segment
          label={t('s01.heat.mode.aria')}
          options={[
            { value: 'avg', label: t('heat.avg') },
            { value: 'sum', label: t('heat.sum') },
          ]}
          value={heat}
          onChange={onHeatChange}
        />
      )}
      <div className={styles.wideOnly} data-part="heatmap-wide">
        <Heatmap
          key={chartKey}
          {...shared}
          colLabels={hourLabels}
          values={hourly}
          colLabelEvery={HOUR_LABEL_EVERY}
          cellText={cellTextFor(hourlyMeanName)}
          {...hourlyMeans.chart}
        />
        <HeatmapTable
          {...tableProps}
          colLabels={hourLabels}
          values={hourly}
          {...hourlyMeans.table}
        />
      </div>
      <div className={styles.narrowOnly} data-part="heatmap-narrow">
        <Heatmap
          key={chartKey}
          {...shared}
          colLabels={slotLabels}
          values={folded}
          cellText={cellTextFor(slotMeanName)}
          {...foldedMeans.chart}
        />
        <HeatmapTable
          {...tableProps}
          colLabels={slotLabels}
          values={folded}
          {...foldedMeans.table}
        />
      </div>
      <Notice>{metricNote('M16')}</Notice>
      {view.hourlyMeans === undefined ? null : <Notice>{t('s01.heat.note.mean')}</Notice>}
      {isAverage ? <Notice>{t('s01.heat.note.avg')}</Notice> : null}
    </>
  );
}

/**
 * 読者はどんな人？（広い画面で開いた状態、狭い画面で閉じた状態の折りたたみ）。
 * いつ読まれているか M-16、端末 M-13、おおよその地域 M-14、初めての人とまた来た人 M-15。
 */
export function ReadersSection({ data, period, site, heat, onHeatChange }: ReadersSectionProps) {
  const breakdown = data.breakdown[period.id];

  return (
    <ResponsiveDetails
      className={styles.section}
      summary={<h2 className={styles.summaryHeading}>{t('s01.readers.h2')}</h2>}
    >
      <div data-part="heatmap">
        <h3 className={styles.h3}>{metricLabel('M16')}</h3>
        <HeatmapBlock
          cells={data.heatmap[period.id]}
          margins={data.heatmapMargins[period.id]}
          period={period}
          site={site}
          heat={heat}
          onHeatChange={onHeatChange}
        />
      </div>

      <div data-part="device">
        <h3 className={styles.h3}>{t('s01.device.h3')}</h3>
        {breakdown === undefined ? (
          <StateMessage kind="empty" />
        ) : (
          <>
            <Breakdown
              title={t('s01.device.h3')}
              lead={t('lead.pageviews', { n: formatNumber(site.pageviews) })}
              valueHeader={metricLabel('M01')}
              items={DEVICE_BUCKETS.map((bucket) => ({
                key: bucket,
                label: t(`device.${bucket}`),
                value: breakdown.device[bucket].pageviews,
              }))}
              total={site.pageviews}
            />
            <Notice>{metricNote('M13')}</Notice>
            <Details summary={t('s01.device.sessions.summary')}>
              <Breakdown
                title={t('s01.device.sessions.title')}
                lead={t('lead.sessions', { n: formatNumber(site.sessions) })}
                valueHeader={metricLabel('M02')}
                items={DEVICE_BUCKETS.map((bucket) => ({
                  key: bucket,
                  label: t(`device.${bucket}`),
                  value: breakdown.device[bucket].sessions,
                }))}
                total={site.sessions}
              />
            </Details>
          </>
        )}
      </div>

      <div data-part="region">
        <h3 className={styles.h3}>{metricLabel('M14')}</h3>
        <h4 className={styles.h4}>{t('metric.M14.local.label')}</h4>
        {breakdown === undefined ? (
          <StateMessage kind="empty" />
        ) : (
          <>
            <Breakdown
              title={t('metric.M14.local.label')}
              lead={t('lead.sessions', { n: formatNumber(site.sessions) })}
              valueHeader={metricLabel('M02')}
              items={LOCAL_BUCKETS.map((bucket) => ({
                key: bucket,
                label: t(`local.${bucket}`),
                value: breakdown.local[bucket],
              }))}
              total={site.sessions}
            />
            <Notice>{metricNote('M14')}</Notice>
            <Notice>{t('metric.M14.local.note')}</Notice>
          </>
        )}
        <MonthTable
          label={t('s01.city.label')}
          headingLevel={4}
          measureStart={data.meta.measureStart}
          caption={t('s01.city.label')}
          groupHeader={t('s01.city.region')}
          nameHeader={t('s01.city.city')}
          table={data.monthCity}
          toRow={(row) => ({
            key: `${row.region}/${row.city}`,
            group: row.region,
            name: row.city,
            sessions: row.sessions,
          })}
          periods={data.periods}
          selected={period}
        />
      </div>

      <div data-part="new-returning">
        <h3 className={styles.h3}>{t('s01.newReturning.h3')}</h3>
        {breakdown === undefined ? (
          <StateMessage kind="empty" />
        ) : (
          <>
            <Breakdown
              title={t('s01.newReturning.h3')}
              lead={
                site.activeUsers === null
                  ? null
                  : t('lead.users', { n: formatNumber(site.activeUsers) })
              }
              valueHeader={metricLabel('M03')}
              items={NEW_RETURNING_BUCKETS.map((bucket) => ({
                key: bucket,
                label: t(`newReturning.${bucket}`),
                value: breakdown.newReturning[bucket],
              }))}
              total={site.activeUsers}
            />
            <Notice>{metricNote('M15')}</Notice>
          </>
        )}
      </div>
    </ResponsiveDetails>
  );
}
