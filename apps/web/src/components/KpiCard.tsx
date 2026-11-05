import type { ReactNode } from 'react';

import type { Masked } from '@/lib/page-data';

import styles from './KpiCard.module.css';
import { MaskedCell } from './MaskedCell';

export type KpiCardProps = {
  /** 見出し（指標の画面での名称。metricLabel() の値）。 */
  label: string;
  /**
   * 値。数は 3 桁区切り、null は伏せ値の印。
   * 文字列はそのまま描く（「1 分 20 秒」「10 人中 6 人」や、absent.* の文言）。
   */
  value: Masked | string;
  /** 比較の相手の 1 文（NFR-95）。例: 「前の 28 日と比べて」と <Delta />。 */
  comparison?: ReactNode;
  /** 注記（metricNote() の値など）。 */
  note?: ReactNode;
  /** 見出しの段。既定は h3。 */
  headingLevel?: 2 | 3 | 4;
};

/** 数字 1 つのカード（05 §2.2、§2.6）。見出し、値、比較の相手の 1 文、注記の順。 */
export function KpiCard({ label, value, comparison, note, headingLevel = 3 }: KpiCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={styles.card}>
      <Heading className={styles.label}>{label}</Heading>
      <p className={styles.value}>
        {typeof value === 'string' ? value : <MaskedCell value={value} />}
      </p>
      {comparison === undefined ? null : <p className={styles.comparison}>{comparison}</p>}
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
    </div>
  );
}

export type KpiGridProps = { children: ReactNode };

/** KpiCard を並べる枠。狭い画面で 1 列、広い画面で 3 列（05 §2.6）。 */
export function KpiGrid({ children }: KpiGridProps) {
  return <div className={styles.grid}>{children}</div>;
}
