/**
 * ページに埋め込む JSON の zod スキーマ（docs/design/04_api.md §3、§4）。型は src/lib/page-data.ts。
 *
 * - 組み立てた JSON は、埋め込む前にここのスキーマで parse する（列の欠けや型の違いをビルドの失敗にする）。
 * - null を許すのは、型で null を許している項目だけ。
 * - 未知のキーは落とさずに失敗させる（strictObject）。
 * - 型とスキーマのずれは、`satisfies` と末尾の PageDataSchemaChecks でコンパイル時に分かる。
 */
import * as z from 'zod';

import {
  CHANNEL_BUCKETS,
  DEVICE_BUCKETS,
  FRESHNESS_BUCKETS,
  LOCAL_BUCKETS,
  NEW_RETURNING_BUCKETS,
  SNS_BUCKETS,
} from '@/lib/config';
import type {
  ActivityData,
  ArticleDetailData,
  ArticleListData,
  AuthorIndexData,
  AuthorPageData,
  CategoryData,
  DashboardData,
  MonthId,
  SeasonalData,
  TagIndexData,
  TagPageData,
} from '@/lib/page-data';

// --- 部品 ---

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const jstTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
const text = z.string();
const id = z.int().nonnegative();
const count = z.int().nonnegative();
/** 伏せ値のあるセル。null は伏せ値。 */
const masked = count.nullable();
const amount = z.number().nonnegative();

const channel = z.enum(CHANNEL_BUCKETS);
const freshness = z.enum(FRESHNESS_BUCKETS);
const band = z.enum(['upper', 'middle', 'lower']);
const milestone = z.literal([500, 1000, 5000, 10000]);

const MONTH_ID_PATTERN = /^m\d{4}-(0[1-9]|1[0-2])$/;
const windowId = z.enum(['last7', 'last28', 'last90']);
const prevWindowId = z.enum(['prev7', 'prev28', 'prev90']);
const monthId = z.custom<MonthId>(
  (value) => typeof value === 'string' && MONTH_ID_PATTERN.test(value),
);
const selectablePeriodId = z.union([windowId, monthId]);
const periodId = z.union([windowId, prevWindowId, monthId]);

/** 期間ごとの値。ない期間はキーごと省く。 */
const byPeriod = <Value extends z.ZodType>(value: Value) => z.partialRecord(periodId, value);
const bySelectablePeriod = <Value extends z.ZodType>(value: Value) =>
  z.partialRecord(selectablePeriodId, value);
/** カテゴリやタグの ID ごとの値。 */
const byId = <Value extends z.ZodType>(value: Value) => z.record(id, value);

const channelRecord = z.record(channel, masked);
const snsRecord = z.record(z.enum(SNS_BUCKETS), masked);

const benchmarkPoint = { p25: amount, p50: amount, p75: amount };
const benchmarkPointSchema = z.strictObject(benchmarkPoint);

const periodSchema = z.strictObject({
  id: selectablePeriodId,
  kind: z.enum(['window', 'month']),
  start: day,
  end: day,
  isConfirmed: z.boolean(),
  label: text.min(1),
  prevId: periodId.nullable(),
  yoyId: periodId.nullable(),
});

const common = {
  meta: z.strictObject({
    baseDate: day,
    finishedAt: jstTimestamp,
    maskThreshold: count,
    isStale: z.boolean(),
    measureStart: day,
    builtAt: jstTimestamp,
  }),
  periods: z.array(periodSchema),
};

const postRow = {
  id,
  title: text,
  url: text,
  authorSlug: text,
  authorName: text,
  publishedOn: day,
  isAd: z.boolean(),
  ageDays: count,
  freshness,
  isPreMeasure: z.boolean(),
  // null は伏せ値ではなく「値がない」（page-data.ts のコメントに書いた例外）。
  pv7: count.nullable(),
  pv30: count.nullable(),
  band30: band.nullable(),
  pvTotal: count,
  isRecentHot: z.boolean(),
  isRevival: z.boolean(),
  categoryIds: z.array(id),
  tagIds: z.array(id),
};
const postRowSchema = z.strictObject(postRow);

const categoryAxisSchema = z.strictObject({
  parent: z.strictObject({ id, name: text }),
  children: z.array(z.strictObject({ id, name: text })),
});

const tagPeriodSchema = byPeriod(byId(z.strictObject({ pageviews: count, postCount: count })));

// --- S-01 全体 ---

