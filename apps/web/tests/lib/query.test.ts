import { describe, expect, it } from 'vitest';

import { DEFAULT_QUERY_STATE, parseQuery, toQueryString } from '@/lib/query';
import type { QueryAllow, QueryScreen, QueryState } from '@/lib/query';

// U-18: 04 §8 の表の全行。
const ALL_SCREENS: QueryScreen[] = [
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
];

// カテゴリ 3 は親、12 は子。
function allowFor(screen: QueryScreen): QueryAllow {
  return {
    screen,
    periodIds: ['last7', 'last28', 'last90', 'm2026-10', 'm2026-09'],
    categories: [
      { id: 3, parentId: null },
      { id: 12, parentId: 3 },
    ],
    authorSlugs: ['sbc', 'yamada-taro'],
    publishedMonths: ['2026-10', '2026-09'],
  };
}

const SCRIPT = '<script>alert(1)</script>';

describe('parseQuery: p（期間）', () => {
  it.each(ALL_SCREENS)('%s で使える', (screen) => {
    expect(parseQuery('p=last7', allowFor(screen)).p).toBe('last7');
    expect(parseQuery('p=m2026-10', allowFor(screen)).p).toBe('m2026-10');
  });

  it('なければ既定の last28', () => {
    expect(parseQuery('', allowFor('s01')).p).toBe('last28');
  });

  it.each(['prev28', 'm2026-13', 'm2026-1', 'LAST7', 'last7 ', 'last30', '', SCRIPT])(
    '形式違い「%s」は既定に戻す',
    (value) => {
      expect(parseQuery(new URLSearchParams({ p: value }), allowFor('s01')).p).toBe('last28');
    },
  );

  it('形式は合うが periods にない月は既定に戻す', () => {
    expect(parseQuery('p=m2024-01', allowFor('s01')).p).toBe('last28');
  });
});

describe('parseQuery: cat / author / ym / q（S-02e）', () => {
  const allow = allowFor('s02e');

  it('cat: 一覧にある ID だけ', () => {
    expect(parseQuery('cat=12', allow).cat).toBe(12);
    expect(parseQuery('cat=3', allow).cat).toBe(3);
    expect(parseQuery('cat=99', allow).cat).toBeNull();
  });

  it.each(['abc', '-1', '1.5', '12345678', '12 ', '', SCRIPT])(
    'cat: 形式違い「%s」は無視',
    (value) => {
      expect(parseQuery(new URLSearchParams({ cat: value }), allow).cat).toBeNull();
    },
  );

  it('author: 一覧にある slug だけ', () => {
    expect(parseQuery('author=sbc', allow).author).toBe('sbc');
    expect(parseQuery('author=yamada-taro', allow).author).toBe('yamada-taro');
    expect(parseQuery('author=unknown', allow).author).toBeNull();
  });

  it.each(['SBC', 'a_b', 'a b', 'a'.repeat(65), '', SCRIPT])(
    'author: 形式違い「%s」は無視',
    (value) => {
      expect(parseQuery(new URLSearchParams({ author: value }), allow).author).toBeNull();
    },
  );

  it('ym: 記事の公開年月にあるものだけ', () => {
    expect(parseQuery('ym=2026-10', allow).ym).toBe('2026-10');
    expect(parseQuery('ym=2025-01', allow).ym).toBeNull();
  });

  it.each(['2026-13', '2026-1', '202610', '2026-10-01', '', SCRIPT])(
    'ym: 形式違い「%s」は無視',
    (value) => {
      expect(parseQuery(new URLSearchParams({ ym: value }), allow).ym).toBeNull();
    },
  );

  it('q: 前後の空白を除き、NFC に正規化する', () => {
    expect(parseQuery(new URLSearchParams({ q: '夏祭り' }), allow).q).toBe('夏祭り');
    expect(parseQuery(new URLSearchParams({ q: '  夏祭り 　' }), allow).q).toBe('夏祭り');
    expect(parseQuery(new URLSearchParams({ q: 'が' }), allow).q).toBe('が');
  });

  it('q: 長さ 1〜50。空と 51 文字は無視', () => {
    expect(parseQuery(new URLSearchParams({ q: 'あ'.repeat(50) }), allow).q).toBe('あ'.repeat(50));
    expect(parseQuery(new URLSearchParams({ q: 'あ'.repeat(51) }), allow).q).toBeNull();
    expect(parseQuery(new URLSearchParams({ q: '   ' }), allow).q).toBeNull();
    expect(parseQuery('q=', allow).q).toBeNull();
  });

  it('q: <script> のような値は、ただの文字列として持つ（解釈しない）', () => {
    expect(parseQuery(new URLSearchParams({ q: SCRIPT }), allow).q).toBe(SCRIPT);
  });

  it('S-02e 以外では無視', () => {
    const state = parseQuery('cat=12&author=sbc&ym=2026-10&q=abc', allowFor('s01'));
    expect(state).toEqual(DEFAULT_QUERY_STATE);
  });

  it('許可リストを渡していなければ無視', () => {
    const state = parseQuery('cat=12&author=sbc&ym=2026-10', {
      screen: 's02e',
      periodIds: ['last28'],
    });
    expect(state).toEqual(DEFAULT_QUERY_STATE);
  });
});

