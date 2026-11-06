/**
 * S-02 記事一覧（04 §3.3）と S-03 記事詳細（04 §3.4）。
 *
 * 記事ごとの期間の値（pvByPeriod、topIndex、period、breakdown）は、選べる期間だけを持つ。
 * 比較用の prev7 / prev28 / prev90 は入れない（記事の単位では前の期間と比べない）。
 */
import {
  ARTICLE_AXES,
  CHANNEL_BUCKETS,
  DEVICE_BUCKETS,
  MEASURE_START,
  SNS_BUCKETS,
} from '@/lib/config';
import type {
  ArticleBreakdown,
  ArticleDetailData,
  ArticleListData,
  ArticleListKind,
  ByPeriod,
  PeriodId,
} from '@/lib/page-data';
import { articleDetailDataSchema, articleListDataSchema } from '@/lib/page-data-schema';
import type { PubArticlePeriodBreakdown, PubCache, PubPost } from '@/lib/pub-types';

import {
  benchmark30,
  benchmarkRow,
  bucketRecord,
  buildCommon,
  byPeriod,
  compareJa,
  dailySeries,
  pageAuthors,
  pvByPeriodOf,
  rowsOf,
  selectableIds,
  sortedPosts,
  toPostRow,
} from './shared';
import { checkPage } from './check';
import { isDisplayableDomain } from '@/lib/derive';

/** 一覧に載せる件数の上限。 */
export type ListLimits = { top: number; recent: number };
const DEFAULT_LIMITS: ListLimits = { top: 50, recent: 10 };

const CURVE_DAYS = 90;

/** generateStaticParams 用。公開記事の post_id だけ。 */
export function listArticleIds(cache: PubCache): number[] {
  return sortedPosts(cache).map((post) => post.post_id);
}

/** 期間 → 記事 → 読まれた回数。 */
function pvOf(cache: PubCache, periodId: PeriodId): Map<number, number> {
  return new Map(
    rowsOf(cache.articlePeriod, 'period_id', periodId).map((row) => [row.post_id, row.pageviews]),
  );
}

/** 期間ごとに、読まれた回数の多い順の上位 limit 件の post_id。0 回の記事は入れない。 */
function rankByPeriod(
  cache: PubCache,
  candidates: readonly PubPost[],
  periodIds: readonly PeriodId[],
  limit: number,
): Map<PeriodId, number[]> {
  const ranking = new Map<PeriodId, number[]>();
  for (const id of periodIds) {
    const pv = pvOf(cache, id);
    const ranked = candidates
      .map((post) => ({ postId: post.post_id, pageviews: pv.get(post.post_id) ?? 0 }))
      .filter((entry) => entry.pageviews > 0)
      .sort((a, b) => b.pageviews - a.pageviews || a.postId - b.postId)
      .slice(0, limit);
    ranking.set(
      id,
      ranked.map((entry) => entry.postId),
    );
  }
  return ranking;
}

