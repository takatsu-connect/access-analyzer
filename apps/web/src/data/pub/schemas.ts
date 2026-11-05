/**
 * 公開ビュー（pub_*）の行の zod スキーマ。src/lib/pub-types.ts の型と対になる。
 *
 * - 列の集合は、リポジトリ直下の tests/snapshots/pub-columns.json と一致させる（tests/data/pub-types.test.ts）。
 * - 未知の列は落とさずに失敗させる（strictObject）。
 * - 型とスキーマのずれは、末尾の PubSchemaChecks でコンパイル時に分かる。
 */
import * as z from 'zod';

import type * as T from '@/lib/pub-types';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const text = z.string();
const id = z.int().nonnegative();
const count = z.int().nonnegative();
/** 伏せ値のある列。 */
const maskedCount = count.nullable();
const amount = z.number().nonnegative();
const freshness = z.enum(['new', 'mid', 'long']);
const band = z.enum(['upper', 'middle', 'lower']);

export const pubMetaSchema = z.strictObject({
  base_date: day,
  finished_at: timestamp,
  mask_threshold: count,
  is_stale: z.boolean(),
  last_status: text,
});

export const pubBatchRunSchema = z.strictObject({
  run_id: id,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  base_date: day,
  mode: text,
  status: text,
  failed_step: text.nullable(),
  error_kind: text.nullable(),
});

export const pubPeriodSchema = z.strictObject({
  period_id: text,
  kind: z.enum(['window', 'month']),
  start_date: day,
  end_date: day,
  is_confirmed: z.boolean(),
});

export const pubAuthorSchema = z.strictObject({
  author_slug: text,
  display_name: text,
  author_url: text,
});

export const pubPostSchema = z.strictObject({
  post_id: id,
  title: text,
  post_url: text,
  author_slug: text,
  display_name: text,
  published_on: day,
  is_ad: z.boolean(),
  age_days: count,
  freshness,
});

export const pubCategorySchema = z.strictObject({
  category_id: id,
  name: text,
  parent_id: id.nullable(),
  path: text,
});

export const pubTagSchema = z.strictObject({ tag_id: id, name: text });
export const pubPostCategorySchema = z.strictObject({ post_id: id, category_id: id });
export const pubPostTagSchema = z.strictObject({ post_id: id, tag_id: id });

export const pubSiteDailySchema = z.strictObject({ day, pageviews: count, sessions: count });

export const pubSiteDailyChannelSchema = z.strictObject({
  day,
  channel: text,
  sessions: maskedCount,
});

export const pubSiteDailyDeviceSchema = z.strictObject({
  day,
  device: text,
  pageviews: maskedCount,
  sessions: maskedCount,
});

export const pubSitePeriodSchema = z.strictObject({
  period_id: text,
  pageviews: count,
  sessions: count,
  active_users: maskedCount,
  engagement_seconds: count,
  days: count,
});

export const pubSitePeriodBreakdownSchema = z.strictObject({
  period_id: text,
  axis: text,
  bucket: text,
  value: maskedCount,
});

export const pubSitePeriodHeatmapSchema = z.strictObject({
  period_id: text,
  dow: z.int().min(0).max(6),
  hour: z.int().min(0).max(23),
  pageviews: maskedCount,
});

export const pubSitePeriodFreshnessSchema = z.strictObject({
  period_id: text,
  freshness,
  post_count: count,
  pageviews: count,
});

export const pubSiteMonthReferrerSchema = z.strictObject({
  period_id: text,
  rank: count,
  source_domain: text,
  sessions: count,
});

export const pubSiteMonthCitySchema = z.strictObject({
  period_id: text,
  rank: count,
  region: text,
  city: text,
  sessions: count,
});

export const pubArticleDailySchema = z.strictObject({ post_id: id, day, pageviews: count });

export const pubArticleCumulativeSchema = z.strictObject({
  post_id: id,
  n: z.int().min(1).max(90),
  cumulative_pv: count,
});

export const pubArticlePeriodSchema = z.strictObject({
  post_id: id,
  period_id: text,
  pageviews: count,
  landing_sessions: maskedCount,
  scroll_count: maskedCount,
  engagement_seconds: maskedCount,
});

export const pubArticlePeriodBreakdownSchema = z.strictObject({
  post_id: id,
  period_id: text,
  axis: text,
  bucket: text,
  sessions: maskedCount,
});

export const pubArticleReferrer30dSchema = z.strictObject({
  post_id: id,
  rank: count,
  source_domain: text,
  sessions: count,
});

