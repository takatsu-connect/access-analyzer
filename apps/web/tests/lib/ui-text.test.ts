import { describe, expect, it } from 'vitest';

import {
  CHANNEL_BUCKETS,
  DEVICE_BUCKETS,
  FRESHNESS_BUCKETS,
  LOCAL_BUCKETS,
  NEW_RETURNING_BUCKETS,
  SNS_BUCKETS,
} from '@/lib/config';
import {
  DEFERRED_MARK,
  DEFERRED_METRIC_IDS,
  dictionary,
  dictionaryParts,
  heatmapSlotLabels,
  METRIC_IDS,
  metricLabel,
  metricNote,
  RETIRED_MARK,
  RETIRED_METRIC_IDS,
  t,
} from '@/lib/ui-text';

// U-19: 辞書の完全性（NFR-97、NFR-99）。

const entries = Object.entries(dictionary as Record<string, string>);
const keys = entries.map(([key]) => key);
const texts = entries.map(([, text]) => text);

/** 型の検査を通さずに呼ぶ（実行時のふるまいを確かめるため）。 */
const loose = t as unknown as (key: string, params?: Record<string, unknown>) => string;

// 02_metrics.md §4 の指標 ID（M-01〜M-27、M-30〜M-34、M-41）。
const EXPECTED_METRIC_IDS = [
  ...[...new Array<undefined>(27).keys()].map((index) => `M${String(index + 1).padStart(2, '0')}`),
  'M30',
  'M31',
  'M32',
  'M33',
  'M34',
  'M41',
];

// 05 §2.1 の本文と表のキー。
const SCREEN_TABLE_KEYS = [
  'band.upper',
  'band.middle',
  'band.lower',
  'band.lower.alt',
  'band.na',
  'band.note',
  'notes.pageviews',
  'notes.masked',
  'notes.band',
  'notes.band.detail',
  'notes.ratio',
  'notes.source',
  'absent.ownMedian',
  'absent.ratio20',
  'absent.referrer30',
  'absent.milestone',
  'absent.band',
  'absent.yoy',
  's01.benchmark',
  's01.readers.h2',
  's01.freshness.h3',
  'lead.sessions',
  'lead.pageviews',
  'lead.users',
  'chart.tap.hint',
  'heatmap.slots',
  's02b.note',
  's02d.note',
  's02d.note.detail',
  's03.h1',
  's03.curve.text',
  's03.curve.text.young',
  's03.period',
  's03.own.h2',
  's03.own.text',
  's03.engagement.h2',
  's04.h1',
  's04.lead',
  's05.summary.a',
  's05.summary.a.zero',
  's05.summary.b',
  's05.summary.c',
  's05.referrer.legend',
  's06.note',
  's06b.scroll',
  's08.authors.h2',
  's08.authors.note',
];

// 計測開始前に公開した記事の助言（2026-11-05）§9 のキー。
const PRE_MEASURE_KEYS = [
  'notes.measureStart',
  'notes.measureStart.detail',
  'notes.ownMedian.scope',
  'absent.preMeasure',
  'absent.preMeasure.alt',
  'absent.ownMedian',
  'absent.milestone.since',
  'absent.referrer30.preMeasure',
  'milestone.reached.since',
  'list.preMeasure.note',
  'list.preMeasure.divider',
  's03.preMeasure.lead',
  's03.period.since',
  's03.own.text.preMeasure',
  's05.summary.b.preMeasure',
  'notes.band.detail',
];

// グラフ部品が props で受ける文言（05 §2.8）。帯と真ん中の記事の凡例は metric.M19.label と
// metric.M27.label、横軸の「n 日目」は absent.dayN を使う。
const CHART_KEYS = [
  'chart.fixedRow.published',
  'chart.fixedRow.week',
  'chart.fixedRow.week.single',
  'hbar.valueWithShare',
  'hbar.compare.prev',
  'legend.compare.prev',
  's05.referrer.legend',
  'legend.curve.post',
  'metric.M19.label',
  'metric.M27.label',
  'absent.dayN',
  'heatmap.tap.hint',
  'heatmap.fixedRow',
  'heatmap.fixedRow.masked',
];

