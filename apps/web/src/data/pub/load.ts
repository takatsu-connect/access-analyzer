/**
 * 公開ビューの読み出し（docs/design/04_api.md §2、§5）。Supabase を読むのは、このディレクトリだけ。
 *
 * - 列は列挙して読む（スキーマのキーから作る。`*` を使わない）。
 * - 既定の上限（1,000 行）を超えても欠けないように、どのビューも主キーの順に 1,000 行ずつ読む。
 * - 行は zod で検証する。失敗したときのエラーには、ビューの名前だけを入れる（接続先、キー、行の値を出さない）。
 */
import { cache } from 'react';
import * as z from 'zod';

import { BENCHMARK_SCOPES } from '@/lib/derive/sections';
import type * as T from '@/lib/pub-types';
import type { PubCache } from '@/lib/pub-types';

import { createPubClient, type PubClient } from './client';
import * as schemas from './schemas';
import type { PubReadViewName, PubViewName } from './schemas';

/** 1 回の問い合わせで読む行数（PostgREST の既定の上限）。 */
export const PAGE_SIZE = 1000;

type PageResult = { data: unknown; error: unknown };

/** 読み出しに使う問い合わせの最小の形。テストでは偽物に差し替える。 */
export type ViewQuery = {
  in(column: string, values: readonly string[]): ViewQuery;
  order(column: string, options: { ascending: boolean }): ViewQuery;
  range(from: number, to: number): PromiseLike<PageResult>;
};
export type ViewSource = { select(columns: string): ViewQuery };

export type ViewSpec<Row> = {
  /** 読むビュー。契約として検査するだけのビュー（CONTRACT_ONLY_VIEWS）は、型で弾く。 */
  name: PubReadViewName;
  schema: z.ZodType<Row>;
  /** 読む列。 */
  columns: readonly string[];
  /** 主キーの列。この順に並べて読む。 */
  orderBy: readonly string[];
  filter?: { column: string; values: readonly string[] };
  open: (client: PubClient) => ViewSource;
};

/** 読み出しの失敗。ビューの名前と失敗の種類だけを持つ。 */
export class PubReadError extends Error {
  readonly view: PubViewName;
  readonly kind: 'read' | 'shape';

  constructor(view: PubViewName, kind: 'read' | 'shape') {
    super(
      kind === 'read'
        ? `公開ビュー ${view} を読めませんでした`
        : `公開ビュー ${view} の行が、想定した形と違います`,
    );
    this.name = 'PubReadError';
    this.view = view;
    this.kind = kind;
  }
}

function view<Row>(
  name: PubReadViewName,
  schema: z.ZodType<Row> & { shape: Record<string, unknown> },
  orderBy: readonly (keyof Row & string)[],
  open: (client: PubClient) => ViewSource,
  filter?: { column: keyof Row & string; values: readonly string[] },
): ViewSpec<Row> {
  const spec: ViewSpec<Row> = {
    name,
    schema,
    columns: Object.keys(schema.shape),
    orderBy,
    open,
  };
  return filter === undefined ? spec : { ...spec, filter };
}

/**
 * Supabase の問い合わせを、読み出しに使う最小の形（ViewSource）として扱う。
 * ライブラリの型は深く、構造の照合がコンパイラの上限を超えるので、ここで 1 回だけ読み替える。
 * 実際に select / eq / order / range を持つことは、tests/data/local-supabase.test.ts で確かめる。
 */
function asSource(builder: { select(columns: string): unknown }): ViewSource {
  return builder as ViewSource;
}

/**
 * 読むビューの一覧。PubCache の項目 → 読むビュー。ビューの名前は、lint（S-02）のために文字列リテラルで書く。
 *
 * ここに置くのは、画面で使うビューだけ。契約として検査するビューの一覧（schemas.ts の PUB_ROW_SCHEMAS）とは別に持つ。
 * 画面で使わないビュー（CONTRACT_ONLY_VIEWS）は読まない。
 */
