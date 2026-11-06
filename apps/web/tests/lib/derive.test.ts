import { describe, expect, it } from 'vitest';

import {
  addDays,
  compare,
  diffDays,
  fold6,
  isDelayed,
  latestConfirmedDay,
  monthProgress,
  monthStart,
  safeExternalUrl,
  share,
  shareOf,
  splitYmd,
  tenOf,
  todayJst,
  topChannel,
  unconfirmedFrom,
} from '@/lib/derive';
import type { Channel, Masked } from '@/lib/page-data';

describe('compare（U-14）', () => {
  it('差と変化率を返す', () => {
    expect(compare(120, 100)).toEqual({ diff: 20, ratio: 0.2 });
    expect(compare(80, 100)).toEqual({ diff: -20, ratio: -0.2 });
  });

  it('分母が 19 なら変化率は null で、差だけを返す', () => {
    expect(compare(25, 19)).toEqual({ diff: 6, ratio: null });
  });

  it('分母が 20 なら変化率を返す', () => {
    expect(compare(25, 20)).toEqual({ diff: 5, ratio: 0.25 });
  });

  it('分母が 0 でも例外にせず、変化率は null', () => {
    expect(compare(0, 0)).toEqual({ diff: 0, ratio: null });
    expect(compare(7, 0)).toEqual({ diff: 7, ratio: null });
  });

  it('どちらかが伏せ値なら null（差も出さない）', () => {
    expect(compare(null, 100)).toBeNull();
    expect(compare(100, null)).toBeNull();
  });
});

describe('share（U-15）', () => {
  it('分母は合計の列', () => {
    expect(share([50, 30, 20], 100)).toEqual([0.5, 0.3, 0.2]);
  });

  it('伏せ値のセルは null。見えている値の和（50）ではなく合計（100）で割る', () => {
    expect(share([50, null, null], 100)).toEqual([0.5, null, null]);
  });

  it('0 は 0 のまま（伏せ値にしない）', () => {
    expect(share([0, 40], 40)).toEqual([0, 1]);
  });

  it('合計が 20 未満なら、すべて null。20 なら出す', () => {
    expect(share([10, 5], 19)).toEqual([null, null]);
    expect(share([10, 5], 20)).toEqual([0.5, 0.25]);
  });

  it('合計が伏せ値なら、すべて null', () => {
    expect(share([10, 5], null)).toEqual([null, null]);
  });

  it('shareOf は区分の名前を保つ', () => {
    const record: Record<Channel, Masked> = {
      search: 60,
      social: null,
      direct: 30,
      referral: null,
      other: 0,
    };
    expect(shareOf(record, 100)).toEqual({
      search: 0.6,
      social: null,
      direct: 0.3,
      referral: null,
      other: 0,
    });
  });
});

describe('tenOf（U-16）', () => {
  it('「10 人中 ◯人」の ◯ を返す', () => {
    expect(tenOf(12, 20)).toBe(6);
    expect(tenOf(21, 100)).toBe(2);
    expect(tenOf(26, 100)).toBe(3);
  });

  it('分母が 19 なら null、20 なら値', () => {
    expect(tenOf(12, 19)).toBeNull();
    expect(tenOf(10, 20)).toBe(5);
  });

  it('0 と 10 の端', () => {
    expect(tenOf(0, 50)).toBe(0);
    expect(tenOf(50, 50)).toBe(10);
    expect(tenOf(60, 50)).toBe(10);
  });

  it('伏せ値なら null', () => {
    expect(tenOf(null, 50)).toBeNull();
    expect(tenOf(12, null)).toBeNull();
  });
});