// 画面ごとのファイル（src/lib/ui-text/screens/）と、そのキーが始まる接頭辞。
const SCREEN_FILE_PREFIXES: Record<string, readonly string[]> = {
  s01: ['s01.'],
  s02: ['s02.', 's02a.', 's02b.', 's02c.', 's02d.', 's02e.'],
  s03: ['s03.'],
  s05: ['s04.', 's05.'],
  s06: ['s06.', 's06b.'],
  s07: ['s07.', 's07b.'],
  s08: ['s08.'],
  s10: ['s10a.', 's10b.', 's10c.', 's10d.', 's10e.'],
};

const parts = dictionaryParts as Record<string, Record<string, string>>;

/** 2 つ以上の部品にあるキー。 */
function duplicateKeys(dictionaries: readonly Record<string, string>[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const part of dictionaries) {
    for (const key of Object.keys(part)) {
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
  }
  return [...duplicates];
}

// 05 §1 の画面（S-09 は初回対象外）。
const SCREEN_IDS = [
  's01',
  's02a',
  's02b',
  's02c',
  's02d',
  's02e',
  's03',
  's04',
  's05',
  's06',
  's06b',
  's07',
  's07b',
  's08',
  // イベント記事（S-02a〜S-02e のイベント記事版。2026-11-10）。
  's10a',
  's10b',
  's10c',
  's10d',
  's10e',
];

// 画面に出す文言で使わない語（05 §2.1、NFR-97）。
const AVOIDED_WORDS = [
  '偏り',
  '下位',
  '読まれなかった',
  '少ない',
  '悪い',
  '低い',
  'ランキング',
  '順位',
  'ワースト',
  'ベスト',
  'あなた',
];

// GA4 Data API の指標とディメンションの名前。括弧の中にだけ書く（05 §2.1）。
const GA4_API_NAMES = [
  'screenPageViews',
  'sessions',
  'activeUsers',
  'newUsers',
  'totalUsers',
  'engagementRate',
  'engagedSessions',
  'averageSessionDuration',
  'bounceRate',
  'userEngagementDuration',
  'eventCount',
  'sessionDefaultChannelGroup',
  'sessionSource',
  'deviceCategory',
  'landingPage',
  'newVsReturning',
  'dayOfWeek',
  'pagePath',
  'pageReferrer',
  'pageLocation',
];

/** 括弧（全角・半角）の中を取り除く。 */
function outsideParens(text: string): string {
  let current = text;
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current.replace(/（[^（）]*）|\([^()]*\)/g, '');
  }
  return current;
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1] ?? '');
}

