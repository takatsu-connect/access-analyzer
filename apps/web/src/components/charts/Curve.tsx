import { area, line } from 'd3-shape';

import { formatNumber } from '@/lib/format';

import styles from './Curve.module.css';
import { percent, xPercent, zeroBasedAxis } from './geometry';
import type { CurveProps } from './types';

// 縦の寸法（px）。LineChart と同じ 200px（レビュー C-8）。
const HEIGHT = 200;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 166;
const DAY_LABEL_Y = 190;
/** 横軸の目盛り（◯日目）。 */
const DAY_TICKS: Record<30 | 90, readonly number[]> = { 30: [1, 10, 20, 30], 90: [1, 30, 60, 90] };

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number';
}

/**
 * 累積曲線と四分位の帯（05 §2.8。S-03）。
 *
 * - 帯（p25〜p75）は面、真ん中（p50）は点線、この記事は実線。渡された値だけを描く
 *   （null の日は線も面も切る）。この記事の線は、たった日までで終わる。
 * - 操作はないので Server Component のまま使える。
 */
export function Curve({ title, cumulative, benchmark = null, days, labels, dayLabel }: CurveProps) {
  const post = cumulative.slice(0, days);
  const p25 = benchmark ? benchmark.p25.slice(0, days) : [];
  const p50 = benchmark ? benchmark.p50.slice(0, days) : [];
  const p75 = benchmark ? benchmark.p75.slice(0, days) : [];

  const drawn = [...post, ...p25, ...p50, ...p75].filter(isNumber);
  if (drawn.length === 0) return null;
  const axis = zeroBasedAxis(Math.max(...drawn), PLOT_TOP, PLOT_BOTTOM);

  const indexes: number[] = [];
  for (let index = 0; index < days; index += 1) indexes.push(index);
  const xAt = (index: number): number => xPercent(index, days);
  const lineOf = (series: readonly (number | null)[]): string | null =>
    line<number>()
      .defined((index) => isNumber(series[index]))
      .x((index) => xAt(index))
      .y((index) => axis.y(series[index] ?? 0))(indexes);
  const hasBand = (index: number): boolean => isNumber(p25[index]) && isNumber(p75[index]);

  const bandPath = indexes.some(hasBand)
    ? area<number>()
        .defined(hasBand)
        .x((index) => xAt(index))
        .y0((index) => axis.y(p25[index] ?? 0))
        .y1((index) => axis.y(p75[index] ?? 0))(indexes)
    : null;
  const medianPath = p50.some(isNumber) ? lineOf(p50) : null;
  const postPath = post.some(isNumber) ? lineOf(post) : null;

  // この記事の線の終わり（いまの位置）に点を置く。
  let lastElapsed = -1;
  post.forEach((value, index) => {
    if (isNumber(value)) lastElapsed = index;
  });
  const lastValue = post[lastElapsed];

  return (
    <div className={styles.chart}>
      <svg className={styles.svg} role="img" height={HEIGHT}>
        <title>{title}</title>
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
          {bandPath === null ? null : (
            <path className={styles.band} data-series="band" d={bandPath} />
          )}
          {medianPath === null ? null : (
            <path
              className={`${styles.line} ${styles.medianLine}`}
              data-series="median"
              d={medianPath}
              strokeDasharray="4 3"
            />
          )}
          {postPath === null ? null : (
            <path className={`${styles.line} ${styles.postLine}`} data-series="post" d={postPath} />
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
        {isNumber(lastValue) ? (
          <circle
            className={styles.postDot}
            data-part="post-dot"
            cx={percent(xAt(lastElapsed))}
            cy={axis.y(lastValue)}
            r={4}
          />
        ) : null}
        {DAY_TICKS[days].map((day) => (
          <text
            key={day}
            className={styles.dayLabel}
            data-part="x-tick"
            x={percent(xAt(day - 1))}
            y={DAY_LABEL_Y}
            textAnchor="middle"
          >
            {dayLabel(day)}
          </text>
        ))}
      </svg>
      <ul className={styles.legend}>
        {postPath === null ? null : (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={24} height={10}>
              <line className={`${styles.line} ${styles.postLine}`} x1={1} y1={5} x2={23} y2={5} />
            </svg>
            <span>{labels.post}</span>
          </li>
        )}
        {bandPath === null ? null : (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={24} height={10}>
              <rect className={styles.band} x={0} y={0} width={24} height={10} />
            </svg>
            <span>{labels.band}</span>
          </li>
        )}
        {medianPath === null ? null : (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={24} height={10}>
              <line
                className={`${styles.line} ${styles.medianLine}`}
                x1={1}
                y1={5}
                x2={23}
                y2={5}
                strokeDasharray="4 3"
              />
            </svg>
            <span>{labels.median}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
