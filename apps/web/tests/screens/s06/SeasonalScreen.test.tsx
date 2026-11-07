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

  it('去年の同じ月が数え始めた月（8 日から）なら、差を出さず、去年の数字を並べる', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);

    // 最初に選んであるのは、終わっている月のうち、いちばん新しい月（2026 年 10 月）。175 と 300。
    const text = fixedRow(view(container, 'wide'));
    expect(text).toBe('2026 年 10 月 グルメ: 175 回。去年の同じ月は、8 日からの数字で 300 回です');
    expect(text).not.toMatch(/[▲▼%]/);
  });

  it('数え始めた日が 1 日なら、去年の同じ月との差を書く', () => {
    setQuery('?axis=child');
    const data = built();
    const { container } = render(
      <SeasonalScreen data={{ ...data, meta: { ...data.meta, measureStart: '2025-10-01' } }} />,
    );
    expect(fixedRow(view(container, 'wide'))).toBe(
      '2026 年 10 月 グルメ: 175 回。去年の同じ月と比べて ▼ −125（−42%）',
    );
  });

  it('去年の同じ月がないマスでは「去年の同じ月の数字なし」と書く', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');

    clickCell(wide, 0, 0);

    expect(fixedRow(wide)).toBe(
      '2025 年 10 月 グルメ: 300 回。去年の同じ月の数字なし。2025 年 10 月は 8 日からの数字です',
    );
  });

  it('periods にない月は、月の途中とみなして比べない（安全側）', () => {
    setQuery('?axis=child');
    const data = built();
    const { container } = render(
      <SeasonalScreen
        data={{ ...data, periods: data.periods.filter((period) => period.id !== 'm2026-10') }}
      />,
    );
    const wide = view(container, 'wide');
    clickCell(wide, 0, 1);
    expect(fixedRow(wide)).toContain('月が終わると、去年の同じ月と比べた数字が出ます');
  });

  it('24 か月の外にある去年の同じ月（yoyMonths）とも比べる', () => {
    setQuery('?axis=child');
    const data = built();
    const { container } = render(
      <SeasonalScreen
        data={{
          ...data,
          meta: { ...data.meta, measureStart: '2024-10-01' },
          months: ['m2025-10', 'm2026-10', 'm2026-11'],
          yoyMonths: ['m2024-10'],
          pvByMonth: { ...data.pvByMonth, 3: { ...data.pvByMonth[3], 'm2024-10': 150 } },
        }}
      />,
    );
    const wide = view(container, 'wide');
    clickCell(wide, 0, 0);
    expect(fixedRow(wide)).toContain('去年の同じ月と比べて ▲ +150（約 2 倍）');
  });

  it('分け方を切り替えると、選んだマスの位置を引き継がない（Heatmap に key）', () => {
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');
    clickCell(wide, 3, 0);
    expect(fixedRow(wide)).toContain('広告');
    fireEvent.click(screen.getByRole('button', { name: '子カテゴリ' }));
    // 子カテゴリは 1 行（グルメ）。既定のマス（いちばん新しい終わった月）に戻る。
    expect(fixedRow(view(container, 'wide'))).toContain('2026 年 10 月 グルメ');
  });

  it('途中までの月は、去年の同じ月と比べない', () => {
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');

    clickCell(wide, 1, 2);

    expect(fixedRow(wide)).toBe(
      '2026 年 11 月（途中まで） イベント: 0 回。月が終わると、去年の同じ月と比べた数字が出ます',
    );
  });

  it('ほぼ確定の月（10 月）は、去年と比べたうえで「11 月 7 日ごろまでは、少し増えることがあります」を添える', () => {
    const data = built();
    const settling: SeasonalData = {
      ...data,
      periods: data.periods.map((period) =>
        period.id === 'm2026-10' ? { ...period, isConfirmed: false } : period,
      ),
    };
    const { container } = render(<SeasonalScreen data={settling} />);
    const wide = view(container, 'wide');

    clickCell(wide, 1, 1);

    const text = fixedRow(wide);
    expect(text).toContain('2026 年 10 月（ほぼ確定） イベント:');
    // 去年の同じ月（2025 年 10 月）は数え始めた月なので、差ではなく数字を並べる。
    expect(text).toContain('去年の同じ月は、8 日からの数字で');
    expect(text).toContain('11 月 7 日ごろまでは、少し増えることがあります');
    expect(text).not.toContain('途中まで');
  });

  it('ほぼ確定の月で、去年の同じ月が数え始めた月のとき、句点が重ならない', () => {
    const data = built();
    const settling: SeasonalData = {
      ...data,
      periods: data.periods.map((period) =>
        period.id === 'm2026-10' ? { ...period, isConfirmed: false } : period,
      ),
    };
    const { container } = render(<SeasonalScreen data={settling} />);
    const wide = view(container, 'wide');

    clickCell(wide, 0, 1);

    const text = fixedRow(wide);
    expect(text).toContain('日からの数字で');
    expect(text).toContain('ごろまでは、少し増えることがあります');
    expect(text).not.toContain('。。');
  });

  it('数え始めた月が月の途中からなら、図の下に注記を出す', () => {
    const { container } = render(<SeasonalScreen data={built()} />);

    expect(container.textContent).toContain(
      '読まれた回数を数え始めたのが 2025 年 10 月 8 日なので、2025 年 10 月は 8 日からの数字です。',
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
