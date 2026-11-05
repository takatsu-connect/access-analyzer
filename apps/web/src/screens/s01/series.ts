/**
 * S-01 の表示用の計算（純粋な関数）。
 *
 * - 日別の列（daily）から、選んだ期間と、重ねる前の期間を切り出す。
 * - 月ごとに集計する表（リンク元のサイト、市別）で、どの月を出すかを決める。
 */
import { addDays, diffDays, splitYmd } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { ByPeriod, DashboardData, Period, PeriodId } from '@/lib/page-data';

/** 週別にまとめるときの 1 つの点の日数（LineChart の週別と同じ）。 */
const DAYS_PER_WEEK = 7;

export type LineMetric = 'pageviews' | 'sessions';

export type DailySeries = {
  /** 'YYYY-MM-DD' の昇順。選んだ期間のうち、日別の値がある日。 */
  dates: string[];
  values: number[];
  /** dates と同じ長さ。値がない日は null。重ねる値が 1 日もなければ undefined。 */
  prevValues: (number | null)[] | undefined;
  /** 日ごとの公開本数。dates と同じ長さ。 */
  publishedCounts: number[];
};

/** 表の 1 行（日別なら 1 日、週別なら 1 週）。LineChart の点と同じまとめ方。 */
export type SeriesRow = {
  start: string;
  end: string;
  value: number;
  prev: number | null;
  published: number;
  unconfirmed: boolean;
};

/** 期間ごとの値を引く。ID が null か、その期間の値がなければ undefined。 */
export function pick<Value>(table: ByPeriod<Value>, id: PeriodId | null): Value | undefined {
  return id === null ? undefined : table[id];
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/** 前の月の同じ「日」。前の月にその日がなければ null（例: 3 月 31 日）。 */
export function sameDayOfPrevMonth(ymd: string): string | null {
  const { year, month, day } = splitYmd(ymd);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  // 翌月の 0 日 = その月の最後の日（UTC の暦で数える）。
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  return day > lastDay ? null : `${pad(prevYear, 4)}-${pad(prevMonth, 2)}-${pad(day, 2)}`;
}

/** firstDay から 1 日 1 要素の列で、その日の値。範囲の外は null。 */
function valueAt(firstDay: string, series: readonly number[], day: string): number | null {
  const index = diffDays(day, firstDay);
  return index >= 0 ? (series[index] ?? null) : null;
}

/**
 * 選んだ期間の日別の値と、重ねる前の期間の値。
 *
 * - 当期間は期間の start〜end。日別の値がない日（途中の月の、基準日より後など）は入れない。
 * - 前の期間は、移動窓なら直前の同じ日数（その日 − 期間の日数）、月なら前の月の同じ「日」。
 */
export function sliceDaily(data: DashboardData, period: Period, metric: LineMetric): DailySeries {
  const { firstDay } = data.daily;
  const series = data.daily[metric];
  const lastDay = addDays(firstDay, series.length - 1);
  const start = period.start < firstDay ? firstDay : period.start;
  const end = period.end > lastDay ? lastDay : period.end;

  const dates: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);

  const length = diffDays(period.end, period.start) + 1;
  const prevDayOf = (day: string): string | null => {
    if (period.prevId === null) return null;
    return period.kind === 'month' ? sameDayOfPrevMonth(day) : addDays(day, -length);
  };
  const prev = dates.map((day) => {
    const prevDay = prevDayOf(day);
    return prevDay === null ? null : valueAt(firstDay, series, prevDay);
  });

  return {
    dates,
    values: dates.map((day) => valueAt(firstDay, series, day) ?? 0),
    prevValues: prev.some((value) => value !== null) ? prev : undefined,
    publishedCounts: dates.map(
      (day) => valueAt(data.publishedPerDay.firstDay, data.publishedPerDay.counts, day) ?? 0,
    ),
  };
}

/** 図と同じまとめ方の行。週別は期間の最初の日から 7 日ずつ（最後の週は短いことがある）。 */
export function toRows(series: DailySeries, weekly: boolean, unconfirmedFrom: string): SeriesRow[] {
  const size = weekly ? DAYS_PER_WEEK : 1;
  const rows: SeriesRow[] = [];
  for (let from = 0; from < series.dates.length; from += size) {
    const to = Math.min(from + size, series.dates.length);
    const start = series.dates[from];
    const end = series.dates[to - 1];
    if (start === undefined || end === undefined) continue;
    let value = 0;
    let prev: number | null = series.prevValues === undefined ? null : 0;
    let published = 0;
    for (let index = from; index < to; index += 1) {
      value += series.values[index] ?? 0;
      const prevValue = series.prevValues?.[index] ?? null;
      prev = prev === null || prevValue === null ? null : prev + prevValue;
      published += series.publishedCounts[index] ?? 0;
    }
    rows.push({ start, end, value, prev, published, unconfirmed: end >= unconfirmedFrom });
  }
  return rows;
}

/**
 * 月ごとに集計する表（リンク元のサイト、市別）で出す月。
 * 確定した月を選んでいればその月、それ以外は最新の確定月。確定した月がなければ null。
 */
export function monthlyTarget(periods: readonly Period[], selected: Period): Period | null {
  if (selected.kind === 'month' && selected.isConfirmed) return selected;
  let latest: Period | null = null;
  for (const period of periods) {
    if (period.kind !== 'month' || !period.isConfirmed) continue;
    if (latest === null || period.end > latest.end) latest = period;
  }
  return latest;
}

/** 小数 1 桁（1 日あたりの平均）。0 以上の値を受け取る。 */
export function formatAverage(value: number): string {
  const tenths = Math.round(value * 10);
  return `${formatNumber(Math.trunc(tenths / 10))}.${Math.abs(tenths % 10)}`;
}
