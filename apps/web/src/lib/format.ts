/**
 * 書式（05 §2.1）。
 *
 * - 日付は 'YYYY-MM-DD' の文字列のまま扱い、Date のローカルのタイムゾーンに頼らない。
 *   時刻はタイムゾーンつきの ISO 8601 だけを受け取り、JST に直して出す。
 * - 単位の日本語（年、月、日、分、秒 など）は src/lib/ui-text.ts の format.* に置く。
 * - 形の違う値は例外にする（「NaN」や壊れた日付を画面に出さない）。
 */
import { splitYmd, todayJst } from '@/lib/derive/dates';
import type { SelectablePeriodId } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

/** マイナス記号（U+2212）。ハイフン（U+002D）は使わない。 */
const MINUS = '−';
const PLUS_MINUS = '±';

const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_ID_PATTERN = /^m(\d{4}-(?:0[1-9]|1[0-2]))$/;
const ISO_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const JST_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// --- 日付と時刻 ---

/** 「2026 年 10 月 5 日」。 */
export function formatDate(ymd: string): string {
  return t('format.date', splitYmd(ymd));
}

/** 「10 月 5 日」。 */
export function formatMonthDay(ymd: string): string {
  const { month, day } = splitYmd(ymd);
  return t('format.monthDay', { month, day });
}

/** 「10 月 6 日〜11 月 2 日」。年をまたぐときは、両方に年を付ける。 */
export function formatDateRange(start: string, end: string): string {
  const sameYear = splitYmd(start).year === splitYmd(end).year;
  const one = sameYear ? formatMonthDay : formatDate;
  return t('format.range', { start: one(start), end: one(end) });
}

function toInstant(iso: string): Date {
  if (!ISO_WITH_OFFSET_PATTERN.test(iso)) {
    throw new RangeError('時刻はタイムゾーンつきの ISO 8601 で渡します。');
  }
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError('暦にない時刻です。');
  return instant;
}

/** 「18:05」（JST）。finishedAt のような '+09:00' つきの文字列を受け取る。 */
export function formatTime(iso: string): string {
  const parts = JST_TIME_FORMAT.formatToParts(toInstant(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')}`;
}

/** 「11 月 4 日 18:05」（JST）。DataStatus の「◯月◯日 18:05 更新」に使う。 */
export function formatUpdatedAt(iso: string): string {
  return t('format.dateTime', {
    date: formatMonthDay(todayJst(toInstant(iso))),
    time: formatTime(iso),
  });
}

/** 「2026 年 10 月」。'YYYY-MM' を受け取る。 */
export function formatYearMonth(ym: string): string {
  const match = YEAR_MONTH_PATTERN.exec(ym);
  if (!match) throw new RangeError('年月は YYYY-MM の形で渡します。');
  return t('format.yearMonth', { year: Number(match[1]), month: Number(match[2]) });
}

/**
 * 期間のラベル。'last7' → 「直近 7 日」、'm2026-10' → 「2026 年 10 月」。
 * src/data/pages が使うので、名前と型を変えない。
 */
export function formatPeriodLabel(id: SelectablePeriodId): string {
  if (id === 'last7' || id === 'last28' || id === 'last90') return t(`period.${id}`);
  const match = MONTH_ID_PATTERN.exec(id);
  if (!match) throw new RangeError('期間の ID が正しくありません。');
  return formatYearMonth(match[1] ?? '');
}

// --- 数 ---

function toInteger(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('数は有限の値で渡します。');
  const rounded = Math.round(value);
  // -0 を 0 にそろえる。
  return rounded === 0 ? 0 : rounded;
}

/** 3 桁ごとに区切る。0 以上の整数を受け取る。 */
function groupDigits(absolute: number): string {
  return String(absolute).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 「4,210」。小数は四捨五入する。負の数は U+2212 を付ける。 */
export function formatNumber(value: number): string {
  const integer = toInteger(value);
  const body = groupDigits(Math.abs(integer));
  return integer < 0 ? `${MINUS}${body}` : body;
}

function withSign(integer: number): string {
  const body = groupDigits(Math.abs(integer));
  if (integer > 0) return `+${body}`;
  if (integer < 0) return `${MINUS}${body}`;
  return `${PLUS_MINUS}0`;
}

/** 差。「+320」「−3」「±0」。 */
export function formatDiff(value: number): string {
  return withSign(toInteger(value));
}

/** 変化率。0.08 → 「+8%」、−0.13 → 「−13%」、0 → 「±0%」。 */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) throw new RangeError('比率は有限の値で渡します。');
  return `${withSign(toInteger(ratio * 100))}%`;
}

/** 構成比。0.42 → 「42%」。符号は付けない。 */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share < 0) {
    throw new RangeError('構成比は 0 以上の値で渡します。');
  }
  return `${groupDigits(toInteger(share * 100))}%`;
}

/** 時間。80 → 「1 分 20 秒」、45 → 「45 秒」。秒は四捨五入する。 */
export function formatDuration(seconds: number): string {
  const total = toInteger(seconds);
  if (total < 0) throw new RangeError('時間は 0 以上の値で渡します。');
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min === 0
    ? t('format.duration.sec', { sec })
    : t('format.duration.minSec', { min: groupDigits(min), sec });
}

/** 「10 人中 6 人」。tenOf() の結果（0〜10 の整数）を受け取る。 */
export function formatTenOf(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    throw new RangeError('「10 人中」の人数は 0〜10 の整数で渡します。');
  }
  return t('format.tenOf', { n: count });
}