describe('辞書の完全性（U-19）', () => {
  it('指標 ID の一覧が要件と同じ', () => {
    expect([...METRIC_IDS]).toEqual(EXPECTED_METRIC_IDS);
  });

  it.each(EXPECTED_METRIC_IDS)('%s に label と note がある', (id) => {
    expect(dictionary).toHaveProperty([`metric.${id}.label`]);
    expect(dictionary).toHaveProperty([`metric.${id}.note`]);
  });

  it('metricLabel と metricNote が辞書の値を返す', () => {
    expect(metricLabel('M01')).toBe('読まれた回数');
    expect(metricNote('M01')).toBe('同じ人が 3 回読めば 3 と数えます。');
    for (const id of METRIC_IDS) {
      expect(metricLabel(id).length).toBeGreaterThan(0);
      expect(metricNote(id).length).toBeGreaterThan(0);
    }
  });

  it('廃止と初回対象外の指標には、名称の先頭に内部用の印がある。ほかの指標にはない', () => {
    const retired: readonly string[] = RETIRED_METRIC_IDS;
    const deferred: readonly string[] = DEFERRED_METRIC_IDS;
    expect(retired).toEqual(['M04', 'M05', 'M07', 'M08']);
    expect(deferred).toEqual(['M41']);
    for (const id of METRIC_IDS) {
      const label = metricLabel(id);
      expect(label.startsWith(RETIRED_MARK)).toBe(retired.includes(id));
      expect(label.startsWith(DEFERRED_MARK)).toBe(deferred.includes(id));
    }
  });

  it.each(SCREEN_TABLE_KEYS)('05 §2.1 のキー %s がある', (key) => {
    expect(keys).toContain(key);
  });

  it.each(PRE_MEASURE_KEYS)('助言 §9 のキー %s がある', (key) => {
    expect(keys).toContain(key);
  });

  it.each(CHART_KEYS)('グラフ部品に渡す文言のキー %s がある', (key) => {
    expect(keys).toContain(key);
  });

  it.each(SCREEN_IDS)('画面 %s に名前と h1 がある', (screen) => {
    expect(keys).toContain(`${screen}.name`);
    expect(keys).toContain(`${screen}.h1`);
  });

  it('区分の名前がそろっている（区分の値は config.ts と同じ）', () => {
    const expected = [
      ...CHANNEL_BUCKETS.map((bucket) => `channel.${bucket}`),
      ...SNS_BUCKETS.map((bucket) => `sns.${bucket}`),
      ...DEVICE_BUCKETS.map((bucket) => `device.${bucket}`),
      ...LOCAL_BUCKETS.map((bucket) => `local.${bucket}`),
      ...NEW_RETURNING_BUCKETS.map((bucket) => `newReturning.${bucket}`),
      ...FRESHNESS_BUCKETS.map((bucket) => `freshness.${bucket}`),
    ];
    expect(keys).toEqual(expect.arrayContaining(expected));
  });

  it('帯の 3 区分と、不在の文言が設計と助言のとおり', () => {
    expect(t('band.upper')).toBe('よく読まれています');
    expect(t('band.middle')).toBe('多くの記事と同じくらい');
    expect(t('band.lower')).toBe('これから');
    expect(t('band.lower.alt')).toBe('ゆっくり読まれています');
    expect(t('band.na')).toBe('まだ比較できません');
    expect(t('absent.band')).toBe(t('band.na'));
    expect(t('absent.ownMedian')).toBe(
      '直近 1 年に公開して 30 日たった記事が 5 本以上になると出ます',
    );
    expect(t('absent.ratio20')).toBe('読まれた回数が 20 回以上になると出ます');
  });

  it('空の文言がない', () => {
    expect(entries.filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([]);
  });
});

describe('辞書の部品（本体と、画面ごとのファイル。U-19）', () => {
  it('部品は、本体と画面ごとの 8 ファイル', () => {
    expect(Object.keys(parts)).toEqual(['base', ...Object.keys(SCREEN_FILE_PREFIXES)]);
  });

  it('同じキーが 2 か所にない（後ろの部品が前の文言を上書きしない）', () => {
    expect(duplicateKeys(Object.values(parts))).toEqual([]);
  });

  it('重なりの検査が空振りしていない', () => {
    expect(duplicateKeys([{ 'a.b': 'x' }, {}, { 'a.b': 'y', 'a.c': 'z' }])).toEqual(['a.b']);
  });

  it('部品のキーと文言がすべて辞書に入っている（上の U-19 の検査が、画面ごとのファイルにも当たる）', () => {
    const merged = Object.values(parts).flatMap((part) => Object.entries(part));
    expect(merged).toHaveLength(entries.length);
    expect(Object.fromEntries(merged)).toEqual(dictionary);
  });

  it.each(Object.entries(SCREEN_FILE_PREFIXES))(
    'screens/%s.ts のキーは、その画面の接頭辞で始まる',
    (file, prefixes) => {
      const outside = Object.keys(parts[file] ?? {}).filter(
        (key) => !prefixes.some((prefix) => key.startsWith(prefix)),
      );
      expect(outside).toEqual([]);
    },
  );
});

describe('辞書の言葉の規則（U-19）', () => {
  it.each(AVOIDED_WORDS)('「%s」を含まない', (word) => {
    expect(entries.filter(([, text]) => text.includes(word)).map(([key]) => key)).toEqual([]);
  });

  it('「出ません」で終わる文がない（不在は「〜になると出ます」の形）', () => {
    const pattern = /出ません(?:[。．！？!?」）)\s]|$)/;
    expect(entries.filter(([, text]) => pattern.test(text)).map(([key]) => key)).toEqual([]);
  });

  it.each(GA4_API_NAMES)('GA4 の API 名 %s は括弧の中にだけ現れる', (name) => {
    expect(
      entries.filter(([, text]) => outsideParens(text).includes(name)).map(([key]) => key),
    ).toEqual([]);
  });

  it('括弧の検査が空振りしていない（括弧の中に API 名を書いた文言がある）', () => {
    expect(texts.some((text) => text.includes('（GA4 の sessions）'))).toBe(true);
    expect(outsideParens('訪問回数（GA4 の sessions）です')).toBe('訪問回数です');
    expect(outsideParens('sessions（訪問回数）')).toContain('sessions');
  });

  it('要件の記号「―」（U+2015）を使わない。伏せ値は「—」（U+2014）', () => {
    expect(entries.filter(([, text]) => text.includes('―')).map(([key]) => key)).toEqual([]);
    expect(t('masked.dash')).toBe('—');
  });
});

