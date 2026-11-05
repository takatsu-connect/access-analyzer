/**
 * 組み立て層のテスト用の、手で作った小さな PubCache。値はすべて架空。
 *
 * 記事 6 本（101 = 数え始める前に公開、105 = 広告）、著者 3 人（1 人は slug が決まった形でなく、記事もない）、
 * タグ 3 つ（203 は記事が 0 本）、期間は last7 / prev7 / last28 / prev28 と月 3 つ。基準日は 2026-11-03。
 * カテゴリの親は 4 つ（記事、イベント、マップ、広告）。広告の親の ID は設定値（AD_CATEGORY_ID）。
 */
import { AD_CATEGORY_ID } from '@/lib/config';
import type {
  PubArticlePeriod,
  PubArticlePeriodBreakdown,
  PubArticleSummary,
  PubCache,
  PubPeriod,
  PubPost,
  PubSiteDaily,
  PubSitePeriodBreakdown,
} from '@/lib/pub-types';

export const BUILT_AT = new Date('2026-11-05T01:02:03Z');
export const SATO = 'sato-hanako';
export const TANAKA = 'tanaka-taro';
/** slug に下線を含む著者。著者ページを作らない。addPagelessAuthor で足す。 */
export const AUTHOR_X = 'author_x';
export const AUTHOR_X_NAME = 'こばやし えっくす';
/** 広告の親より ID の大きい親カテゴリ。広告の軸が、ID の順でなく設定値で最後になることを確かめる。 */
export const MAP_CATEGORY_ID = AD_CATEGORY_ID + 1;
const SITE = 'https://takatsu-connect.com';

function post(
  post_id: number,
  author: [slug: string, name: string],
  published_on: string,
  age_days: number,
  freshness: PubPost['freshness'],
  is_ad = false,
): PubPost {
  return {
    post_id,
    title: `記事 ${post_id}`,
    post_url: `${SITE}/archives/${post_id}/`,
    author_slug: author[0],
    display_name: author[1],
    published_on,
    is_ad,
    age_days,
    freshness,
  };
}

function summary(
  post_id: number,
  values: Partial<PubArticleSummary> & { pv_total: number },
): PubArticleSummary {
  return {
    post_id,
    age_days: 0,
    freshness: 'long',
    pv_7d: null,
    pv_30d: null,
    band_7d: null,
    band_30d: null,
    is_recent_hot: false,
    is_revival: false,
    is_evergreen_365: false,
    referrer_30d_computed_on: null,
    ...values,
  };
}

function articlePeriods(period_id: string, pvByPost: Record<number, number>): PubArticlePeriod[] {
  return Object.entries(pvByPost).map(([postId, pageviews]) => ({
    post_id: Number(postId),
    period_id,
    pageviews,
    landing_sessions: pageviews,
    scroll_count: Math.floor(pageviews / 2),
    engagement_seconds: pageviews * 30,
  }));
}

function articleBreakdown(
  post_id: number,
  period_id: string,
  axis: string,
  buckets: Record<string, number | null>,
): PubArticlePeriodBreakdown[] {
  return Object.entries(buckets).map(([bucket, sessions]) => ({
    post_id,
    period_id,
    axis,
    bucket,
    sessions,
  }));
}

function siteBreakdown(
  period_id: string,
  axis: string,
  buckets: Record<string, number | null>,
): PubSitePeriodBreakdown[] {
  return Object.entries(buckets).map(([bucket, value]) => ({ period_id, axis, bucket, value }));
}

function period(
  period_id: string,
  kind: PubPeriod['kind'],
  start_date: string,
  end_date: string,
  is_confirmed = false,
): PubPeriod {
  return { period_id, kind, start_date, end_date, is_confirmed };
}

/** 2026-10-01 から 2026-11-03 までの 34 日。 */
function siteDaily(): PubSiteDaily[] {
  const rows: PubSiteDaily[] = [];
  for (let index = 0; index < 34; index += 1) {
    const day = new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10);
    rows.push({ day, pageviews: 100 + index, sessions: 50 + index });
  }
  return rows;
}

/**
 * 著者ページのない著者（slug に下線を含む author_x）と、その記事 107 を足す。渡した cache を書き換えて返す。
 * 記事 107 は 2026-10-20 に公開。著者は直近 28 日に 1 本公開している。
 */
