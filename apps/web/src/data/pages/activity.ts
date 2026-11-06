/**
 * S-08 投稿活動（docs/design/04_api.md §3.7）。
 */
import type { ActivityData } from '@/lib/page-data';
import { activityDataSchema } from '@/lib/page-data-schema';
import type { PubCache } from '@/lib/pub-types';

import {
  authorPageSlug,
  buildCommon,
  byPeriod,
  compareJa,
  comparableIds,
  rowsOf,
  selectableIds,
} from './shared';
import { checkPage } from './check';

/** 月ごとの公開本数に出す月の数。 */
const ACTIVITY_MONTHS = 24;

/** 'YYYY-MM' → 通し番号（年 × 12 + 月 − 1）。 */
function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthOfIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * 月ごとの公開本数。基準日の月までの直近 24 か月で、行のない月は 0 本。
 * 最初の行より前の月は作らない。
 * 去年の同じ月の本数（yoyPostCount）は、24 か月の外（13〜24 か月前の月の去年）も同じ表から引く。
 * 最初の行より前の月なら null（「去年の同じ月の数字なし」）。
 */
function monthlyOf(cache: PubCache): ActivityData['monthly'] {
  const countByIndex = new Map(
    cache.postingMonthly.map((row) => [monthIndex(row.month), row.post_count]),
  );
  if (countByIndex.size === 0) return [];
  const last = monthIndex(cache.meta.base_date);
  const earliest = Math.min(...countByIndex.keys());
  const first = Math.max(earliest, last - ACTIVITY_MONTHS + 1);
  const countAt = (index: number): number | null =>
    index < earliest ? null : (countByIndex.get(index) ?? 0);

  const monthly: ActivityData['monthly'] = [];
  for (let index = first; index <= last; index += 1) {
    monthly.push({
      month: monthOfIndex(index),
      postCount: countByIndex.get(index) ?? 0,
      yoyPostCount: countAt(index - 12),
    });
  }
  return monthly;
}

export function buildActivity(cache: PubCache, builtAt: Date): ActivityData {
  const common = buildCommon(cache, builtAt);
  const comparable = comparableIds(common);
  const authorBySlug = new Map(cache.authors.map((author) => [author.author_slug, author]));
  const pathById = new Map(cache.categories.map((row) => [row.category_id, row.path]));

  const data: ActivityData = {
    ...common,
    monthly: monthlyOf(cache),
    posting: byPeriod(comparable, (id) => {
      const row = rowsOf(cache.postingPeriod, 'period_id', id)[0];
      return row === undefined ? undefined : { postCount: row.post_count };
    }),
    // 期間内に 1 本以上公開した著者だけを、名前の順で。数で並べ替えない。
    // 著者ページのない著者も行は残し、slug を null にする（リンクにしない）。
    authorCounts: byPeriod(selectableIds(common), (id) =>
      rowsOf(cache.authorPeriod, 'period_id', id)
        .flatMap((row) => {
          const author = authorBySlug.get(row.author_slug);
          return author === undefined || row.post_count < 1
            ? []
            : [{ author, postCount: row.post_count }];
        })
        // 同じ名前の順は、元の slug で決める（slug を null にする前に並べる）。
        .sort(
          (a, b) =>
            compareJa(a.author.display_name, b.author.display_name) ||
            (a.author.author_slug < b.author.author_slug ? -1 : 1),
        )
        .map(({ author, postCount }) => ({
          name: author.display_name,
          slug: authorPageSlug(cache, author.author_slug),
          postCount,
        })),
    ),
    categoryMix: byPeriod(comparable, (id) => {
      const rows = rowsOf(cache.categoryPeriod, 'period_id', id).filter(
        (row) => row.post_count_published > 0,
      );
      if (rows.length === 0) return undefined;
      return rows
        .map((row) => {
          const path = pathById.get(row.category_id);
          if (path === undefined) {
            throw new Error('pub_category_period に、pub_category にないカテゴリがあります');
          }
          return {
            categoryId: row.category_id,
            path,
            postCountPublished: row.post_count_published,
          };
        })
        .sort((a, b) => compareJa(a.path, b.path) || a.categoryId - b.categoryId);
    }),
  };
  return checkPage(activityDataSchema, data, 'activityDataSchema');
}
