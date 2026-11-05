/**
 * ページに埋め込む JSON の型（docs/design/04_api.md §3）。
 *
 * ビルド時の組み立て（src/data/pages）とクライアントの部品が、同じ型を使う。
 * null の意味は 1 つだけ: 伏せ値（公開ビューで null の値）。例外は、コメントに書いたものだけ。
 * 区分の名前は contracts/constants.json を正とする（src/lib/config.ts の定数と同じ）。
 */

// --- 区分 ---

export type Channel = 'search' | 'social' | 'direct' | 'referral' | 'other';
export type SnsBucket = 'instagram' | 'facebook' | 'x' | 'line' | 'other';
export type Device = 'mobile' | 'desktop' | 'tablet';
export type NewReturning = 'new' | 'returning' | 'unknown';
export type LocalBucket = 'kawasaki' | 'japan_other' | 'unknown';
export type Freshness = 'new' | 'mid' | 'long';
export type Band = 'upper' | 'middle' | 'lower';
export type Milestone = 500 | 1000 | 5000 | 10000;

// --- 期間 ---

/** 選べる移動窓。 */
export type WindowId = 'last7' | 'last28' | 'last90';
/** 比較の相手としてだけ使う移動窓。選択肢に出さない。 */
export type PrevWindowId = 'prev7' | 'prev28' | 'prev90';
/** 月。'm2026-10' の形。 */
export type MonthId = `m${number}-${string}`;
export type PeriodId = WindowId | PrevWindowId | MonthId;
/** 利用者が選べる期間（移動窓 3 つと月）。 */
export type SelectablePeriodId = WindowId | MonthId;

/** 期間ごとの値。ない期間は undefined（noUncheckedIndexedAccess で検査される）。 */
export type ByPeriod<T> = Partial<Record<PeriodId, T>>;
export type BySelectablePeriod<T> = Partial<Record<SelectablePeriodId, T>>;

export type Period = {
  id: SelectablePeriodId;
  kind: 'window' | 'month';
  /** 'YYYY-MM-DD'（JST の暦日）。 */
  start: string;
  end: string;
  /** 月だけ意味を持つ。移動窓は常に false。 */
  isConfirmed: boolean;
  /** '直近 28 日' / '2026 年 10 月'。 */
  label: string;
  /** 前の期間。last28 → prev28、m2026-10 → m2026-09。なければ null。 */
  prevId: PeriodId | null;
  /** 月だけ。前年同月。なければ null（「前年のデータなし」）。 */
  yoyId: PeriodId | null;
};

// --- 共通 ---

export type PageMeta = {
  /** 'YYYY-MM-DD'（JST の暦日。pub_meta.base_date）。 */
  baseDate: string;
  /** 'YYYY-MM-DDTHH:mm:ss+09:00'（pub_meta.finished_at を JST にした値）。 */
  finishedAt: string;
  maskThreshold: number;
  isStale: boolean;
  /** 読まれた回数を数え始めた日。'YYYY-MM-DD'（設定値 MEASURE_START）。 */
  measureStart: string;
  /** ビルドの時刻（JST）。画面の「◯月◯日までのデータ」には使わない。 */
  builtAt: string;
};

export type PageCommon = {
  meta: PageMeta;
  /** 選べる期間の一覧（移動窓 3 つと月。月は直近 36 か月まで）。 */
  periods: Period[];
};

/** 伏せ値のあるセル。null は伏せ値。 */
export type Masked = number | null;

export type BenchmarkPoint = { p25: number; p50: number; p75: number };

// --- S-01 全体 ---

export type SitePeriodValue = {
  pageviews: number;
  sessions: number;
  activeUsers: Masked;
  engagementSeconds: number;
  days: number;
};

export type SiteBreakdown = {
  /** 訪問回数。期間値（日別の合算ではない）。 */
  channel: Record<Channel, Masked>;
  sns: Record<SnsBucket, Masked>;
  device: Record<Device, { pageviews: Masked; sessions: Masked }>;
  local: Record<LocalBucket, Masked>;
  newReturning: Record<NewReturning, Masked>;
};