describe('parseQuery: sort', () => {
  const allow = allowFor('s02e');

  it('絞り込みなしでは無視', () => {
    expect(parseQuery('sort=pv', allow).sort).toBe('published');
  });

  it('親カテゴリだけでは無視', () => {
    const state = parseQuery('cat=3&sort=pv', allow);
    expect(state.cat).toBe(3);
    expect(state.sort).toBe('published');
  });

  it('子カテゴリで絞ると受け付ける', () => {
    expect(parseQuery('cat=12&sort=pv7', allow).sort).toBe('pv7');
  });

  it('著者で絞ると受け付ける', () => {
    expect(parseQuery('author=sbc&sort=pv30', allow).sort).toBe('pv30');
  });

  it('公開年月で絞ると受け付ける', () => {
    expect(parseQuery('ym=2026-10&sort=pv', allow).sort).toBe('pv');
  });

  it('絞り込みの値が無効なら、絞り込みなしと同じ', () => {
    expect(parseQuery('author=unknown&sort=pv', allow).sort).toBe('published');
    expect(parseQuery('cat=99&sort=pv', allow).sort).toBe('published');
  });

  it('タイトル検索だけでは受け付けない', () => {
    expect(parseQuery('q=abc&sort=pv', allow).sort).toBe('published');
  });

  it('S-05 は常に受け付ける', () => {
    expect(parseQuery('sort=pv', allowFor('s05')).sort).toBe('pv');
    expect(parseQuery('sort=pv7', allowFor('s05')).sort).toBe('pv7');
    expect(parseQuery('sort=pv30', allowFor('s05')).sort).toBe('pv30');
  });

  it.each(['asc', 'pv-asc', '-pv', 'published', 'PV', '', SCRIPT])(
    '形式違い「%s」は公開日順',
    (value) => {
      expect(parseQuery(new URLSearchParams({ sort: value }), allowFor('s05')).sort).toBe(
        'published',
      );
    },
  );

  it('ほかの画面では無視', () => {
    expect(parseQuery('sort=pv', allowFor('s02a')).sort).toBe('published');
    expect(parseQuery('sort=pv', allowFor('s07b')).sort).toBe('published');
  });
});

describe('parseQuery: n / line / heat / axis', () => {
  it('n: S-02a と S-02c で 20 か 50', () => {
    expect(parseQuery('n=50', allowFor('s02a')).n).toBe(50);
    expect(parseQuery('n=50', allowFor('s02c')).n).toBe(50);
    expect(parseQuery('n=20', allowFor('s02a')).n).toBe(20);
    expect(parseQuery('', allowFor('s02a')).n).toBe(20);
  });

  it.each(['100', '5', '050', '50.0', SCRIPT])('n: 形式違い「%s」は 20', (value) => {
    expect(parseQuery(new URLSearchParams({ n: value }), allowFor('s02a')).n).toBe(20);
  });

  it('n: ほかの画面では無視', () => {
    expect(parseQuery('n=50', allowFor('s02e')).n).toBe(20);
  });

  it('line: S-01 で pv か sessions', () => {
    expect(parseQuery('line=sessions', allowFor('s01')).line).toBe('sessions');
    expect(parseQuery('line=pv', allowFor('s01')).line).toBe('pv');
    expect(parseQuery('line=users', allowFor('s01')).line).toBe('pv');
    expect(parseQuery(new URLSearchParams({ line: SCRIPT }), allowFor('s01')).line).toBe('pv');
    expect(parseQuery('line=sessions', allowFor('s03')).line).toBe('pv');
  });

  it('heat: S-01 で avg か sum', () => {
    expect(parseQuery('heat=sum', allowFor('s01')).heat).toBe('sum');
    expect(parseQuery('heat=avg', allowFor('s01')).heat).toBe('avg');
    expect(parseQuery('heat=max', allowFor('s01')).heat).toBe('avg');
    expect(parseQuery(new URLSearchParams({ heat: SCRIPT }), allowFor('s01')).heat).toBe('avg');
    expect(parseQuery('heat=sum', allowFor('s08')).heat).toBe('avg');
  });

  it('axis: S-06b で parent か child', () => {
    expect(parseQuery('axis=child', allowFor('s06b')).axis).toBe('child');
    expect(parseQuery('axis=parent', allowFor('s06b')).axis).toBe('parent');
    expect(parseQuery('axis=all', allowFor('s06b')).axis).toBe('parent');
    expect(parseQuery(new URLSearchParams({ axis: SCRIPT }), allowFor('s06b')).axis).toBe('parent');
    expect(parseQuery('axis=child', allowFor('s06')).axis).toBe('parent');
  });
});