export const VIEWS = {
  meta: view('pub_meta', schemas.pubMetaSchema, ['base_date'], (c) => asSource(c.from('pub_meta'))),
  periods: view('pub_period', schemas.pubPeriodSchema, ['period_id'], (c) =>
    asSource(c.from('pub_period')),
  ),
  authors: view('pub_author', schemas.pubAuthorSchema, ['author_slug'], (c) =>
    asSource(c.from('pub_author')),
  ),
  posts: view('pub_post', schemas.pubPostSchema, ['post_id'], (c) => asSource(c.from('pub_post'))),
  categories: view('pub_category', schemas.pubCategorySchema, ['category_id'], (c) =>
    asSource(c.from('pub_category')),
  ),
  tags: view('pub_tag', schemas.pubTagSchema, ['tag_id'], (c) => asSource(c.from('pub_tag'))),
  postCategories: view(
    'pub_post_category',
    schemas.pubPostCategorySchema,
    ['post_id', 'category_id'],
    (c) => asSource(c.from('pub_post_category')),
  ),
  postTags: view('pub_post_tag', schemas.pubPostTagSchema, ['post_id', 'tag_id'], (c) =>
    asSource(c.from('pub_post_tag')),
  ),
  siteDaily: view('pub_site_daily', schemas.pubSiteDailySchema, ['day'], (c) =>
    asSource(c.from('pub_site_daily')),
  ),
  sitePeriod: view('pub_site_period', schemas.pubSitePeriodSchema, ['period_id'], (c) =>
    asSource(c.from('pub_site_period')),
  ),
  sitePeriodBreakdown: view(
    'pub_site_period_breakdown',
    schemas.pubSitePeriodBreakdownSchema,
    ['period_id', 'axis', 'bucket'],
    (c) => asSource(c.from('pub_site_period_breakdown')),
  ),
  siteHeatmap: view(
    'pub_site_period_heatmap',
    schemas.pubSitePeriodHeatmapSchema,
    ['period_id', 'dow', 'hour'],
    (c) => asSource(c.from('pub_site_period_heatmap')),
  ),
  siteFreshness: view(
    'pub_site_period_freshness',
    schemas.pubSitePeriodFreshnessSchema,
    ['period_id', 'freshness'],
    (c) => asSource(c.from('pub_site_period_freshness')),
  ),
  siteMonthReferrer: view(
    'pub_site_month_referrer',
    schemas.pubSiteMonthReferrerSchema,
    ['period_id', 'rank'],
    (c) => asSource(c.from('pub_site_month_referrer')),
  ),
  siteMonthCity: view(
    'pub_site_month_city',
    schemas.pubSiteMonthCitySchema,
    ['period_id', 'rank'],
    (c) => asSource(c.from('pub_site_month_city')),
  ),
  articleDaily: view('pub_article_daily', schemas.pubArticleDailySchema, ['post_id', 'day'], (c) =>
    asSource(c.from('pub_article_daily')),
  ),
  articleCumulative: view(
    'pub_article_cumulative',
    schemas.pubArticleCumulativeSchema,
    ['post_id', 'n'],
    (c) => asSource(c.from('pub_article_cumulative')),
  ),
  articlePeriod: view(
    'pub_article_period',
    schemas.pubArticlePeriodSchema,
    ['post_id', 'period_id'],
    (c) => asSource(c.from('pub_article_period')),
  ),
  articlePeriodBreakdown: view(
    'pub_article_period_breakdown',
    schemas.pubArticlePeriodBreakdownSchema,
    ['post_id', 'period_id', 'axis', 'bucket'],
    (c) => asSource(c.from('pub_article_period_breakdown')),
  ),
  articleReferrer30d: view(
    'pub_article_referrer_30d',
    schemas.pubArticleReferrer30dSchema,
    ['post_id', 'rank'],
    (c) => asSource(c.from('pub_article_referrer_30d')),
  ),
  articleSummary: view('pub_article_summary', schemas.pubArticleSummarySchema, ['post_id'], (c) =>
    asSource(c.from('pub_article_summary')),
  ),
  articleMilestone: view(
    'pub_article_milestone',
    schemas.pubArticleMilestoneSchema,
    ['post_id', 'milestone'],
    (c) => asSource(c.from('pub_article_milestone')),
  ),
  authorPeriod: view(
    'pub_author_period',
    schemas.pubAuthorPeriodSchema,
    ['author_slug', 'period_id'],
    (c) => asSource(c.from('pub_author_period')),
  ),
  authorPeriodBreakdown: view(
    'pub_author_period_breakdown',
    schemas.pubAuthorPeriodBreakdownSchema,
    ['author_slug', 'period_id', 'axis', 'bucket'],
    (c) => asSource(c.from('pub_author_period_breakdown')),
  ),
  authorCategoryPeriod: view(
    'pub_author_category_period',
    schemas.pubAuthorCategoryPeriodSchema,
    ['author_slug', 'category_id', 'period_id'],
    (c) => asSource(c.from('pub_author_category_period')),
  ),
  authorSummary: view('pub_author_summary', schemas.pubAuthorSummarySchema, ['author_slug'], (c) =>
    asSource(c.from('pub_author_summary')),
  ),
  categoryPeriod: view(
    'pub_category_period',
    schemas.pubCategoryPeriodSchema,
    ['category_id', 'period_id'],
    (c) => asSource(c.from('pub_category_period')),
  ),
  tagPeriod: view('pub_tag_period', schemas.pubTagPeriodSchema, ['tag_id', 'period_id'], (c) =>
    asSource(c.from('pub_tag_period')),
  ),
  postingMonthly: view('pub_posting_monthly', schemas.pubPostingMonthlySchema, ['month'], (c) =>
    asSource(c.from('pub_posting_monthly')),
  ),
  postingPeriod: view('pub_posting_period', schemas.pubPostingPeriodSchema, ['period_id'], (c) =>
    asSource(c.from('pub_posting_period')),
  ),
  // 分布は scope が全体（all）と記事の種類（kind:article、kind:event）の行だけを使う（04 §2）。
  benchmarkCurve: view(
    'pub_benchmark_curve',
    schemas.pubBenchmarkCurveSchema,
    ['scope', 'n'],
    (c) => asSource(c.from('pub_benchmark_curve')),
    { column: 'scope', values: BENCHMARK_SCOPES },
  ),
} as const;

