import type { Comparison } from '@/lib/derive';
import { formatChange, formatDiff, isFlatChange } from '@/lib/format';
import { t } from '@/lib/ui-text';

import a11y from './a11y.module.css';
import { cx } from './class-names';
import styles from './Delta.module.css';
import { MaskedMark } from './MaskedCell';

export type DeltaProps = {
  /** compare()（@/lib/derive）の結果。null は、どちらかが伏せ値で比べられない。 */
  comparison: Comparison | null;
  className?: string;
};

/**
 * 前の期間との差（05 §2.2、§2.3、§2.4）。
 *
 * - 差の数（「+320」「−3」「±0」）と、分母が 20 以上のときだけ比率（compare() が ratio を持つとき）。
 * - 比率が丸めて 0% になるのに差が 0 でないときは、印を付けず「−32（ほぼ同じ）」。読み上げの言葉も付けない。
 * - +100% 以上は倍で書く（「+1,180（約 6 倍）」）。
 * - 矢印は文字色と同じ色。向きは、矢印、符号、読み上げ用の言葉の 3 つで伝える（色に頼らない）。
 * - 伏せ値どうしの比較は、伏せ値の印（「—」）。
 */
export function Delta({ comparison, className }: DeltaProps) {
  if (comparison === null) return <MaskedMark className={className} />;

  const { diff, ratio } = comparison;
  const flat = ratio !== null && isFlatChange(diff, ratio);
  const direction = flat ? null : diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const amount =
    ratio === null
      ? formatDiff(diff)
      : t('compare.withRatio', { diff: formatDiff(diff), ratio: formatChange(diff, ratio) });

  return (
    <span className={cx(styles.delta, className)}>
      {direction === null || direction === 'same' ? null : (
        <span className={styles.arrow} aria-hidden="true">
          {t(`compare.arrow.${direction}`)}
        </span>
      )}
      <span className={styles.amount}>{amount}</span>
      {direction === null ? null : <span className={a11y.srOnly}>{t(`compare.${direction}`)}</span>}
    </span>
  );
}