export function buildArticleList(
  cache: PubCache,
  kind: ArticleListKind,
  builtAt: Date,
  limits: ListLimits = DEFAULT_LIMITS,
): ArticleListData {
  const common = buildCommon(cache, builtAt);
  const selectable = selectableIds(common);
  const all = sortedPosts(cache);
  // 広告は、記事を探す画面（search）以外では除く。
  const nonAd = all.filter((post) => !post.is_ad);

  let posts: PubPost[];
  let topIndex: ByPeriod<number[]> | undefined;

  if (kind === 'top' || kind === 'long') {
    const candidates = kind === 'long' ? nonAd.filter((post) => post.freshness === 'long') : nonAd;
    const ranking = rankByPeriod(cache, candidates, selectable, limits.top);
    // いずれかの期間で上位に入る記事の和集合。順は post_id の昇順のまま。
    const included = new Set([...ranking.values()].flat());
    posts = candidates.filter((post) => included.has(post.post_id));
    const indexOf = new Map(posts.map((post, index) => [post.post_id, index]));
    topIndex = byPeriod(selectable, (id) =>
      (ranking.get(id) ?? []).flatMap((postId) => {
        const index = indexOf.get(postId);
        return index === undefined ? [] : [index];
      }),
    );
  } else if (kind === 'recent') {
    const last7 = pvOf(cache, 'last7');
    const flagged = nonAd.filter((post) => {
      const summary = rowsOf(cache.articleSummary, 'post_id', post.post_id)[0];
      return summary !== undefined && (summary.is_recent_hot || summary.is_revival);
    });
    // 件数が多いときは、直近 7 日の読まれた回数の多い順に切る。切ったあとは post_id の昇順に戻す。
    posts = flagged
      .sort(
        (a, b) =>
          (last7.get(b.post_id) ?? 0) - (last7.get(a.post_id) ?? 0) || a.post_id - b.post_id,
      )
      .slice(0, limits.recent)
      .sort((a, b) => a.post_id - b.post_id);
  } else if (kind === 'new') {
    posts = nonAd;
  } else {
    posts = all;
  }

  const data: ArticleListData = {
    ...common,
    posts: posts.map((post) => toPostRow(cache, post, kind === 'search')),
    // 新着の立ち上がり（new）は期間の値を使わないので省く。
    ...(kind === 'new' ? {} : { pvByPeriod: pvByPeriodOf(cache, posts, selectable) }),
    ...(topIndex === undefined ? {} : { topIndex }),
    categories: [...cache.categories]
      .sort((a, b) => compareJa(a.path, b.path) || a.category_id - b.category_id)
      .map((row) => ({
        id: row.category_id,
        name: row.name,
        parentId: row.parent_id,
        path: row.path,
      })),
    // 絞り込みの許可リスト。著者ページのある著者だけ（posts[].authorSlug に現れる値と同じ集合）。
    authors: pageAuthors(cache).map((row) => ({ slug: row.author_slug, name: row.display_name })),
    benchmark: benchmark30(cache),
  };
  return checkPage(articleListDataSchema, data, 'articleListDataSchema');
}

/** 1 つの期間の記事の内訳。行がなければ undefined。 */
function articleBreakdownOf(
  rows: readonly PubArticlePeriodBreakdown[],
): ArticleBreakdown | undefined {
  if (rows.length === 0) return undefined;
  const knownAxes: readonly string[] = ARTICLE_AXES;
  if (rows.some((row) => !knownAxes.includes(row.axis))) {
    throw new Error('pub_article_period_breakdown に、定義にない軸の行があります');
  }
  const axis = (name: (typeof ARTICLE_AXES)[number]) =>
    rows
      .filter((row) => row.axis === name)
      .map((row) => ({ bucket: row.bucket, value: row.sessions }));
  return {
    channel: bucketRecord(CHANNEL_BUCKETS, axis('channel')),
    sns: bucketRecord(SNS_BUCKETS, axis('sns')),
    device: bucketRecord(DEVICE_BUCKETS, axis('device')),
  };
}

/** 全体の分布の曲線（n = 1..90）。行のない n は null。1 行もなければ全体が null。 */
function benchmarkCurveOf(cache: PubCache): ArticleDetailData['benchmark'] {
  const rows = cache.benchmarkCurve.filter((row) => row.scope === 'all');
  if (rows.length === 0) return null;

  const p25 = new Array<number | null>(CURVE_DAYS).fill(null);
  const p50 = new Array<number | null>(CURVE_DAYS).fill(null);
  const p75 = new Array<number | null>(CURVE_DAYS).fill(null);
  for (const row of rows) {
    p25[row.n - 1] = row.p25;
    p50[row.n - 1] = row.p50;
    p75[row.n - 1] = row.p75;
  }
  // 母集団の大きさは n = 30 の行の値。なければ、行のあるいちばん大きい n の値。
  const population =
    benchmarkRow(cache, 30) ?? rows.reduce((best, row) => (row.n > best.n ? row : best));
  return {
    p25,
    p50,
    p75,
    populationSize: population.population_size,
    populationWindow: population.population_window,
  };
}

