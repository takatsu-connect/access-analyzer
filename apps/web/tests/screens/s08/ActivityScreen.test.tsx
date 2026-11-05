import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildActivity } from '@/data/pages';
import type { ActivityData } from '@/lib/page-data';
import { ActivityScreen } from '@/screens/s08/ActivityScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';
import { expectCommonRules, expectNoSortUi, setQuery } from '../s06/helpers';

const AUTHORS_HEADING = 'この期間に記事を公開したライター（名前の順）';
const MIX_HEADING = 'どんな記事が多かった？';

// 既定の期間（直近 28 日）: 公開 2 本（前の 28 日は 1 本）。ライターは さとう 1 本、たなか 2 本。
function built(): ActivityData {
  return buildActivity(makeCache(), BUILT_AT);
}

/** 直近 28 日の公開本数と、カテゴリの内訳を差し替えたデータ。 */
function withMix(postCount: number, prevCount?: number): ActivityData {
  const data = built();
  return {
    ...data,
    posting: { ...data.posting, last28: { postCount } },
    categoryMix: {
      ...data.categoryMix,
      last28: [
        { categoryId: 7, path: 'イベント', postCountPublished: 5 },
        { categoryId: 3, path: '記事 > グルメ', postCountPublished: 10 },
      ],
      ...(prevCount === undefined
        ? {}
        : { prev28: [{ categoryId: 3, path: '記事 > グルメ', postCountPublished: prevCount }] }),
    },
  };
}

function authorsTable(): HTMLElement {
  return screen.getByRole('table', { name: AUTHORS_HEADING });
}

function mixTable(): HTMLElement {
  return screen.getByRole('table', { name: MIX_HEADING });
}

