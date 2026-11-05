'use client';

import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';

import { safeExternalUrl } from '@/lib/derive';
import { formatDateShort, formatNumber } from '@/lib/format';
import type { Channel, Masked, PostRow } from '@/lib/page-data';
import type { SortKey } from '@/lib/query';
import { t } from '@/lib/ui-text';

import a11y from './a11y.module.css';
import styles from './ArticleTable.module.css';
import { cx } from './class-names';
import { Details } from './Details';
import { ExternalLink } from './ExternalLink';
import { MaskedCell, MaskedMark } from './MaskedCell';
import { Badge, StateMessage } from './Notice';
import { ArticleLink, AuthorLink } from './SiteLinks';

/** 選べる列。連番の列はない（NFR-36）。 */
export type ArticleColumnId =
  | 'title'
  | 'author'
  | 'publishedOn'
  | 'pageviews'
  | 'pv7'
  | 'pv30'
  | 'band'
  | 'category'
  | 'topChannel'
  | 'recent7';

/** タイトルに添える印。 */
export type ArticleBadgeKind = 'new' | 'recentHot' | 'revival';

/** 記事の行。authorSlug は、著者ページがない著者では null。 */
export type ArticleTablePost = Omit<PostRow, 'authorSlug'> & { authorSlug: string | null };

export type ArticleTableRow = {
  post: ArticleTablePost;
  /** 列 'pageviews': この期間に読まれた回数（pvByPeriod[期間][i]）。null は伏せ値。 */
  pageviews?: Masked;
  /** 列 'recent7': 直近 7 日に読まれた回数（pvByPeriod.last7[i]）。null は伏せ値。 */
  recent7?: Masked;
  /** 列 'topChannel': 流入の主な経路。null は全区分が伏せ値。 */
  topChannel?: Channel | null;
  /** 列 'category': カテゴリの名前（呼び出し側が categoryIds から引く）。 */
  categories?: readonly string[];
};

export type ArticleTableProps = {
  /** 表の名前（読み上げ用。画面には出さない）。 */
  caption: string;
  /** 行。sortable が false のときは、渡した順のまま描く。 */
  rows: readonly ArticleTableRow[];
  /** 描く列と、その順。 */
  columns: readonly ArticleColumnId[];
  /**
   * 狭い画面（幅 600px 未満）に残す列。4 つまで（5 つ目からは捨てる。NFR-99）。
   * 残りは行の末尾の「詳しく」に入る。省くと columns の先頭 4 つ。
   */
  narrowColumns?: readonly ArticleColumnId[];
  /** 列の見出しの差し替え（例: pageviews を「読まれた回数（この期間）」に）。 */
  columnLabels?: Partial<Record<ArticleColumnId, string>>;
  /** タイトルに添える印。既定は ['new']。S-02d は ['recentHot', 'revival']。 */
  badges?: readonly ArticleBadgeKind[];
  /**
   * 帯の図（BandDot）を差し込む描画関数。渡さなければ文言だけ。
   * 渡すと、広い画面では列 'band' にこの結果を描き（文言は図の側が持つ前提）、
   * 狭い画面では文言だけを残して、図を「詳しく」に入れる。
   * 数え始める前に公開した記事では呼ばない（「数え始める前」と書く）。
   */
  renderBand?: (post: ArticleTablePost) => ReactNode;
  /** 並べ替えの UI を描くか。false（既定）なら UI を描かず、sort も無視する（04 §8）。 */
  sortable?: boolean;
  /** 並び（useQueryState().state.sort）。多い順だけ。 */
  sort?: SortKey;
  /** 並びを選んだとき（update({ sort }) を渡す）。 */
  onSortChange?: (sort: SortKey) => void;
  /** 「さらに表示」で足す件数。既定は 50。 */
  pageSize?: number;
  /** 行がこの件数を超えるときだけ、pageSize 件ずつに分ける。既定は 100（05 §4.5）。 */
  pagingThreshold?: number;
  /** 行がないときの文言。省くと state.empty。 */
  emptyText?: string;
};

