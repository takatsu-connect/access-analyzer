/**
 * 組み立て層の共通部分（docs/design/04_api.md §3.1、§4）。
 *
 * ここの関数はどれも、引数だけから結果が決まる（Supabase を読まない。時刻は引数で受ける）。
 */
import { MAX_MONTHS, MEASURE_START } from '@/lib/config';
import { formatPeriodLabel } from '@/lib/format';
import type {
  BenchmarkPoint,
  ByPeriod,
  Masked,
  MonthId,
  PageCommon,
  Period,
  PeriodId,
  PostRow,
  PrevWindowId,
  SelectablePeriodId,
  WindowId,
} from '@/lib/page-data';
import type { PubAuthor, PubBenchmarkCurve, PubCache, PubPost } from '@/lib/pub-types';

// --- 期間 ID ---

const WINDOW_IDS = ['last7', 'last28', 'last90'] as const satisfies readonly WindowId[];
const PREV_OF: Record<WindowId, PrevWindowId> = {
  last7: 'prev7',
  last28: 'prev28',
  last90: 'prev90',
};
const MONTH_ID_PATTERN = /^m(\d{4})-(0[1-9]|1[0-2])$/;

/** 著者ページを作る slug の形（06 §7）。 */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isMonthId(id: string): id is MonthId {
  return MONTH_ID_PATTERN.test(id);
}

