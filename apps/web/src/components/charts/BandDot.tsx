import type { Band } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './BandDot.module.css';
import type { BandDotProps } from './types';

/** 点の位置。3 区分それぞれの中央で固定（05 §2.4）。値に比例した位置は描かない。 */
const DOT_CX: Record<Band, string> = { lower: '12.5%', middle: '50%', upper: '87.5%' };
/** 区分の境界（左から 25% / 50% / 25%）。 */
const BOUNDARIES = ['25%', '75%'];

/**
 * 帯と点（05 §2.4、§2.8。S-02b、S-03、S-05）。
 *
 * 入力は band（3 値か null）だけ。帯は 1 色で、区分で濃淡を変えない。
 * null のときは帯を描かず、「まだ比較できません」と書く。
 */
export function BandDot({ band, variant = 'figure' }: BandDotProps) {
  if (band === null) return <span className={styles.na}>{t('band.na')}</span>;
  const label = t(`band.${band}`);
  if (variant === 'text') return <span className={styles.text}>{label}</span>;
  return (
    <span className={styles.figure}>
      <svg className={styles.svg} role="img" viewBox="0 0 100 12">
        <title>{label}</title>
        <rect className={styles.band} x="0" y={3} width="100%" height={6} rx={1} />
        {BOUNDARIES.map((x) => (
          <line key={x} className={styles.rule} data-part="rule" x1={x} x2={x} y1={3} y2={9} />
        ))}
        <circle className={styles.dot} data-part="dot" cx={DOT_CX[band]} cy={6} r={4} />
      </svg>
      <span className={`${styles.label} ${styles[band]}`}>{label}</span>
    </span>
  );
}