/**
 * 1 つのビューを、主キーの順に PAGE_SIZE 行ずつ最後まで読む。
 * open は呼ぶたびに新しい問い合わせを返すこと（問い合わせは使い回せない）。
 *
 * 終わりは「空のページが返ったとき」で判定し、次の位置は受け取った行数だけ進める。
 * サーバー側の上限が PAGE_SIZE より小さく設定されていても、途中で切れたまま気づかないことがない。
 */
export async function readView<Row>(spec: ViewSpec<Row>, open: () => ViewSource): Promise<Row[]> {
  const pageSchema = z.array(spec.schema);
  const rows: Row[] = [];

  for (let offset = 0; ;) {
    let result: PageResult;
    try {
      let query = open().select(spec.columns.join(','));
      if (spec.filter !== undefined) query = query.in(spec.filter.column, spec.filter.values);
      for (const column of spec.orderBy) query = query.order(column, { ascending: true });
      result = await query.range(offset, offset + PAGE_SIZE - 1);
    } catch {
      // 元のエラーは接続先を含みうるので、引き継がない。
      throw new PubReadError(spec.name, 'read');
    }
    if ((result.error ?? null) !== null || !Array.isArray(result.data)) {
      throw new PubReadError(spec.name, 'read');
    }

    const parsed = pageSchema.safeParse(result.data);
    if (!parsed.success) throw new PubReadError(spec.name, 'shape');
    if (parsed.data.length === 0) return rows;
    for (const row of parsed.data) rows.push(row);
    offset += parsed.data.length;
  }
}