/** 記事詳細。公開記事にない post_id は null（404）。 */
export function buildArticleDetail(
  cache: PubCache,
  postId: number,
  builtAt: Date,
): ArticleDetailData | null {
  if (!Number.isSafeInteger(postId)) return null;
  const post = rowsOf(cache.posts, 'post_id', postId)[0];
  const summary = rowsOf(cache.articleSummary, 'post_id', postId)[0];
  if (post === undefined) return null;
  if (summary === undefined) throw new Error('pub_article_summary に行のない記事があります');

  const common = buildCommon(cache, builtAt);
  const selectable = selectableIds(common);
  const row = toPostRow(cache, post, false);

  const categoryById = new Map(
    cache.categories.map((category) => [category.category_id, category]),
  );
  const tagById = new Map(cache.tags.map((tag) => [tag.tag_id, tag]));

  const cumulative = new Array<number | null>(CURVE_DAYS).fill(null);
  for (const point of rowsOf(cache.articleCumulative, 'post_id', postId)) {
    cumulative[point.n - 1] = point.cumulative_pv;
  }

  const periodRows = rowsOf(cache.articlePeriod, 'post_id', postId);
  const breakdownRows = rowsOf(cache.articlePeriodBreakdown, 'post_id', postId);
  const ownMedian = rowsOf(cache.authorSummary, 'author_slug', post.author_slug)[0]?.own_median_30d;

  const data: ArticleDetailData = {
    ...common,
    post: {
      ...row,
      categories: rowsOf(cache.postCategories, 'post_id', postId)
        .flatMap((link) => {
          const category = categoryById.get(link.category_id);
          return category === undefined ? [] : [{ id: category.category_id, path: category.path }];
        })
        .sort((a, b) => compareJa(a.path, b.path) || a.id - b.id),
      tags: rowsOf(cache.postTags, 'post_id', postId)
        .flatMap((link) => {
          const tag = tagById.get(link.tag_id);
          return tag === undefined ? [] : [{ id: tag.tag_id, name: tag.name }];
        })
        .sort((a, b) => compareJa(a.name, b.name) || a.id - b.id),
    },
    daily: (() => {
      // 公開日から基準日まで。数え始める前に公開した記事は、数え始めた日から。
      const firstDay = row.isPreMeasure ? MEASURE_START : post.published_on;
      return {
        firstDay,
        pageviews: dailySeries(
          firstDay,
          cache.meta.base_date,
          rowsOf(cache.articleDaily, 'post_id', postId).map((daily) => ({
            day: daily.day,
            value: daily.pageviews,
          })),
        ),
      };
    })(),
    // 数え始める前に公開した記事は、公開してすぐの数字がないので曲線を出さない。
    cumulative: row.isPreMeasure ? [] : cumulative,
    benchmark: benchmarkCurveOf(cache),
    period: byPeriod(selectable, (id) => {
      const value = periodRows.find((periodRow) => periodRow.period_id === id);
      return value === undefined
        ? undefined
        : {
            pageviews: value.pageviews,
            landingSessions: value.landing_sessions,
            scrollCount: value.scroll_count,
            engagementSeconds: value.engagement_seconds,
          };
    }),
    breakdown: byPeriod(selectable, (id) =>
      articleBreakdownOf(breakdownRows.filter((breakdownRow) => breakdownRow.period_id === id)),
    ),
    referrer30d:
      summary.referrer_30d_computed_on === null
        ? { status: 'pending' }
        : {
            status: 'ready',
            rows: [...rowsOf(cache.articleReferrer30d, 'post_id', postId)]
              .sort((a, b) => a.rank - b.rank)
              .filter((referrer) => isDisplayableDomain(referrer.source_domain))
              .map((referrer) => ({ domain: referrer.source_domain, sessions: referrer.sessions })),
          },
    milestones: [...rowsOf(cache.articleMilestone, 'post_id', postId)]
      .sort((a, b) => a.milestone - b.milestone)
      .map((milestone) => ({ milestone: milestone.milestone, reachedOn: milestone.reached_on })),
    isEvergreen365: summary.is_evergreen_365,
    ownMedian30d: ownMedian === undefined || ownMedian === null ? null : { value: ownMedian },
  };
  return checkPage(articleDetailDataSchema, data, 'articleDetailDataSchema');
}