const COLUMN_LABELS = {
  title: 'column.post',
  author: 'column.author',
  publishedOn: 'column.publishedOn',
  pageviews: 'column.pageviews',
  pv7: 'column.pv7',
  pv30: 'column.pv30',
  band: 'column.band',
  category: 'column.category',
  topChannel: 'column.topChannel',
  recent7: 'column.recent7',
} as const satisfies Record<ArticleColumnId, string>;

/** 右寄せにする数の列。 */
const NUMERIC_COLUMNS: ReadonlySet<ArticleColumnId> = new Set([
  'pageviews',
  'pv7',
  'pv30',
  'recent7',
]);

/** 並びと、その並びに要る列。published は常に選べる。 */
const SORT_COLUMNS = [
  ['published', null],
  ['pv', 'pageviews'],
  ['pv7', 'pv7'],
  ['pv30', 'pv30'],
] as const satisfies readonly (readonly [SortKey, ArticleColumnId | null])[];

const NARROW_COLUMN_LIMIT = 4;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_PAGING_THRESHOLD = 100;
const DEFAULT_BADGES: readonly ArticleBadgeKind[] = ['new'];

function byPublishedDesc(left: ArticleTableRow, right: ArticleTableRow): number {
  if (left.post.publishedOn === right.post.publishedOn) return 0;
  return left.post.publishedOn < right.post.publishedOn ? 1 : -1;
}

function sortValue(row: ArticleTableRow, sort: Exclude<SortKey, 'published'>): number | null {
  if (sort === 'pv') return row.pageviews ?? null;
  return sort === 'pv7' ? row.post.pv7 : row.post.pv30;
}

/**
 * 行を並べ替える（NFR-98）。公開日の新しい順か、数の多い順だけ。
 * 値のない行（まだ日数がたっていない、数え始める前、伏せ値）は後ろに回す。
 */
export function sortArticleRows<Row extends ArticleTableRow>(
  rows: readonly Row[],
  sort: SortKey,
): Row[] {
  const sorted = [...rows];
  if (sort === 'published') return sorted.sort(byPublishedDesc);
  return sorted.sort((left, right) => {
    const a = sortValue(left, sort);
    const b = sortValue(right, sort);
    if (a === null || b === null) {
      if (a === b) return byPublishedDesc(left, right);
      return a === null ? 1 : -1;
    }
    return b - a || byPublishedDesc(left, right);
  });
}

/** 最初の 1 週間 / 1 か月の値。ないときは、理由を文字で書く（「—」にしない。05 §2.3）。 */
function earlyCount(post: ArticleTablePost, value: number | null): ReactNode {
  if (value !== null) return formatNumber(value);
  if (post.isPreMeasure) return t('absent.preMeasure');
  return t('absent.dayN.count', {
    n: formatNumber(post.ageDays),
    count: formatNumber(post.pvTotal),
  });
}

function bandText(post: ArticleTablePost): string {
  if (post.band30 !== null) return t(`band.${post.band30}`);
  return post.isPreMeasure ? t('absent.preMeasure') : t('absent.band');
}

function badgeLabels(post: ArticleTablePost, kinds: readonly ArticleBadgeKind[]): string[] {
  const labels: string[] = [];
  if (kinds.includes('new') && post.freshness === 'new') labels.push(t('badge.new'));
  if (kinds.includes('revival') && post.isRevival) labels.push(t('badge.revival'));
  else if (kinds.includes('recentHot') && post.isRecentHot) labels.push(t('badge.recentHot'));
  return labels;
}