/** 月の ID を delta か月ずらす（'m2026-01' の 1 つ前は 'm2025-12'）。 */
export function shiftMonth(id: MonthId, delta: number): MonthId {
  const match = MONTH_ID_PATTERN.exec(id);
  const index = Number(match?.[1]) * 12 + (Number(match?.[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = String((index % 12) + 1).padStart(2, '0');
  return `m${year}-${month}`;
}

// --- 日付と時刻 ---

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

function toUtcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** from から to までの日数（同じ日なら 0）。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 時刻を JST の文字列（'YYYY-MM-DDTHH:mm:ss+09:00'）にする。 */
export function toJstTimestamp(date: Date): string {
  return `${new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

/** firstDay から lastDay まで、1 日 1 要素の配列を作る。行のない日は 0。 */
export function dailySeries(
  firstDay: string,
  lastDay: string,
  rows: readonly { day: string; value: number }[],
): number[] {
  const length = Math.max(0, daysBetween(firstDay, lastDay) + 1);
  const series = new Array<number>(length).fill(0);
  for (const row of rows) {
    const index = daysBetween(firstDay, row.day);
    if (index >= 0 && index < length) series[index] = row.value;
  }
  return series;
}

/** 名前の順（日本語の照合順）。 */
export function compareJa(a: string, b: string): number {
  return a.localeCompare(b, 'ja');
}

// --- 行のグループ化 ---

const groupMemo = new WeakMap<readonly unknown[], Map<PropertyKey, Map<unknown, unknown[]>>>();

/** 行を 1 つの列の値でまとめる。同じ配列と列の組は 1 回だけ計算する。 */
export function groupRows<Row, Key extends keyof Row>(
  rows: readonly Row[],
  column: Key,
): Map<Row[Key], Row[]> {
  let byColumn = groupMemo.get(rows);
  if (byColumn === undefined) {
    byColumn = new Map();
    groupMemo.set(rows, byColumn);
  }
  let groups = byColumn.get(column);
  if (groups === undefined) {
    groups = new Map();
    for (const row of rows) {
      const key = row[column];
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [row]);
      else list.push(row);
    }
    byColumn.set(column, groups);
  }
  return groups as Map<Row[Key], Row[]>;
}

/** 列の値が value の行。 */
export function rowsOf<Row, Key extends keyof Row>(
  rows: readonly Row[],
  column: Key,
  value: Row[Key],
): readonly Row[] {
  return groupRows(rows, column).get(value) ?? [];
}

// --- 著者ページ ---

/**
 * 著者ページのある著者か。ページを作るのは、pub_author にあり、slug が決まった形の著者だけ
 * （listAuthorSlugs と同じ条件）。
 */
export function hasAuthorPage(cache: PubCache, slug: string): boolean {
  return SLUG_PATTERN.test(slug) && rowsOf(cache.authors, 'author_slug', slug).length > 0;
}

/** 著者ページへのリンクに使う slug。著者ページのない著者は null（リンクにしない）。 */
export function authorPageSlug(cache: PubCache, slug: string): string | null {
  return hasAuthorPage(cache, slug) ? slug : null;
}

/** 著者ページのある著者。名前の順（同じ名前は slug の順）。 */
export function pageAuthors(cache: PubCache): PubAuthor[] {
  return cache.authors
    .filter((author) => hasAuthorPage(cache, author.author_slug))
    .sort(
      (a, b) =>
        compareJa(a.display_name, b.display_name) || (a.author_slug < b.author_slug ? -1 : 1),
    );
}

// --- 区分ごとの値 ---

/**
 * 区分 → 値の表を作る。行のない区分は 0。null は伏せ値のまま残す。
 * 定義にない区分の行があれば、黙って捨てずに失敗させる（構成比が合わなくなるため）。
 */
export function bucketRecord<Bucket extends string>(
  buckets: readonly Bucket[],
  rows: readonly { bucket: string; value: Masked }[],
): Record<Bucket, Masked> {
  const record = new Map<string, Masked>(buckets.map((bucket) => [bucket, 0]));
  for (const row of rows) {
    if (!record.has(row.bucket)) throw new Error('公開ビューに、定義にない区分の行があります');
    record.set(row.bucket, row.value);
  }
  return Object.fromEntries(record) as Record<Bucket, Masked>;
}

// --- 共通部分（meta、periods） ---

/** meta と、選べる期間の一覧を作る。期間は移動窓 3 つ、月（新しい順。直近 MAX_MONTHS か月まで）の順。 */
export function buildCommon(cache: PubCache, builtAt: Date): PageCommon {
  const periodIds = new Set(cache.periods.map((row) => row.period_id));
  const months = cache.periods
    .flatMap((row) => (row.kind === 'month' && isMonthId(row.period_id) ? [row.period_id] : []))
    .sort()
    .reverse()
    .slice(0, MAX_MONTHS);
  const monthSet = new Set<string>(months);
  const rowById = new Map(cache.periods.map((row) => [row.period_id, row]));

  const periods: Period[] = [];
  for (const id of WINDOW_IDS) {
    const row = rowById.get(id);
    if (row === undefined) continue;
    periods.push({
      id,
      kind: 'window',
      start: row.start_date,
      end: row.end_date,
      isConfirmed: false,
      label: formatPeriodLabel(id),
      prevId: periodIds.has(PREV_OF[id]) ? PREV_OF[id] : null,
      yoyId: null,
    });
  }
  for (const id of months) {
    const row = rowById.get(id);
    if (row === undefined) continue;
    const prev = shiftMonth(id, -1);
    const yoy = shiftMonth(id, -12);
    periods.push({
      id,
      kind: 'month',
      start: row.start_date,
      end: row.end_date,
      isConfirmed: row.is_confirmed,
      label: formatPeriodLabel(id),
      // 埋め込む月（直近 MAX_MONTHS か月）の外は、比較の相手にしない。
      prevId: monthSet.has(prev) ? prev : null,
      yoyId: monthSet.has(yoy) ? yoy : null,
    });
  }

  return {
    meta: {
      baseDate: cache.meta.base_date,
      finishedAt: toJstTimestamp(new Date(cache.meta.finished_at)),
      maskThreshold: cache.meta.mask_threshold,
      isStale: cache.meta.is_stale,
      measureStart: MEASURE_START,
      builtAt: toJstTimestamp(builtAt),
    },
    periods,
  };
}

/** 選べる期間の ID（periods の順）。 */
export function selectableIds(common: PageCommon): SelectablePeriodId[] {
  return common.periods.map((period) => period.id);
}

/** 選べる期間と、その比較の相手（前の期間、前年同月）の ID。集計値の表に使う。 */
export function comparableIds(common: PageCommon): PeriodId[] {
  const ids = new Set<PeriodId>();
  for (const period of common.periods) {
    ids.add(period.id);
    if (period.prevId !== null) ids.add(period.prevId);
    if (period.yoyId !== null) ids.add(period.yoyId);
  }
  return [...ids];
}

/** 期間ごとの表を作る。値が undefined の期間は入れない（行がない = 該当なし）。 */
export function byPeriod<Id extends PeriodId, Value>(
  ids: readonly Id[],
  valueOf: (id: Id) => Value | undefined,
): Partial<Record<Id, Value>> {
  const table: Partial<Record<Id, Value>> = {};
  for (const id of ids) {
    const value = valueOf(id);
    if (value !== undefined) table[id] = value;
  }
  return table;
}

// --- 記事 ---

/** 公開記事を post_id の昇順で返す（列指向の配列の順の基準）。 */
export function sortedPosts(cache: PubCache): PubPost[] {
  return [...cache.posts].sort((a, b) => a.post_id - b.post_id);
}

/** 一覧と詳細に共通の、記事 1 本ぶんの行を作る。 */
export function toPostRow(cache: PubCache, post: PubPost, withTaxonomy: boolean): PostRow {
  const summary = rowsOf(cache.articleSummary, 'post_id', post.post_id)[0];
  if (summary === undefined) throw new Error('pub_article_summary に行のない記事があります');

  const idsOf = (ids: number[]): number[] => (withTaxonomy ? ids.sort((a, b) => a - b) : []);
  return {
    id: post.post_id,
    title: post.title,
    url: post.post_url,
    // 著者ページのない著者は、リンクにしない。
    authorSlug: authorPageSlug(cache, post.author_slug),
    authorName: post.display_name,
    publishedOn: post.published_on,
    isAd: post.is_ad,
    ageDays: post.age_days,
    freshness: post.freshness,
    isPreMeasure: post.published_on < MEASURE_START,
    pv7: summary.pv_7d,
    pv30: summary.pv_30d,
    band30: summary.band_30d,
    pvTotal: summary.pv_total,
    isRecentHot: summary.is_recent_hot,
    isRevival: summary.is_revival,
    categoryIds: idsOf(
      rowsOf(cache.postCategories, 'post_id', post.post_id).map((row) => row.category_id),
    ),
    tagIds: idsOf(rowsOf(cache.postTags, 'post_id', post.post_id).map((row) => row.tag_id)),
  };
}

/** 期間 → 記事ごとの読まれた回数（posts と同じ順）。行のない記事は 0。 */
export function pvByPeriodOf(
  cache: PubCache,
  posts: readonly PubPost[],
  periodIds: readonly PeriodId[],
): ByPeriod<number[]> {
  return byPeriod(periodIds, (id) => {
    const pvByPost = new Map(
      rowsOf(cache.articlePeriod, 'period_id', id).map((row) => [row.post_id, row.pageviews]),
    );
    return posts.map((post) => pvByPost.get(post.post_id) ?? 0);
  });
}

// --- 分布 ---

/** 全体の分布の n 日目の行。母集団が足りなければ行がない。 */
export function benchmarkRow(cache: PubCache, n: number): PubBenchmarkCurve | undefined {
  return cache.benchmarkCurve.find((row) => row.scope === 'all' && row.n === n);
}

/** n = 30 の 1 行（「多くの記事は ◯〜◯回」の文言用）。母集団が足りなければ null。 */
export function benchmark30(cache: PubCache): BenchmarkPoint | null {
  const row = benchmarkRow(cache, 30);
  return row === undefined ? null : { p25: row.p25, p50: row.p50, p75: row.p75 };
}
