import { percent } from './geometry';
import styles from './HBar.module.css';
import type { MiniBarProps } from './types';

const HEIGHT = 8;

/**
 * 表の行に埋める小さな棒（05 §2.8。S-06、S-07）。値と、同じ列の最大値だけを受ける。
 * 伏せ値（null）は何も描かない（セルの「—」は呼び出し側の表が出す）。0 は長さ 0 の棒。
 */
export function MiniBar({ title, value, max }: MiniBarProps) {
  if (value === null) return null;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <svg className={styles.mini} role="img" height={HEIGHT}>
      <title>{title}</title>
      <rect className={styles.track} x="0" y={0} width="100%" height={HEIGHT} rx={2} />
      <rect
        className={styles.bar}
        data-part="bar"
        x="0"
        y={0}
        width={percent(ratio * 100)}
        height={HEIGHT}
        rx={2}
      />
    </svg>
  );
}
