import { share } from '@/lib/derive';
import { formatNumber, formatShare } from '@/lib/format';
import { t } from '@/lib/ui-text';

import { percent } from './geometry';
import styles from './HBar.module.css';
import type { HBarProps } from './types';

// 縦の寸法（px）。1 区分 = 文字の行 + 棒の行。
const ROW_HEIGHT = 44;
const TEXT_BASELINE = 14;
const BAR_TOP = 22;
const BAR_HEIGHT = 10;
/** 比較相手の輪郭は、棒より上下に少しはみ出させる（棒より短くても見えるように）。 */
const COMPARE_OVERHANG = 2;

function clampPercent(ratio: number): number {
  return Math.min(100, Math.max(0, ratio * 100));
}

/**
 * 構成比の横棒（05 §2.8。S-01、S-03、S-05）。横棒 1 本 = 1 区分で、常に縦に並べる。
 *
 * - 棒の長さは構成比（分母は合計の列）。右に「数（%）」。
 * - 合計が 20 未満か伏せ値のときは、比率も棒も出さず、数だけを出す（NFR-96）。
 * - 伏せ値の区分は棒を描かず「— 伏せ値」。0 は 0 として出す。
 * - 比較相手（前の期間、サイト全体）の構成比は、棒に重ねた細い輪郭。
 */
export function HBar({ title, items, total, valueWithShare, compare }: HBarProps) {
  if (items.length === 0) return null;
  const shares = share(
    items.map((item) => item.value),
    total,
  );
  const hasCompareOutline = items.some(
    (_, index) => (shares[index] ?? null) !== null && (compare?.shares[index] ?? null) !== null,
  );

  return (
    <div className={styles.chart}>
      <svg className={styles.svg} role="img" height={items.length * ROW_HEIGHT}>
        <title>{title}</title>
        {items.map((item, index) => {
          const top = index * ROW_HEIGHT;
          const itemShare = shares[index] ?? null;
          // 比較相手は、この区分の棒を描くときだけ重ねる。
          const compareShare = itemShare === null ? null : (compare?.shares[index] ?? null);
          return (
            <g key={item.key} data-key={item.key}>
              <text className={styles.label} x="0" y={top + TEXT_BASELINE}>
                {item.label}
              </text>
              {item.value === null ? (
                <text
                  className={styles.masked}
                  data-part="masked"
                  x="100%"
                  y={top + TEXT_BASELINE}
                  textAnchor="end"
                >
                  <tspan>{t('masked.dash')}</tspan>
                  <tspan className={styles.maskedLabel} dx={4}>
                    {t('masked.label')}
                  </tspan>
                </text>
              ) : (
                <text
                  className={styles.value}
                  data-part="value"
                  x="100%"
                  y={top + TEXT_BASELINE}
                  textAnchor="end"
                >
                  <tspan>
                    {itemShare === null
                      ? formatNumber(item.value)
                      : valueWithShare(formatNumber(item.value), formatShare(itemShare))}
                  </tspan>
                  {compareShare !== null && compare?.text ? (
                    <tspan className={styles.compareText} data-part="compare-text" dx={8}>
                      {compare.text(formatShare(compareShare))}
                    </tspan>
                  ) : null}
                </text>
              )}
              {itemShare === null ? null : (
                <>
                  <rect
                    className={styles.track}
                    x="0"
                    y={top + BAR_TOP}
                    width="100%"
                    height={BAR_HEIGHT}
                    rx={2}
                  />
                  <rect
                    className={styles.bar}
                    data-part="bar"
                    x="0"
                    y={top + BAR_TOP}
                    width={percent(clampPercent(itemShare))}
                    height={BAR_HEIGHT}
                    rx={2}
                  />
                </>
              )}
              {compareShare === null ? null : (
                <rect
                  className={styles.compare}
                  data-part="compare"
                  x="0"
                  y={top + BAR_TOP - COMPARE_OVERHANG}
                  width={percent(clampPercent(compareShare))}
                  height={BAR_HEIGHT + COMPARE_OVERHANG * 2}
                  rx={2}
                />
              )}
            </g>
          );
        })}
      </svg>
      {compare && hasCompareOutline ? (
        <p className={styles.legend}>
          <svg className={styles.swatch} aria-hidden="true" width={24} height={14}>
            <rect className={styles.compare} x={1} y={1} width={22} height={12} rx={2} />
          </svg>
          <span>{compare.legend}</span>
        </p>
      ) : null}
    </div>
  );
}