export const dashboardDataSchema = z.strictObject({
  ...common,
  daily: z.strictObject({ firstDay: day, pageviews: z.array(count), sessions: z.array(count) }),
  publishedPerDay: z.strictObject({ firstDay: day, counts: z.array(count) }),
  sitePeriod: byPeriod(
    z.strictObject({
      pageviews: count,
      sessions: count,
      activeUsers: masked,
      engagementSeconds: count,
      days: count,
    }),
  ),
  breakdown: byPeriod(
    z.strictObject({
      channel: channelRecord,
      sns: snsRecord,
      device: z.record(
        z.enum(DEVICE_BUCKETS),
        z.strictObject({ pageviews: masked, sessions: masked }),
      ),
      local: z.record(z.enum(LOCAL_BUCKETS), masked),
      newReturning: z.record(z.enum(NEW_RETURNING_BUCKETS), masked),
    }),
  ),
  heatmap: byPeriod(z.array(masked).length(168)),
  freshness: byPeriod(z.record(freshness, z.strictObject({ postCount: count, pageviews: count }))),
  monthReferrer: byPeriod(z.array(z.strictObject({ domain: text, sessions: count }))),
  monthCity: byPeriod(z.array(z.strictObject({ region: text, city: text, sessions: count }))),
  posting: byPeriod(z.strictObject({ postCount: count })),
  benchmark30: z
    .strictObject({ ...benchmarkPoint, populationSize: count, populationWindow: text })
    .nullable(),
}) satisfies z.ZodType<DashboardData>;

// --- S-02 記事一覧 ---

export const articleListDataSchema = z.strictObject({
  ...common,
  posts: z.array(postRowSchema),
  pvByPeriod: byPeriod(z.array(count)).optional(),
  topIndex: byPeriod(z.array(count)).optional(),
  categories: z.array(z.strictObject({ id, name: text, parentId: id.nullable(), path: text })),
  authors: z.array(z.strictObject({ slug: text, name: text })),
  benchmark: benchmarkPointSchema.nullable(),
}) satisfies z.ZodType<ArticleListData>;

// --- S-03 記事詳細 ---

/** 90 日ぶんの列。母集団が足りない n は null（伏せ値ではない）。 */
const curve = z.array(amount.nullable()).length(90);

export const articleDetailDataSchema = z.strictObject({
  ...common,
  post: z.strictObject({
    ...postRow,
    categories: z.array(z.strictObject({ id, path: text })),
    tags: z.array(z.strictObject({ id, name: text })),
  }),
  daily: z.strictObject({ firstDay: day, pageviews: z.array(count) }),
  // 計測を始める前に公開した記事は空。それ以外は 90 要素で、まだたっていない日は null。
  cumulative: z
    .array(count.nullable())
    .refine((values) => values.length === 0 || values.length === 90),
  benchmark: z
    .strictObject({
      p25: curve,
      p50: curve,
      p75: curve,
      populationSize: count,
      populationWindow: text,
    })
    .nullable(),
  period: bySelectablePeriod(
    z.strictObject({
      pageviews: count,
      landingSessions: masked,
      scrollCount: masked,
      engagementSeconds: masked,
    }),
  ),
  breakdown: bySelectablePeriod(
    z.strictObject({
      channel: channelRecord,
      sns: snsRecord,
      device: z.record(z.enum(DEVICE_BUCKETS), masked),
    }),
  ),
  referrer30d: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('ready'),
      rows: z.array(z.strictObject({ domain: text, sessions: count })),
    }),
    z.strictObject({ status: z.literal('pending') }),
  ]),
  milestones: z.array(z.strictObject({ milestone, reachedOn: day })),
  isEvergreen365: z.boolean(),
  ownMedian30d: z.strictObject({ value: amount }).nullable(),
}) satisfies z.ZodType<ArticleDetailData>;

// --- S-04 / S-05 著者 ---

const author = z.strictObject({ slug: text, name: text, url: text });
const authorBreakdown = byPeriod(z.strictObject({ channel: channelRecord, sns: snsRecord }));

export const authorIndexDataSchema = z.strictObject({
  ...common,
  authors: z.array(author),
}) satisfies z.ZodType<AuthorIndexData>;

