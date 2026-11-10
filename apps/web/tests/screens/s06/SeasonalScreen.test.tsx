import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildSeasonal } from '@/data/pages';
import type { SeasonalData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';
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
    expect(text).toBe(
      '2026 年 10 月 記事 > グルメ: 175 回。去年の同じ月は、8 日からの数字で 300 回です',
    );
    expect(text).not.toMatch(/[▲▼%]/);
  });

  it('数え始めた日が 1 日なら、去年の同じ月との差を書く', () => {
    setQuery('?axis=child');
    const data = built();
    const { container } = render(
      <SeasonalScreen data={{ ...data, meta: { ...data.meta, measureStart: '2025-10-01' } }} />,
    );
    expect(fixedRow(view(container, 'wide'))).toBe(
      '2026 年 10 月 記事 > グルメ: 175 回。去年の同じ月と比べて ▼ −125（−42%）',
    );
  });

  it('去年の同じ月がないマスでは「去年の同じ月の数字なし」と書く', () => {
    setQuery('?axis=child');
    const { container } = render(<SeasonalScreen data={built()} />);
    const wide = view(container, 'wide');

    clickCell(wide, 0, 0);

    expect(fixedRow(wide)).toBe(
      '2025 年 10 月 記事 > グルメ: 300 回。去年の同じ月の数字なし。2025 年 10 月は 8 日からの数字です',
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
    expect(fixedRow(view(container, 'wide'))).toContain('2026 年 10 月 記事 > グルメ');
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

describe('S-06b 子カテゴリの親子（2026-11-10。同じ名前の子が別の親の下にある）', () => {
  beforeEach(() => {
    setQuery('?axis=child');
  });

  /** イベント（9）と記事（10）の下に、同じ名前の「お祭り」がある形。 */
  function sameNameData(): SeasonalData {
    const data = built();
    return {
      ...data,
      axes: [
        { parent: { id: 9, name: 'イベント' }, children: [{ id: 31, name: 'お祭り' }] },
        {
          parent: { id: 10, name: '記事' },
          children: [
            { id: 41, name: 'お祭り' },
            { id: 42, name: 'グルメ' },
          ],
        },
        // 数字のある子がない親は、まとまりを出さない。
        { parent: { id: 189, name: 'マップ' }, children: [{ id: 51, name: '駅' }] },
      ],
      pvByMonth: {
        31: { 'm2026-10': 120 },
        41: { 'm2026-10': 30 },
        42: { 'm2026-10': 60 },
      },
    };
  }

  it('広い画面と狭い画面の図は、親の名前の見出しごとに分かれる', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);

    for (const name of ['wide', 'narrow'] as const) {
      const target = view(container, name);
      const groups = [...target.querySelectorAll('section[data-group]')];
      expect(groups.map((group) => group.querySelector('h2')?.textContent)).toEqual([
        'イベント',
        '記事',
      ]);
      expect(groups.map((group) => rowLabels(group as HTMLElement))).toEqual([
        ['お祭り'],
        ['お祭り', 'グルメ'],
      ]);
    }
  });

  it('狭い画面では、親の見出しを横に送る枠の外に置く', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);

    for (const group of view(container, 'narrow').querySelectorAll('section[data-group]')) {
      const heading = group.querySelector('h2');
      expect(heading?.parentElement).toBe(group);
    }
  });

  it('選んだマスの文は子の名前に親の名前を添える。最初から文を出すのは最初の親だけ（M-1）', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);
    const groups = view(container, 'wide').querySelectorAll<HTMLElement>('section[data-group]');
    const first = groups[0] as HTMLElement;
    const second = groups[1] as HTMLElement;

    expect(fixedRow(first)).toContain('2026 年 10 月 イベント > お祭り: 120 回');
    // 2 つめの親は、マスを選ぶまで文も選んだ枠も出さない。
    expect(fixedRow(second)).toBe('');
    expect(second.querySelector('[data-part="selected"]')).toBeNull();
    const months = second.querySelectorAll('[data-part="col-label"]').length;
    clickCell(second, 0, months - 2);
    expect(fixedRow(second)).toContain('2026 年 10 月 記事 > お祭り: 30 回');
    expect(second.querySelector('[data-part="selected"]')).not.toBeNull();
  });

  it('案内と凡例は、親ごとの図の上に 1 回だけ（広い画面と狭い画面のそれぞれ）', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);
    for (const name of ['wide', 'narrow'] as const) {
      const target = view(container, name);
      expect(target.querySelectorAll('[data-part="heatmap-notes"]')).toHaveLength(1);
      const hints = [...target.querySelectorAll('p')].filter(
        (item) => item.textContent === t('s06b.tap.hint'),
      );
      expect(hints).toHaveLength(1);
      expect(target.querySelectorAll('ul')).toHaveLength(1);
      // 案内と凡例は、最初の親の見出しより前。
      const notes = target.querySelector('[data-part="heatmap-notes"]');
      const firstGroup = target.querySelector('section[data-group]');
      expect(
        notes !== null &&
          firstGroup !== null &&
          (notes.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ).toBe(true);
    }
  });

  it('行の名前の幅はページで 1 つ（親ごとの図に同じ幅の段を当てる）。名前の全文は title にある', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);
    const wide = view(container, 'wide');
    const narrow = view(container, 'narrow');
    // 最も長い名前（3 文字）で段が決まる。広い画面と狭い画面で同じ段。
    expect(wide.className).toMatch(/labelW4/);
    expect(narrow.className).toMatch(/labelW4/);
    const titles = [...wide.querySelectorAll('section[data-group] span[title]')].map((item) =>
      item.getAttribute('title'),
    );
    expect(titles).toEqual(['お祭り', 'お祭り', 'グルメ']);
  });

  it('長い名前があれば、上限の段（広い画面 w12）にする', () => {
    const data = sameNameData();
    const long: SeasonalData = {
      ...data,
      axes: data.axes.map((axis) =>
        axis.parent.id === 10
          ? {
              ...axis,
              children: [...axis.children, { id: 43, name: 'とても長い子カテゴリの名前' }],
            }
          : axis,
      ),
      pvByMonth: { ...data.pvByMonth, 43: { 'm2026-10': 5 } },
    };
    const { container } = render(<SeasonalScreen data={long} />);
    expect(view(container, 'wide').className).toMatch(/labelW12/);
  });

  it('狭い画面の横に送る枠は、親ごとにある', () => {
    const { container } = render(<SeasonalScreen data={sameNameData()} />);
    expect(
      view(container, 'narrow').querySelectorAll(
        'section[data-group] [data-part="scroll-from-end"]',
      ),
    ).toHaveLength(2);
  });

  it('同じ値の表は、親の名前の行で子の列をまとめる', () => {
    render(<SeasonalScreen data={sameNameData()} />);
    const table = screen.getByRole('table', {
      name: '月ごと、カテゴリごとの読まれた回数の表',
      hidden: true,
    });
    const parents = [...table.querySelectorAll('thead tr[data-row="parents"] th')].map((cell) => [
      cell.textContent,
      cell.getAttribute('colspan'),
      cell.getAttribute('scope'),
    ]);
    expect(parents).toEqual([
      ['イベント', '1', 'colgroup'],
      ['記事', '2', 'colgroup'],
    ]);
    expect(table.querySelectorAll('colgroup')).toHaveLength(3);
    const children = [...table.querySelectorAll('thead tr:last-child th[scope="col"]')].map(
      (cell) => cell.textContent,
    );
    expect(children).toEqual(['月', 'お祭り', 'お祭り', 'グルメ']);
  });

  it('親カテゴリのときは、親の名前の行もまとまりもない', () => {
    setQuery('');
    const { container } = render(<SeasonalScreen data={sameNameData()} />);

    expect(container.querySelector('section[data-group]')).toBeNull();
    expect(container.querySelector('tr[data-row="parents"]')).toBeNull();
  });
});