/** 読むビュー（VIEWS）をすべて読む。 */
export async function readAllViews(client: PubClient): Promise<PubCache> {
  const read = <Row>(spec: ViewSpec<Row>): Promise<Row[]> =>
    readView(spec, () => spec.open(client));

  const [
    metaRows,
    periods,
    authors,
    posts,
    categories,
    tags,
    postCategories,
    postTags,
    siteDaily,
    sitePeriod,
    sitePeriodBreakdown,
    siteHeatmap,
    siteFreshness,
    siteMonthReferrer,
  ] = await Promise.all([
    read(VIEWS.meta),
    read(VIEWS.periods),
    read(VIEWS.authors),
    read(VIEWS.posts),
    read(VIEWS.categories),
    read(VIEWS.tags),
    read(VIEWS.postCategories),
    read(VIEWS.postTags),
    read(VIEWS.siteDaily),
    read(VIEWS.sitePeriod),
    read(VIEWS.sitePeriodBreakdown),
    read(VIEWS.siteHeatmap),
    read(VIEWS.siteFreshness),
    read(VIEWS.siteMonthReferrer),
  ]);
  const [
    siteMonthCity,
    articleDaily,
    articleCumulative,
    articlePeriod,
    articlePeriodBreakdown,
    articleReferrer30d,
    articleSummary,
    articleMilestone,
    authorPeriod,
    authorPeriodBreakdown,
    authorCategoryPeriod,
    authorSummary,
    categoryPeriod,
    tagPeriod,
    postingMonthly,
    postingPeriod,
    benchmarkCurve,
  ] = await Promise.all([
    read(VIEWS.siteMonthCity),
    read(VIEWS.articleDaily),
    read(VIEWS.articleCumulative),
    read(VIEWS.articlePeriod),
    read(VIEWS.articlePeriodBreakdown),
    read(VIEWS.articleReferrer30d),
    read(VIEWS.articleSummary),
    read(VIEWS.articleMilestone),
    read(VIEWS.authorPeriod),
    read(VIEWS.authorPeriodBreakdown),
    read(VIEWS.authorCategoryPeriod),
    read(VIEWS.authorSummary),
    read(VIEWS.categoryPeriod),
    read(VIEWS.tagPeriod),
    read(VIEWS.postingMonthly),
    read(VIEWS.postingPeriod),
    read(VIEWS.benchmarkCurve),
  ]);

  // pub_meta は 1 行だけのビュー。0 行（成功したバッチがない）なら、ビルドを止める。
  const meta = metaRows[0];
  if (meta === undefined || metaRows.length !== 1) throw new PubReadError('pub_meta', 'shape');

  return {
    meta,
    periods,
    authors,
    posts,
    categories,
    tags,
    postCategories,
    postTags,
    siteDaily,
    sitePeriod,
    sitePeriodBreakdown,
    siteHeatmap,
    siteFreshness,
    siteMonthReferrer,
    siteMonthCity,
    articleDaily,
    articleCumulative,
    articlePeriod,
    articlePeriodBreakdown,
    articleReferrer30d,
    articleSummary,
    articleMilestone,
    authorPeriod,
    authorPeriodBreakdown,
    authorCategoryPeriod,
    authorSummary,
    categoryPeriod,
    tagPeriod,
    postingMonthly,
    postingPeriod,
    benchmarkCurve,
  };
}

// React の cache() はレンダリングの単位で結果を持つ。ページをまたいでも読み直さないように、
// 同じプロセスの中では約束（Promise）も使い回す。
let pending: Promise<PubCache> | undefined;

/** 全ビューの全行を読む。ビルド中 1 回だけ実行する（プロセスごと）。 */
export const loadAll = cache((): Promise<PubCache> => {
  pending ??= Promise.resolve().then(() => readAllViews(createPubClient()));
  return pending;
});

// --- 04 §5 の get* ---

