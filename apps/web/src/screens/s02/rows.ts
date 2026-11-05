/**
 * S-02（記事一覧の 5 画面）の行の組み立て（05 §4、04 §3.3）。どれも純粋な関数。
 *
 * 連番は作らない。並びは、公開日の新しい順か、読まれた回数の多い順だけ（NFR-36、NFR-98）。
 */
import { sortArticleRows } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';
import type { ArticleListData, PostRow, SelectablePeriodId } from '@/lib/page-data';

/** 最近よく読まれている記事（S-02d）に出す件数の上限（05 §4.4）。 */
export const RECENT_LIMIT = 10;

/** 数え始める前に公開した記事で「数え始める前」と書くセルを持つ列。 */
const EARLY_COLUMNS: readonly ArticleColumnId[] = ['pv7', 'pv30', 'band'];

/** 記事を探す（S-02e）の絞り込みの条件。どれも検証済みの値（parseQuery の結果）。 */
export type SearchFilter = {
  q: string | null;
  cat: number | null;
  author: string | null;
  ym: string | null;
};

/**
 * S-02a / S-02c: その期間に読まれた回数の多い順の、先頭 count 件。
 * 並びは topIndex の順のまま（番号は付けない）。
 */
export function topRows(
  data: ArticleListData,
  periodId: SelectablePeriodId,
  count: number,
): ArticleTableRow[] {
  const indexes = data.topIndex?.[periodId] ?? [];
  const pageviews = data.pvByPeriod?.[periodId];
  return indexes.slice(0, count).flatMap((index): ArticleTableRow[] => {
    const post = data.posts[index];
    if (post === undefined) return [];
    const value = pageviews?.[index];
    return [value === undefined ? { post } : { post, pageviews: value }];
  });
}

/** S-02b: start〜end（両端を含む）に公開された記事を、公開日の新しい順に。 */
export function publishedWithin(
  posts: readonly PostRow[],
  start: string,
  end: string,
): ArticleTableRow[] {
  const rows = posts
    .filter((post) => post.publishedOn >= start && post.publishedOn <= end)
    .map((post): ArticleTableRow => ({ post }));
  return sortArticleRows(rows, 'published');
}

/** S-02d: 直近 7 日に読まれた回数の多い順に、最大 10 件。同じ回数なら渡された順のまま。 */
export function recentRows(data: ArticleListData): ArticleTableRow[] {
  const last7 = data.pvByPeriod?.last7;
  const rows = data.posts.map((post, index): ArticleTableRow => {
    const value = last7?.[index];
    return value === undefined ? { post } : { post, recent7: value };
  });
  return rows.sort((a, b) => (b.recent7 ?? -1) - (a.recent7 ?? -1)).slice(0, RECENT_LIMIT);
}

/** 検索のために、大文字と小文字、全角と半角の違いをそろえる（05 §4.5）。 */
export function foldText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 選んだカテゴリと、その配下のカテゴリの ID。親を選ぶと、子に属する記事も含まれる。 */
export function categoryScope(
  categories: ArticleListData['categories'],
  categoryId: number,
): Set<number> {
  const scope = new Set([categoryId]);
  // 階層が深くても拾えるよう、増えなくなるまで繰り返す。
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId !== null && scope.has(category.parentId) && !scope.has(category.id)) {
        scope.add(category.id);
        grew = true;
      }
    }
  }
  return scope;
}

/** posts にある公開年月（'YYYY-MM'）。新しい順。絞り込みの選択肢と許可リストに使う。 */
export function publishedMonths(posts: readonly PostRow[]): string[] {
  return [...new Set(posts.map((post) => post.publishedOn.slice(0, 7)))].sort().reverse();
}

/**
 * S-02e: 条件に合う記事を、公開日の新しい順に。
 * 読まれた回数の多い順への並べ替えは、許されるときだけ ArticleTable が行う。
 */
export function searchRows(
  data: ArticleListData,
  periodId: SelectablePeriodId | null,
  filter: SearchFilter,
): ArticleTableRow[] {
  const pageviews = periodId === null ? undefined : data.pvByPeriod?.[periodId];
  const pathOf = new Map(data.categories.map((category) => [category.id, category.path]));
  const scope = filter.cat === null ? null : categoryScope(data.categories, filter.cat);
  const needle = filter.q === null ? null : foldText(filter.q);

  const rows = data.posts.flatMap((post, index): ArticleTableRow[] => {
    if (needle !== null && !foldText(post.title).includes(needle)) return [];
    if (scope !== null && !post.categoryIds.some((id) => scope.has(id))) return [];
    if (filter.author !== null && post.authorSlug !== filter.author) return [];
    if (filter.ym !== null && post.publishedOn.slice(0, 7) !== filter.ym) return [];
    const categories = post.categoryIds.flatMap((id) => {
      const path = pathOf.get(id);
      return path === undefined ? [] : [path];
    });
    const value = pageviews?.[index];
    return [value === undefined ? { post, categories } : { post, categories, pageviews: value }];
  });
  return sortArticleRows(rows, 'published');
}

/** 表に「数え始める前」と書かれるセルがあるか（その列があり、該当の記事の行がある）。 */
export function showsPreMeasure(
  rows: readonly ArticleTableRow[],
  columns: readonly ArticleColumnId[],
): boolean {
  return (
    columns.some((column) => EARLY_COLUMNS.includes(column)) &&
    rows.some((row) => row.post.isPreMeasure)
  );
}
