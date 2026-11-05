import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildTagIndex } from '@/data/pages';
import type { TagIndexData } from '@/lib/page-data';
import { TagsScreen } from '@/screens/s07/TagsScreen';

import { BUILT_AT, makeCache } from '../../data/fixture';
import { expectCommonRules, expectNoSortUi, setQuery } from '../s06/helpers';

function built(): TagIndexData {
  return buildTagIndex(makeCache(), BUILT_AT);
}

/** 表の行の見出し（シリーズの名前）を、上から順に返す。 */
function seriesNames(): (string | null)[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('rowheader')
    .map((item) => item.textContent);
}

describe('S-07 シリーズ（タグ）別', () => {
  beforeEach(() => {
    setQuery('');
  });

  it('見出し、期間の選択、注記がある', () => {
    setQuery('?p=last7');
    const { container } = render(<TagsScreen data={built()} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('どのシリーズが読まれた？');
    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
    expect(container.textContent).toContain(
      'シリーズの合計を足してもサイト全体の合計とは一致しません。',
    );
  });

  it('名前の順に並ぶ。読まれた回数が多くても、順を変えない', () => {
    setQuery('?p=last7');
    const data = built();
    const last7 = data.period.last7 ?? {};
    render(
      <TagsScreen
        data={{
          ...data,
          period: { ...data.period, last7: { ...last7, 202: { pageviews: 999, postCount: 1 } } },
        }}
      />,
    );

    expect(seriesNames()).toEqual(['さんぽ', 'なつまつり']);
  });

  it('読まれた回数の順への切り替えも、並べ替えの UI もない', () => {
    setQuery('?p=last7');
    const { container } = render(<TagsScreen data={built()} />);

    expectNoSortUi(container);
    expect(container.textContent).not.toContain('多い順');
  });

  it('記事が 0 本のタグの行がない', () => {
    setQuery('?p=last7');
    const data = built();
    const last7 = data.period.last7 ?? {};
    render(
      <TagsScreen
        data={{
          ...data,
          tags: [{ id: 203, name: 'からのタグ' }, ...data.tags],
          period: { ...data.period, last7: { ...last7, 203: { pageviews: 0, postCount: 0 } } },
        }}
      />,
    );

    expect(seriesNames()).toEqual(['さんぽ', 'なつまつり']);
    expect(screen.queryByText('からのタグ')).toBeNull();
  });

  it('シリーズの名前は、シリーズの記事のページへのリンク', () => {
    setQuery('?p=last7');
    render(<TagsScreen data={built()} />);

    expect(screen.getByRole('link', { name: 'さんぽ' }).getAttribute('href')).toBe('/tags/201');
    expect(screen.getByRole('link', { name: 'なつまつり' }).getAttribute('href')).toBe('/tags/202');
  });

  it('前の期間との比較は差と %。前の期間の行がなければ、文字で書く', () => {
    setQuery('?p=last7');
    const { container } = render(<TagsScreen data={built()} />);

    // さんぽ: 65 と 40。
    const sanpo = screen.getByRole('link', { name: 'さんぽ' }).closest('tr');
    expect(sanpo?.textContent).toContain('+25（+63%）');
    // なつまつり: 前の期間の行がない。
    const natsu = screen.getByRole('link', { name: 'なつまつり' }).closest('tr');
    expect(natsu?.textContent).toContain('前の期間のデータなし');
    expect(container.querySelector('.masked')).toBeNull();
    expect(screen.getByRole('columnheader', { name: '前の 7 日と比べて' })).toBeTruthy();
  });

  it('その期間のデータがないときは、データなしの文を出す', () => {
    // 既定の期間（直近 28 日）には、シリーズの行がない。
    render(<TagsScreen data={built()} />);

    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('共通の決まり（style 属性、使わない語、順位の数字）', () => {
    setQuery('?p=last7');
    const { container } = render(<TagsScreen data={built()} />);

    expectCommonRules(container);
  });
});
