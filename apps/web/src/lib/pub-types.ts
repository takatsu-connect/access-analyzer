/**
 * 公開ビュー（pub_*）の行の型（docs/design/02_data_model.md §4、04_api.md §4）。
 *
 * 列名と型の正は、リポジトリ直下の tests/snapshots/pub-columns.json。
 * date と timestamptz は文字列、integer / bigint / numeric / double precision は number。
 * 伏せ値のある列と、値がないことのある列は null を許す。
 * 対になる zod のスキーマは src/data/pub/schemas.ts にあり、列の集合は tests/data/pub-types.test.ts で突き合わせる。
 */
import type { Band, Freshness, Milestone } from '@/lib/page-data';

// --- 共通 ---

export type PubMeta = {
  /** 'YYYY-MM-DD'（JST の暦日）。 */
  base_date: string;
  /** 最後に成功したバッチの終了時刻（timestamptz の文字列）。 */
  finished_at: string;
  mask_threshold: number;
  is_stale: boolean;
  last_status: string;
};

/** BI の画面では読まない（04 §2 の表にない）。列の突き合わせのために型だけ置く。 */
export type PubBatchRun = {
  run_id: number;
  started_at: string;
  finished_at: string | null;
  base_date: string;
  mode: string;
  status: string;
  failed_step: string | null;
  error_kind: string | null;
};

export type PubPeriod = {
  period_id: string;
  kind: 'window' | 'month';
  start_date: string;
  end_date: string;
  is_confirmed: boolean;
};

export type PubAuthor = {
  author_slug: string;
  display_name: string;
  author_url: string;
};

export type PubPost = {
  post_id: number;
  title: string;
  post_url: string;
  author_slug: string;
  display_name: string;
  published_on: string;
  is_ad: boolean;
  age_days: number;
  freshness: Freshness;
};

export type PubCategory = {
  category_id: number;
  name: string;
  parent_id: number | null;
  path: string;
};

export type PubTag = { tag_id: number; name: string };
export type PubPostCategory = { post_id: number; category_id: number };
export type PubPostTag = { post_id: number; tag_id: number };

// --- サイト全体 ---

export type PubSiteDaily = { day: string; pageviews: number; sessions: number };
export type PubSiteDailyChannel = { day: string; channel: string; sessions: number | null };
export type PubSiteDailyDevice = {
  day: string;
  device: string;
  pageviews: number | null;
  sessions: number | null;
};

export type PubSitePeriod = {
  period_id: string;
  pageviews: number;
  sessions: number;
  /** 伏せ値は null。 */
  active_users: number | null;
  engagement_seconds: number;
  days: number;
};

export type PubSitePeriodBreakdown = {
  period_id: string;
  axis: string;
  bucket: string;
  /** 伏せ値は null。 */
  value: number | null;
};

export type PubSitePeriodHeatmap = {
  period_id: string;
  /** 0 = 日曜。 */
  dow: number;
  hour: number;
  /** 伏せ値は null（二次伏せを含む）。 */
  pageviews: number | null;
};

export type PubSitePeriodFreshness = {
  period_id: string;
  freshness: Freshness;
  post_count: number;
  pageviews: number;
};

export type PubSiteMonthReferrer = {
  period_id: string;
  rank: number;
  source_domain: string;
  sessions: number;
};

export type PubSiteMonthCity = {
  period_id: string;
  rank: number;
  region: string;
  city: string;
  sessions: number;
};

// --- 記事 ---

export type PubArticleDaily = { post_id: number; day: string; pageviews: number };
export type PubArticleCumulative = { post_id: number; n: number; cumulative_pv: number };

export type PubArticlePeriod = {
  post_id: number;
  period_id: string;
  pageviews: number;
  /** 伏せ値は null。 */
  landing_sessions: number | null;
  scroll_count: number | null;
  engagement_seconds: number | null;
};

export type PubArticlePeriodBreakdown = {
  post_id: number;
  period_id: string;
  axis: string;
  bucket: string;
  /** 伏せ値は null。 */
  sessions: number | null;
};

export type PubArticleReferrer30d = {
  post_id: number;
  rank: number;
  source_domain: string;
  sessions: number;
};

