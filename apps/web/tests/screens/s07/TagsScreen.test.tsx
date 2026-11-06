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
      'シリーズの合計を足しても、サイト全体の合計とは一致しません。1 つの記事が複数のシリーズに入ることがあり、サイト全体には記事以外のページも入っているためです。',
    );
  });

  it('月の途中（2026 年 11 月）は ▲▼ と % を出さず、「月が終わると…」を出す', () => {
    setQuery('?p=m2026-11');
    const data = built();
    const last7 = data.period.last7 ?? {};
    const { container } = render(
      <TagsScreen
        data={{ ...data, period: { ...data.period, 'm2026-11': last7, 'm2026-10': last7 } }}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('月が終わると、前の月と比べた数字が出ます')).toHaveLength(2);
    expect(table.textContent).not.toMatch(/[▲▼%]/);
    expect(container.textContent).not.toContain('前の期間の数字なし');
  });

  it('終わった月（2026 年 10 月）は前の月と比べる。前の月が数え始めた月なら差を出さず数字を並べる', () => {
    setQuery('?p=m2026-10');
    const data = built();
    const last7 = data.period.last7 ?? {};
    const periods = data.periods.map((period) =>
      period.id === 'm2026-10' ? { ...period, prevId: 'm2026-09' as const } : period,
    );
    render(
      <TagsScreen
        data={{
          ...data,
          periods,
          period: {
            ...data.period,
            'm2026-10': last7,
            'm2026-09': { 201: { pageviews: 40, postCount: 1 } },
          },
        }}
      />,
    );
    const sanpo = screen.getByRole('link', { name: 'さんぽ' }).closest('tr');
    expect(sanpo?.textContent).toContain('+25（+63%）');
  });

  it('前の月が数え始めた月（2025 年 10 月、8 日から）なら、差を出さず数字を並べる', () => {
    setQuery('?p=m2025-11');
    const data = built();
    const last7 = data.period.last7 ?? {};
    render(
      <TagsScreen
        data={{
          ...data,
          periods: [
            ...data.periods,
            {
              id: 'm2025-11',
              kind: 'month',
              start: '2025-11-01',
              end: '2025-11-30',
              isConfirmed: true,
              label: '2025 年 11 月',
              prevId: 'm2025-10',
              yoyId: null,
            },
          ],
          period: {
            ...data.period,
            'm2025-11': last7,
            'm2025-10': { 201: { pageviews: 40, postCount: 1 } },
          },
        }}
      />,
    );
    const sanpo = screen.getByRole('link', { name: 'さんぽ' }).closest('tr');
    expect(sanpo?.textContent).toContain('前の月は 40（8 日からの数字）');
    expect(sanpo?.textContent).not.toMatch(/[▲▼%]/);
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
    expect(natsu?.textContent).toContain('前の期間の数字なし');
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
