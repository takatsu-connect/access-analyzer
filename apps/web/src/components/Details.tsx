import type { ReactNode } from 'react';

import { cx } from './class-names';
import styles from './Details.module.css';

export type DetailsProps = {
  /** 折りたたみの見出し（「詳しく」など）。 */
  summary: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * 常に閉じた状態から始まる折りたたみ（05 §2.6。表の「詳しく」、CommonNotes の「詳しく」）。
 * 操作はブラウザの details に任せる（スクリプトなし）。
 * 広い画面で開いた状態にしたいときは ResponsiveDetails を使う。
 */
export function Details({ summary, children, className }: DetailsProps) {
  return (
    <details className={cx(styles.details, className)}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