export type DashboardData = PageCommon & {
  /** 列指向。firstDay から 1 日 1 要素。 */
  daily: { firstDay: string; pageviews: number[]; sessions: number[] };
  /** 日ごとの公開本数（M-26）。 */
  publishedPerDay: { firstDay: string; counts: number[] };
  sitePeriod: ByPeriod<SitePeriodValue>;
  breakdown: ByPeriod<SiteBreakdown>;
  /** 168 要素。index = dow * 24 + hour（dow 0 = 日曜）。 */
  heatmap: ByPeriod<Masked[]>;
  /** 公開記事の合算。sitePeriod.pageviews（記事以外のページを含む）とは一致しない。 */
  freshness: ByPeriod<Record<Freshness, { postCount: number; pageviews: number }>>;
  /** 確定月だけ。多い順。 */
  monthReferrer: ByPeriod<{ domain: string; sessions: number }[]>;
  monthCity: ByPeriod<{ region: string; city: string; sessions: number }[]>;
  posting: ByPeriod<{ postCount: number }>;
  /** 母集団が 30 本に満たなければ null（「まだ比較できません」）。 */
  benchmark30: (BenchmarkPoint & { populationSize: number; populationWindow: string }) | null;
};

// --- S-02 記事一覧 ---

export type PostRow = {
  id: number;
  title: string;
  url: string;
  /** href にだけ使う。画面に文字として出さない。 */
  authorSlug: string;
  authorName: string;
  /** 'YYYY-MM-DD'。 */
  publishedOn: string;
  isAd: boolean;
  ageDays: number;
  freshness: Freshness;
  /**
   * 数え始める前（meta.measureStart より前）に公開した記事。公開してすぐの数字が残っていない。
   * 画面は null から不在の理由を推測せず、この印で文言を切り替える。
   */
  isPreMeasure: boolean;
  /**
   * 最初の 1 週間 / 1 か月で読まれた回数。null は伏せ値ではなく「値がない」:
   * まだその日数がたっていない（isPreMeasure = false）か、数え始める前に公開した記事。
   */
  pv7: number | null;
  pv30: number | null;
  /** null は「まだ比較できません」か、数え始める前に公開した記事（伏せ値ではない）。 */
  band30: Band | null;
  /** 現時点の累積。数え始める前に公開した記事では、数え始めてからの合計。 */
  pvTotal: number;
  isRecentHot: boolean;
  isRevival: boolean;
  /** S-02e（記事を探す）だけ。ほかは空の配列。 */
  categoryIds: number[];
  tagIds: number[];
};

export type ArticleListKind = 'top' | 'new' | 'long' | 'recent' | 'search';

export type ArticleListData = PageCommon & {
  posts: PostRow[];
  /** posts と同じ順の列指向の配列（伏せなし）。S-02b では省略する。 */
  pvByPeriod?: ByPeriod<number[]>;
  /** S-02a / S-02c: 期間ごとの上位 50 の posts の添字（多い順）。番号は画面に出さない。 */
  topIndex?: ByPeriod<number[]>;
  categories: { id: number; name: string; parentId: number | null; path: string }[];
  /** 名前の順。 */
  authors: { slug: string; name: string }[];
  /** n = 30 の 1 行。母集団不足は null。 */
  benchmark: BenchmarkPoint | null;
};

// --- S-03 記事詳細 ---

export type ArticlePeriodValue = {
  pageviews: number;
  landingSessions: Masked;
  scrollCount: Masked;
  engagementSeconds: Masked;
};

export type ArticleBreakdown = {
  channel: Record<Channel, Masked>;
  sns: Record<SnsBucket, Masked>;
  device: Record<Device, Masked>;
};

