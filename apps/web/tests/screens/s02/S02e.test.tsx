import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sortArticleRows } from '@/components/ArticleTable';
import { ARTICLE_CATEGORY_ID } from '@/lib/config';
import { t } from '@/lib/ui-text';
import { S02eScreen } from '@/screens/s02/S02eScreen';

import { makePost } from '../../components/fixtures';
import { SATO, TANAKA } from '../../data/fixture';

import {
  cellText,
  headers,
  listData,
  makeListData,
  rowTitles,
  setUrl,
  cellOf,
  narrowText,
} from './helpers';

/** 公開日の新しい順（フィクスチャの 6 本。広告の記事 105 を含む）。 */
const BY_PUBLISHED = ['記事 104', '記事 103', '記事 105', '記事 106', '記事 102', '記事 101'];

function sortGroup(): HTMLElement | null {
  return screen.queryByRole('group', { name: '並び' });
}

function queryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** 検索語の URL への書き戻し（打つのをやめて 300 ミリ秒後）を進める。 */
function flushWrite(): void {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

/** 検索の確かめ用。タイトルの英字と仮名に、全角と半角、大文字と小文字を混ぜてある。 */
function searchData() {
  return makeListData({
    posts: [
      makePost({ id: 401, title: 'Cafe めぐり', publishedOn: '2026-10-04' }),
      makePost({ id: 402, title: 'ＣＡＦＥ 特集', publishedOn: '2026-10-03' }),
      makePost({ id: 403, title: 'カフェの朝', publishedOn: '2026-10-02' }),
      makePost({ id: 404, title: '溝の口の朝市', publishedOn: '2026-10-01' }),
    ],
    pvByPeriod: { last28: [40, 30, 20, 10] },
  });
}

beforeEach(() => {
  setUrl('/articles');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('S-02e 記事を探す', () => {
  it('見出し、期間、絞り込み、件数、7 つの列を描く', () => {
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('記事を探す');
    expect(
      screen.getByText('タイトルの言葉、カテゴリ、ライター、公開した月で探せます。'),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '絞り込み' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('6 本');
    expect(headers(container)).toEqual([
      '記事',
      'ライター',
      '公開日',
      '読まれた回数（この期間）',
      '最初の 1 週間',
      '最初の 1 か月',
      'カテゴリ',
    ]);
    expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    expect(cellText(container, '記事 101', 'カテゴリ')).toBe('記事 > グルメ');
    expect(cellText(container, '記事 106', '読まれた回数（この期間）')).toBe('200');
  });

  it('広告の記事も並べ、「広告」の印を付ける。狭い画面のセルには名前を添える', () => {
    const { container } = render(<S02eScreen data={listData('search')} />);
    const rowOf = (title: string): Element | null | undefined =>
      [...container.querySelectorAll('tbody tr')].find(
        (row) => row.querySelector('th[scope="row"] a')?.textContent === title,
      );
    // 記事 105 は広告。
    expect(rowOf('記事 105')?.querySelector('th')?.textContent).toContain('広告');
    expect(rowOf('記事 101')?.querySelector('th')?.textContent).not.toContain('広告');
    expect(narrowText(cellOf(container, '記事 106', '読まれた回数（この期間）'))).toBe(
      'この期間 200 回',
    );
  });

  it('絞り込みの選択肢は、埋め込んだ一覧にあるものだけ', () => {
    render(<S02eScreen data={listData('search')} />);
    const options = (label: string): string[] =>
      [...screen.getByLabelText(label).querySelectorAll('option')].map(
        (option) => option.textContent ?? '',
      );
    // カテゴリは、このタブ（記事）の親とその子だけ。イベント、マップ、広告は選択肢にない。
    expect(options('カテゴリ')).toEqual(['すべて', '記事', '記事 > グルメ']);
    expect(options('カテゴリ')).toContain('記事 > グルメ');
    // 著者ページのある著者だけ。名前の順。
    expect(options('ライター')).toEqual(['すべて', 'さとう はなこ', 'たなか たろう']);
    expect(options('公開した月')).toEqual([
      'すべて',
      '2026 年 11 月',
      '2026 年 10 月',
      '2026 年 9 月',
      '2026 年 3 月',
      '2026 年 1 月',
      '2025 年 6 月',
    ]);
  });

  describe('並び', () => {
    it('絞り込みなしのときは並びの UI がなく、URL に sort=pv を付けても公開日の新しい順', () => {
      setUrl('/articles?sort=pv');
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).toBeNull();
      expect(screen.queryByRole('button', { name: /多い順|新しい順/ })).toBeNull();
      expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    });

    it('親カテゴリだけのときも並びの UI がなく、sort=pv が効かない。子に属する記事も出す', () => {
      setUrl(`/articles?cat=${ARTICLE_CATEGORY_ID}&sort=pv`);
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).toBeNull();
      // 親「記事」に直接付いた 103、105、106 と、配下の「記事 > グルメ」だけに属する 101、102、104。
      // 公開日の新しい順のまま（読まれた回数の順なら 106 が先頭になる）。
      expect(rowTitles(container)).toEqual(BY_PUBLISHED);
      expect(screen.getByRole('status').textContent).toBe('6 本');
    });

    it('検索語だけのときも並びの UI がない', () => {
      setUrl('/articles?q=記事&sort=pv');
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).toBeNull();
      expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    });

    it('子カテゴリで絞ると、多い順の UI が出て、sort が効く', () => {
      setUrl('/articles?cat=3&sort=pv');
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).not.toBeNull();
      expect(
        screen.getByRole('button', { name: '読まれた回数の多い順' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(rowTitles(container)).toEqual(['記事 101', '記事 102', '記事 104']);
    });

    it('著者で絞ると、多い順の UI が出る。選ぶと並びが変わり、URL に書き戻す', () => {
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).toBeNull();
      fireEvent.change(screen.getByLabelText('ライター'), { target: { value: TANAKA } });
      expect(sortGroup()).not.toBeNull();
      expect(rowTitles(container)).toEqual(['記事 104', '記事 103', '記事 106']);

      fireEvent.click(screen.getByRole('button', { name: '読まれた回数の多い順' }));
      expect(rowTitles(container)).toEqual(['記事 106', '記事 103', '記事 104']);
      expect(queryParam('author')).toBe(TANAKA);
      expect(queryParam('sort')).toBe('pv');

      // 絞り込みを外すと、並びの UI が消えて、公開日の新しい順に戻る。
      fireEvent.change(screen.getByLabelText('ライター'), { target: { value: '' } });
      expect(sortGroup()).toBeNull();
      expect(rowTitles(container)).toEqual(BY_PUBLISHED);
      expect(window.location.search).toBe('');
    });

    it('公開した月で絞ると、多い順の UI が出る', () => {
      setUrl('/articles?ym=2026-10');
      const { container } = render(<S02eScreen data={listData('search')} />);
      expect(sortGroup()).not.toBeNull();
      expect(rowTitles(container)).toEqual(['記事 103']);
    });

    it('並びの選択肢は、公開日の新しい順と多い順の 3 つだけ（少ない順はない）', () => {
      for (const query of [`author=${SATO}`, 'cat=3', 'ym=2026-10']) {
        setUrl(`/articles?${query}`);
        const { container, unmount } = render(<S02eScreen data={listData('search')} />);
        const names = [...(sortGroup()?.querySelectorAll('button') ?? [])].map(
          (button) => button.textContent,
        );
        expect(names).toEqual([
          '公開日の新しい順',
          '読まれた回数の多い順',
          '最初の 1 週間の多い順',
          '最初の 1 か月の多い順',
        ]);
        expect(container.textContent).not.toContain('少ない');
        expect(container.textContent).not.toMatch(/昇順|古い順/);
        unmount();
      }
    });

    it('最初の 1 週間 / 1 か月の多い順では、値のない記事を 0 として扱わず末尾にまとめる', () => {
      setUrl(`/articles?author=${SATO}&sort=pv7`);
      const first = render(<S02eScreen data={listData('search')} />);
      // 記事 101 は数え始める前（値なし）。記事 105 は 30 回、記事 102 は 120 回。
      expect(rowTitles(first.container)).toEqual(['記事 102', '記事 105', '記事 101']);
      expect(cellText(first.container, '記事 101', '最初の 1 週間')).toBe('数え始める前');
      first.unmount();

      setUrl('/articles?cat=3&sort=pv30');
      const second = render(<S02eScreen data={listData('search')} />);
      // 値のない 2 本（まだ 30 日たっていない 104、数え始める前の 101）は、公開日の新しい順で末尾。
      expect(rowTitles(second.container)).toEqual(['記事 102', '記事 104', '記事 101']);
    });

    it('sortArticleRows は、値のない行を 0 より後ろに置く', () => {
      const rows = [
        { post: makePost({ id: 1, title: 'なし', pv7: null, isPreMeasure: true }) },
        { post: makePost({ id: 2, title: 'ゼロ', pv7: 0 }) },
        { post: makePost({ id: 3, title: '多い', pv7: 9 }) },
      ];
      expect(sortArticleRows(rows, 'pv7').map((row) => row.post.title)).toEqual([
        '多い',
        'ゼロ',
        'なし',
      ]);
    });
  });

  describe('検索語', () => {
    it('入力のたびに絞り込み、URL の q に書き戻す', () => {
      const { container } = render(<S02eScreen data={searchData()} />);
      const input = screen.getByLabelText('タイトルの言葉');
      fireEvent.change(input, { target: { value: '朝' } });
      expect(rowTitles(container)).toEqual(['カフェの朝', '溝の口の朝市']);
      flushWrite();
      expect(queryParam('q')).toBe('朝');
      expect(screen.getByRole('status').textContent).toBe('2 本');

      fireEvent.change(input, { target: { value: '朝市' } });
      expect(rowTitles(container)).toEqual(['溝の口の朝市']);
      flushWrite();
      expect(queryParam('q')).toBe('朝市');

      fireEvent.change(input, { target: { value: '' } });
      expect(rowTitles(container)).toHaveLength(4);
      flushWrite();
      expect(window.location.search).toBe('');
    });

    it('大文字と小文字、全角と半角を区別しない', () => {
      const { container } = render(<S02eScreen data={searchData()} />);
      const input = screen.getByLabelText('タイトルの言葉');
      for (const text of ['cafe', 'CAFE', 'ｃａｆｅ', 'Ｃafe']) {
        fireEvent.change(input, { target: { value: text } });
        expect(rowTitles(container)).toEqual(['Cafe めぐり', 'ＣＡＦＥ 特集']);
      }
      fireEvent.change(input, { target: { value: 'ｶﾌｪ' } });
      expect(rowTitles(container)).toEqual(['カフェの朝']);
    });

    it('URL の q を読んで、入力欄に入れる。打った文字の末尾の空白は消さない', () => {
      setUrl('/articles?q=CAFE');
      const { container } = render(<S02eScreen data={searchData()} />);
      const input = screen.getByLabelText<HTMLInputElement>('タイトルの言葉');
      expect(input.value).toBe('CAFE');
      expect(rowTitles(container)).toEqual(['Cafe めぐり', 'ＣＡＦＥ 特集']);

      fireEvent.change(input, { target: { value: 'cafe ' } });
      expect(input.value).toBe('cafe ');
      flushWrite();
      expect(queryParam('q')).toBe('cafe');
      fireEvent.change(input, { target: { value: 'cafe め' } });
      expect(rowTitles(container)).toEqual(['Cafe めぐり']);
    });

    it('打っている間は URL に書かず、打つのをやめて 300 ミリ秒たってから書く', () => {
      render(<S02eScreen data={searchData()} />);
      const input = screen.getByLabelText('タイトルの言葉');
      fireEvent.change(input, { target: { value: '朝' } });
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(queryParam('q')).toBeNull();
      flushWrite();
      expect(queryParam('q')).toBe('朝');
    });

    it('変換中に 51 文字以上になっても落とさず、先頭 50 文字で切って絞り込む', () => {
      const long = `カフェ${'あ'.repeat(60)}`;
      const { container } = render(
        <S02eScreen
          data={makeListData({
            posts: [makePost({ id: 501, title: long, publishedOn: '2026-10-04' })],
            pvByPeriod: { last28: [10] },
          })}
        />,
      );
      const input = screen.getByLabelText<HTMLInputElement>('タイトルの言葉');
      fireEvent.change(input, { target: { value: `${long}い` } });
      expect([...input.value]).toHaveLength(50);
      expect(input.value).toBe(long.slice(0, 50));
      expect(rowTitles(container)).toEqual([long]);
      flushWrite();
      expect(queryParam('q')).toBe(long.slice(0, 50));
    });

    it('history.replaceState が例外を投げても、入力欄と絞り込みは壊れない', () => {
      const { container } = render(<S02eScreen data={searchData()} />);
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
        throw new DOMException('回数の上限', 'SecurityError');
      });
      const input = screen.getByLabelText<HTMLInputElement>('タイトルの言葉');
      fireEvent.change(input, { target: { value: '朝' } });
      expect(() => flushWrite()).not.toThrow();
      expect(input.value).toBe('朝');
      expect(rowTitles(container)).toEqual(['カフェの朝', '溝の口の朝市']);
      fireEvent.change(input, { target: { value: '朝市' } });
      flushWrite();
      expect(rowTitles(container)).toEqual(['溝の口の朝市']);
    });

    it('「条件を消す」は、書き戻し待ちの検索語を取り消す', () => {
      const { container } = render(<S02eScreen data={searchData()} />);
      const input = screen.getByLabelText<HTMLInputElement>('タイトルの言葉');
      fireEvent.change(input, { target: { value: '朝' } });
      fireEvent.click(screen.getByRole('button', { name: t('s02e.filter.clear') }));
      flushWrite();
      expect(window.location.search).toBe('');
      expect(input.value).toBe('');
      expect(rowTitles(container)).toHaveLength(4);
    });

    it('「条件を消す」は、条件がないときは disabled、条件があると押せる（レビュー P-2）', async () => {
      render(<S02eScreen data={searchData()} />);
      const button = screen.getByRole<HTMLButtonElement>('button', {
        name: t('s02e.filter.clear'),
      });
      expect(button.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText<HTMLInputElement>('タイトルの言葉'), {
        target: { value: '朝' },
      });
      expect(button.disabled).toBe(false);
      // 押せるときの見た目（太字、基調色の枠）と、押せないときの見た目（点線）を CSS で分ける。
      const { readFileSync } = await import('node:fs');
      const css = readFileSync('src/screens/s02/s02.module.css', 'utf8');
      expect(css).toMatch(
        /\.clearButton \{[^}]*min-height: var\(--tap-min\);[^}]*font-weight: 700;/,
      );
      expect(css).toMatch(/\.clearButton:disabled \{[^}]*border-style: dashed;/);
    });

    it('条件に合う記事がなければ、その旨の文を出す', () => {
      const { container } = render(<S02eScreen data={searchData()} />);
      fireEvent.change(screen.getByLabelText('タイトルの言葉'), { target: { value: '温泉' } });
      expect(screen.getByRole('status').textContent).toBe('0 本');
      expect(screen.getByText(/^条件に合う記事はありません。/)).toBeTruthy();
      expect(container.querySelector('table')).toBeNull();
    });
  });

  it('許可リストにない cat、author、ym は無視する', () => {
    setUrl('/articles?cat=999&author=nobody&ym=1999-01');
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    expect(screen.getByLabelText<HTMLSelectElement>('カテゴリ').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('ライター').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('公開した月').value).toBe('');
    expect(sortGroup()).toBeNull();
  });

  it('形式に合わない値と、著者ページのない著者も無視する', () => {
    setUrl('/articles?cat=3%20or%201&author=suzuki_jiro&ym=2026-13');
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    expect(sortGroup()).toBeNull();
  });

  it('カテゴリ、著者、公開した月を重ねて絞れる。親カテゴリは配下の子の記事を含む', () => {
    const { container } = render(<S02eScreen data={listData('search')} />);
    fireEvent.change(screen.getByLabelText('カテゴリ'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('ライター'), { target: { value: SATO } });
    expect(rowTitles(container)).toEqual(['記事 102', '記事 101']);
    fireEvent.change(screen.getByLabelText('公開した月'), { target: { value: '2026-01' } });
    expect(rowTitles(container)).toEqual(['記事 102']);
    expect(screen.getByRole('status').textContent).toBe('1 本');
    expect(window.location.search).toBe(`?cat=3&author=${SATO}&ym=2026-01`);
  });

  it('「条件を消す」で絞り込みと並びを戻す。期間は残す', () => {
    setUrl(`/articles?p=last7&cat=3&author=${SATO}&q=101&sort=pv`);
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(rowTitles(container)).toEqual(['記事 101']);

    fireEvent.click(screen.getByRole('button', { name: '条件を消す' }));
    expect(rowTitles(container)).toEqual(BY_PUBLISHED);
    expect(window.location.search).toBe('?p=last7');
    expect(screen.getByLabelText<HTMLInputElement>('タイトルの言葉').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('カテゴリ').value).toBe('');
    expect(sortGroup()).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('6 本');
  });

  it('期間を変えると、読まれた回数（この期間）の値が変わる。並びは変わらない', () => {
    const { container } = render(<S02eScreen data={listData('search')} />);
    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(cellText(container, '記事 106', '読まれた回数（この期間）')).toBe('90');
    expect(rowTitles(container)).toEqual(BY_PUBLISHED);
  });

  it('100 件を超えるときは 50 件ずつ表示する', () => {
    const posts = [...Array(120).keys()].map((index) =>
      makePost({ id: 700 + index, title: `まち歩きの記事 ${index + 1}` }),
    );
    const { container } = render(<S02eScreen data={makeListData({ posts })} />);
    expect(screen.getByRole('status').textContent).toBe('120 本');
    expect(rowTitles(container)).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'さらに表示' }));
    expect(rowTitles(container)).toHaveLength(100);
  });
});
