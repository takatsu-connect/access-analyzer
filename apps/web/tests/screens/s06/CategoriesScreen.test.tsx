import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildCategories } from '@/data/pages';
import type { CategoryData, CategoryPeriodValue } from '@/lib/page-data';
import { CategoriesScreen } from '@/screens/s06/CategoriesScreen';

import { BUILT_AT, makeCache } from '../../data/fixture';

import { expectCommonRules, expectNoSortUi, setQuery } from './helpers';

function built(): CategoryData {
  return buildCategories(makeCache(), BUILT_AT);
}

function value(pageviews: number): CategoryPeriodValue {
  return {
    pageviews,
    postCountTotal: 3,
    postCountPublished: 0,
    median30: null,
    median30Count: 0,
  };
}

describe('S-06 カテゴリ別', () => {
  beforeEach(() => {
    setQuery('');
  });

  it('見出しが 記事、イベント、マップ、広告 の順で、設計の語（軸）を出さない', () => {
    setQuery('?p=last7');
    const { container } = render(<CategoriesScreen data={built()} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('どのカテゴリが読まれた？');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent);
    expect(headings).toEqual(['記事', 'イベント', 'マップ', '広告']);
    expect(container.textContent).not.toContain('軸');
  });

  it('期間の選択と、足しても合計と一致しないことの注記、平均ではないことの注記がある', () => {
    setQuery('?p=last7');
    const { container } = render(<CategoriesScreen data={built()} />);

    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
    expect(container.textContent).toContain('子の数字を足しても合計とは一致しません。');
    expect(container.textContent).toContain('平均ではなく真ん中の記事の値です。');
    expect(container.textContent).toContain('広告の記事は他の合計に含めていません。');
  });

  it('母数が 0 のときは「該当なし」と書き、伏せ値の印にしない', () => {
    setQuery('?p=last7');
    const { container } = render(<CategoriesScreen data={built()} />);

    expect(screen.getAllByText('該当なし').length).toBeGreaterThan(0);
    expect(container.querySelector('.masked')).toBeNull();
  });

  it('母数があるときは、真ん中の記事の値を出す', () => {
    setQuery('?p=m2026-10');
    render(<CategoriesScreen data={built()} />);

    // 210.5 を四捨五入した値。広い画面の列と、狭い画面の「詳しく」の両方にある。
    expect(screen.getAllByText('211').length).toBe(2);
  });

  it('子カテゴリの名前は /articles?cat=<数> へのリンク', () => {
    setQuery('?p=last7');
    const { container } = render(<CategoriesScreen data={built()} />);

    expect(screen.getByRole('link', { name: 'グルメ' }).getAttribute('href')).toBe(
      '/articles?cat=3',
    );
    const links = [...container.querySelectorAll('a[href^="/articles"]')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/articles\?cat=[1-9][0-9]*$/);
    }
  });

  it('記事が 0 本の子カテゴリと、その期間に行がない子カテゴリは、行を出さない', () => {
    setQuery('?p=last7');
    const data = built();
    const last7 = data.period.last7 ?? {};
    render(
      <CategoriesScreen
        data={{
          ...data,
          period: { ...data.period, last7: { ...last7, 6: { ...value(0), postCountTotal: 0 } } },
        }}
      />,
    );

    expect(screen.queryByRole('link', { name: 'PR' })).toBeNull();
  });

  it('前の期間との比較は差と、分母が 20 以上のときだけ %', () => {
    setQuery('?p=last7');
    const data = built();
    const { container } = render(
      <CategoriesScreen
        data={{ ...data, period: { ...data.period, prev7: { 1: value(50), 3: value(19) } } }}
      />,
    );

    // 記事の合計: 57 と 50。分母が 20 以上なので、差と %。
    expect(screen.getByText('+7（+14%）')).toBeTruthy();
    // グルメ: 57 と 19。分母が 20 未満なので、差だけ。
    const row = screen.getByRole('link', { name: 'グルメ' }).closest('tr');
    expect(row?.textContent).toContain('+38');
    expect(row?.textContent).not.toContain('%');
    // 前の期間の行がないカテゴリは、伏せ値の印ではなく、文字で書く。
    expect(screen.getAllByText('前の期間のデータなし').length).toBeGreaterThan(0);
    expect(container.querySelector('.masked')).toBeNull();
    // 比較の相手の言い方。
    expect(screen.getAllByText('前の 7 日と比べて').length).toBeGreaterThan(0);
  });

  it('その期間のデータがないときは、データなしの文を出す', () => {
    // 既定の期間（直近 28 日）には、カテゴリの行がない。
    render(<CategoriesScreen data={built()} />);

    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
  });

  it('共通の決まり（style 属性、使わない語、順位の数字、並べ替えの UI）', () => {
    setQuery('?p=last7');
    const { container } = render(<CategoriesScreen data={built()} />);

    expectCommonRules(container);
    expectNoSortUi(container);
  });
});