export const pubArticleSummarySchema = z.strictObject({
  post_id: id,
  age_days: count,
  freshness,
  pv_7d: count.nullable(),
  pv_30d: count.nullable(),
  pv_total: count,
  band_7d: band.nullable(),
  band_30d: band.nullable(),
  is_recent_hot: z.boolean(),
  is_revival: z.boolean(),
  is_evergreen_365: z.boolean(),
  referrer_30d_computed_on: day.nullable(),
});

export const pubArticleMilestoneSchema = z.strictObject({
  post_id: id,
  milestone: z.literal([500, 1000, 5000, 10000]),
  reached_on: day,
});

export const pubAuthorPeriodSchema = z.strictObject({
  author_slug: text,
  period_id: text,
  post_count: count,
  pageviews: count,
  long_post_count: count,
  long_pageviews: count,
});

export const pubAuthorPeriodBreakdownSchema = z.strictObject({
  author_slug: text,
  period_id: text,
  axis: text,
  bucket: text,
  sessions: maskedCount,
});

export const pubAuthorCategoryPeriodSchema = z.strictObject({
  author_slug: text,
  category_id: id,
  period_id: text,
  post_count: count,
  pageviews: count,
});

export const pubAuthorSummarySchema = z.strictObject({
  author_slug: text,
  own_median_30d: amount.nullable(),
  eligible_count: count,
  band_30d: band.nullable(),
});

export const pubCategoryPeriodSchema = z.strictObject({
  category_id: id,
  period_id: text,
  pageviews: count,
  post_count_total: count,
  post_count_published: count,
  median_30d_pv: amount.nullable(),
  published_post_count_30d: count,
});

export const pubTagPeriodSchema = z.strictObject({
  tag_id: id,
  period_id: text,
  pageviews: count,
  post_count: count,
});

export const pubPostingMonthlySchema = z.strictObject({ month: day, post_count: count });
export const pubPostingPeriodSchema = z.strictObject({ period_id: text, post_count: count });

export const pubBenchmarkCurveSchema = z.strictObject({
  scope: text,
  n: z.int().min(1).max(90),
  p25: amount,
  p50: amount,
  p75: amount,
  population_size: count,
  population_window: text,
});

/**
 * 契約として検査するビューの一覧。ビュー名 → 行のスキーマ。スナップショットの全ビューを持つ。
 * BI が読むビューの一覧は、これとは別に load.ts の VIEWS が持つ。
 */
export const PUB_ROW_SCHEMAS = {
  pub_article_cumulative: pubArticleCumulativeSchema,
  pub_article_daily: pubArticleDailySchema,
  pub_article_milestone: pubArticleMilestoneSchema,
  pub_article_period: pubArticlePeriodSchema,
  pub_article_period_breakdown: pubArticlePeriodBreakdownSchema,
  pub_article_referrer_30d: pubArticleReferrer30dSchema,
  pub_article_summary: pubArticleSummarySchema,
  pub_author: pubAuthorSchema,
  pub_author_category_period: pubAuthorCategoryPeriodSchema,
  pub_author_period: pubAuthorPeriodSchema,
  pub_author_period_breakdown: pubAuthorPeriodBreakdownSchema,
  pub_author_summary: pubAuthorSummarySchema,
  pub_batch_run: pubBatchRunSchema,
  pub_benchmark_curve: pubBenchmarkCurveSchema,
  pub_category: pubCategorySchema,
  pub_category_period: pubCategoryPeriodSchema,
  pub_meta: pubMetaSchema,
  pub_period: pubPeriodSchema,
  pub_post: pubPostSchema,
  pub_post_category: pubPostCategorySchema,
  pub_post_tag: pubPostTagSchema,
  pub_posting_monthly: pubPostingMonthlySchema,
  pub_posting_period: pubPostingPeriodSchema,
  pub_site_daily: pubSiteDailySchema,
  pub_site_daily_channel: pubSiteDailyChannelSchema,
  pub_site_daily_device: pubSiteDailyDeviceSchema,
  pub_site_month_city: pubSiteMonthCitySchema,
  pub_site_month_referrer: pubSiteMonthReferrerSchema,
  pub_site_period: pubSitePeriodSchema,
  pub_site_period_breakdown: pubSitePeriodBreakdownSchema,
  pub_site_period_freshness: pubSitePeriodFreshnessSchema,
  pub_site_period_heatmap: pubSitePeriodHeatmapSchema,
  pub_tag: pubTagSchema,
  pub_tag_period: pubTagPeriodSchema,
} as const;

export type PubViewName = keyof typeof PUB_ROW_SCHEMAS;

/**
 * 契約として検査するだけで、BI が読まないビュー。行の型、スキーマ、スナップショットとの突き合わせは残す。
 *
 * - pub_batch_run: loadAll() の対象にしていない。
 * - pub_site_daily_channel、pub_site_daily_device: 画面で使わない（04 §2: S-01 では読まない）。
 */
