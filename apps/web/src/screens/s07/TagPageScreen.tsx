'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';
import { StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { usePeriod } from '@/components/usePeriod';
import { formatNumber } from '@/lib/format';
import type { TagPageData } from '@/lib/page-data';
import { metricLabel, t } from '@/lib/ui-text';
import styles from '@/screens/s06/shared/parts.module.css';
import { PrevDelta, Totals } from '@/screens/s06/shared/parts';

/** 4 列: タイトル、著者、公開日、読まれた回数（05 §7.3）。狭い画面でも 4 列のまま。 */
const COLUMNS: readonly ArticleColumnId[] = ['title', 'author', 'publishedOn', 'pageviews'];

/**
 * S-07b シリーズの記事（05 §7.3）。
 * 合計（読まれた回数、記事数、前の期間との差）と、記事の表（公開日の新しい順）。
 * 複数の著者が混ざる一覧なので、並べ替えの UI は置かない（FR-24）。
 */
export function TagPageScreen({ data }: { data: TagPageData }) {
  const { period, prevId, prevLabel, setPeriod } = usePeriod(data.periods);
  const periodId = period?.id ?? null;
  const total = periodId === null ? undefined : data.period[periodId]?.[data.tag.id];
  const prevTotal = prevId === null ? undefined : data.period[prevId]?.[data.tag.id];

  // 公開日の新しい順（同じ日は ID の大きい順）。読まれた回数は、もとの添字で引く。
  const rows = useMemo<ArticleTableRow[]>(() => {
    const pageviews = periodId === null ? undefined : data.pvByPeriod[periodId];
    return data.posts
      .map((post, index) => ({ post, index }))
      .sort((left, right) => {
        if (left.post.publishedOn === right.post.publishedOn) return right.post.id - left.post.id;
        return left.post.publishedOn < right.post.publishedOn ? 1 : -1;
      })
      .map(({ post, index }) => {
        const value = pageviews?.[index];
        return value === undefined ? { post } : { post, pageviews: value };
      });
  }, [data.posts, data.pvByPeriod, periodId]);

  return (
    <>
      <h1>{t('s07b.h1', { name: data.tag.name })}</h1>
      <p className={styles.nav}>
        <Link href="/tags" prefetch={false} className={styles.link}>
          {t('s07b.back')}
        </Link>
      </p>
      {period === null ? null : (
        <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
      )}
      {total === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <Totals
          label={t('s07b.total')}
          items={[
            {
              label: metricLabel('M01'),
              value: t('s07.count', { n: formatNumber(total.pageviews) }),
            },
            {
              label: t('s07.column.postCount'),
              value: t('s07.posts', { n: formatNumber(total.postCount) }),
            },
            {
              label: prevLabel ?? t('s07.column.prev'),
              value: (
                <PrevDelta
                  current={total.pageviews}
                  previous={prevTotal?.pageviews}
                  absentText={t('s07.absent.prev')}
                />
              ),
            },
          ]}
        />
      )}
      <ArticleTable
        caption={t('s07b.table.caption', { name: data.tag.name })}
        rows={rows}
        columns={COLUMNS}
        columnLabels={{ pageviews: t('column.pageviews.period') }}
      />
    </>
  );
}
