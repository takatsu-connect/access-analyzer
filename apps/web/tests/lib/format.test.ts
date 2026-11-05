import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateRange,
  formatDiff,
  formatDuration,
  formatMonthDay,
  formatNumber,
  formatPeriodLabel,
  formatRatio,
  formatShare,
  formatTenOf,
  formatTime,
  formatUpdatedAt,
  formatYearMonth,
} from '@/lib/format';

const MINUS = '−';

describe('日付と時刻', () => {
  it('日付は「2026 年 10 月 5 日」「10 月 5 日」', () => {
    expect(formatDate('2026-10-05')).toBe('2026 年 10 月 5 日');
    expect(formatMonthDay('2026-10-05')).toBe('10 月 5 日');
    expect(formatDate('2026-01-31')).toBe('2026 年 1 月 31 日');
  });

  it('期間は「10 月 6 日〜11 月 2 日」（月またぎ）', () => {
    expect(formatDateRange('2026-10-06', '2026-11-02')).toBe('10 月 6 日〜11 月 2 日');
  });

  it('年をまたぐ期間は、両方に年を付ける', () => {
    expect(formatDateRange('2025-12-06', '2026-01-02')).toBe(
      '2025 年 12 月 6 日〜2026 年 1 月 2 日',
    );
  });

  it('同じ日の期間', () => {
    expect(formatDateRange('2026-10-05', '2026-10-05')).toBe('10 月 5 日〜10 月 5 日');
  });

  it('暦にない日付は例外', () => {
    expect(() => formatDate('2026-02-30')).toThrow(RangeError);
    expect(() => formatMonthDay('2026/10/05')).toThrow(RangeError);
  });

  it('時刻は JST で「18:05」', () => {
    expect(formatTime('2026-11-04T18:05:00+09:00')).toBe('18:05');
    expect(formatTime('2026-11-04T00:00:00+09:00')).toBe('00:00');
    expect(formatTime('2026-11-04T23:59:59+09:00')).toBe('23:59');
  });

  it('別のタイムゾーンで書かれた時刻も JST に直す', () => {
    expect(formatTime('2026-11-04T09:05:00Z')).toBe('18:05');
    expect(formatTime('2026-11-04T04:05:00-05:00')).toBe('18:05');
  });

  it('タイムゾーンのない時刻は例外（端末のタイムゾーンで読まない）', () => {
    expect(() => formatTime('2026-11-04T18:05:00')).toThrow(RangeError);
    expect(() => formatTime('2026-11-04')).toThrow(RangeError);
  });

  it('更新の日時は「11 月 4 日 18:05」。JST で日付が変わる時刻も正しい', () => {
    expect(formatUpdatedAt('2026-11-04T18:05:00+09:00')).toBe('11 月 4 日 18:05');
    expect(formatUpdatedAt('2026-10-31T15:30:00Z')).toBe('11 月 1 日 00:30');
    expect(formatUpdatedAt('2025-12-31T15:00:00Z')).toBe('1 月 1 日 00:00');
  });

  it('年月は「2026 年 10 月」', () => {
    expect(formatYearMonth('2026-10')).toBe('2026 年 10 月');
    expect(formatYearMonth('2026-01')).toBe('2026 年 1 月');
    expect(() => formatYearMonth('2026-13')).toThrow(RangeError);
    expect(() => formatYearMonth('2026-1')).toThrow(RangeError);
  });
});

describe('formatPeriodLabel', () => {
  it('移動窓', () => {
    expect(formatPeriodLabel('last7')).toBe('直近 7 日');
    expect(formatPeriodLabel('last28')).toBe('直近 28 日');
    expect(formatPeriodLabel('last90')).toBe('直近 90 日');
  });

  it('月', () => {
    expect(formatPeriodLabel('m2026-10')).toBe('2026 年 10 月');
    expect(formatPeriodLabel('m2025-12')).toBe('2025 年 12 月');
    expect(formatPeriodLabel('m2026-01')).toBe('2026 年 1 月');
  });

  it('形の違う ID は例外', () => {
    expect(() => formatPeriodLabel('m2026-13')).toThrow(RangeError);
    expect(() => formatPeriodLabel('prev28' as 'last28')).toThrow(RangeError);
  });
});

describe('数', () => {
  it('3 桁ごとに区切る', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(4210)).toBe('4,210');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('負の数は U+2212 を付ける', () => {
    expect(formatNumber(-3)).toBe(`${MINUS}3`);
    expect(formatNumber(-1000)).toBe(`${MINUS}1,000`);
  });

  it('小数は四捨五入する。-0 は 0', () => {
    expect(formatNumber(12.5)).toBe('13');
    expect(formatNumber(12.4)).toBe('12');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.4)).toBe('0');
  });

  it('有限でない数は例外', () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('差は「+320」「−3」「±0」', () => {
    expect(formatDiff(320)).toBe('+320');
    expect(formatDiff(-3)).toBe(`${MINUS}3`);
    expect(formatDiff(0)).toBe('±0');
    expect(formatDiff(1000)).toBe('+1,000');
    expect(formatDiff(-1234)).toBe(`${MINUS}1,234`);
  });

  it('差のマイナスは U+2212 で、ハイフン（U+002D）ではない', () => {
    expect(formatDiff(-3).codePointAt(0)).toBe(0x2212);
    expect(formatDiff(-3)).not.toContain('-');
  });

  it('変化率は「+8%」', () => {
    expect(formatRatio(0.08)).toBe('+8%');
    expect(formatRatio(-0.13)).toBe(`${MINUS}13%`);
    expect(formatRatio(0)).toBe('±0%');
    expect(formatRatio(0.004)).toBe('±0%');
    expect(formatRatio(1.5)).toBe('+150%');
    expect(formatRatio(12)).toBe('+1,200%');
    expect(() => formatRatio(Number.NaN)).toThrow(RangeError);
  });

  it('構成比は符号なしで「42%」', () => {
    expect(formatShare(0.42)).toBe('42%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(1)).toBe('100%');
    expect(() => formatShare(-0.1)).toThrow(RangeError);
  });

  it('時間は「1 分 20 秒」', () => {
    expect(formatDuration(80)).toBe('1 分 20 秒');
    expect(formatDuration(45)).toBe('45 秒');
    expect(formatDuration(0)).toBe('0 秒');
    expect(formatDuration(59)).toBe('59 秒');
    expect(formatDuration(60)).toBe('1 分 0 秒');
    expect(formatDuration(59.6)).toBe('1 分 0 秒');
    expect(formatDuration(3600)).toBe('60 分 0 秒');
    expect(() => formatDuration(-1)).toThrow(RangeError);
  });

  it('「10 人中 6 人」', () => {
    expect(formatTenOf(6)).toBe('10 人中 6 人');
    expect(formatTenOf(0)).toBe('10 人中 0 人');
    expect(formatTenOf(10)).toBe('10 人中 10 人');
    expect(() => formatTenOf(11)).toThrow(RangeError);
    expect(() => formatTenOf(2.5)).toThrow(RangeError);
  });
});
