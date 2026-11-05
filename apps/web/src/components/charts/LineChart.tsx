'use client';

import { line } from 'd3-shape';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { splitYmd } from '@/lib/derive';
import { formatDateRange, formatMonthDay, formatNumber } from '@/lib/format';
import { t } from '@/lib/ui-text';

import { percent, round2, xPercent, zeroBasedAxis } from './geometry';
import styles from './LineChart.module.css';
import type { LineChartPoint, LineChartProps } from './types';

// 縦の寸法（px）。高さは 160px（05 §2.6）。
const HEIGHT = 160;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 120;
const PUBLISHED_DOT_Y = 131;
const DATE_LABEL_Y = 152;
const DAYS_PER_WEEK = 7;
/** 週別のとき、日付ラベルを出す間隔（週）。 */
const WEEK_LABEL_EVERY = 4;
/** 月の表示で日付ラベルを出す日（05 §2.6）。 */
const MONTH_LABEL_DAYS = [1, 11, 21];

/** 日別の値を点にまとめる。週別は期間の最初の日から 7 日ずつ（最後の週は短いことがある）。 */
function buildPoints({
  dates,
  values,
  prevValues,
  publishedCounts,
  unconfirmedFrom,
  weekly,
}: LineChartProps): LineChartPoint[] {
  if (values.length !== dates.length) {
    throw new RangeError('LineChart: dates と values は同じ長さで渡します。');
  }
  const size = weekly ? DAYS_PER_WEEK : 1;
  const points: LineChartPoint[] = [];
  for (let from = 0; from < dates.length; from += size) {
    const to = Math.min(from + size, dates.length);
    const start = dates[from];
    const end = dates[to - 1];
    if (start === undefined || end === undefined) continue;
    let value = 0;
    let prev: number | null = prevValues ? 0 : null;
    let published = 0;
    for (let index = from; index < to; index += 1) {
      value += values[index] ?? 0;
      const prevValue = prevValues?.[index] ?? null;
      prev = prev === null || prevValue === null ? null : prev + prevValue;
      published += publishedCounts?.[index] ?? 0;
    }
    points.push({
      start,
      end,
      value,
      prev,
      published,
      unconfirmed: unconfirmedFrom !== undefined && end >= unconfirmedFrom,
    });
  }
  return points;
}

/** 日付ラベルを出す点（05 §2.6: 7 日は毎日、28 日は週ごと、90 日は月初、月は 1・11・21 日）。 */
function labelIndexes(points: readonly LineChartPoint[], weekly: boolean): number[] {
  const all = points.map((_, index) => index);
  if (weekly) return all.filter((index) => index % WEEK_LABEL_EVERY === 0);
  if (points.length <= 10) return all;
  const days = points.map((point) => splitYmd(point.start));
  const first = days[0];
  const last = days[days.length - 1];
  const isOneMonth =
    first !== undefined &&
    last !== undefined &&
    first.day === 1 &&
    first.year === last.year &&
    first.month === last.month;
  if (isOneMonth) return all.filter((index) => MONTH_LABEL_DAYS.includes(days[index]?.day ?? 0));
  if (points.length <= 31) return all.filter((index) => index % DAYS_PER_WEEK === 0);
  return all.filter((index) => days[index]?.day === 1);
}

/** 軸の日付ラベル（'10/30'）。狭い幅で重ならないよう、固定行より短い形にする。 */
function axisDate(ymd: string): string {
  const { month, day } = splitYmd(ymd);
  return `${month}/${day}`;
}

/** 固定行の既定の点。最新の確定日を含む点。その点が薄い（未確定を含む）なら、薄くない最後の点。 */
function defaultIndex(points: readonly LineChartPoint[], defaultDate: string | undefined): number {
  let lastConfirmed = -1;
  points.forEach((point, index) => {
    if (!point.unconfirmed) lastConfirmed = index;
  });
  const fallback = lastConfirmed >= 0 ? lastConfirmed : points.length - 1;
  if (defaultDate === undefined) return fallback;
  const found = points.findIndex((point) => point.start <= defaultDate && defaultDate <= point.end);
  if (found < 0) return fallback;
  return points[found]?.unconfirmed ? fallback : found;
}

