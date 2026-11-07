import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildActivity } from '@/data/pages';
import type { ActivityData } from '@/lib/page-data';
import parts from '@/screens/s06/shared/parts.module.css';
import { ActivityScreen } from '@/screens/s08/ActivityScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';
import { expectCommonRules, expectNoSortUi, setQuery } from '../s06/helpers';

const AUTHORS_HEADING = 'この期間に記事を公開したライター（名前の順）';
const MIX_HEADING = 'カテゴリごとの本数';

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

  it('主文は本数だけで、人数を出さない。h1 は「この期間、どんな記事が公開された？」', () => {
    const { container } = render(<ActivityScreen data={built()} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'この期間、どんな記事が公開された？',
    );
    expect(screen.getByRole('heading', { level: 2, name: MIX_HEADING })).toBeTruthy();

    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
    expect(screen.getByText('この期間に 2 本の記事が公開されました。')).toBeTruthy();
    expect(container.textContent).not.toContain('人のライター');
    expect(container.textContent).not.toMatch(/[0-9] ?人/);
  });

  it('前の期間との比較は、▲▼ と差を付けず「前の 28 日は 1 本」と本数を並べる', () => {
    const { container } = render(<ActivityScreen data={built()} />);

    expect(screen.getByText('前の 28 日は 1 本')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[▲▼]/);
    expect(container.textContent).not.toContain('+1');
    expect(container.querySelector('[class*="arrow"]')).toBeNull();
  });

  it('月ごとの公開本数: 月の数だけ棒があり、去年の同じ月があるときだけ縦の線を描く', () => {
    const { container } = render(<ActivityScreen data={built()} />);

    expect(screen.getByRole('heading', { name: '月ごとの公開本数（直近 24 か月）' })).toBeTruthy();
    // フィクスチャは 2025 年 6 月から 2026 年 11 月までの 18 か月。新しい月が上。
    const rows = [...container.querySelectorAll('li[data-month]')];
    expect(rows.length).toBe(18);
    expect(rows[0]?.getAttribute('data-month')).toBe('2026-11');
    // 「途中まで」は、月の名前の下に小さく置く（括弧ごと折れない形。助言 B-1）。
    expect(rows[0]?.querySelector('[data-part="note"]')?.textContent).toBe('途中まで');
    expect(rows[0]?.querySelector('[data-part="note"]')?.parentElement?.textContent).toBe(
      '2026 年 11 月途中まで',
    );
    expect(rows[0]?.querySelector('title')?.textContent).toBe('2026 年 11 月（途中まで）: 1 本');
    expect(rows[1]?.querySelector('[data-part="note"]')).toBeNull();
    // 2026 年 6 月（0 本）は、去年の同じ月（1 本）がある。
    const june = container.querySelector('li[data-month="2026-06"]');
    // 去年の同じ月は縦の線（枠ではない）。今の棒が 0 本でも線は見える（レビュー C-10）。
    expect(june?.querySelector('[data-part="yoy"]')?.tagName.toLowerCase()).toBe('line');
    expect(june?.querySelector('title')?.textContent).toBe(
      '2026 年 6 月: 0 本（去年の同じ月: 1 本）',
    );
    // 2025 年 6 月は、去年の同じ月のデータがない。
    const first = container.querySelector('li[data-month="2025-06"]');
    expect(first?.querySelector('[data-part="yoy"]')).toBeNull();
    // 凡例。
    expect(container.textContent).toContain('塗り: その月の本数');
    expect(container.textContent).toContain('縦の線: 去年の同じ月の本数');
  });

  it('終わった月には、確定の前でも「途中まで」を添えない（公開本数は月末で固まる）', () => {
    const data = built();
    const settling: ActivityData = {
      ...data,
      periods: data.periods.map((period) =>
        period.id === 'm2026-10' ? { ...period, isConfirmed: false } : period,
      ),
    };
    const { container } = render(<ActivityScreen data={settling} />);

    const october = container.querySelector('li[data-month="2026-10"]');
    expect(october?.textContent).toContain('2026 年 10 月');
    expect(october?.textContent).not.toContain('途中まで');
    expect(october?.textContent).not.toContain('集計中');
  });

  it('月ごとの公開本数と同じ値の表がある', () => {
    render(<ActivityScreen data={built()} />);

    const table = screen.getByRole('table', { name: '月ごとの公開本数の表', hidden: true });
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows.length).toBe(18);
    // 途中の月は、去年の 1 か月分と比べない（線も描かない）。
    expect(rows[0]).toBe(
      '2026 年 11 月（途中まで）1月が終わると、去年の同じ月と比べた数字が出ます',
    );
    expect(rows.at(-1)).toBe('2025 年 6 月1去年の同じ月の数字なし');
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
    // 割合の注記は notes.ratio と重なるので出さない（助言 A-3）。
    expect(screen.queryByText(/割合は、期間内に公開した記事が/)).toBeNull();
    // 列名は「カテゴリ」「この期間に公開した本数」。
    const headers = within(mixTable())
      .getAllByRole('columnheader')
      .map((item) => item.textContent);
    expect(headers.slice(0, 2)).toEqual(['カテゴリ', 'この期間に公開した本数']);
  });

  it('月の途中（2026 年 11 月）は ▲▼ を出さず、「月が終わると…」を出す', () => {
    setQuery('?p=m2026-11');
    const { container } = render(<ActivityScreen data={built()} />);
    const lead = screen.getByText('この期間に 1 本の記事が公開されました。');
    expect(lead).toBeTruthy();
    expect(container.textContent).toContain('月が終わると、前の月と比べた数字が出ます');
    expect(container.querySelector('[class*="arrow"]')).toBeNull();
    expect(container.textContent).not.toMatch(/[▲▼]/);
  });

  it('終わった月（2026 年 10 月）は、前の月の本数を並べる（「前の月は 3 本」。差は出さない）', () => {
    setQuery('?p=m2026-10');
    const data = built();
    const { container } = render(
      <ActivityScreen
        data={{
          ...data,
          periods: data.periods.map((period) =>
            period.id === 'm2026-10' ? { ...period, prevId: 'm2026-09' as const } : period,
          ),
          posting: { ...data.posting, 'm2026-09': { postCount: 3 } },
        }}
      />,
    );
    expect(screen.getByText('前の月は 3 本')).toBeTruthy();
    // 10 月は 1 本、9 月は 3 本。差は出さない。
    expect(container.textContent).not.toContain('−2');
    expect(container.textContent).not.toMatch(/[▲▼]/);
  });

  it('13 か月前の行にも、去年の同じ月の本数が出る（36 か月のデータ）', () => {
    const cache = makeCache();
    // 2023 年 12 月から 2026 年 11 月までの 36 か月。本数は月の通し番号。
    const months = [...new Array<undefined>(36).keys()].map((index) => {
      const serial = 2023 * 12 + 11 + index;
      const month = `${Math.floor(serial / 12)}-${String((serial % 12) + 1).padStart(2, '0')}`;
      return { month, post_count: index + 1 };
    });
    const data = buildActivity({ ...cache, postingMonthly: months }, BUILT_AT);
    expect(data.monthly).toHaveLength(24);
    // 2025 年 10 月（13 か月前）は 23 本、去年の同じ月（2024 年 10 月）は 11 本。
    expect(data.monthly.find((row) => row.month === '2025-10')).toEqual({
      month: '2025-10',
      postCount: 23,
      yoyPostCount: 11,
    });
    // 2024 年 12 月（24 か月の先頭）の去年は 2023 年 12 月（1 本）。
    expect(data.monthly[0]).toEqual({ month: '2024-12', postCount: 13, yoyPostCount: 1 });

    render(<ActivityScreen data={data} />);
    const table = screen.getByRole('table', { name: '月ごとの公開本数の表', hidden: true });
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toHaveLength(24);
    expect(rows).toContain('2025 年 10 月2311');
    expect(rows.at(-1)).toBe('2024 年 12 月131');
    expect(rows.join('')).not.toContain('去年の同じ月の数字なし');
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
  });

  it('カテゴリの表は、列「前の 28 日」に前の期間の本数を並べる（▲▼ と差を付けない）', () => {
    render(<ActivityScreen data={withMix(20, 4)} />);

    const rows = [...mixTable().querySelectorAll('tbody tr')];
    // グルメ: 前の期間は 4 本。イベント: 前の期間に行がないので 0 本。
    expect(rows[0]?.querySelectorAll('td')[2]?.textContent).toBe('4');
    expect(rows[1]?.querySelectorAll('td')[2]?.textContent).toBe('0');
    expect(mixTable().textContent).not.toMatch(/[▲▼+]/);
    expect(within(mixTable()).getByRole('columnheader', { name: '前の 28 日' })).toBeTruthy();
  });

  it('カテゴリの表の見出し「前の 28 日」は折り返さない（語ごとに縦に折れない）', () => {
    render(<ActivityScreen data={withMix(20, 4)} />);
    const header = within(mixTable()).getByRole('columnheader', { name: '前の 28 日' });
    expect(parts.nowrap).toBeTruthy();
    expect(header.classList.contains(parts.nowrap ?? '')).toBe(true);
  });

  it('前の期間の内訳がないときは、文字で書く', () => {
    const { container } = render(<ActivityScreen data={withMix(20)} />);

    expect(mixTable().textContent).toContain('前の期間の数字なし');
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