export type PubArticleSummary = {
  post_id: number;
  age_days: number;
  freshness: Freshness;
  /** まだその日数がたっていないか、数え始める前に公開した記事は null（伏せ値ではない）。 */
  pv_7d: number | null;
  pv_30d: number | null;
  pv_total: number;
  band_7d: Band | null;
  band_30d: Band | null;
  is_recent_hot: boolean;
  is_revival: boolean;
  is_evergreen_365: boolean;
  /** 公開 30 日後に計算する。まだなら null。 */
  referrer_30d_computed_on: string | null;
};

export type PubArticleMilestone = { post_id: number; milestone: Milestone; reached_on: string };

// --- 著者 ---

export type PubAuthorPeriod = {
  author_slug: string;
  period_id: string;
  post_count: number;
  pageviews: number;
  long_post_count: number;
  long_pageviews: number;
};

export type PubAuthorPeriodBreakdown = {
  author_slug: string;
  period_id: string;
  axis: string;
  bucket: string;
  /** 伏せ値は null。 */
  sessions: number | null;
};

export type PubAuthorCategoryPeriod = {
  author_slug: string;
  category_id: number;
  period_id: string;
  post_count: number;
  pageviews: number;
};

export type PubAuthorSummary = {
  author_slug: string;
  /** 対象の記事が足りなければ null。 */
  own_median_30d: number | null;
  eligible_count: number;
  band_30d: Band | null;
};

// --- カテゴリ、タグ、投稿活動、分布 ---

export type PubCategoryPeriod = {
  category_id: number;
  period_id: string;
  pageviews: number;
  post_count_total: number;
  post_count_published: number;
  /** 該当する記事がなければ null（伏せ値ではない）。 */
  median_30d_pv: number | null;
  published_post_count_30d: number;
};

export type PubTagPeriod = {
  tag_id: number;
  period_id: string;
  pageviews: number;
  post_count: number;
};

/** month は月初の日付（'YYYY-MM-01'）。 */
export type PubPostingMonthly = { month: string; post_count: number };
export type PubPostingPeriod = { period_id: string; post_count: number };

export type PubBenchmarkCurve = {
  scope: string;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  population_size: number;
  population_window: string;
};

// --- 全ビューの全行 ---

/** ビルド時に読んだ公開ビューの全行（04 §5 の loadAll の結果）。 */
export type PubCache = {
  meta: PubMeta;
  periods: PubPeriod[];
  authors: PubAuthor[];
  /** post_id の昇順。 */
  posts: PubPost[];
  categories: PubCategory[];
  tags: PubTag[];
  postCategories: PubPostCategory[];
  postTags: PubPostTag[];
  siteDaily: PubSiteDaily[];
  siteDailyChannel: PubSiteDailyChannel[];
  siteDailyDevice: PubSiteDailyDevice[];
  sitePeriod: PubSitePeriod[];
  sitePeriodBreakdown: PubSitePeriodBreakdown[];
  siteHeatmap: PubSitePeriodHeatmap[];
  siteFreshness: PubSitePeriodFreshness[];
  siteMonthReferrer: PubSiteMonthReferrer[];
  siteMonthCity: PubSiteMonthCity[];
  articleDaily: PubArticleDaily[];
  articleCumulative: PubArticleCumulative[];
  articlePeriod: PubArticlePeriod[];
  articlePeriodBreakdown: PubArticlePeriodBreakdown[];
  articleReferrer30d: PubArticleReferrer30d[];
  articleSummary: PubArticleSummary[];
  articleMilestone: PubArticleMilestone[];
  authorPeriod: PubAuthorPeriod[];
  authorPeriodBreakdown: PubAuthorPeriodBreakdown[];
  authorCategoryPeriod: PubAuthorCategoryPeriod[];
  authorSummary: PubAuthorSummary[];
  categoryPeriod: PubCategoryPeriod[];
  tagPeriod: PubTagPeriod[];
  postingMonthly: PubPostingMonthly[];
  postingPeriod: PubPostingPeriod[];
  /** scope = all の行だけ。 */
  benchmarkCurve: PubBenchmarkCurve[];
};