describe('parseQuery: 全体のふるまい', () => {
  it('期間が不正でも、ほかのパラメータは個別に判定する', () => {
    const state = parseQuery('p=bogus&cat=12&author=sbc&sort=pv&q=abc', allowFor('s02e'));
    expect(state).toEqual({
      ...DEFAULT_QUERY_STATE,
      cat: 12,
      author: 'sbc',
      q: 'abc',
      sort: 'pv',
    });
  });

  it('1 つの不正値が、ほかの正しい値に影響しない', () => {
    const state = parseQuery('p=last7&cat=999&author=sbc&ym=2026-13', allowFor('s02e'));
    expect(state).toEqual({ ...DEFAULT_QUERY_STATE, p: 'last7', author: 'sbc' });
  });

  it('未知のパラメータを落とす', () => {
    const allow = allowFor('s01');
    const state = parseQuery('p=last7&utm_source=x&foo=bar&__proto__=1', allow);
    expect(Object.keys(state).sort()).toEqual(Object.keys(DEFAULT_QUERY_STATE).sort());
    expect(toQueryString(state, allow)).toBe('p=last7');
  });

  it('すべてのパラメータが <script> でも例外にせず、q 以外は既定値', () => {
    const search = new URLSearchParams(
      ['p', 'cat', 'author', 'ym', 'q', 'sort', 'n', 'line', 'heat', 'axis', 'x'].map(
        (name): [string, string] => [name, SCRIPT],
      ),
    );
    for (const screen of ALL_SCREENS) {
      const state = parseQuery(search, allowFor(screen));
      expect(state).toEqual({ ...DEFAULT_QUERY_STATE, q: screen === 's02e' ? SCRIPT : null });
    }
  });

  it('先頭の「?」があってもなくても同じ', () => {
    expect(parseQuery('?p=last90&line=sessions', allowFor('s01'))).toEqual(
      parseQuery('p=last90&line=sessions', allowFor('s01')),
    );
  });

  it('同じ名前が複数あるときは最初の値', () => {
    expect(parseQuery('p=last7&p=last90', allowFor('s01')).p).toBe('last7');
  });

  it('壊れたパーセント符号でも例外にしない', () => {
    expect(() => parseQuery('p=%E0%A4%A&q=%', allowFor('s02e'))).not.toThrow();
  });
});

describe('toQueryString', () => {
  it('すべて既定値なら空', () => {
    expect(toQueryString({ ...DEFAULT_QUERY_STATE }, allowFor('s01'))).toBe('');
    expect(
      toQueryString(parseQuery('p=last28&line=pv&heat=avg', allowFor('s01')), allowFor('s01')),
    ).toBe('');
  });

  it('既定値でないものだけを、決まった順で書く', () => {
    const allow = allowFor('s02e');
    const state = parseQuery('sort=pv&q=abc&author=sbc&cat=12&p=last7&ym=2026-10', allow);
    expect(toQueryString(state, allow)).toBe('p=last7&cat=12&author=sbc&ym=2026-10&q=abc&sort=pv');
  });

  it('S-01 の切り替え', () => {
    const allow = allowFor('s01');
    expect(toQueryString(parseQuery('heat=sum&line=sessions', allow), allow)).toBe(
      'line=sessions&heat=sum',
    );
  });

  it('その画面が使わないパラメータは書かない', () => {
    const state: QueryState = { ...DEFAULT_QUERY_STATE, p: 'last7', n: 50, axis: 'child' };
    expect(toQueryString(state, allowFor('s01'))).toBe('p=last7');
    expect(toQueryString(state, allowFor('s02a'))).toBe('p=last7&n=50');
    expect(toQueryString(state, allowFor('s06b'))).toBe('p=last7&axis=child');
  });

  it('書く前にもう一度検証する（一覧にない値、条件を満たさない sort は書かない）', () => {
    const allow = allowFor('s02e');
    expect(toQueryString({ ...DEFAULT_QUERY_STATE, cat: 999, sort: 'pv' }, allow)).toBe('');
    expect(toQueryString({ ...DEFAULT_QUERY_STATE, cat: 3, sort: 'pv' }, allow)).toBe('cat=3');
    expect(toQueryString({ ...DEFAULT_QUERY_STATE, cat: 12, sort: 'pv' }, allow)).toBe(
      'cat=12&sort=pv',
    );
    expect(toQueryString({ ...DEFAULT_QUERY_STATE, p: 'm2024-01' }, allow)).toBe('');
  });

  it('q は符号化して書き、読み戻すと同じ状態になる', () => {
    const allow = allowFor('s02e');
    const state = parseQuery(
      new URLSearchParams({ q: SCRIPT, author: 'sbc', sort: 'pv30' }),
      allow,
    );
    const query = toQueryString(state, allow);
    expect(query).not.toMatch(/[<>]/);
    expect(parseQuery(query, allow)).toEqual(state);
  });

  it('日本語の q も読み戻せる', () => {
    const allow = allowFor('s02e');
    const state = parseQuery(new URLSearchParams({ q: '夏祭り 2026' }), allow);
    expect(parseQuery(toQueryString(state, allow), allow)).toEqual(state);
  });
});
