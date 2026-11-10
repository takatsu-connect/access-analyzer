/**
 * S-01 全体（docs/design/04_api.md §3.2）。
 */
import {
  CHANNEL_BUCKETS,
  DEVICE_BUCKETS,
  FRESHNESS_BUCKETS,
  LOCAL_BUCKETS,
  NEW_RETURNING_BUCKETS,
  SITE_AXES,
  SNS_BUCKETS,
} from '@/lib/config';
import type { DashboardData, Device, Freshness, Masked, SiteBreakdown } from '@/lib/page-data';
import { dashboardDataSchema } from '@/lib/page-data-schema';
import type { PubCache, PubSitePeriodBreakdown, PubSitePeriodHeatmap } from '@/lib/pub-types';

import {
  benchmarkRow,
  bucketRecord,
  buildCommon,
  byPeriod,
  comparableIds,
  dailySeries,
  daysBetween,
  rowsOf,
} from './shared';
import { checkPage } from './check';
import { isDisplayableDomain } from '@/lib/derive';

const HEATMAP_CELLS = 7 * 24;

type SiteAxis = (typeof SITE_AXES)[number];

/** 1 つの期間のサイト全体の内訳。行がなければ undefined。 */
function siteBreakdownOf(rows: readonly PubSitePeriodBreakdown[]): SiteBreakdown | undefined {
  if (rows.length === 0) return undefined;
  const knownAxes: readonly string[] = SITE_AXES;
  if (rows.some((row) => !knownAxes.includes(row.axis))) {
    throw new Error('pub_site_period_breakdown に、定義にない軸の行があります');
  }
  const axis = (name: SiteAxis) =>
    rows
      .filter((row) => row.axis === name)
      .map((row) => ({ bucket: row.bucket, value: row.value }));

  const devicePageviews = bucketRecord(DEVICE_BUCKETS, axis('device_pv'));
  const deviceSessions = bucketRecord(DEVICE_BUCKETS, axis('device_sessions'));
  return {
    channel: bucketRecord(CHANNEL_BUCKETS, axis('channel')),
    sns: bucketRecord(SNS_BUCKETS, axis('sns')),
    device: Object.fromEntries(
      DEVICE_BUCKETS.map((device) => [
        device,
        { pageviews: devicePageviews[device], sessions: deviceSessions[device] },
      ]),
    ) as Record<Device, { pageviews: Masked; sessions: Masked }>,
    local: bucketRecord(LOCAL_BUCKETS, axis('local')),
    newReturning: bucketRecord(NEW_RETURNING_BUCKETS, axis('new_returning')),
  };
}

/**
 * 曜日ごと（7）と時間帯ごと（24）の合計（ADR 0003 判断 8）。軸 dow と hour の行から作る。
 * どちらかの行が 1 つもなければ undefined（バッチがまだ作っていない期間。平均を出さない）。
 * 行のない区分は 0、伏せ値は null。
 */
function heatmapMarginsOf(
  rows: readonly PubSitePeriodBreakdown[],
): { dow: Masked[]; hour: Masked[] } | undefined {
  const of = (name: SiteAxis, size: number): Masked[] | undefined => {
    const axisRows = rows.filter((row) => row.axis === name);
    if (axisRows.length === 0) return undefined;
    const values = new Array<Masked>(size).fill(0);
    for (const row of axisRows) {
      const index = Number(row.bucket);
      if (!Number.isInteger(index) || index < 0 || index >= size || String(index) !== row.bucket) {
        throw new Error(`pub_site_period_breakdown の軸 ${name} に、定義にない区分があります`);
      }
      values[index] = row.value;
    }
    return values;
  };
  const dow = of('dow', 7);
  const hour = of('hour', 24);
  return dow === undefined || hour === undefined ? undefined : { dow, hour };
}

/** 168 要素（index = dow * 24 + hour）。行のない時間帯は 0、伏せ値は null。 */
function heatmapOf(rows: readonly PubSitePeriodHeatmap[]): Masked[] | undefined {
  if (rows.length === 0) return undefined;
  const cells = new Array<Masked>(HEATMAP_CELLS).fill(0);
  for (const row of rows) cells[row.dow * 24 + row.hour] = row.pageviews;
  return cells;
}

