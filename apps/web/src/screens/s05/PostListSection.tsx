'use client';

import { useMemo } from 'react';

import { ArticleTable, sortArticleRows } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';
import { BandDot } from '@/components/charts';
import { Notice } from '@/components/Notice';
import { formatDate } from '@/lib/format';
import type { AuthorPageData, SelectablePeriodId } from '@/lib/page-data';
import type { SortKey } from '@/lib/query';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type PostListSectionProps = {
  data: AuthorPageData;
  /** 選んだ期間。期間がなければ null（「読まれた回数（この期間）」は該当なし）。 */
  periodId: SelectablePeriodId | null;
  /** 並び（useQueryState().state.sort）。 */
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
};

/**
 * 列。著者の列（全員同じ）と、読まれていた時間の列は持たない（05 §6.2）。
 * カテゴリの名前は、posts の categoryIds を categoryPaths で引く。狭い画面では「詳しく」に入る。
 */
const COLUMNS: readonly ArticleColumnId[] = [
  'title',
  'publishedOn',
  'category',
  'pageviews',
  'pv7',
  'pv30',
  'band',
  'topChannel',
];

/** 狭い画面に残す 4 列（FR-32）。 */
const NARROW_COLUMNS: readonly ArticleColumnId[] = ['title', 'publishedOn', 'pageviews', 'pv30'];

/**
 * h2 記事の一覧（FR-32）。
 *
 * - 本人の記事同士なので、数の多い順に並べ替えられる（NFR-98。多い順だけ）。連番は付けない。
 * - 数え始める前に公開した記事は、最初の 1 週間 / 1 か月の値がない。その並びを選んだときは、
 *   末尾に回すのでなく、区切りの文を挟んだ別の表にまとめる（公開日の新しい順）。
 */
export function PostListSection({ data, periodId, sort, onSortChange }: PostListSectionProps) {
  const pageviews = periodId === null ? undefined : data.pvByPeriod[periodId];
  const topChannels = periodId === null ? undefined : data.topChannelByPeriod[periodId];
  // 行の配列は、期間が変わったときだけ作り直す（表が「さらに表示」の件数を保てるように）。
  const { rows, measured, preMeasure } = useMemo(() => {
    const pathById = new Map(data.categoryPaths.map((category) => [category.id, category.path]));
    const all = data.posts.map((post, index): ArticleTableRow => {
      const pv = pageviews?.[index];
      const channel = topChannels?.[index];
      const categories = post.categoryIds.flatMap((id) => {
        const path = pathById.get(id);
        return path === undefined ? [] : [path];
      });
      return {
        post,
        categories,
        ...(pv === undefined ? {} : { pageviews: pv }),
        // 'none'（訪問がない）は topChannel を渡さない。ArticleTable は undefined を「該当なし」と書く。
        // null（伏せ値）はそのまま渡し、「— 伏せ値」と書かせる。
        ...(channel === undefined || channel === 'none' ? {} : { topChannel: channel }),
      };
    });
    return {
      rows: all,
      measured: all.filter((row) => !row.post.isPreMeasure),
      // 区切りの下は、公開日の新しい順（並べ替えの対象にしない）。
      preMeasure: sortArticleRows(
        all.filter((row) => row.post.isPreMeasure),
        'published',
      ),
    };
  }, [data.posts, data.categoryPaths, pageviews, topChannels]);

  const { name } = data.author;
  const start = formatDate(data.meta.measureStart);
  // 最初の 1 週間 / 1 か月で並べるときだけ分ける。全部が数え始める前なら分けない（並びの UI を残す）。
  const isSplit =
    (sort === 'pv7' || sort === 'pv30') && preMeasure.length > 0 && measured.length > 0;

  const columnLabels = useMemo(() => ({ pageviews: t('column.pageviews.period') }), []);

  return (
    <section className={styles.section}>
      <h2>{t('s05.posts.h2')}</h2>
      {preMeasure.length === 0 ? null : <Notice>{t('list.preMeasure.note', { start })}</Notice>}
      <ArticleTable
        caption={t('s05.posts.caption', { name })}
        rows={isSplit ? measured : rows}
        columns={COLUMNS}
        narrowColumns={NARROW_COLUMNS}
        columnLabels={columnLabels}
        renderBand={(post) => <BandDot band={post.band30} />}
        sortable
        sort={sort}
        onSortChange={onSortChange}
      />
      {isSplit ? (
        <>
          <p className={styles.divider}>{t('list.preMeasure.divider', { start })}</p>
          <ArticleTable
            caption={t('s05.posts.caption.preMeasure', { name })}
            rows={preMeasure}
            columns={COLUMNS}
            narrowColumns={NARROW_COLUMNS}
            columnLabels={columnLabels}
          />
        </>
      ) : null}
    </section>
  );
}