export function addPagelessAuthor(cache: PubCache): PubCache {
  cache.authors.push({
    author_slug: AUTHOR_X,
    display_name: AUTHOR_X_NAME,
    author_url: `${SITE}/author/${AUTHOR_X}/`,
  });
  cache.posts.push(post(107, [AUTHOR_X, AUTHOR_X_NAME], '2026-10-20', 14, 'mid'));
  cache.articleSummary.push(summary(107, { pv_7d: 20, pv_total: 33 }));
  cache.articlePeriod.push(...articlePeriods('last28', { 107: 33 }));
  cache.authorPeriod.push({
    author_slug: AUTHOR_X,
    period_id: 'last28',
    post_count: 1,
    pageviews: 33,
    long_post_count: 0,
    long_pageviews: 0,
  });
  return cache;
}

export function makeCache(): PubCache {
  const sato: [string, string] = [SATO, 'さとう はなこ'];
  const tanaka: [string, string] = [TANAKA, 'たなか たろう'];

  return {
    meta: {
      base_date: '2026-11-03',
      finished_at: '2026-11-04T19:12:34.567891+00:00',
      mask_threshold: 5,
      is_stale: false,
      last_status: 'success',
    },
    periods: [
      period('last7', 'window', '2026-10-28', '2026-11-03'),
      period('prev7', 'window', '2026-10-21', '2026-10-27'),
      period('last28', 'window', '2026-10-07', '2026-11-03'),
      period('prev28', 'window', '2026-09-09', '2026-10-06'),
      period('m2025-10', 'month', '2025-10-01', '2025-10-31', true),
      period('m2026-10', 'month', '2026-10-01', '2026-10-31', true),
      // 基準日の属する月の end_date は、基準日（バッチの period.py と同じ）。
      period('m2026-11', 'month', '2026-11-01', '2026-11-03'),
    ],
    authors: [
      { author_slug: TANAKA, display_name: tanaka[1], author_url: `${SITE}/author/${TANAKA}/` },
      { author_slug: SATO, display_name: sato[1], author_url: `${SITE}/author/${SATO}/` },
      // slug が決まった形でない著者。著者ページを作らない。
      {
        author_slug: 'suzuki_jiro',
        display_name: 'すずき じろう',
        author_url: `${SITE}/author/suzuki_jiro/`,
      },
    ],
    // わざと post_id の順を崩してある。
    posts: [
      post(106, tanaka, '2026-03-01', 247, 'long'),
      post(101, sato, '2025-06-01', 520, 'long'),
      post(102, sato, '2026-01-15', 292, 'long'),
      post(103, tanaka, '2026-10-10', 24, 'mid'),
      post(104, tanaka, '2026-11-01', 2, 'new'),
      post(105, sato, '2026-09-01', 63, 'mid', true),
    ],
    categories: [
      { category_id: 1, name: '記事', parent_id: null, path: '記事' },
      { category_id: 3, name: 'グルメ', parent_id: 1, path: '記事 > グルメ' },
      { category_id: AD_CATEGORY_ID, name: '広告', parent_id: null, path: '広告' },
      { category_id: 6, name: 'PR', parent_id: AD_CATEGORY_ID, path: '広告 > PR' },
      { category_id: 7, name: 'イベント', parent_id: null, path: 'イベント' },
      { category_id: MAP_CATEGORY_ID, name: 'マップ', parent_id: null, path: 'マップ' },
    ],
    tags: [
      { tag_id: 201, name: 'さんぽ' },
      { tag_id: 202, name: 'なつまつり' },
      { tag_id: 203, name: 'からのタグ' },
    ],
    postCategories: [
      { post_id: 101, category_id: 3 },
      { post_id: 102, category_id: 3 },
      { post_id: 103, category_id: 7 },
      { post_id: 104, category_id: 3 },
      { post_id: 105, category_id: 6 },
      { post_id: 106, category_id: 7 },
    ],
    postTags: [
      { post_id: 105, tag_id: 201 },
      { post_id: 101, tag_id: 201 },
      { post_id: 102, tag_id: 201 },
      { post_id: 103, tag_id: 202 },
    ],
    siteDaily: siteDaily(),
    sitePeriod: [
      {
        period_id: 'last7',
        pageviews: 800,
        sessions: 400,
        active_users: 300,
        engagement_seconds: 9000,
        days: 7,
      },
      {
        period_id: 'prev7',
        pageviews: 700,
        sessions: 350,
        active_users: 280,
        engagement_seconds: 8000,
        days: 7,
      },
      {
        period_id: 'last28',
        pageviews: 3100,
        sessions: 1500,
        active_users: 1100,
        engagement_seconds: 36000,
        days: 28,
      },
      {
        period_id: 'prev28',
        pageviews: 2900,
        sessions: 1400,
        active_users: 1000,
        engagement_seconds: 33000,
        days: 28,
      },
      {
        period_id: 'm2025-10',
        pageviews: 2000,
        sessions: 900,
        active_users: 700,
        engagement_seconds: 20000,
        days: 31,
      },
      {
        period_id: 'm2026-10',
        pageviews: 3500,
        sessions: 1700,
        active_users: 1200,
        engagement_seconds: 40000,
        days: 31,
      },
      // 伏せ値（active_users）。
      {
        period_id: 'm2026-11',
        pageviews: 330,
        sessions: 160,
        active_users: null,
        engagement_seconds: 4000,
        days: 3,
      },
    ],
    sitePeriodBreakdown: [
      ...siteBreakdown('last7', 'channel', {
        search: 200,
        social: 100,
        direct: 60,
        referral: null,
        other: 0,
      }),
      ...siteBreakdown('last7', 'sns', { instagram: 50, facebook: null, x: 10, line: 5, other: 0 }),
      ...siteBreakdown('last7', 'local', { kawasaki: 150, japan_other: 200, unknown: 50 }),
      ...siteBreakdown('last7', 'new_returning', { new: 250, returning: 140, unknown: 10 }),
      ...siteBreakdown('last7', 'device_pv', { mobile: 600, desktop: 180, tablet: null }),
      ...siteBreakdown('last7', 'device_sessions', { mobile: 300, desktop: 90, tablet: null }),
      // 行のない区分は 0 になる。
      ...siteBreakdown('prev7', 'channel', { search: 180 }),
      ...siteBreakdown('last28', 'channel', { search: 700, social: 300 }),
    ],
    siteHeatmap: [
      { period_id: 'last7', dow: 0, hour: 0, pageviews: 5 },
      { period_id: 'last7', dow: 0, hour: 1, pageviews: null },
      { period_id: 'last7', dow: 6, hour: 23, pageviews: 9 },
    ],
    siteFreshness: [
      { period_id: 'last7', freshness: 'new', post_count: 1, pageviews: 12 },
      { period_id: 'last7', freshness: 'long', post_count: 3, pageviews: 135 },
    ],
    siteMonthReferrer: [
      { period_id: 'm2026-10', rank: 2, source_domain: 'instagram.com', sessions: 200 },
      { period_id: 'm2026-10', rank: 1, source_domain: 'google.com', sessions: 500 },
    ],
    siteMonthCity: [
      { period_id: 'm2026-10', rank: 1, region: '神奈川県', city: '川崎市', sessions: 300 },
    ],
    articleDaily: [
      { post_id: 101, day: '2025-10-08', pageviews: 7 },
      { post_id: 102, day: '2026-01-15', pageviews: 10 },
      { post_id: 102, day: '2026-01-16', pageviews: 20 },
      { post_id: 102, day: '2026-11-03', pageviews: 3 },
      { post_id: 104, day: '2026-11-01', pageviews: 5 },
      { post_id: 104, day: '2026-11-03', pageviews: 7 },
    ],
    articleCumulative: [
      { post_id: 102, n: 1, cumulative_pv: 10 },
      { post_id: 102, n: 2, cumulative_pv: 30 },
      { post_id: 102, n: 3, cumulative_pv: 45 },
      { post_id: 104, n: 1, cumulative_pv: 5 },
      { post_id: 104, n: 2, cumulative_pv: 5 },
      { post_id: 104, n: 3, cumulative_pv: 12 },
    ],
    articlePeriod: [
      ...articlePeriods('last7', { 101: 40, 102: 5, 103: 60, 105: 20, 106: 90 }),
      // 伏せ値のある行。
      {
        post_id: 104,
        period_id: 'last7',
        pageviews: 12,
        landing_sessions: null,
        scroll_count: null,
        engagement_seconds: 300,
      },
      ...articlePeriods('prev7', { 101: 30, 102: 10, 103: 50, 106: 20 }),
      ...articlePeriods('last28', { 101: 150, 102: 30, 103: 150, 104: 12, 105: 55, 106: 200 }),
      ...articlePeriods('prev28', { 101: 100, 102: 40, 106: 60 }),
      ...articlePeriods('m2025-10', { 101: 300 }),
      ...articlePeriods('m2026-10', { 101: 140, 102: 35, 103: 138, 105: 50, 106: 190 }),
      ...articlePeriods('m2026-11', { 101: 15, 102: 2, 103: 12, 104: 12, 105: 6, 106: 25 }),
    ],
    articlePeriodBreakdown: [
      ...articleBreakdown(102, 'last28', 'channel', { search: 20, social: null, direct: 5 }),
      ...articleBreakdown(102, 'last28', 'sns', { instagram: null }),
      ...articleBreakdown(102, 'last28', 'device', { mobile: 22, desktop: 6 }),
      // 比較用の期間の行。記事詳細には入れない。
      ...articleBreakdown(102, 'prev28', 'channel', { search: 9 }),
      ...articleBreakdown(103, 'last7', 'channel', { search: 10, social: 40, direct: 5 }),
      // 全区分が伏せ値。
      ...articleBreakdown(106, 'last7', 'channel', {
        search: null,
        social: null,
        direct: null,
        referral: null,
        other: null,
      }),
    ],
    articleReferrer30d: [
      { post_id: 102, rank: 2, source_domain: 'instagram.com', sessions: 12 },
      { post_id: 102, rank: 1, source_domain: 'google.com', sessions: 30 },
    ],
    articleSummary: [
      // 数え始める前に公開した記事。pv_7d、pv_30d、band_30d は null。
      summary(101, { pv_total: 900, is_revival: true, is_evergreen_365: true }),
      summary(102, {
        pv_7d: 120,
        pv_30d: 400,
        pv_total: 2100,
        band_7d: 'upper',
        band_30d: 'upper',
        referrer_30d_computed_on: '2026-02-14',
      }),
      summary(103, {
        pv_7d: 80,
        pv_total: 150,
        band_7d: 'middle',
        band_30d: 'middle',
        is_recent_hot: true,
      }),
      summary(104, { pv_total: 12, is_recent_hot: true }),
      // 広告。最近よく読まれている記事の印が付いていても、一覧には出さない。
      summary(105, {
        pv_7d: 30,
        pv_30d: 60,
        pv_total: 70,
        band_7d: 'lower',
        band_30d: 'lower',
        is_recent_hot: true,
        referrer_30d_computed_on: '2026-10-01',
      }),
      summary(106, {
        pv_7d: 50,
        pv_30d: 200,
        pv_total: 800,
        band_7d: 'middle',
        band_30d: 'middle',
        is_revival: true,
        referrer_30d_computed_on: '2026-03-31',
      }),
    ],
    articleMilestone: [
      { post_id: 102, milestone: 1000, reached_on: '2026-03-01' },
      { post_id: 102, milestone: 500, reached_on: '2026-02-01' },
      { post_id: 106, milestone: 500, reached_on: '2026-04-10' },
    ],
    authorPeriod: [
      // 期間内に公開が 0 本の著者（last7 の さとう）。
      {
        author_slug: TANAKA,
        period_id: 'last7',
        post_count: 1,
        pageviews: 162,
        long_post_count: 1,
        long_pageviews: 90,
      },
      {
        author_slug: SATO,
        period_id: 'last7',
        post_count: 0,
        pageviews: 65,
        long_post_count: 2,
        long_pageviews: 45,
      },
      {
        author_slug: SATO,
        period_id: 'prev7',
        post_count: 0,
        pageviews: 40,
        long_post_count: 2,
        long_pageviews: 40,
      },
      {
        author_slug: TANAKA,
        period_id: 'last28',
        post_count: 2,
        pageviews: 362,
        long_post_count: 1,
        long_pageviews: 200,
      },
      {
        author_slug: SATO,
        period_id: 'last28',
        post_count: 1,
        pageviews: 235,
        long_post_count: 2,
        long_pageviews: 180,
      },
    ],
    authorPeriodBreakdown: [
      { author_slug: SATO, period_id: 'last7', axis: 'channel', bucket: 'search', sessions: 30 },
      { author_slug: SATO, period_id: 'last7', axis: 'channel', bucket: 'social', sessions: null },
      { author_slug: SATO, period_id: 'last7', axis: 'sns', bucket: 'instagram', sessions: null },
    ],
    authorCategoryPeriod: [
      { author_slug: SATO, category_id: 6, period_id: 'last7', post_count: 1, pageviews: 20 },
      { author_slug: SATO, category_id: 3, period_id: 'last7', post_count: 2, pageviews: 45 },
      { author_slug: TANAKA, category_id: 7, period_id: 'last7', post_count: 2, pageviews: 150 },
      { author_slug: TANAKA, category_id: 3, period_id: 'last7', post_count: 1, pageviews: 12 },
    ],
    authorSummary: [
      { author_slug: SATO, own_median_30d: 230, eligible_count: 5, band_30d: 'middle' },
      { author_slug: TANAKA, own_median_30d: null, eligible_count: 2, band_30d: null },
    ],
    categoryPeriod: [
      {
        category_id: 1,
        period_id: 'last7',
        pageviews: 57,
        post_count_total: 3,
        post_count_published: 1,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
      {
        category_id: 3,
        period_id: 'last7',
        pageviews: 57,
        post_count_total: 3,
        post_count_published: 1,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
      {
        category_id: 7,
        period_id: 'last7',
        pageviews: 150,
        post_count_total: 2,
        post_count_published: 0,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
      {
        category_id: AD_CATEGORY_ID,
        period_id: 'last7',
        pageviews: 20,
        post_count_total: 1,
        post_count_published: 0,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
      {
        category_id: 3,
        period_id: 'm2026-10',
        pageviews: 175,
        post_count_total: 3,
        post_count_published: 0,
        median_30d_pv: 210.5,
        published_post_count_30d: 2,
      },
      {
        category_id: 7,
        period_id: 'm2026-10',
        pageviews: 328,
        post_count_total: 2,
        post_count_published: 1,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
      {
        category_id: 3,
        period_id: 'm2025-10',
        pageviews: 300,
        post_count_total: 3,
        post_count_published: 0,
        median_30d_pv: null,
        published_post_count_30d: 0,
      },
    ],
    tagPeriod: [
      { tag_id: 201, period_id: 'last7', pageviews: 65, post_count: 3 },
      { tag_id: 202, period_id: 'last7', pageviews: 60, post_count: 1 },
      // 記事が 0 本のタグ。
      { tag_id: 203, period_id: 'last7', pageviews: 0, post_count: 0 },
      { tag_id: 201, period_id: 'prev7', pageviews: 40, post_count: 3 },
      { tag_id: 201, period_id: 'm2026-10', pageviews: 225, post_count: 3 },
    ],
    postingMonthly: [
      { month: '2025-06-01', post_count: 1 },
      { month: '2026-01-01', post_count: 1 },
      { month: '2026-03-01', post_count: 1 },
      { month: '2026-09-01', post_count: 1 },
      { month: '2026-10-01', post_count: 1 },
      { month: '2026-11-01', post_count: 1 },
    ],
    postingPeriod: [
      { period_id: 'last7', post_count: 1 },
      { period_id: 'prev7', post_count: 0 },
      { period_id: 'last28', post_count: 2 },
      { period_id: 'prev28', post_count: 1 },
      { period_id: 'm2025-10', post_count: 0 },
      { period_id: 'm2026-10', post_count: 1 },
      { period_id: 'm2026-11', post_count: 1 },
    ],
    // n = 3 は母集団が足りず、行がない。
    benchmarkCurve: [
      {
        scope: 'all',
        n: 1,
        p25: 1,
        p50: 2,
        p75: 3,
        population_size: 45,
        population_window: '2025-11-03/2026-11-03',
      },
      {
        scope: 'all',
        n: 2,
        p25: 2,
        p50: 4,
        p75: 6.5,
        population_size: 44,
        population_window: '2025-11-03/2026-11-03',
      },
      {
        scope: 'all',
        n: 30,
        p25: 100,
        p50: 200,
        p75: 300,
        population_size: 40,
        population_window: '2025-11-03/2026-11-03',
      },
    ],
  };
}
