import styles from './activity.module.css';

export type MonthlyBarRow = {
  /** 'YYYY-MM'。 */
  key: string;
  /** 月の名前（「2026 年 10 月」）。 */
  label: string;
  /** その月の本数。 */
  value: number;
  /** 去年の同じ月の本数。データがなければ null（枠を描かない）。 */
  yoy: number | null;
  /** 棒の右に書く文字（「3 本」）。 */
  valueText: string;
  /** 図の説明（「2026 年 10 月: 3 本（去年の同じ月: 2 本）」）。 */
  title: string;
};

export type MonthlyBarsProps = {
  /** 図の名前（読み上げ用）。 */
  title: string;
  rows: readonly MonthlyBarRow[];
  /** 凡例の文言（塗り、細い枠）。 */
  legend: { current: string; yoy: string };
};

const HEIGHT = 16;
const BAR_HEIGHT = 8;
const BAR_TOP = (HEIGHT - BAR_HEIGHT) / 2;
const OUTLINE_INSET = 1;
const SWATCH_WIDTH = 20;

function percent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 10000) / 100}%`;
}

/**
 * 月ごとの横棒を縦に並べる図（05 §8。S-08 だけが使う）。
 *
 * 共通の HBar は構成比の図で、月ごとの本数と去年の同じ月を重ねる形を持たないので、ここに作った。
 * - 塗りの棒がその月、細い枠が去年の同じ月。色ではなく、塗りと枠の違いで分ける。
 * - 棒の長さは、塗りと枠を合わせた最大値を基準にする（軸は 1 本）。
 * - 本数は棒の右に文字でも書く。同じ値の表は、呼び出し側が並べる。
 */
export function MonthlyBars({ title, rows, legend }: MonthlyBarsProps) {
  const max = rows.reduce((largest, row) => Math.max(largest, row.value, row.yoy ?? 0), 0);
  const ratio = (value: number): number => (max > 0 ? value / max : 0);
  const hasYoy = rows.some((row) => row.yoy !== null);

  return (
    <div>
      <ul className={styles.legend}>
        <li className={styles.legendItem}>
          <svg className={styles.swatch} aria-hidden="true" width={SWATCH_WIDTH} height={HEIGHT}>
            <rect
              className={styles.barFill}
              x="0"
              y={BAR_TOP}
              width={SWATCH_WIDTH}
              height={BAR_HEIGHT}
              rx={2}
            />
          </svg>
          {legend.current}
        </li>
        {hasYoy ? (
          <li className={styles.legendItem}>
            <svg className={styles.swatch} aria-hidden="true" width={SWATCH_WIDTH} height={HEIGHT}>
              <rect
                className={styles.barOutline}
                x="0"
                y={OUTLINE_INSET}
                width={SWATCH_WIDTH}
                height={HEIGHT - OUTLINE_INSET * 2}
                rx={2}
              />
            </svg>
            {legend.yoy}
          </li>
        ) : null}
      </ul>
      <ul className={styles.bars} aria-label={title}>
        {rows.map((row) => (
          <li key={row.key} className={styles.barRow} data-month={row.key}>
            <span className={styles.barLabel}>{row.label}</span>
            <svg className={styles.barSvg} role="img" height={HEIGHT}>
              <title>{row.title}</title>
              <rect
                className={styles.barTrack}
                x="0"
                y={BAR_TOP}
                width="100%"
                height={BAR_HEIGHT}
                rx={2}
              />
              <rect
                className={styles.barFill}
                data-part="bar"
                x="0"
                y={BAR_TOP}
                width={percent(ratio(row.value))}
                height={BAR_HEIGHT}
                rx={2}
              />
              {row.yoy === null ? null : (
                <rect
                  className={styles.barOutline}
                  data-part="yoy"
                  x="0"
                  y={OUTLINE_INSET}
                  width={percent(ratio(row.yoy))}
                  height={HEIGHT - OUTLINE_INSET * 2}
                  rx={2}
                />
              )}
            </svg>
            <span className={styles.barValue}>{row.valueText}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