export const CONTRACT_ONLY_VIEWS = [
  'pub_batch_run',
  'pub_site_daily_channel',
  'pub_site_daily_device',
] as const satisfies readonly PubViewName[];

/** BI が読むビューの名前（契約として検査するビューから、検査だけのビューを除いたもの）。 */
export type PubReadViewName = Exclude<PubViewName, (typeof CONTRACT_ONLY_VIEWS)[number]>;

// --- 型とスキーマの突き合わせ（コンパイル時） ---

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<C extends true> = C;
type Row<S extends z.ZodType> = z.output<S>;

/** どれかがずれると、ここでコンパイルが失敗する。 */
export type PubSchemaChecks = [
  Expect<Mutual<Row<typeof pubMetaSchema>, T.PubMeta>>,
  Expect<Mutual<Row<typeof pubBatchRunSchema>, T.PubBatchRun>>,
  Expect<Mutual<Row<typeof pubPeriodSchema>, T.PubPeriod>>,
  Expect<Mutual<Row<typeof pubAuthorSchema>, T.PubAuthor>>,
  Expect<Mutual<Row<typeof pubPostSchema>, T.PubPost>>,
  Expect<Mutual<Row<typeof pubCategorySchema>, T.PubCategory>>,
  Expect<Mutual<Row<typeof pubTagSchema>, T.PubTag>>,
  Expect<Mutual<Row<typeof pubPostCategorySchema>, T.PubPostCategory>>,
  Expect<Mutual<Row<typeof pubPostTagSchema>, T.PubPostTag>>,
  Expect<Mutual<Row<typeof pubSiteDailySchema>, T.PubSiteDaily>>,
  Expect<Mutual<Row<typeof pubSiteDailyChannelSchema>, T.PubSiteDailyChannel>>,
  Expect<Mutual<Row<typeof pubSiteDailyDeviceSchema>, T.PubSiteDailyDevice>>,
  Expect<Mutual<Row<typeof pubSitePeriodSchema>, T.PubSitePeriod>>,
  Expect<Mutual<Row<typeof pubSitePeriodBreakdownSchema>, T.PubSitePeriodBreakdown>>,
  Expect<Mutual<Row<typeof pubSitePeriodHeatmapSchema>, T.PubSitePeriodHeatmap>>,
  Expect<Mutual<Row<typeof pubSitePeriodFreshnessSchema>, T.PubSitePeriodFreshness>>,
  Expect<Mutual<Row<typeof pubSiteMonthReferrerSchema>, T.PubSiteMonthReferrer>>,
  Expect<Mutual<Row<typeof pubSiteMonthCitySchema>, T.PubSiteMonthCity>>,
  Expect<Mutual<Row<typeof pubArticleDailySchema>, T.PubArticleDaily>>,
  Expect<Mutual<Row<typeof pubArticleCumulativeSchema>, T.PubArticleCumulative>>,
  Expect<Mutual<Row<typeof pubArticlePeriodSchema>, T.PubArticlePeriod>>,
  Expect<Mutual<Row<typeof pubArticlePeriodBreakdownSchema>, T.PubArticlePeriodBreakdown>>,
  Expect<Mutual<Row<typeof pubArticleReferrer30dSchema>, T.PubArticleReferrer30d>>,
  Expect<Mutual<Row<typeof pubArticleSummarySchema>, T.PubArticleSummary>>,
  Expect<Mutual<Row<typeof pubArticleMilestoneSchema>, T.PubArticleMilestone>>,
  Expect<Mutual<Row<typeof pubAuthorPeriodSchema>, T.PubAuthorPeriod>>,
  Expect<Mutual<Row<typeof pubAuthorPeriodBreakdownSchema>, T.PubAuthorPeriodBreakdown>>,
  Expect<Mutual<Row<typeof pubAuthorCategoryPeriodSchema>, T.PubAuthorCategoryPeriod>>,
  Expect<Mutual<Row<typeof pubAuthorSummarySchema>, T.PubAuthorSummary>>,
  Expect<Mutual<Row<typeof pubCategoryPeriodSchema>, T.PubCategoryPeriod>>,
  Expect<Mutual<Row<typeof pubTagPeriodSchema>, T.PubTagPeriod>>,
  Expect<Mutual<Row<typeof pubPostingMonthlySchema>, T.PubPostingMonthly>>,
  Expect<Mutual<Row<typeof pubPostingPeriodSchema>, T.PubPostingPeriod>>,
  Expect<Mutual<Row<typeof pubBenchmarkCurveSchema>, T.PubBenchmarkCurve>>,
];
