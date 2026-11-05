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

export type ChannelBucket = (typeof CHANNEL_BUCKETS)[number];
export type SnsBucket = (typeof SNS_BUCKETS)[number];
export type DeviceBucket = (typeof DEVICE_BUCKETS)[number];
export type NewReturningBucket = (typeof NEW_RETURNING_BUCKETS)[number];
export type LocalBucket = (typeof LOCAL_BUCKETS)[number];
export type FreshnessBucket = (typeof FRESHNESS_BUCKETS)[number];
export type WindowPeriodId = (typeof WINDOW_PERIOD_IDS)[number];
