'use client';

import { useSyncExternalStore } from 'react';

import { isDelayed, todayJst } from '@/lib/derive';
import { formatMonthDay, formatUpdatedAt } from '@/lib/format';
import type { PageMeta } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './DataStatus.module.css';

function subscribeNever(): () => void {
  return () => undefined;
}

/** JST の今日。クライアントでだけ求める。 */
function getToday(): string {
  return todayJst(new Date());
}

/** 静的な HTML は「今日」を知らない（ビルドの日で止まるので、使わない）。 */
function getServerToday(): string | null {
  return null;
}

export type DataStatusProps = {
  /** 埋め込んだ JSON の meta。 */
  meta: Pick<PageMeta, 'baseDate' | 'finishedAt' | 'isStale'>;
};

/**
 * データの日付と更新の状況（05 §2.7、U-25）。各画面の先頭（ヘッダの直下）に置く。
 *
 * 「更新が遅れています」は、isStale か、今日 − 基準日 が 3 日以上のときだけ出す。
 * isStale はサーバーでも描く。「今日」が要る判定は、サーバーの HTML とずれないよう、
 * マウント後に足す。
 */
export function DataStatus({ meta }: DataStatusProps) {
  const today = useSyncExternalStore(subscribeNever, getToday, getServerToday);
  const delayed = today === null ? meta.isStale : isDelayed(meta, today);
  const baseDay = formatMonthDay(meta.baseDate);

  return (
    <div className={styles.status}>
      <p className={styles.asOf}>
        {t('status.asOf', { date: baseDay, updated: formatUpdatedAt(meta.finishedAt) })}
      </p>
      {delayed ? <p className={styles.delayed}>{t('status.delayed', { date: baseDay })}</p> : null}
    </div>
  );
}
