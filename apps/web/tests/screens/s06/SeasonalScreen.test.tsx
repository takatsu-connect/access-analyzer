import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildSeasonal } from '@/data/pages';
import type { SeasonalData } from '@/lib/page-data';
import { SeasonalScreen } from '@/screens/s06/SeasonalScreen';

import { BUILT_AT, makeCache } from '../../data/fixture';

import { expectCommonRules, expectNoSortUi, setQuery } from './helpers';

// フィクスチャの月は 2025 年 10 月、2026 年 10 月、2026 年 11 月（途中まで）。数え始めた日は 2025-10-08。
function built(): SeasonalData {
  return buildSeasonal(makeCache(), BUILT_AT);
}

function view(container: HTMLElement, name: 'wide' | 'narrow'): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-view="${name}"]`);
  if (element === null) throw new Error(`${name} の図がありません。`);
  return element;
}

/** 図の行の見出し。 */
function rowLabels(target: HTMLElement): (string | null)[] {
  return [...target.querySelectorAll('div[aria-hidden="true"] > span')].map(
    (item) => item.textContent,
  );
}

/** 選んだマスの文。 */
function fixedRow(target: HTMLElement): string {
  return target.querySelector('[data-part="fixed-row"]')?.textContent ?? '';
}

function clickCell(target: HTMLElement, row: number, col: number): void {
  const cell = target.querySelector(`[data-part="cell"][data-row="${row}"][data-col="${col}"]`);
  if (cell === null) throw new Error('マスがありません。');
  fireEvent.click(cell);
}

describe('S-06b 月ごと × カテゴリ', () => {
  beforeEach(() => {
    setQuery('');
  });

  it('期間の選択（PeriodPicker）がなく、期間は固定だと書いてある', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('季節で読まれ方は変わる？');
    expect(screen.queryByRole('group', { name: '期間' })).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).toContain('期間: 直近 24 か月');
  });

  it('既定は親カテゴリの 4 行で、分け方を切り替えると行が変わる', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(rowLabels(view(container, 'wide'))).toEqual(['記事', 'イベント', 'マップ', '広告']);
    expect(screen.getByRole('button', { name: '親カテゴリ' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '子カテゴリ' }));

    // 月ごとの数字がある子カテゴリだけ（PR には数字がない）。
    expect(rowLabels(view(container, 'wide'))).toEqual(['グルメ']);
    expect(screen.getByRole('button', { name: '子カテゴリ' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(window.location.search).toBe('?axis=child');
  });

  it('URL の axis=child で、子カテゴリから始まる', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(rowLabels(view(container, 'wide'))).toEqual(['グルメ']);
  });

  it('選んだマスの文に、去年の同じ月との差を書く', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);

    // 最初に選んであるのは、終わっている月のうち、いちばん新しい月（2026 年 10 月）。175 と 300。
    expect(fixedRow(view(container, 'wide'))).toBe(
      '2026 年 10 月 グルメ: 175 回。去年の同じ月と比べて ▼ −125（−42%）。2025 年 10 月は 8 日からの数字です',
    );
  });

  it('前年の同じ月がないマスでは「前年のデータなし」と書く', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');

    clickCell(wide, 0, 0);

    expect(fixedRow(wide)).toBe(
      '2025 年 10 月 グルメ: 300 回。前年のデータなし。2025 年 10 月は 8 日からの数字です',
    );
  });

  it('途中までの月は、去年の同じ月と比べない', () => {
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');

    clickCell(wide, 1, 2);

    expect(fixedRow(wide)).toBe(
      '2026 年 11 月（途中まで） イベント: 0 回。月が終わると、去年の同じ月と比べた数字が出ます',
    );
  });

  it('数え始めた月が月の途中からなら、図の下に注記を出す', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(container.textContent).toContain(
      '読まれた回数を数え始めたのが2025 年 10 月 8 日なので、2025 年 10 月は 8 日からの数字です。',
    );
  });

  it('数え始めた日が 1 日なら、注記を出さない', () => {
    const data = built();
    const { container } = render(
      <SeasonalScreen data={{ ...data, meta: { ...data.meta, measureStart: '2025-10-01' } }} />,
    );

    expect(container.textContent).not.toContain('日からの数字です');
  });

  it('狭い画面の図: 親カテゴリは行が月、子カテゴリは横に送れることを書く', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(rowLabels(view(container, 'narrow'))).toEqual(['2025/10', '2026/10', '2026/11']);
    expect(container.textContent).not.toContain('→ 横にスクロールできます');

    fireEvent.click(screen.getByRole('button', { name: '子カテゴリ' }));

    expect(rowLabels(view(container, 'narrow'))).toEqual(['グルメ']);
    expect(view(container, 'narrow').textContent).toContain('→ 横にスクロールできます');
  });

  it('狭い画面の図は、直近 12 か月に畳む', () => {
    const data = built();
    // 2024 年 12 月から 2026 年 11 月までの 24 か月。
    const months = [...Array(24).keys()].map((index) => {
      const year = 2024 + Math.floor((index + 11) / 12);
      const month = ((index + 11) % 12) + 1;
      return `m${year}-${String(month).padStart(2, '0')}` as const;
    });
    const { container } = render(<SeasonalScreen data={{ ...data, months }} />);

    expect(view(container, 'wide').querySelectorAll('[data-part="cell"]').length).toBe(4 * 24);
    expect(rowLabels(view(container, 'narrow')).length).toBe(12);
    expect(rowLabels(view(container, 'narrow')).at(-1)).toBe('2026/11');
  });

  it('図と同じ値の表がある', () => {
    setQuery('?axis=child');
    render(<SeasonalScreen data={built()} />);

    // 表は折りたたみの中にある。
    const table = screen.getByRole('table', {
      name: '月ごと、カテゴリごとの読まれた回数の表',
      hidden: true,
    });
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual(['2026/11（途中まで）0', '2026/10175', '2025/10300']);
  });

  it('月がないときは、データなしの文を出す', () => {
    const data = built();
    render(<SeasonalScreen data={{ ...data, months: [], pvByMonth: {} }} />);

    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
  });

  it('共通の決まり（style 属性、使わない語、順位の数字、並べ替えの UI）', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expectCommonRules(container);
    expectNoSortUi(container);
  });
});