export const getMeta = async (): Promise<T.PubMeta> => (await loadAll()).meta;
export const getPeriods = async (): Promise<T.PubPeriod[]> => (await loadAll()).periods;
export const getPosts = async (): Promise<T.PubPost[]> => (await loadAll()).posts;
export const getAuthors = async (): Promise<T.PubAuthor[]> => (await loadAll()).authors;
export const getCategories = async (): Promise<T.PubCategory[]> => (await loadAll()).categories;
export const getTags = async (): Promise<T.PubTag[]> => (await loadAll()).tags;
export const getPostCategories = async (): Promise<T.PubPostCategory[]> =>
  (await loadAll()).postCategories;
export const getPostTags = async (): Promise<T.PubPostTag[]> => (await loadAll()).postTags;
export const getSiteDaily = async (): Promise<T.PubSiteDaily[]> => (await loadAll()).siteDaily;
export const getSitePeriod = async (): Promise<T.PubSitePeriod[]> => (await loadAll()).sitePeriod;
export const getSitePeriodBreakdown = async (): Promise<T.PubSitePeriodBreakdown[]> =>
  (await loadAll()).sitePeriodBreakdown;
export const getSiteHeatmap = async (): Promise<T.PubSitePeriodHeatmap[]> =>
  (await loadAll()).siteHeatmap;
export const getSiteFreshness = async (): Promise<T.PubSitePeriodFreshness[]> =>
  (await loadAll()).siteFreshness;
export const getSiteMonthReferrer = async (): Promise<T.PubSiteMonthReferrer[]> =>
  (await loadAll()).siteMonthReferrer;
export const getSiteMonthCity = async (): Promise<T.PubSiteMonthCity[]> =>
  (await loadAll()).siteMonthCity;
export const getArticleDailyAll = async (): Promise<T.PubArticleDaily[]> =>
  (await loadAll()).articleDaily;
export const getArticleCumulativeAll = async (): Promise<T.PubArticleCumulative[]> =>
  (await loadAll()).articleCumulative;
export const getArticlePeriodAll = async (): Promise<T.PubArticlePeriod[]> =>
  (await loadAll()).articlePeriod;
export const getArticlePeriodBreakdownAll = async (): Promise<T.PubArticlePeriodBreakdown[]> =>
  (await loadAll()).articlePeriodBreakdown;
export const getArticleReferrer30dAll = async (): Promise<T.PubArticleReferrer30d[]> =>
  (await loadAll()).articleReferrer30d;
export const getArticleSummaryAll = async (): Promise<T.PubArticleSummary[]> =>
  (await loadAll()).articleSummary;
export const getArticleMilestoneAll = async (): Promise<T.PubArticleMilestone[]> =>
  (await loadAll()).articleMilestone;
export const getAuthorPeriodAll = async (): Promise<T.PubAuthorPeriod[]> =>
  (await loadAll()).authorPeriod;
export const getAuthorPeriodBreakdownAll = async (): Promise<T.PubAuthorPeriodBreakdown[]> =>
  (await loadAll()).authorPeriodBreakdown;
export const getAuthorCategoryPeriodAll = async (): Promise<T.PubAuthorCategoryPeriod[]> =>
  (await loadAll()).authorCategoryPeriod;
export const getAuthorSummaryAll = async (): Promise<T.PubAuthorSummary[]> =>
  (await loadAll()).authorSummary;
export const getCategoryPeriodAll = async (): Promise<T.PubCategoryPeriod[]> =>
  (await loadAll()).categoryPeriod;
export const getTagPeriodAll = async (): Promise<T.PubTagPeriod[]> => (await loadAll()).tagPeriod;
export const getPostingMonthly = async (): Promise<T.PubPostingMonthly[]> =>
  (await loadAll()).postingMonthly;
export const getPostingPeriod = async (): Promise<T.PubPostingPeriod[]> =>
  (await loadAll()).postingPeriod;
export const getBenchmarkCurve = async (): Promise<T.PubBenchmarkCurve[]> =>
  (await loadAll()).benchmarkCurve;