/**
 * 記事の表（05 §4 の 5 画面、S-05、S-07b。U-24）。
 *
 * - 連番を描かない。並べ替えの UI は sortable のときだけで、多い順だけ。
 * - 狭い画面では narrowColumns の 4 列までを残し、残りを行の末尾の「詳しく」に入れる。
 *   タイトルは幅いっぱいの 1 段目に置き、残りの列をその下に並べる（題名を読めるようにするため）。
 *   切り替えは CSS だけで行う（静的な HTML と描画後の HTML が同じになる）。
 * - 関数の props を受けるので、Client Component から使う。
 */
export function ArticleTable({
  caption,
  rows,
  columns,
  narrowColumns,
  columnLabels,
  badges = DEFAULT_BADGES,
  renderBand,
  sortable = false,
  sort = 'published',
  onSortChange,
  pageSize = DEFAULT_PAGE_SIZE,
  pagingThreshold = DEFAULT_PAGING_THRESHOLD,
  emptyText,
}: ArticleTableProps) {
  const sortOptions = SORT_COLUMNS.filter(
    ([, column]) => column === null || columns.includes(column),
  ).map(([key]) => key);
  const activeSort: SortKey = sortable && sortOptions.includes(sort) ? sort : 'published';

  // 行か並びが変わったら、「さらに表示」で足した分を戻す。
  const [shown, setShown] = useState({ rows, sort: activeSort, count: pageSize });
  const isSameList = shown.rows === rows && shown.sort === activeSort;
  if (!isSameList) setShown({ rows, sort: activeSort, count: pageSize });

  if (rows.length === 0) return <StateMessage kind="empty">{emptyText}</StateMessage>;

  const ordered = sortable ? sortArticleRows(rows, activeSort) : rows;
  const isPaged = ordered.length > pagingThreshold;
  const visibleCount = isPaged
    ? Math.min(isSameList ? shown.count : pageSize, ordered.length)
    : ordered.length;
  const visibleRows = ordered.slice(0, visibleCount);

  const kept = (narrowColumns ?? columns)
    .filter((column) => columns.includes(column))
    .slice(0, NARROW_COLUMN_LIMIT);
  const folded = columns.filter((column) => !kept.includes(column));
  const label = (column: ArticleColumnId): string =>
    columnLabels?.[column] ?? t(COLUMN_LABELS[column]);

  const bandFigure = (post: ArticleTablePost): ReactNode =>
    renderBand === undefined || post.isPreMeasure ? null : renderBand(post);

  const cell = (column: ArticleColumnId, row: ArticleTableRow, inDetail: boolean): ReactNode => {
    const { post } = row;
    switch (column) {
      case 'title': {
        const names = badgeLabels(post, badges);
        return (
          <span className={styles.titleBox}>
            <ArticleLink postId={post.id} className={styles.titleLink}>
              {post.title}
            </ArticleLink>
            {safeExternalUrl(post.url) === null ? null : (
              <ExternalLink
                href={post.url}
                className={styles.external}
                ariaLabel={t('link.external.article', { title: post.title })}
              >
                {t('link.external.mark')}
              </ExternalLink>
            )}
            {names.length === 0 ? null : (
              <span className={styles.badges}>
                {names.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </span>
            )}
          </span>
        );
      }
      case 'author':
        return (
          <AuthorLink slug={post.authorSlug} className={styles.link}>
            {post.authorName}
          </AuthorLink>
        );
      case 'publishedOn':
        // 狭い画面で 2 行に折れないよう、短い形（2026/10/20）で出す。
        return <time dateTime={post.publishedOn}>{formatDateShort(post.publishedOn)}</time>;
      case 'pageviews':
        return row.pageviews === undefined ? t('absent.na') : <MaskedCell value={row.pageviews} />;
      case 'recent7':
        return row.recent7 === undefined ? t('absent.na') : <MaskedCell value={row.recent7} />;
      case 'pv7':
        return earlyCount(post, post.pv7);
      case 'pv30':
        return earlyCount(post, post.pv30);
      case 'band': {
        const figure = bandFigure(post);
        if (figure === null) return bandText(post);
        if (inDetail) return figure;
        return (
          <>
            <span className={styles.narrowOnly}>{bandText(post)}</span>
            <span className={styles.wideOnly}>{figure}</span>
          </>
        );
      }
      case 'category':
        return row.categories === undefined || row.categories.length === 0
          ? t('absent.na')
          : row.categories.join(t('list.separator'));
      case 'topChannel':
        if (row.topChannel === undefined) return t('absent.na');
        return row.topChannel === null ? <MaskedMark /> : t(`channel.${row.topChannel}`);
    }
  };

  const cellClass = (column: ArticleColumnId): string | undefined =>
    cx(
      NUMERIC_COLUMNS.has(column) && styles.numeric,
      column === 'publishedOn' && styles.compact,
      column === 'title' && styles.title,
      column === 'author' && styles.author,
      column === 'band' && styles.band,
      !kept.includes(column) && styles.wideOnly,
    );

  return (
    <div className={styles.wrap}>
      {sortable && sortOptions.length > 1 ? (
        <div className={styles.sort} role="group" aria-label={t('sort.label')}>
          <span className={styles.sortLabel} aria-hidden="true">
            {t('sort.label')}
          </span>
          {sortOptions.map((key) => (
            <button
              key={key}
              type="button"
              className={styles.button}
              aria-pressed={key === activeSort}
              onClick={() => onSortChange?.(key)}
            >
              {t(`sort.${key}`)}
            </button>
          ))}
        </div>
      ) : null}
      {/* 狭い画面では CSS で行を組み替える（display を変える）ので、表の役割を role でも明示する。 */}
      <table role="table" className={styles.table}>
        <caption className={a11y.srOnly}>{caption}</caption>
        <thead role="rowgroup">
          <tr role="row" className={styles.headRow}>
            {columns.map((column) => (
              <th
                key={column}
                role="columnheader"
                scope="col"
                className={cx(styles.head, cellClass(column))}
              >
                {label(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {visibleRows.map((row) => {
            // 狭い画面で帯の列を残すときは、図を「詳しく」に入れる。
            const foldedFigure = kept.includes('band') ? bandFigure(row.post) : null;
            const hasMore = folded.length > 0 || foldedFigure !== null;
            return (
              <Fragment key={row.post.id}>
                <tr role="row" className={cx(styles.row, hasMore && styles.hasMore)}>
                  {columns.map((column) =>
                    column === 'title' ? (
                      <th
                        key={column}
                        role="rowheader"
                        scope="row"
                        className={cx(styles.cell, cellClass(column))}
                      >
                        {cell(column, row, false)}
                      </th>
                    ) : (
                      <td key={column} role="cell" className={cx(styles.cell, cellClass(column))}>
                        {cell(column, row, false)}
                      </td>
                    ),
                  )}
                </tr>
                {hasMore ? (
                  <tr role="row" className={cx(styles.moreRow, styles.narrowOnly)}>
                    <td role="cell" colSpan={kept.length} className={styles.moreCell}>
                      <Details
                        summary={
                          <>
                            {t('column.more')}
                            <span className={a11y.srOnly}>{row.post.title}</span>
                          </>
                        }
                      >
                        <dl className={styles.detailList}>
                          {folded.map((column) => (
                            <Fragment key={column}>
                              <dt>{label(column)}</dt>
                              <dd>{cell(column, row, true)}</dd>
                            </Fragment>
                          ))}
                          {foldedFigure === null ? null : (
                            <>
                              <dt>{label('band')}</dt>
                              <dd>{foldedFigure}</dd>
                            </>
                          )}
                        </dl>
                      </Details>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {visibleCount < ordered.length ? (
        <div className={styles.more}>
          <p className={styles.shown}>
            {t('table.shown', {
              total: formatNumber(ordered.length),
              shown: formatNumber(visibleCount),
            })}
          </p>
          <button
            type="button"
            className={styles.button}
            onClick={() => setShown({ rows, sort: activeSort, count: visibleCount + pageSize })}
          >
            {t('table.more')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
