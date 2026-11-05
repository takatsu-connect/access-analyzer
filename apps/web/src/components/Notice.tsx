import type { ReactNode } from 'react';

import { t } from '@/lib/ui-text';

import { cx } from './class-names';
import styles from './Notice.module.css';

export type NoticeProps = { children: ReactNode; className?: string };

/** 注記の小さな段落（図や表に添える 1〜2 文）。 */
export function Notice({ children, className }: NoticeProps) {
  return <p className={cx(styles.notice, className)}>{children}</p>;
}

export type BadgeProps = { children: ReactNode; className?: string };

/** 「新着」などの小さな印（05 §2.4）。グレーの枠と文字で、色で意味を足さない。 */
export function Badge({ children, className }: BadgeProps) {
  return <span className={cx(styles.badge, className)}>{children}</span>;
}

export type StateMessageProps = {
  /** 読み込み中、エラー、データなし。 */
  kind: 'loading' | 'error' | 'empty';
  /** 文言を差し替えるとき（「この期間に公開された記事はありません」など）。既定は state.*。 */
  children?: ReactNode;
};

/** 読み込み中、エラー、データなしの 3 状態の文。エラーは固定文だけで、中身を出さない（NFR-91）。 */
export function StateMessage({ kind, children }: StateMessageProps) {
  return (
    <p
      className={styles.state}
      role={kind === 'error' ? 'alert' : undefined}
      aria-busy={kind === 'loading' ? true : undefined}
    >
      {children ?? t(`state.${kind}`)}
    </p>
  );
}
