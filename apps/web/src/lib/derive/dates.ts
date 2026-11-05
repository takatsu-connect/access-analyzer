/**
 * 日付の計算（表示用）。
 *
 * 日付は 'YYYY-MM-DD' の文字列のまま扱う。計算は UTC の暦日で行い、
 * Date のローカルのタイムゾーンに頼らない（ビルドのサーバーと利用者の端末で結果を変えない）。
 */
import { UNCONFIRMED_DAYS } from '@/lib/config';

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export type YmdParts = { year: number; month: number; day: number };

/** 'YYYY-MM-DD' を年・月・日に分ける。形が違うとき、暦にない日付のときは例外。 */
export function splitYmd(ymd: string): YmdParts {
  const match = YMD_PATTERN.exec(ymd);
  if (!match) throw new RangeError('日付は YYYY-MM-DD の形で渡します。');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('暦にない日付です。');
  }
  return { year, month, day };
}

function toUtcMs(ymd: string): number {
  const { year, month, day } = splitYmd(ymd);
  return Date.UTC(year, month - 1, day);
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function fromUtcMs(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** 日数を足す（負の数で引く）。 */
export function addDays(ymd: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError('日数は整数で渡します。');
  return fromUtcMs(toUtcMs(ymd) + days * MS_PER_DAY);
}

/** 差の日数（later − earlier）。同じ日は 0。 */
export function diffDays(later: string, earlier: string): number {
  return Math.round((toUtcMs(later) - toUtcMs(earlier)) / MS_PER_DAY);
}

/** その月の初日。 */
export function monthStart(ymd: string): string {
  const { year, month } = splitYmd(ymd);
  return `${pad(year, 4)}-${pad(month, 2)}-01`;
}

const JST_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ある時点の、JST での暦日（'YYYY-MM-DD'）。端末のタイムゾーンに依らない。 */
export function todayJst(now: Date): string {
  const parts = JST_DATE_FORMAT.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** あとで増えることがある日の最初の日（基準日から 2 日前。3 日分の先頭。05 §2.4）。 */
export function unconfirmedFrom(baseDate: string): string {
  return addDays(baseDate, -(UNCONFIRMED_DAYS - 1));
}

/** 最新の確定日（基準日 − 3 日）。グラフの固定行の既定の日（05 §2.6）。 */
export function latestConfirmedDay(baseDate: string): string {
  return addDays(baseDate, -UNCONFIRMED_DAYS);
}
