import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildTagPage } from '@/data/pages';
import type { TagPageData } from '@/lib/page-data';
import { TagPageScreen } from '@/screens/s07/TagPageScreen';

import { BUILT_AT, makeCache, SATO } from '../../data/fixture';
import { expectCommonRules, expectNoSortUi, setQuery } from '../s06/helpers';

// タグ 201（さんぽ）の記事は 101、102、105。著者はどれも さとう はなこ。
function built(): TagPageData {
  const data = buildTagPage(makeCache(), 201, BUILT_AT);
  if (data === null) throw new Error('タグ 201 のデータがありません。');
  return data;
}

/** 表の記事のタイトルを、上から順に返す。 */
function titles(): (string | null)[] {
  return screen.getAllByRole('link', { name: /^記事 [0-9]+$/ }).map((item) => item.textContent);
}

describe('S-07b シリーズの記事', () => {
  beforeEach(() => {
    setQuery('');
  });

  it('見出しにタグの名前が入り、期間の選択がある', () => {
    render(<TagPageScreen data={built()} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'さんぽの記事は、この期間どう読まれた？',
    );
    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
  });

  it('合計（読まれた回数、記事数、前の期間との差）を出す', () => {
    setQuery('?p=last7');
    const { container } = render(<TagPageScreen data={built()} />);

    expect(screen.getByText('65 回')).toBeTruthy();
    expect(screen.getByText('3 本')).toBeTruthy();
    expect(screen.getByText('前の 7 日と比べて')).toBeTruthy();
    // 65 と 40。
    expect(container.textContent).toContain('+25（+63%）');
  });

  it('月の途中（2026 年 11 月）は ▲▼ と % を出さず、「月が終わると…」を出す', () => {
    setQuery('?p=m2026-11');
    const data = built();
    const last7 = data.period.last7 ?? {};
    const { container } = render(
      <TagPageScreen
        data={{ ...data, period: { ...data.period, 'm2026-11': last7, 'm2026-10': last7 } }}
      />,
    );
    expect(screen.getByText('月が終わると、前の月と比べた数字が出ます')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[▲▼]/);
    expect(container.textContent).not.toContain('前の期間の数字なし');
  });

  it('記事は公開日の新しい順で、読まれた回数は記事ごとに合っている', () => {
    setQuery('?p=last7');
    render(<TagPageScreen data={built()} />);

    expect(titles()).toEqual(['記事 105', '記事 102', '記事 101']);
    const cells = (name: string): (string | null)[] =>
      [...(screen.getByRole('link', { name }).closest('tr')?.querySelectorAll('td') ?? [])].map(
        (cell) => (cell.querySelector('[data-part="wide-cell"]') ?? cell).textContent,
      );
    expect(cells('記事 105').at(-1)).toBe('20');
    expect(cells('記事 102').at(-1)).toBe('5');
    expect(cells('記事 101').at(-1)).toBe('40');
    // 狭い画面では、値に名前を添える（助言 B-10）。
    const narrow = screen
      .getByRole('link', { name: '記事 105' })
      .closest('tr')
      ?.querySelectorAll('[data-part="narrow-cell"]');
    expect([...(narrow ?? [])].map((cell) => cell.textContent).at(-1)).toBe('この期間 20 回');
  });

  it('列は タイトル、著者、公開日、読まれた回数 の 4 つ', () => {
    render(<TagPageScreen data={built()} />);

    const headers = screen.getAllByRole('columnheader').map((item) => item.textContent);
    expect(headers).toEqual(['記事', 'ライター', '公開日', '読まれた回数（この期間）']);
  });

  it('並べ替えの UI がない', () => {
    const { container } = render(<TagPageScreen data={built()} />);

    expectNoSortUi(container);
    expect(container.textContent).not.toContain('多い順');
  });

  it('著者の slug は href にだけ使い、本文の文字に現れない', () => {
    const { container } = render(<TagPageScreen data={built()} />);

    expect(container.textContent).not.toContain(SATO);
    const links = screen.getAllByRole('link', { name: 'さとう はなこ' });
    expect(links.length).toBe(3);
    for (const link of links) expect(link.getAttribute('href')).toBe(`/authors/${SATO}`);
  });

  it('その期間の合計がないときは、データなしの文を出す', () => {
    // 既定の期間（直近 28 日）には、タグの合計の行がない。記事ごとの数字はある。
    render(<TagPageScreen data={built()} />);

    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
    expect(titles()).toEqual(['記事 105', '記事 102', '記事 101']);
  });

  it('共通の決まり（style 属性、使わない語、順位の数字）', () => {
    setQuery('?p=last7');
    const { container } = render(<TagPageScreen data={built()} />);

    expectCommonRules(container);
  });
});