export type ArticleDetailData = PageCommon & {
  post: PostRow & {
    categories: { id: number; path: string }[];
    tags: { id: number; name: string }[];
  };
  /** 公開日（計測開始より前なら計測開始日）から基準日まで。 */
  daily: { firstDay: string; pageviews: number[] };
  /**
   * 添字 0 = 1 日目 … 89 = 90 日目。まだたっていない日は null（伏せ値ではない）。
   * 計測を始める前に公開した記事は、空の配列（曲線を出さない）。
   */
  cumulative: (number | null)[];
  /** n = 1..90。母集団が足りない n は欠ける。全体が出せなければ null。 */
  benchmark: {
    p25: (number | null)[];
    p50: (number | null)[];
    p75: (number | null)[];
    populationSize: number;
    populationWindow: string;
  } | null;
  /** 選べる期間だけ。記事では前の期間と比べない。 */
  period: BySelectablePeriod<ArticlePeriodValue>;
  breakdown: BySelectablePeriod<ArticleBreakdown>;
  /** pending は「公開 30 日後に出ます」。 */
  referrer30d:
    { status: 'ready'; rows: { domain: string; sessions: number }[] } | { status: 'pending' };
  milestones: { milestone: Milestone; reachedOn: string }[];
  isEvergreen365: boolean;
  /** 著者の記事が 5 本に満たなければ null。 */
  ownMedian30d: { value: number } | null;
};

// --- S-04 / S-05 著者 ---

export type AuthorIndexData = PageCommon & {
  /** 名前の順。数値を持たない。 */
  authors: { slug: string; name: string; url: string }[];
};

export type AuthorPeriodValue = {
  postCount: number;
  pageviews: number;
  longPostCount: number;
  longPageviews: number;
};

export type AuthorBreakdown = {
  channel: Record<Channel, Masked>;
  sns: Record<SnsBucket, Masked>;
};

export type AuthorPageData = PageCommon & {
  author: { slug: string; name: string; url: string };
  period: ByPeriod<AuthorPeriodValue>;
  breakdown: ByPeriod<AuthorBreakdown>;
  /** サイト全体の構成。比較の相手。 */
  siteBreakdown: ByPeriod<AuthorBreakdown>;
  categoryMix: ByPeriod<
    { categoryId: number; path: string; postCount: number; pageviews: number }[]
  >;
  summary: { ownMedian30d: number | null; eligibleCount: number; band30: Band | null };
  posts: PostRow[];
  /** posts と同じ順。 */
  pvByPeriod: ByPeriod<number[]>;
  /** 流入の主な経路。全区分が伏せ値なら null。 */
  topChannelByPeriod: ByPeriod<(Channel | null)[]>;
  milestones: { postId: number; milestone: Milestone; reachedOn: string }[];
  benchmark: BenchmarkPoint | null;
};

// --- S-06 / S-07 カテゴリとシリーズ ---

export type CategoryAxis = {
  parent: { id: number; name: string };
  children: { id: number; name: string }[];
};

export type CategoryPeriodValue = {
  pageviews: number;
  postCountTotal: number;
  postCountPublished: number;
  /** 期間内に公開して 30 日たった記事の中央値。該当がなければ null（伏せ値ではない）。 */
  median30: number | null;
  median30Count: number;
};

export type CategoryData = PageCommon & {
  /** 記事 / イベント / マップ / 広告 の順。 */
  axes: CategoryAxis[];
  period: ByPeriod<Record<number, CategoryPeriodValue>>;
};

export type SeasonalData = PageCommon & {
  axes: CategoryAxis[];
  /** 直近 24 か月（ある月だけ）。 */
  months: MonthId[];
  pvByMonth: Record<number, Partial<Record<MonthId, number>>>;
};

export type TagPeriodValue = { pageviews: number; postCount: number };

export type TagIndexData = PageCommon & {
  /** 名前の順。 */
  tags: { id: number; name: string }[];
  period: ByPeriod<Record<number, TagPeriodValue>>;
};

export type TagPageData = PageCommon & {
  tag: { id: number; name: string };
  posts: PostRow[];
  pvByPeriod: ByPeriod<number[]>;
  period: ByPeriod<Record<number, TagPeriodValue>>;
};

// --- S-08 投稿活動 ---

export type ActivityData = PageCommon & {
  /** 'YYYY-MM'。直近 24 か月。 */
  monthly: { month: string; postCount: number }[];
  posting: ByPeriod<{ postCount: number }>;
  /** 名前の順で固定。期間内に 1 本以上公開した著者だけ。 */
  authorCounts: ByPeriod<{ name: string; slug: string; postCount: number }[]>;
  categoryMix: ByPeriod<{ categoryId: number; path: string; postCountPublished: number }[]>;
};
