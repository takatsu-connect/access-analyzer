/**
 * S-06 カテゴリ、S-06b 季節、S-07 タグ（docs/design/04_api.md §3.6）。
 */
import { AD_CATEGORY_ID } from '@/lib/config';
import type {
  CategoryAxis,
  CategoryData,
  CategoryPeriodValue,
  MonthId,
  SeasonalData,
  TagIndexData,
  TagPageData,
  TagPeriodValue,
} from '@/lib/page-data';
import {
  categoryDataSchema,
  seasonalDataSchema,
  tagIndexDataSchema,
  tagPageDataSchema,
} from '@/lib/page-data-schema';
import type { PubCache, PubCategory, PubPost } from '@/lib/pub-types';

import {
  buildCommon,
  byPeriod,
  compareJa,
  comparableIds,
  isMonthId,
  pvByPeriodOf,
  rowsOf,
  selectableIds,
  sortedPosts,
  toPostRow,
} from './shared';
import { checkPage } from './check';

/** 季節の画面に出す月の数。 */
const SEASONAL_MONTHS = 24;

// --- カテゴリ ---

/**
 * カテゴリの軸（いちばん上の親と、その配下）。親は category_id の昇順で、広告の軸を最後に置く。
 *
 * 広告の軸は、category_id が設定値（AD_CATEGORY_ID）の親カテゴリ。記事の中身からは推定しない。
 * その親カテゴリがなければ、広告の軸はない（すべて category_id の昇順）。
 */
export function categoryAxes(cache: PubCache): CategoryAxis[] {
  const byId = new Map(cache.categories.map((category) => [category.category_id, category]));
  const rootOf = (category: PubCategory): number => {
    let current = category;
    const seen = new Set<number>();
    while (current.parent_id !== null && !seen.has(current.category_id)) {
      seen.add(current.category_id);
      const parent = byId.get(current.parent_id);
      if (parent === undefined) break;
      current = parent;
    }
    return current.category_id;
  };

  // rootIds に入るのは親カテゴリだけなので、AD_CATEGORY_ID が子カテゴリの ID なら、どの軸も広告の軸にならない。
  const isAdAxis = (rootId: number): boolean => rootId === AD_CATEGORY_ID;

  const rootIds = [...new Set(cache.categories.map(rootOf))].sort(
    (a, b) => Number(isAdAxis(a)) - Number(isAdAxis(b)) || a - b,
  );
  return rootIds.flatMap((rootId) => {
    const parent = byId.get(rootId);
    if (parent === undefined) return [];
    return [
      {
        parent: { id: parent.category_id, name: parent.name },
        children: cache.categories
          .filter((category) => category.category_id !== rootId && rootOf(category) === rootId)
          .sort((a, b) => compareJa(a.path, b.path) || a.category_id - b.category_id)
          .map((category) => ({ id: category.category_id, name: category.name })),
      },
    ];
  });
}

export function buildCategories(cache: PubCache, builtAt: Date): CategoryData {
  const common = buildCommon(cache, builtAt);
  const data: CategoryData = {
    ...common,
    axes: categoryAxes(cache),
    period: byPeriod(comparableIds(common), (id) => {
      const rows = rowsOf(cache.categoryPeriod, 'period_id', id);
      if (rows.length === 0) return undefined;
      const table: Record<number, CategoryPeriodValue> = {};
      for (const row of rows) {
        table[row.category_id] = {
          pageviews: row.pageviews,
          postCountTotal: row.post_count_total,
          postCountPublished: row.post_count_published,
          median30: row.median_30d_pv,
          median30Count: row.published_post_count_30d,
        };
      }
      return table;
    }),
  };
  return checkPage(categoryDataSchema, data, 'categoryDataSchema');
}