describe('fold6（U-17）', () => {
  /** 168 要素を同じ値で埋める。 */
  const filled = (value: number): number[] => new Array<number>(168).fill(value);
  const byHour = filled(0).map((_, index) => index % 24);

  it('7 × 6 に畳む', () => {
    const folded = fold6(byHour);
    expect(folded).toHaveLength(7);
    for (const row of folded) expect(row).toHaveLength(6);
  });

  it('区分の値は 4 時間ぶんの合計（0〜3 時、4〜7 時、…、20〜23 時）', () => {
    expect(fold6(byHour)[0]).toEqual([6, 22, 38, 54, 70, 86]);
    expect(fold6(byHour)[6]).toEqual([6, 22, 38, 54, 70, 86]);
  });

  it('1 日あたり平均（小数）でも、区分の中を足す', () => {
    expect(fold6(filled(0.25))[3]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('曜日ごとに分けて畳む（index = 曜日 * 24 + 時）', () => {
    const values: Masked[] = filled(0);
    values[2 * 24 + 21] = 9;
    const folded = fold6(values);
    expect(folded[2]).toEqual([0, 0, 0, 0, 0, 9]);
    expect(folded[1]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('区分の中に伏せ値が 1 つでもあれば、その区分は null。ほかの区分は変わらない', () => {
    const values: Masked[] = [...byHour];
    values[2 * 24 + 5] = null;
    const folded = fold6(values);
    expect(folded[2]).toEqual([6, null, 38, 54, 70, 86]);
    expect(folded[1]).toEqual([6, 22, 38, 54, 70, 86]);
  });

  it('0 だけの区分は 0（null にしない）', () => {
    expect(fold6(filled(0))[0]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('168 要素でなければ例外', () => {
    expect(() => fold6([1, 2, 3])).toThrow(RangeError);
  });
});

describe('topChannel', () => {
  it('最多の区分を返す', () => {
    expect(topChannel({ search: 10, social: 30, direct: 20, referral: 5, other: 0 })).toBe(
      'social',
    );
  });

  it('同じ値なら CHANNEL_BUCKETS の順で先のもの', () => {
    expect(topChannel({ search: 10, social: 10, direct: 10, referral: 10, other: 10 })).toBe(
      'search',
    );
    expect(topChannel({ search: 1, social: 7, direct: 7, referral: 2, other: 7 })).toBe('social');
  });

  it('伏せ値の区分は比べない', () => {
    expect(topChannel({ search: null, social: 8, direct: null, referral: 6, other: 0 })).toBe(
      'social',
    );
  });

  it('全区分が伏せ値なら null', () => {
    expect(
      topChannel({ search: null, social: null, direct: null, referral: null, other: null }),
    ).toBeNull();
  });

  it('全区分が 0 なら none（訪問がない。伏せ値ではない）', () => {
    expect(topChannel({ search: 0, social: 0, direct: 0, referral: 0, other: 0 })).toBe('none');
  });

  it('見えている値がすべて 0 で伏せ値もあれば null（最多が伏せ値の側にあり、名指ししない）', () => {
    expect(topChannel({ search: null, social: null, direct: 0, referral: 0, other: 0 })).toBeNull();
  });
});

describe('日付の計算', () => {
  it('日数を足す（月またぎ、年またぎ、うるう年）', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-05', 0)).toBe('2026-10-05');
  });

  it('差の日数', () => {
    expect(diffDays('2026-11-05', '2026-11-02')).toBe(3);
    expect(diffDays('2026-01-01', '2025-12-31')).toBe(1);
    expect(diffDays('2026-11-02', '2026-11-02')).toBe(0);
    expect(diffDays('2026-11-02', '2026-11-05')).toBe(-3);
  });

  it('月の初日', () => {
    expect(monthStart('2026-10-31')).toBe('2026-10-01');
    expect(monthStart('2026-01-01')).toBe('2026-01-01');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-1-5', '20261005', '', '2026-10-05T00:00:00'])(
    '形の違う日付「%s」は例外',
    (value) => {
      expect(() => splitYmd(value)).toThrow(RangeError);
    },
  );

  it('todayJst は JST の暦日を返す（日付の変わり目、年の変わり目）', () => {
    expect(todayJst(new Date('2026-11-04T14:59:59Z'))).toBe('2026-11-04');
    expect(todayJst(new Date('2026-11-04T15:00:00Z'))).toBe('2026-11-05');
    expect(todayJst(new Date('2025-12-31T15:00:00Z'))).toBe('2026-01-01');
    expect(todayJst(new Date('2026-11-05T08:00:00+09:00'))).toBe('2026-11-05');
  });

  it('未確定の日は基準日から 2 日前までの 3 日分。最新の確定日は基準日 − 3 日', () => {
    expect(unconfirmedFrom('2026-11-02')).toBe('2026-10-31');
    expect(latestConfirmedDay('2026-11-02')).toBe('2026-10-30');
    expect(diffDays(unconfirmedFrom('2026-11-02'), latestConfirmedDay('2026-11-02'))).toBe(1);
  });
});

describe('monthProgress', () => {
  it('確定した月は confirmed', () => {
    expect(monthProgress({ end: '2026-09-30', isConfirmed: true })).toBe('confirmed');
  });

  it('月末まで日がそろっていて、まだ確定していない月は settling', () => {
    expect(monthProgress({ end: '2026-10-31', isConfirmed: false })).toBe('settling');
    // うるう年の 2 月の末日。
    expect(monthProgress({ end: '2028-02-29', isConfirmed: false })).toBe('settling');
    // 年をまたぐ月末。
    expect(monthProgress({ end: '2026-12-31', isConfirmed: false })).toBe('settling');
  });

  it('end が月末より前（基準日の属する月）は inProgress', () => {
    expect(monthProgress({ end: '2026-11-04', isConfirmed: false })).toBe('inProgress');
    expect(monthProgress({ end: '2028-02-28', isConfirmed: false })).toBe('inProgress');
    expect(monthProgress({ end: '2026-11-01', isConfirmed: false })).toBe('inProgress');
  });
});

describe('isDelayed（U-25）', () => {
  it('今日 − 基準日 が 2 日なら遅れていない', () => {
    expect(isDelayed({ isStale: false, baseDate: '2026-11-02' }, '2026-11-04')).toBe(false);
  });

  it('今日 − 基準日 が 3 日以上なら遅れている', () => {
    expect(isDelayed({ isStale: false, baseDate: '2026-11-02' }, '2026-11-05')).toBe(true);
    expect(isDelayed({ isStale: false, baseDate: '2026-10-30' }, '2026-11-05')).toBe(true);
  });

  it('isStale なら、日数に関係なく遅れている', () => {
    expect(isDelayed({ isStale: true, baseDate: '2026-11-04' }, '2026-11-04')).toBe(true);
  });
});

describe('safeExternalUrl（U-26）', () => {
  it.each(['https://takatsu-connect.com/', 'https://takatsu-connect.com/2026/10/natsu-matsuri/'])(
    '配下の URL「%s」はそのまま返す',
    (url) => {
      expect(safeExternalUrl(url)).toBe(url);
    },
  );

  it.each([
    'http://takatsu-connect.com/',
    'https://takatsu-connect.com',
    'https://www.takatsu-connect.com/',
    'https://takatsu-connect.com.evil.example/',
    'https://takatsu-connect.com@evil.example/',
    'https://evil.example/https://takatsu-connect.com/',
    'HTTPS://TAKATSU-CONNECT.COM/',
    ' https://takatsu-connect.com/',
    '//takatsu-connect.com/',
    '/articles/1',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '',
  ])('配下でない「%s」は null', (url) => {
    expect(safeExternalUrl(url)).toBeNull();
  });

  it('文字列でなければ null', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