describe('S-08 投稿活動', () => {
  beforeEach(() => {
    setQuery('');
  });

  it('主文は本数だけで、人数を出さない', () => {
    const { container } = render(<ActivityScreen data={built()} />);

    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
    expect(screen.getByText('この期間に 2 本の記事が公開されました。')).toBeTruthy();
    expect(container.textContent).not.toContain('人のライター');
    expect(container.textContent).not.toMatch(/[0-9] ?人/);
  });

  it('前の期間との比較は、本数の差だけを出す', () => {
    render(<ActivityScreen data={built()} />);

    const compare = screen.getByText('前の 28 日と比べて').closest('p');
    expect(compare?.textContent).toContain('本数');
    expect(compare?.textContent).toContain('+1');
    expect(compare?.textContent).not.toContain('%');
  });

  it('月ごとの公開本数: 月の数だけ棒があり、去年の同じ月があるときだけ細い枠を描く', () => {
    const { container } = render(<ActivityScreen data={built()} />);

    expect(screen.getByRole('heading', { name: '月ごとの公開本数（直近 24 か月）' })).toBeTruthy();
    // フィクスチャは 2025 年 6 月から 2026 年 11 月までの 18 か月。新しい月が上。
    const rows = [...container.querySelectorAll('li[data-month]')];
    expect(rows.length).toBe(18);
    expect(rows[0]?.getAttribute('data-month')).toBe('2026-11');
    expect(rows[0]?.textContent).toContain('2026 年 11 月（途中まで）');
    // 2026 年 6 月（0 本）は、去年の同じ月（1 本）がある。
    const june = container.querySelector('li[data-month="2026-06"]');
    expect(june?.querySelector('[data-part="yoy"]')).not.toBeNull();
    expect(june?.querySelector('title')?.textContent).toBe(
      '2026 年 6 月: 0 本（去年の同じ月: 1 本）',
    );
    // 2025 年 6 月は、去年の同じ月のデータがない。
    const first = container.querySelector('li[data-month="2025-06"]');
    expect(first?.querySelector('[data-part="yoy"]')).toBeNull();
    // 凡例。
    expect(container.textContent).toContain('塗り: その月の本数');
    expect(container.textContent).toContain('細い枠: 去年の同じ月の本数');
  });

  it('月ごとの公開本数と同じ値の表がある', () => {
    render(<ActivityScreen data={built()} />);

    const table = screen.getByRole('table', { name: '月ごとの公開本数の表', hidden: true });
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows.length).toBe(18);
    expect(rows[0]).toBe('2026 年 11 月（途中まで）10');
    expect(rows.at(-1)).toBe('2025 年 6 月1前年のデータなし');
  });

  it('ライターの表: 見出し、名前の順、本数が 0 の行がない', () => {
    const data = built();
    const last28 = data.authorCounts.last28 ?? [];
    render(
      <ActivityScreen
        data={{
          ...data,
          authorCounts: {
            ...data.authorCounts,
            last28: [{ name: 'あおき ぜろ', slug: 'aoki-zero', postCount: 0 }, ...last28],
          },
        }}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: AUTHORS_HEADING })).toBeTruthy();
    const rows = [...authorsTable().querySelectorAll('tbody tr')].map((row) => row.textContent);
    // 本数の多い順（たなか 2 本が先）ではなく、データの順（名前の順）のまま。
    expect(rows).toEqual(['さとう はなこ1', 'たなか たろう2']);
    expect(screen.queryByText('あおき ぜろ')).toBeNull();
    const headers = within(authorsTable())
      .getAllByRole('columnheader')
      .map((item) => item.textContent);
    expect(headers).toEqual(['ライター', 'この期間の本数']);
    expect(screen.getByText('名前の順に並んでいます。本数の多い順にはしていません。')).toBeTruthy();
  });

  it('ライターの名前は著者ページへのリンク。slug を文字にせず、slug のない人はリンクにしない', () => {
    const data = built();
    const last28 = data.authorCounts.last28 ?? [];
    const { container } = render(
      <ActivityScreen
        data={{
          ...data,
          authorCounts: {
            ...data.authorCounts,
            last28: [{ name: 'こばやし えっくす', slug: null, postCount: 1 }, ...last28],
          },
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'さとう はなこ' }).getAttribute('href')).toBe(
      `/authors/${SATO}`,
    );
    expect(screen.getByText('こばやし えっくす')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'こばやし えっくす' })).toBeNull();
    expect(container.textContent).not.toContain(SATO);
    expect(container.textContent).not.toContain(TANAKA);
  });

  it('表に連番がなく、並べ替えの UI がない', () => {
    const { container } = render(<ActivityScreen data={withMix(20, 4)} />);

    expectCommonRules(container);
    expectNoSortUi(container);
  });

  it('カテゴリの割合は、分母が 19 のときは出さない', () => {
    render(<ActivityScreen data={withMix(19)} />);

    expect(mixTable().textContent).not.toContain('%');
    expect(within(mixTable()).queryByRole('columnheader', { name: '割合' })).toBeNull();
    expect(
      screen.getByText('割合は、期間内に公開した記事が 20 本以上になると出ます。'),
    ).toBeTruthy();
  });

  it('カテゴリの割合は、分母が 20 のときは出す', () => {
    render(<ActivityScreen data={withMix(20)} />);

    const rows = [...mixTable().querySelectorAll('tbody tr')];
    // 本数の多い順。10 ÷ 20 と 5 ÷ 20。
    expect(rows[0]?.textContent).toContain('記事 > グルメ');
    expect(rows[0]?.textContent).toContain('50%');
    expect(rows[1]?.textContent).toContain('イベント');
    expect(rows[1]?.textContent).toContain('25%');
    expect(within(mixTable()).getByRole('columnheader', { name: '割合' })).toBeTruthy();
    expect(
      screen.queryByText('割合は、期間内に公開した記事が 20 本以上になると出ます。'),
    ).toBeNull();
  });

  it('カテゴリの前の期間との比較は、本数の差だけ', () => {
    render(<ActivityScreen data={withMix(20, 4)} />);

    const rows = [...mixTable().querySelectorAll('tbody tr')];
    // グルメ: 10 と 4。イベント: 前の期間に行がないので 0 と比べる。
    expect(rows[0]?.querySelectorAll('td')[2]?.textContent).toContain('+6');
    expect(rows[1]?.querySelectorAll('td')[2]?.textContent).toContain('+5');
    expect(
      within(mixTable()).getByRole('columnheader', { name: '前の 28 日と比べて（本数の差）' }),
    ).toBeTruthy();
  });

  it('前の期間の内訳がないときは、文字で書く', () => {
    const { container } = render(<ActivityScreen data={withMix(20)} />);

    expect(mixTable().textContent).toContain('前の期間のデータなし');
    expect(container.querySelector('.masked')).toBeNull();
  });

  it('その期間のデータがないときは、データなしの文を出す', () => {
    const data = built();
    render(<ActivityScreen data={{ ...data, posting: {}, authorCounts: {}, categoryMix: {} }} />);

    expect(screen.getAllByText('この期間の数字はまだありません。').length).toBe(3);
    // 月ごとの公開本数は、期間に依らず出る。
    expect(screen.getByRole('heading', { name: '月ごとの公開本数（直近 24 か月）' })).toBeTruthy();
  });

  it('その期間に公開がないときは、ライターの表を出さず、文で書く', () => {
    setQuery('?p=m2026-10');
    render(<ActivityScreen data={built()} />);

    expect(screen.getByText('この期間に公開された記事はありません')).toBeTruthy();
    expect(screen.queryByRole('table', { name: AUTHORS_HEADING })).toBeNull();
  });
});
