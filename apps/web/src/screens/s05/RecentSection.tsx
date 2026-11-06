'use client';

import { useMemo } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';
import { Notice } from '@/components/Notice';
import type { AuthorPageData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type RecentSectionProps = { data: AuthorPageData };

/** 各 5 件まで（05 §6.2）。 */
const LIST_LIMIT = 5;
const COLUMNS: readonly ArticleColumnId[] = ['title', 'publishedOn', 'recent7'];
const NO_BADGES = [] as const;

/** 直近 7 日の読まれた回数の多い順。同じなら公開日の新しい順。値がなければ公開日の新しい順。 */
function byRecent7(left: ArticleTableRow, right: ArticleTableRow): number {
  const diff = (right.recent7 ?? 0) - (left.recent7 ?? 0);
  if (diff !== 0) return diff;
  if (left.post.publishedOn === right.post.publishedOn) return 0;
  return left.post.publishedOn < right.post.publishedOn ? 1 : -1;
}

/**
 * h2 最近よく読まれている記事 / 久しぶりに読まれた記事（FR-34。M-22）。
 * 期間の選択に依らず、直近 7 日の値で出す。本人の記事だけで、連番は付けない。
 */
export function RecentSection({ data }: RecentSectionProps) {
  const recent7 = data.pvByPeriod.last7;
  const { hot, revival } = useMemo(() => {
    const rows = data.posts.map((post, index): ArticleTableRow => {
      const value = recent7?.[index];
      return value === undefined ? { post } : { post, recent7: value };
    });
    const pick = (rule: (row: ArticleTableRow) => boolean): ArticleTableRow[] =>
      rows.filter(rule).sort(byRecent7).slice(0, LIST_LIMIT);
    return {
      // 両方の印が付いた記事は「久しぶりに読まれた」にだけ出す（同じ記事を 2 つの一覧に出さない）。
      hot: pick((row) => row.post.isRecentHot && !row.post.isRevival),
      revival: pick((row) => row.post.isRevival),
    };
  }, [data.posts, recent7]);
  const { name } = data.author;
  const lists = [
    {
      key: 'hot',
      h3: t('s05.recent.hot.h3'),
      caption: t('s05.recent.caption.hot', { name }),
      rows: hot,
    },
    {
      key: 'revival',
      h3: t('s05.recent.revival.h3'),
      caption: t('s05.recent.caption.revival', { name }),
      rows: revival,
    },
  ].filter((list) => list.rows.length > 0);

  return (
    <section className={styles.section}>
      <h2>{t('s05.recent.h2')}</h2>
      {/* 両方ないときは h3 と枠を出さず 1 文だけ。片方だけなら、ある方だけ（助言 A-1）。 */}
      {lists.length === 0 ? (
        <p>{t('s05.recent.empty')}</p>
      ) : (
        <>
          <div className={styles.pair}>
            {lists.map((list) => (
              <div key={list.key}>
                <h3>{list.h3}</h3>
                <ArticleTable
                  caption={list.caption}
                  rows={list.rows}
                  columns={COLUMNS}
                  badges={NO_BADGES}
                />
              </div>
            ))}
          </div>
          <Notice>{t('metric.M22.note')}</Notice>
        </>
      )}
    </section>
  );
}