function defaultFixedRow(
  point: LineChartPoint,
  valueLabel: string,
  publishedText: ((count: number) => string) | undefined,
): string {
  const date =
    point.start === point.end
      ? formatMonthDay(point.start)
      : formatDateRange(point.start, point.end);
  const value = formatNumber(point.value);
  const base =
    point.prev === null
      ? t('chart.fixedRow.single', { date, label: valueLabel, value })
      : t('chart.fixedRow', { date, label: valueLabel, value, prev: formatNumber(point.prev) });
  return point.published > 0 && publishedText ? `${base}${publishedText(point.published)}` : base;
}

/**
 * 日別推移の折れ線（05 §2.8。S-01、S-03）。
 *
 * - 当期間は実線、前期間は点線、あとで増えることがある日は薄い線と背景の帯。意味の違いは
 *   色ではなく線種で分ける（05 §2.4）。縦軸は 0 始まり。
 * - 日付を選ぶと、図の下の固定行が変わる（ツールチップは作らない。ADR 0008）。
 *   固定行は最初から埋まっている。
 */
export function LineChart(props: LineChartProps) {
  const { title, valueLabel, prevValues, publishedCounts, defaultDate, fixedRowText } = props;
  const weekly = props.weekly ?? false;
  const fixedRowId = useId();
  // 選んだ点は日付で覚える。期間を切り替えて日付が範囲の外に出たら、既定の点に戻る。
  const [selectedStart, setSelectedStart] = useState<string | null>(null);

  const points = buildPoints(props);
  const count = points.length;
  if (count === 0) return null;

  const selectedIndex = points.findIndex((point) => point.start === selectedStart);
  const current = selectedIndex >= 0 ? selectedIndex : defaultIndex(points, defaultDate);
  const currentPoint = points[current];
  if (currentPoint === undefined) return null;

  const xs = points.map((_, index) => xPercent(index, count));
  const xAt = (index: number): number => xs[index] ?? 0;
  const maxValue = Math.max(0, ...points.map((point) => Math.max(point.value, point.prev ?? 0)));
  const axis = zeroBasedAxis(maxValue, PLOT_TOP, PLOT_BOTTOM);

  // 線は、横 0〜100・縦 px の入れ子の SVG に描く（横だけ引き伸ばす）。
  const firstUnconfirmed = points.findIndex((point) => point.unconfirmed);
  const confirmedEnd = firstUnconfirmed < 0 ? count : firstUnconfirmed;
  const indexes = points.map((_, index) => index);
  const currentLine = line<number>()
    .x((index) => xAt(index))
    .y((index) => axis.y(points[index]?.value ?? 0));
  const prevLine = line<number>()
    .defined((index) => (points[index]?.prev ?? null) !== null)
    .x((index) => xAt(index))
    .y((index) => axis.y(points[index]?.prev ?? 0));
  const confirmedPath = confirmedEnd > 0 ? currentLine(indexes.slice(0, confirmedEnd)) : null;
  // 薄い線は、最後の確定の点から続けて描く。
  const unconfirmedPath =
    firstUnconfirmed < 0 ? null : currentLine(indexes.slice(Math.max(0, firstUnconfirmed - 1)));
  const prevPath = prevValues ? prevLine(indexes) : null;

  const boundary = (index: number): number => round2((xAt(index - 1) + xAt(index)) / 2);
  const leftEdge = (index: number): number => (index === 0 ? 0 : boundary(index));
  const rightEdge = (index: number): number => (index === count - 1 ? 100 : boundary(index + 1));
  const bandLeft = firstUnconfirmed < 0 ? null : leftEdge(firstUnconfirmed);

  const select = (index: number): void => {
    const point = points[index];
    if (point !== undefined) setSelectedStart(point.start);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowRight') next = Math.min(count - 1, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  const fixedRow = fixedRowText
    ? fixedRowText(currentPoint)
    : defaultFixedRow(currentPoint, valueLabel, props.publishedText);
  const hasUnconfirmed = firstUnconfirmed >= 0;

  return (
    <div className={styles.chart}>
      <div
        className={styles.plot}
        role="group"
        tabIndex={0}
        aria-label={title}
        aria-describedby={fixedRowId}
        onKeyDown={onKeyDown}
      >
        <svg className={styles.svg} role="img" height={HEIGHT}>
          <title>{title}</title>
          {bandLeft === null ? null : (
            <rect
              className={styles.unconfirmedBand}
              data-part="unconfirmed-band"
              x={percent(bandLeft)}
              y={PLOT_TOP}
              width={percent(100 - bandLeft)}
              height={PLOT_BOTTOM - PLOT_TOP}
            />
          )}
          {axis.ticks.map((tick) => (
            <line
              key={tick}
              className={tick === 0 ? styles.baseline : styles.gridLine}
              x1="0"
              x2="100%"
              y1={axis.y(tick)}
              y2={axis.y(tick)}
            />
          ))}
          <svg
            x="0"
            y="0"
            width="100%"
            height={HEIGHT}
            viewBox={`0 0 100 ${HEIGHT}`}
            preserveAspectRatio="none"
          >
            {prevPath === null ? null : (
              <path
                className={`${styles.line} ${styles.prevLine}`}
                data-series="prev"
                d={prevPath}
                strokeDasharray="4 3"
              />
            )}
            {confirmedPath === null ? null : (
              <path
                className={`${styles.line} ${styles.currentLine}`}
                data-series="current"
                d={confirmedPath}
              />
            )}
            {unconfirmedPath === null ? null : (
              <path
                className={`${styles.line} ${styles.unconfirmedLine}`}
                data-series="unconfirmed"
                d={unconfirmedPath}
              />
            )}
          </svg>
          {axis.ticks.map((tick) => (
            <text
              key={tick}
              className={styles.axisLabel}
              data-part="y-tick"
              x="0"
              y={axis.y(tick) - 3}
            >
              {formatNumber(tick)}
            </text>
          ))}
          {publishedCounts
            ? points.map((point, index) =>
                point.published > 0 ? (
                  <circle
                    key={point.start}
                    className={styles.publishedDot}
                    data-part="published-dot"
                    cx={percent(xAt(index))}
                    cy={PUBLISHED_DOT_Y}
                    r={3}
                  />
                ) : null,
              )
            : null}
          <line
            className={styles.marker}
            x1={percent(xAt(current))}
            x2={percent(xAt(current))}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
          />
          <circle
            className={styles.markerDot}
            data-part="selected-dot"
            cx={percent(xAt(current))}
            cy={axis.y(currentPoint.value)}
            r={4}
          />
          {labelIndexes(points, weekly).map((index) => (
            <text
              key={index}
              className={styles.dateLabel}
              data-part="x-tick"
              x={percent(xAt(index))}
              y={DATE_LABEL_Y}
              textAnchor="middle"
            >
              {axisDate(points[index]?.start ?? currentPoint.start)}
            </text>
          ))}
          {points.map((point, index) => (
            <rect
              key={point.start}
              className={styles.hit}
              data-part="hit"
              data-date={point.start}
              x={percent(leftEdge(index))}
              y={0}
              width={percent(rightEdge(index) - leftEdge(index))}
              height={HEIGHT}
              onClick={() => select(index)}
            />
          ))}
        </svg>
      </div>
      <p className={styles.hint}>{t('chart.tap.hint')}</p>
      <p id={fixedRowId} className={styles.fixedRow} data-part="fixed-row" aria-live="polite">
        {fixedRow}
      </p>
      <ul className={styles.legend}>
        <li className={styles.legendItem}>
          <svg className={styles.swatch} aria-hidden="true" width={24} height={8}>
            <line className={`${styles.line} ${styles.currentLine}`} x1={1} y1={4} x2={23} y2={4} />
          </svg>
          <span>{t('legend.current')}</span>
        </li>
        {prevPath === null ? null : (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={24} height={8}>
              <line
                className={`${styles.line} ${styles.prevLine}`}
                x1={1}
                y1={4}
                x2={23}
                y2={4}
                strokeDasharray="4 3"
              />
            </svg>
            <span>{t('legend.prev')}</span>
          </li>
        )}
        {publishedCounts ? (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={8} height={8}>
              <circle className={styles.publishedDot} cx={4} cy={4} r={3} />
            </svg>
            <span>{t('legend.published')}</span>
          </li>
        ) : null}
        {hasUnconfirmed ? (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={24} height={8}>
              <rect className={styles.unconfirmedBand} x={0} y={0} width={24} height={8} />
              <line
                className={`${styles.line} ${styles.unconfirmedLine}`}
                x1={1}
                y1={4}
                x2={23}
                y2={4}
              />
            </svg>
            <span>{t('legend.unconfirmed')}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
