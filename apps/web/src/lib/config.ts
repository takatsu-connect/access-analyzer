/**
 * 言語をまたぐ定数（TypeScript 側）。
 *
 * 正は リポジトリ直下の contracts/constants.json。値を変えるときは JSON を先に直す。
 * 一致は tests/lib/contracts.test.ts で検査する（07 §7 S-16）。
 */

/** 外部リンク先として許すオリジン（06 §7）。 */
export const SITE_ORIGIN = 'https://takatsu-connect.com';

/** 読まれた回数を数え始めた日（JST の暦日）。バッチの BACKFILL_START と同じ値。 */
export const MEASURE_START = '2025-10-08';

/** 広告カテゴリの ID（配下の子カテゴリも広告の軸）。 */
export const AD_CATEGORY_ID = 188;

/** 「記事」の親カテゴリの ID。この親か、その子に属する記事が、記事の種類「記事」。 */
export const ARTICLE_CATEGORY_ID = 10;

/** 「イベント」の親カテゴリの ID。この親か、その子に属する記事が、記事の種類「イベント」。 */
export const EVENT_CATEGORY_ID = 9;

/** 流入チャネルの 5 区分。 */
export const CHANNEL_BUCKETS = ['search', 'social', 'direct', 'referral', 'other'] as const;

/** SNS の 5 区分。 */
export const SNS_BUCKETS = ['instagram', 'facebook', 'x', 'line', 'other'] as const;

/** デバイス種別。 */
export const DEVICE_BUCKETS = ['mobile', 'desktop', 'tablet'] as const;

/** 初めて・また来た。 */
export const NEW_RETURNING_BUCKETS = ['new', 'returning', 'unknown'] as const;

/** 地元（川崎市）かどうか。 */
export const LOCAL_BUCKETS = ['kawasaki', 'japan_other', 'unknown'] as const;

/** 記事の鮮度区分。 */
export const FRESHNESS_BUCKETS = ['new', 'mid', 'long'] as const;

/** サイト全体の内訳の軸。 */
export const SITE_AXES = [
  'sns',
  'new_returning',
  'local',
  'channel',
  'device_pv',
  'device_sessions',
  // 曜日ごと（'0' = 日曜）と時間帯ごと（'0'〜'23'）の合計。S-01 のヒートマップの平均に使う（ADR 0003 判断 8）。
  'dow',
  'hour',
] as const;

/** 記事の内訳の軸。 */
export const ARTICLE_AXES = ['channel', 'sns', 'device'] as const;

/** 著者の内訳の軸。 */
export const AUTHOR_AXES = ['channel', 'sns'] as const;

/** 移動窓の期間 ID。 */
export const WINDOW_PERIOD_IDS = [
  'last7',
  'prev7',
  'last28',
  'prev28',
  'last90',
  'prev90',
] as const;

// --- BI だけの設定値 ---
// contracts/constants.json にはない（バッチは使わない）。名前を足すときは、
// tests/lib/contracts.test.ts の BI_ONLY_CONSTANTS にも足す。

/** 比率（%）、変化率、「10 人中 ◯人」を出す分母の下限（05 §2.3、NFR-96）。 */
export const RATIO_MIN_DENOMINATOR = 20;

/** あとで増えることがある日数。基準日から 2 日前までの 3 日分（05 §2.4）。 */
export const UNCONFIRMED_DAYS = 3;

/** 今日 − 基準日 がこの日数以上なら「更新が遅れています」を出す（05 §2.7、U-25）。 */
export const STALE_AFTER_DAYS = 3;

/** 既定の期間（05 §2.5）。 */
export const DEFAULT_PERIOD_ID = 'last28';

/** 選べる月の上限（04 §3.1）。 */
export const MAX_MONTHS = 36;

export type ChannelBucket = (typeof CHANNEL_BUCKETS)[number];
export type SnsBucket = (typeof SNS_BUCKETS)[number];
export type DeviceBucket = (typeof DEVICE_BUCKETS)[number];
export type NewReturningBucket = (typeof NEW_RETURNING_BUCKETS)[number];
export type LocalBucket = (typeof LOCAL_BUCKETS)[number];
export type FreshnessBucket = (typeof FRESHNESS_BUCKETS)[number];
export type WindowPeriodId = (typeof WINDOW_PERIOD_IDS)[number];
