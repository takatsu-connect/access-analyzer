/**
 * S-04 著者一覧と S-05 著者ページ（docs/design/04_api.md §3.5）。
 *
 * 著者ページに入れるのは、その著者の値と、サイト全体の構成（比較の相手）だけ。ほかの著者の値は入れない。
 */
import { AUTHOR_AXES, CHANNEL_BUCKETS, SNS_BUCKETS } from '@/lib/config';
import { topChannel } from '@/lib/derive';
import type { AuthorBreakdown, AuthorIndexData, AuthorPageData, Masked } from '@/lib/page-data';
import { authorIndexDataSchema, authorPageDataSchema } from '@/lib/page-data-schema';
import type { PubCache, PubPost } from '@/lib/pub-types';

import {
  benchmark30,
  bucketRecord,
  buildCommon,
  byPeriod,
  compareJa,
  comparableIds,
  pageAuthors,
  pvByPeriodOf,
  rowsOf,
  selectableIds,
  SLUG_PATTERN,
  sortedPosts,
  toPostRow,
} from './shared';

type AxisRow = { axis: string; bucket: string; value: Masked };

/** generateStaticParams 用。著者ページを作るのは、slug が決まった形の著者だけ。 */
export function listAuthorSlugs(cache: PubCache): string[] {
  return pageAuthors(cache)
    .map((author) => author.author_slug)
    .sort();
}

export function buildAuthorIndex(cache: PubCache, builtAt: Date): AuthorIndexData {
  const data: AuthorIndexData = {
    ...buildCommon(cache, builtAt),
    authors: pageAuthors(cache).map((author) => ({
      slug: author.author_slug,
      name: author.display_name,
      url: author.author_url,
    })),
  };
  return authorIndexDataSchema.parse(data);
}

/** 流入チャネルと SNS の内訳。どちらの軸にも行がなければ undefined。 */
function channelAndSnsOf(rows: readonly AxisRow[]): AuthorBreakdown | undefined {
  const axes: readonly string[] = AUTHOR_AXES;
  const used = rows.filter((row) => axes.includes(row.axis));
  if (used.length === 0) return undefined;
  return {
    channel: bucketRecord(
      CHANNEL_BUCKETS,
      used.filter((row) => row.axis === 'channel'),
    ),
    sns: bucketRecord(
      SNS_BUCKETS,
      used.filter((row) => row.axis === 'sns'),
    ),
  };
}

/** 著者の記事に付いたカテゴリの ID とパス（ID の順）。記事の一覧のカテゴリの列で引く。 */
function categoryPathsOf(
  cache: PubCache,
  posts: readonly PubPost[],
  pathById: ReadonlyMap<number, string>,
): { id: number; path: string }[] {
  const ids = new Set<number>();
  for (const post of posts) {
    for (const row of rowsOf(cache.postCategories, 'post_id', post.post_id))
      ids.add(row.category_id);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const path = pathById.get(id);
      if (path === undefined)
        throw new Error('pub_post_category に、pub_category にないカテゴリがあります');
      return { id, path };
    });
}

/** 著者ページ。公開ビューにない slug は null（404）。 */
export function buildAuthorPage(
  cache: PubCache,
  slug: string,
  builtAt: Date,
): AuthorPageData | null {
  if (!SLUG_PATTERN.test(slug)) return null;
  const author = cache.authors.find((row) => row.author_slug === slug);
  if (author === undefined) return null;

  const common = buildCommon(cache, builtAt);
  const selectable = selectableIds(common);
  const comparable = comparableIds(common);

  const posts = sortedPosts(cache).filter((post) => post.author_slug === slug);
  const periodRows = rowsOf(cache.authorPeriod, 'author_slug', slug);
  const breakdownRows = rowsOf(cache.authorPeriodBreakdown, 'author_slug', slug);
  const categoryRows = rowsOf(cache.authorCategoryPeriod, 'author_slug', slug);
  const pathById = new Map(cache.categories.map((row) => [row.category_id, row.path]));
  const summary = rowsOf(cache.authorSummary, 'author_slug', slug)[0];

  const data: AuthorPageData = {
    ...common,
    author: { slug: author.author_slug, name: author.display_name, url: author.author_url },
    period: byPeriod(comparable, (id) => {
      const row = periodRows.find((periodRow) => periodRow.period_id === id);
      return row === undefined
        ? undefined
        : {
            postCount: row.post_count,
            pageviews: row.pageviews,
            longPostCount: row.long_post_count,
            longPageviews: row.long_pageviews,
          };
    }),
    breakdown: byPeriod(comparable, (id) =>
      channelAndSnsOf(
        breakdownRows
          .filter((row) => row.period_id === id)
          .map((row) => ({ axis: row.axis, bucket: row.bucket, value: row.sessions })),
      ),
    ),
    // 比較の相手は、サイト全体の構成。
    siteBreakdown: byPeriod(comparable, (id) =>
      channelAndSnsOf(rowsOf(cache.sitePeriodBreakdown, 'period_id', id)),
    ),
    categoryMix: byPeriod(comparable, (id) => {
      const rows = categoryRows.filter((row) => row.period_id === id);
      if (rows.length === 0) return undefined;
      return rows
        .map((row) => {
          const path = pathById.get(row.category_id);
          if (path === undefined) {
            throw new Error('pub_author_category_period に、pub_category にないカテゴリがあります');
          }
          return {
            categoryId: row.category_id,
            path,
            postCount: row.post_count,
            pageviews: row.pageviews,
          };
        })
        .sort((a, b) => compareJa(a.path, b.path) || a.categoryId - b.categoryId);
    }),
    summary: {
      ownMedian30d: summary?.own_median_30d ?? null,
      eligibleCount: summary?.eligible_count ?? 0,
      band30: summary?.band_30d ?? null,
    },
    // 記事の一覧のカテゴリの列のために categoryIds を持たせる。タグは使わないので空にする（JSON を増やさない）。
    posts: posts.map((post) => ({ ...toPostRow(cache, post, true), tagIds: [] })),
    // 記事の一覧のカテゴリの列で引く、カテゴリの ID → パス。著者の記事に付いたカテゴリだけ。
    categoryPaths: categoryPathsOf(cache, posts, pathById),
    pvByPeriod: pvByPeriodOf(cache, posts, selectable),
    // 流入の主な経路。記事にその期間の行がなければ、訪問がないので 'none'（該当なし。伏せ値ではない）。
    topChannelByPeriod: byPeriod(selectable, (id) =>
      posts.map((post) => {
        const rows = rowsOf(cache.articlePeriodBreakdown, 'post_id', post.post_id).filter(
          (row) => row.period_id === id && row.axis === 'channel',
        );
        if (rows.length === 0) return 'none';
        return topChannel(
          bucketRecord(
            CHANNEL_BUCKETS,
            rows.map((row) => ({ bucket: row.bucket, value: row.sessions })),
          ),
        );
      }),
    ),
    milestones: posts
      .flatMap((post) => rowsOf(cache.articleMilestone, 'post_id', post.post_id))
      .map((row) => ({ postId: row.post_id, milestone: row.milestone, reachedOn: row.reached_on }))
      .sort(
        (a, b) =>
          (a.reachedOn < b.reachedOn ? -1 : a.reachedOn > b.reachedOn ? 1 : 0) ||
          a.postId - b.postId ||
          a.milestone - b.milestone,
      ),
    benchmark: benchmark30(cache),
  };
  return authorPageDataSchema.parse(data);
}