export function buildDashboard(cache: PubCache, builtAt: Date): DashboardData {
  const common = buildCommon(cache, builtAt);
  const ids = comparableIds(common);

  // 日別の推移。欠けた日はバッチが許さないので、あればビルドを止める。
  const days = [...cache.siteDaily].sort((a, b) => (a.day < b.day ? -1 : 1));
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) throw new Error('pub_site_daily に行がありません');
  if (daysBetween(first.day, last.day) + 1 !== days.length) {
    throw new Error('pub_site_daily に、欠けた日か重なった日があります');
  }

  // 日ごとの公開本数（M-26）。日別の推移と同じ範囲で数える。
  const publishedCounts = new Array<number>(days.length).fill(0);
  for (const post of cache.posts) {
    const index = daysBetween(first.day, post.published_on);
    const current = publishedCounts[index];
    if (index >= 0 && current !== undefined) publishedCounts[index] = current + 1;
  }

  const point = benchmarkRow(cache, 30);

  const data: DashboardData = {
    ...common,
    daily: {
      firstDay: first.day,
      pageviews: dailySeries(
        first.day,
        last.day,
        days.map((row) => ({ day: row.day, value: row.pageviews })),
      ),
      sessions: dailySeries(
        first.day,
        last.day,
        days.map((row) => ({ day: row.day, value: row.sessions })),
      ),
    },
    publishedPerDay: { firstDay: first.day, counts: publishedCounts },
    sitePeriod: byPeriod(ids, (id) => {
      const row = rowsOf(cache.sitePeriod, 'period_id', id)[0];
      return row === undefined
        ? undefined
        : {
            pageviews: row.pageviews,
            sessions: row.sessions,
            activeUsers: row.active_users,
            engagementSeconds: row.engagement_seconds,
            days: row.days,
          };
    }),
    breakdown: byPeriod(ids, (id) =>
      siteBreakdownOf(rowsOf(cache.sitePeriodBreakdown, 'period_id', id)),
    ),
    heatmap: byPeriod(ids, (id) => heatmapOf(rowsOf(cache.siteHeatmap, 'period_id', id))),
    heatmapMargins: byPeriod(ids, (id) =>
      heatmapMarginsOf(rowsOf(cache.sitePeriodBreakdown, 'period_id', id)),
    ),
    freshness: byPeriod(ids, (id) => {
      const rows = rowsOf(cache.siteFreshness, 'period_id', id);
      if (rows.length === 0) return undefined;
      const table = Object.fromEntries(
        FRESHNESS_BUCKETS.map((bucket) => [bucket, { postCount: 0, pageviews: 0 }]),
      ) as Record<Freshness, { postCount: number; pageviews: number }>;
      for (const row of rows) {
        table[row.freshness] = { postCount: row.post_count, pageviews: row.pageviews };
      }
      return table;
    }),
    monthReferrer: byPeriod(ids, (id) => {
      const rows = rowsOf(cache.siteMonthReferrer, 'period_id', id);
      if (rows.length === 0) return undefined;
      return [...rows]
        .sort((a, b) => a.rank - b.rank)
        .filter((row) => isDisplayableDomain(row.source_domain))
        .map((row) => ({ domain: row.source_domain, sessions: row.sessions }));
    }),
    monthCity: byPeriod(ids, (id) => {
      const rows = rowsOf(cache.siteMonthCity, 'period_id', id);
      if (rows.length === 0) return undefined;
      return [...rows]
        .sort((a, b) => a.rank - b.rank)
        .map((row) => ({ region: row.region, city: row.city, sessions: row.sessions }));
    }),
    posting: byPeriod(ids, (id) => {
      const row = rowsOf(cache.postingPeriod, 'period_id', id)[0];
      return row === undefined ? undefined : { postCount: row.post_count };
    }),
    benchmark30:
      point === undefined
        ? null
        : {
            p25: point.p25,
            p50: point.p50,
            p75: point.p75,
            populationSize: point.population_size,
            populationWindow: point.population_window,
          },
  };
  return checkPage(dashboardDataSchema, data, 'dashboardDataSchema');
}
