import { formatNumber } from '@/lib/format';
import type { Masked } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { cx } from './class-names';
import styles from './MaskedCell.module.css';

export type MaskedMarkProps = { className?: string };

/**
 * 伏せ値の印（05 §2.3）。「—」（U+2014）と、同じ要素の中の小さな「伏せ値」。
 * 色に頼らず、文字で伏せ値だと分かるようにする。
 */
export function MaskedMark({ className }: MaskedMarkProps) {
  return (
    <span className={cx('masked', styles.masked, className)}>
      {t('masked.dash')}
      <small className={styles.label}>{t('masked.label')}</small>
    </span>
  );
}

export type MaskedCellProps = {
  /** null は伏せ値。一次と二次を区別する口はない（Q-33）。 */
  value: Masked;
  className?: string;
};

/**
 * 伏せ値のありうる数（05 §2.3、U-24）。
 * 数は 3 桁区切り（0 は「0」）、null は伏せ値の印。表のセルにも KPI にも使える。
 */
export function MaskedCell({ value, className }: MaskedCellProps) {
  if (value === null) return <MaskedMark className={className} />;
  return <span className={cx(styles.value, className)}>{formatNumber(value)}</span>;
}