export const authorPageDataSchema = z.strictObject({
  ...common,
  author,
  period: byPeriod(
    z.strictObject({
      postCount: count,
      pageviews: count,
      longPostCount: count,
      longPageviews: count,
    }),
  ),
  breakdown: authorBreakdown,
  siteBreakdown: authorBreakdown,
  categoryMix: byPeriod(
    z.array(z.strictObject({ categoryId: id, path: text, postCount: count, pageviews: count })),
  ),
  summary: z.strictObject({
    ownMedian30d: amount.nullable(),
    eligibleCount: count,
    band30: band.nullable(),
  }),
  posts: z.array(postRowSchema),
  pvByPeriod: byPeriod(z.array(count)),
  topChannelByPeriod: byPeriod(z.array(channel.nullable())),
  milestones: z.array(z.strictObject({ postId: id, milestone, reachedOn: day })),
  benchmark: benchmarkPointSchema.nullable(),
}) satisfies z.ZodType<AuthorPageData>;

// --- S-06 / S-07 カテゴリとタグ ---

export const categoryDataSchema = z.strictObject({
  ...common,
  axes: z.array(categoryAxisSchema),
  period: byPeriod(
    byId(
      z.strictObject({
        pageviews: count,
        postCountTotal: count,
        postCountPublished: count,
        // null は「該当する記事がない」（伏せ値ではない。page-data.ts のコメントに書いた例外）。
        median30: amount.nullable(),
        median30Count: count,
      }),
    ),
  ),
}) satisfies z.ZodType<CategoryData>;

export const seasonalDataSchema = z.strictObject({
  ...common,
  axes: z.array(categoryAxisSchema),
  months: z.array(monthId),
  pvByMonth: byId(z.partialRecord(monthId, count)),
}) satisfies z.ZodType<SeasonalData>;

export const tagIndexDataSchema = z.strictObject({
  ...common,
  tags: z.array(z.strictObject({ id, name: text })),
  period: tagPeriodSchema,
}) satisfies z.ZodType<TagIndexData>;

export const tagPageDataSchema = z.strictObject({
  ...common,
  tag: z.strictObject({ id, name: text }),
  posts: z.array(postRowSchema),
  pvByPeriod: byPeriod(z.array(count)),
  period: tagPeriodSchema,
}) satisfies z.ZodType<TagPageData>;

// --- S-08 投稿活動 ---

export const activityDataSchema = z.strictObject({
  ...common,
  monthly: z.array(z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/), postCount: count })),
  posting: byPeriod(z.strictObject({ postCount: count })),
  authorCounts: byPeriod(
    z.array(z.strictObject({ name: text, slug: text, postCount: count.min(1) })),
  ),
  categoryMix: byPeriod(
    z.array(z.strictObject({ categoryId: id, path: text, postCountPublished: count })),
  ),
}) satisfies z.ZodType<ActivityData>;

// --- 型とスキーマの突き合わせ（コンパイル時。両方向） ---

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<C extends true> = C;

/** スキーマが型より広くても狭くても、ここでコンパイルが失敗する。 */
export type PageDataSchemaChecks = [
  Expect<Mutual<z.output<typeof dashboardDataSchema>, DashboardData>>,
  Expect<Mutual<z.output<typeof articleListDataSchema>, ArticleListData>>,
  Expect<Mutual<z.output<typeof articleDetailDataSchema>, ArticleDetailData>>,
  Expect<Mutual<z.output<typeof authorIndexDataSchema>, AuthorIndexData>>,
  Expect<Mutual<z.output<typeof authorPageDataSchema>, AuthorPageData>>,
  Expect<Mutual<z.output<typeof categoryDataSchema>, CategoryData>>,
  Expect<Mutual<z.output<typeof seasonalDataSchema>, SeasonalData>>,
  Expect<Mutual<z.output<typeof tagIndexDataSchema>, TagIndexData>>,
  Expect<Mutual<z.output<typeof tagPageDataSchema>, TagPageData>>,
  Expect<Mutual<z.output<typeof activityDataSchema>, ActivityData>>,
];

/**
 * 検査そのものの確認。null を許すかどうかだけが違う型と、キーが 1 つ多い型は、ずれとして検出される。
 * 検出できなくなったら、下の行（@ts-expect-error）がコンパイルエラーになる。
 */
export type PageDataSchemaSelfChecks = [
  // @ts-expect-error -- null の有無の違いを検出する
  Expect<Mutual<{ value: number }, { value: number | null }>>,
  // @ts-expect-error -- キーの過不足を検出する
  Expect<Mutual<{ value: number; extra: number }, { value: number }>>,
  // @ts-expect-error -- 別の画面のスキーマとの取り違えを検出する
  Expect<Mutual<z.output<typeof authorIndexDataSchema>, DashboardData>>,
];