describe('t', () => {
  it('差し込みのない文言をそのまま返す', () => {
    expect(t('s03.h1')).toBe('この記事はどう読まれた？');
  });

  it('{name} の形の差し込みを埋める', () => {
    expect(t('lead.sessions', { n: '4,210' })).toBe('訪問 4,210 回のうち');
    expect(t('s03.own.h2', { name: '山田' })).toBe('山田さんのこれまでの記事と比べて');
    expect(t('s01.benchmark', { p25: 40, p50: 85, p75: 160 })).toBe(
      'このサイトの多くの記事は、公開から 30 日で 40〜160 回（真ん中は 85 回）読まれます。',
    );
  });

  it('同じ差し込みが 2 回あれば、どちらも埋める', () => {
    expect(t('s03.curve.text.young', { n: 12, pv: 30, p25: 20, p75: 60 })).toBe(
      '12 日目で 30 回読まれました。同じ 12 日目の多くの記事は 20〜60 回です。',
    );
  });

  it('0 も差し込める', () => {
    expect(t('lead.users', { n: 0 })).toBe('読んだ人 0 人のうち');
  });

  it('差し込み値が足りないときは例外（{n} をそのまま出さない）', () => {
    expect(() => loose('lead.sessions')).toThrow(/差し込み値 n/);
    expect(() => loose('lead.sessions', {})).toThrow(/差し込み値 n/);
    expect(() => loose('lead.sessions', { n: undefined })).toThrow();
    expect(() => loose('lead.sessions', { n: null })).toThrow();
    expect(() => loose('s01.benchmark', { p25: 1, p50: 2 })).toThrow(/p75/);
  });

  it('差し込み値の不足と名前の違いは、型の検査でも止まる（tsc が @ts-expect-error を確かめる）', () => {
    // @ts-expect-error 差し込み値を渡していない
    expect(() => t('lead.sessions')).toThrow(/差し込み値 n/);
    // @ts-expect-error 差し込み値の名前が違う
    expect(() => t('lead.sessions', { count: 1 })).toThrow(/差し込み値 n/);
    // @ts-expect-error 差し込みのない文言に値を渡している
    expect(t('s03.h1', { n: 1 })).toBe('この記事はどう読まれた？');
  });

  it('辞書にないキーは例外', () => {
    expect(() => loose('no.such.key')).toThrow();
    expect(() => loose('toString')).toThrow();
    // @ts-expect-error 存在しないキーは型の検査で止まる
    expect(() => t('no.such.key')).toThrow();
  });

  it.each(entries)('%s は、差し込みをすべて渡すと波括弧が残らない', (key, text) => {
    const params = Object.fromEntries(placeholdersOf(text).map((name) => [name, 'x']));
    expect(loose(key, params)).not.toMatch(/[{}]/);
  });
});

describe('補助', () => {
  it('ヒートマップの 6 区分のラベル', () => {
    expect(heatmapSlotLabels()).toEqual([
      '深夜 0〜3 時',
      '早朝 4〜7 時',
      '朝 8〜11 時',
      '昼 12〜15 時',
      '夕方 16〜19 時',
      '夜 20〜23 時',
    ]);
  });
});
