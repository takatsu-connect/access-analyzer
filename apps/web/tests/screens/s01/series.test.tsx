import { describe, expect, it } from 'vitest';

import { buildDashboard } from '@/data/pages';
import type { DashboardData, Period } from '@/lib/page-data';
import {
  formatAverage,
  monthlyTarget,
  sameDayOfPrevMonth,
  sliceDaily,
  toRows,
} from '@/screens/s01/series';

import { BUILT_AT, makeCache } from '../../data/fixture';

function build(): DashboardData {
  return buildDashboard(makeCache(), BUILT_AT);
}

function periodOf(data: DashboardData, id: string): Period {
  const period = data.periods.find((item) => item.id === id);
  if (period === undefined) throw new Error(`フィクスチャに ${id} がありません`);
  return period;
}

describe('sameDayOfPrevMonth', () => {
  it('前の月の同じ日を返す', () => {
    expect(sameDayOfPrevMonth('2026-11-03')).toBe('2026-10-03');
    expect(sameDayOfPrevMonth('2026-01-15')).toBe('2025-12-15');
    expect(sameDayOfPrevMonth('2024-03-29')).toBe('2024-02-29');
  });

  it('前の月にその日がなければ null', () => {
    expect(sameDayOfPrevMonth('2026-03-31')).toBeNull();
    expect(sameDayOfPrevMonth('2026-03-29')).toBeNull();
    expect(sameDayOfPrevMonth('2026-10-31')).toBeNull();
  });
});

describe('sliceDaily', () => {
  it('移動窓は、直前の同じ日数を重ねる（日別の値がない日は null）', () => {
    const data = build();
    const series = sliceDaily(data, periodOf(data, 'last7'), 'pageviews');
    expect(series.dates).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    // 日別は 10 月 1 日が 100 で、1 日ごとに 1 増える。
    expect(series.values).toEqual([127, 128, 129, 130, 131, 132, 133]);
    expect(series.prevValues).toEqual([120, 121, 122, 123, 124, 125, 126]);
    // 11 月 1 日に 1 本公開。
    expect(series.publishedCounts).toEqual([0, 0, 0, 0, 1, 0, 0]);

    const month = sliceDaily(data, periodOf(data, 'last28'), 'sessions');
    expect(month.dates).toHaveLength(28);
    // 前の 28 日（9 月 9 日〜10 月 6 日）のうち、値があるのは 10 月 1 日〜6 日だけ。
    expect(month.prevValues?.slice(0, 22).every((value) => value === null)).toBe(true);
    expect(month.prevValues?.slice(22)).toEqual([50, 51, 52, 53, 54, 55]);
  });

  it('月は、前の月の同じ「日」を重ね、値のない日は入れない', () => {
    const data = build();
    const series = sliceDaily(data, periodOf(data, 'm2026-11'), 'pageviews');
    // 途中の月。基準日（11 月 3 日）までの 3 日だけ。
    expect(series.dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(series.values).toEqual([131, 132, 133]);
    expect(series.prevValues).toEqual([100, 101, 102]);
  });

  it('重ねる値が 1 日もなければ、前の期間の線を出さない', () => {
    const data = build();
    const series = sliceDaily(data, periodOf(data, 'm2026-10'), 'pageviews');
    expect(series.dates).toHaveLength(31);
    expect(series.prevValues).toBeUndefined();
  });
});

describe('toRows', () => {
  it('週別は、期間の最初の日から 7 日ずつにまとめる', () => {
    const data = build();
    const series = sliceDaily(data, periodOf(data, 'last28'), 'pageviews');
    const rows = toRows(series, true, '2026-11-01');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ start: '2026-10-07', end: '2026-10-13', published: 1 });
    // 106 + 107 + … + 112。
    expect(rows[0]?.value).toBe(763);
    expect(rows[0]?.prev).toBeNull();
    expect(rows.map((row) => row.unconfirmed)).toEqual([false, false, false, true]);
  });

  it('日別は 1 日 1 行', () => {
    const data = build();
    const series = sliceDaily(data, periodOf(data, 'last7'), 'pageviews');
    const rows = toRows(series, false, '2026-11-01');
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.unconfirmed)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('monthlyTarget', () => {
  it('移動窓と途中の月では、最新の確定月', () => {
    const data = build();
    expect(monthlyTarget(data.periods, periodOf(data, 'last28'))?.id).toBe('m2026-10');
    expect(monthlyTarget(data.periods, periodOf(data, 'm2026-11'))?.id).toBe('m2026-10');
  });

  it('確定した月を選んでいれば、その月', () => {
    const data = build();
    expect(monthlyTarget(data.periods, periodOf(data, 'm2025-10'))?.id).toBe('m2025-10');
  });

  it('確定した月がなければ null', () => {
    const data = build();
    const windows = data.periods.filter((period) => period.kind === 'window');
    expect(monthlyTarget(windows, periodOf(data, 'last28'))).toBeNull();
  });
});

describe('formatAverage', () => {
  it('小数 1 桁で書く', () => {
    expect(formatAverage(0)).toBe('0.0');
    expect(formatAverage(5 / 7)).toBe('0.7');
    expect(formatAverage(9 / 7)).toBe('1.3');
    expect(formatAverage(1234.56)).toBe('1,234.6');
    expect(formatAverage(0.96)).toBe('1.0');
  });
});