export function buildSeasonal(cache: PubCache, builtAt: Date): SeasonalData {
  const common = buildCommon(cache, builtAt);
  // 直近 24 か月（ある月だけ）。古い順。
  const months: MonthId[] = selectableIds(common)
    .filter((id) => isMonthId(id))
    .sort()
    .slice(-SEASONAL_MONTHS);
  const monthSet = new Set<string>(months);
  // 13〜24 か月前の月の「去年の同じ月」。24 か月の外でも、数字があれば比較の相手として持つ。
  const presentMonths = new Set<string>(cache.categoryPeriod.map((row) => row.period_id));
  const yoyMonths: MonthId[] = months
    .map((month): MonthId => `m${Number(month.slice(1, 5)) - 1}-${month.slice(-2)}`)
    .filter((month) => !monthSet.has(month) && presentMonths.has(month))
    .sort();
  const wanted = new Set<string>([...months, ...yoyMonths]);

  const pvByMonth: SeasonalData['pvByMonth'] = {};
  for (const row of cache.categoryPeriod) {
    if (!wanted.has(row.period_id) || !isMonthId(row.period_id)) continue;
    const byMonth = pvByMonth[row.category_id] ?? {};
    byMonth[row.period_id] = row.pageviews;
    pvByMonth[row.category_id] = byMonth;
  }

  const data: SeasonalData = {
    ...common,
    axes: categoryAxes(cache),
    months,
    yoyMonths,
    pvByMonth,
  };
  return checkPage(seasonalDataSchema, data, 'seasonalDataSchema');
}

// --- タグ ---

/** タグ → そのタグの付いた公開記事（post_id の昇順）。 */
function postsByTag(cache: PubCache): Map<number, PubPost[]> {
  const postById = new Map(sortedPosts(cache).map((post) => [post.post_id, post]));
  const table = new Map<number, PubPost[]>();
  for (const link of [...cache.postTags].sort((a, b) => a.post_id - b.post_id)) {
    const post = postById.get(link.post_id);
    if (post === undefined) continue;
    const list = table.get(link.tag_id);
    if (list === undefined) table.set(link.tag_id, [post]);
    else list.push(post);
  }
  return table;
}

/** generateStaticParams 用。記事が 0 本のタグは作らない。 */
export function listTagIds(cache: PubCache): number[] {
  const withPosts = postsByTag(cache);
  return cache.tags
    .map((tag) => tag.tag_id)
    .filter((tagId) => withPosts.has(tagId))
    .sort((a, b) => a - b);
}

function tagValue(row: { pageviews: number; post_count: number }): TagPeriodValue {
  return { pageviews: row.pageviews, postCount: row.post_count };
}

export function buildTagIndex(cache: PubCache, builtAt: Date): TagIndexData {
  const common = buildCommon(cache, builtAt);
  const live = new Set(listTagIds(cache));
  const data: TagIndexData = {
    ...common,
    tags: cache.tags
      .filter((tag) => live.has(tag.tag_id))
      .sort((a, b) => compareJa(a.name, b.name) || a.tag_id - b.tag_id)
      .map((tag) => ({ id: tag.tag_id, name: tag.name })),
    period: byPeriod(comparableIds(common), (id) => {
      const rows = rowsOf(cache.tagPeriod, 'period_id', id).filter(
        (row) => row.post_count > 0 && live.has(row.tag_id),
      );
      if (rows.length === 0) return undefined;
      const table: Record<number, TagPeriodValue> = {};
      for (const row of rows) table[row.tag_id] = tagValue(row);
      return table;
    }),
  };
  return checkPage(tagIndexDataSchema, data, 'tagIndexDataSchema');
}

/** タグのページ。公開ビューにないタグと、記事が 0 本のタグは null（ページを作らない）。 */
export function buildTagPage(cache: PubCache, tagId: number, builtAt: Date): TagPageData | null {
  if (!Number.isSafeInteger(tagId)) return null;
  const tag = cache.tags.find((row) => row.tag_id === tagId);
  const posts = postsByTag(cache).get(tagId);
  if (tag === undefined || posts === undefined || posts.length === 0) return null;

  const common = buildCommon(cache, builtAt);
  const periodRows = rowsOf(cache.tagPeriod, 'tag_id', tagId);
  const data: TagPageData = {
    ...common,
    tag: { id: tag.tag_id, name: tag.name },
    posts: posts.map((post) => toPostRow(cache, post, false)),
    pvByPeriod: pvByPeriodOf(cache, posts, selectableIds(common)),
    // このタグの行だけを持つ。
    period: byPeriod(comparableIds(common), (id) => {
      const row = periodRows.find((periodRow) => periodRow.period_id === id);
      return row === undefined || row.post_count === 0 ? undefined : { [tagId]: tagValue(row) };
    }),
  };
  return checkPage(tagPageDataSchema, data, 'tagPageDataSchema');
}
