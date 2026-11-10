import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Heatmap } from '@/components/charts';
import type { HeatmapCell, HeatmapProps } from '@/components/charts';
import { heatLevels } from '@/components/charts/heat-levels';
import type { Masked } from '@/lib/page-data';

import { expectChartBasics, parts } from './helpers';

const TITLE = 'いつ読まれているか';
const VALUES: Masked[][] = [
  [0, 5, 10],
  [20, null, 40],
];
const cellText = (cell: HeatmapCell): string =>
  `${cell.rowLabel}曜 ${cell.colLabel}: ${cell.value === null ? '伏せ値' : cell.value}`;

function props(overrides: Partial<HeatmapProps> = {}): HeatmapProps {
  return {
    title: TITLE,
    rowLabels: ['日', '月'],
    colLabels: ['朝', '昼', '夜'],
    values: VALUES,
    cellText,
    hint: 'マスをタップすると、その時間の数字に変わります',
    legend: '読まれた回数が多い時間ほど濃い色',
    ...overrides,
  };
}

function cell(container: HTMLElement, row: number, col: number): Element {
  const found = container.querySelector(`[data-part="cell"][data-row="${row}"][data-col="${col}"]`);
  if (!found) throw new Error(`セル (${row}, ${col}) がありません。`);
  return found;
}

function fixedRow(container: HTMLElement): string {
  return parts(container, 'fixed-row')[0]?.textContent ?? '';
}

describe('heatLevels', () => {
  it('伏せ値を除いた値の分位で 5 段階に分ける。最小は 1、最大は 5', () => {
    expect(heatLevels(VALUES)).toEqual([
      [1, 2, 3],
      [4, null, 5],
    ]);
    expect(heatLevels([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]])).toEqual([[1, 1, 2, 2, 3, 3, 4, 4, 5, 5]]);
  });

  it('0 が多くても、0 はいちばん薄い段階のまま', () => {
    expect(heatLevels([[0, 0, 0, 0, 0, 0, 7, 9]])).toEqual([[1, 1, 1, 1, 1, 1, 5, 5]]);
    expect(heatLevels([[0, 0, 0, 2, 4, 6, 8, 9]])).toEqual([[1, 1, 1, 3, 3, 4, 5, 5]]);
  });

  it('全部同じ値でも、全部が伏せ値でも、空でも落ちない', () => {
    expect(
      heatLevels([
        [7, 7],
        [7, 7],
      ]),
    ).toEqual([
      [3, 3],
      [3, 3],
    ]);
    expect(heatLevels([[0, 0]])).toEqual([[1, 1]]);
    expect(heatLevels([[null, null]])).toEqual([[null, null]]);
    expect(heatLevels([[5]])).toEqual([[3]]);
    expect(heatLevels([])).toEqual([]);
  });

  // S-06b はカテゴリごとに濃淡を付ける（助言 A-2）。小さいカテゴリの季節の波も色に出る。
  const BY_CATEGORY: Masked[][] = [
    [1000, 2000, 3000, 4000, 5000],
    [1, 2, 3, 4, 5],
    [0, 0, 0, 0, 0],
  ];

  it("scale='row' は、行ごとに、その行の中の値で 5 段階に分ける。全部 0 の行はいちばん薄い", () => {
    expect(heatLevels(BY_CATEGORY, 'row')).toEqual([
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 1, 1, 1, 1],
    ]);
    // 既定（表全体で 1 つの分位。S-01）は変わらない。
    expect(heatLevels(BY_CATEGORY)).toEqual(heatLevels(BY_CATEGORY, 'all'));
    expect(heatLevels(BY_CATEGORY)[0]).toEqual([4, 4, 5, 5, 5]);
  });

  it("scale='col' は、列ごとに分ける（行と列を入れ替えた図と同じ段階になる）", () => {
    const transpose = <T,>(grid: readonly (readonly T[])[]): T[][] =>
      (grid[0] ?? []).map((_, col) => grid.map((row) => row[col] as T));
    expect(heatLevels(transpose(BY_CATEGORY), 'col')).toEqual(
      transpose(heatLevels(BY_CATEGORY, 'row')),
    );
  });

  it('行ごと・列ごとでも、伏せ値は null のまま、全部が伏せ値の行は null', () => {
    expect(
      heatLevels(
        [
          [null, 3, 9],
          [null, null, null],
        ],
        'row',
      ),
    ).toEqual([
      [null, 1, 5],
      [null, null, null],
    ]);
    expect(
      heatLevels(
        [
          [null, 3],
          [7, null],
          [9, 0],
        ],
        'col',
      ),
    ).toEqual([
      [null, 5],
      [1, null],
      [5, 1],
    ]);
  });
});

describe('Heatmap（U-24）', () => {
  it("scale='row' を渡すと、行ごとの段階でセルを塗る（既定は表全体）", () => {
    const levelsOf = (container: HTMLElement): string[] =>
      [...container.querySelectorAll('[data-part="cell"]')].map(
        (item) => item.getAttribute('data-level') ?? '',
      );
    const grid: Masked[][] = [
      [100, 200, 300],
      [0, 0, 0],
    ];
    const whole = render(<Heatmap {...props({ values: grid })} />);
    expect(levelsOf(whole.container)).toEqual(['4', '5', '5', '1', '1', '1']);
    whole.unmount();
    const byRow = render(<Heatmap {...props({ values: grid, scale: 'row' })} />);
    expect(levelsOf(byRow.container)).toEqual(['1', '3', '5', '1', '1', '1']);
  });

  it('セルは 5 段階の濃淡のクラスで、段階ごとにクラスが違う', () => {
    const { container } = render(<Heatmap {...props()} />);
    const cells = parts(container, 'cell');
    expect(cells).toHaveLength(6);
    const classByLevel = new Map(
      cells.map((node) => [node.getAttribute('data-level'), node.getAttribute('class')]),
    );
    expect([...classByLevel.keys()].sort()).toEqual(['1', '2', '3', '4', '5', 'masked']);
    expect(new Set(classByLevel.values()).size).toBe(6);
    for (const level of ['1', '2', '3', '4', '5']) {
      expect(classByLevel.get(level)).toContain(`shade${level}`);
    }
  });

  it('伏せ値のセルは濃淡を付けず「—」を書き、凡例に「— 伏せ値」を出す', () => {
    const { container } = render(<Heatmap {...props()} />);
    const masked = cell(container, 1, 1);
    expect(masked.getAttribute('data-level')).toBe('masked');
    expect(masked.getAttribute('class')).not.toMatch(/shade\d/);
    expect(parts(container, 'masked-mark').map((node) => node.textContent)).toEqual(['—']);
    expect(parts(container, 'legend-masked')[0]?.textContent).toBe('— 伏せ値');
    // 0 は伏せ値ではなく、0 として書く。
    expect(parts(container, 'cell-value').map((node) => node.textContent)).toContain('0');
  });

  it('伏せ値がなければ、凡例に伏せ値を出さない', () => {
    const values = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const { container } = render(<Heatmap {...props({ values })} />);
    expect(parts(container, 'legend-masked')).toHaveLength(0);
    expect(container.textContent).toContain('読まれた回数が多い時間ほど濃い色');
  });

  it('固定行は最初から埋まっていて（既定はいちばん大きいセル）、行の前に案内がある', () => {
    const { container } = render(<Heatmap {...props()} />);
    expect(fixedRow(container)).toBe('月曜 夜: 40');
    expect(container.textContent).toContain('マスをタップすると、その時間の数字に変わります');
    const byDefault = render(<Heatmap {...props({ defaultCell: { row: 0, col: 1 } })} />);
    expect(fixedRow(byDefault.container)).toBe('日曜 昼: 5');
  });

  it('セルをクリックすると固定行が変わる。伏せ値のセルも選べる', () => {
    const { container } = render(<Heatmap {...props()} />);
    fireEvent.click(cell(container, 0, 2));
    expect(fixedRow(container)).toBe('日曜 夜: 10');
    fireEvent.click(cell(container, 1, 1));
    expect(fixedRow(container)).toBe('月曜 昼: 伏せ値');
  });

  it('矢印キーでセルを選べて、端で止まる', () => {
    const { container } = render(<Heatmap {...props()} />);
    const plot = container.querySelector('[role="group"]');
    expect(plot?.getAttribute('tabindex')).toBe('0');
    if (!plot) return;
    fireEvent.keyDown(plot, { key: 'ArrowUp' });
    expect(fixedRow(container)).toBe('日曜 夜: 10');
    fireEvent.keyDown(plot, { key: 'ArrowUp' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(fixedRow(container)).toBe('日曜 夜: 10');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(fixedRow(container)).toBe('日曜 昼: 5');
    fireEvent.keyDown(plot, { key: 'ArrowDown' });
    expect(fixedRow(container)).toBe('月曜 昼: 伏せ値');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(fixedRow(container)).toBe('月曜 朝: 20');
  });

  it('全部同じ値でも落ちない', () => {
    const values = [
      [3, 3, 3],
      [3, 3, 3],
    ];
    const { container } = render(<Heatmap {...props({ values })} />);
    expect(
      new Set(parts(container, 'cell').map((node) => node.getAttribute('data-level'))),
    ).toEqual(new Set(['3']));
    expect(fixedRow(container)).toBe('日曜 朝: 3');
  });

  it('列の見出しを間引ける。数字の書式を差し替えられる', () => {
    const formatValue = (value: number): string => value.toFixed(1);
    const { container } = render(<Heatmap {...props({ colLabelEvery: 2, formatValue })} />);
    expect(parts(container, 'col-label').map((node) => node.textContent)).toEqual(['朝', '夜']);
    expect(parts(container, 'cell-value').map((node) => node.textContent)).toContain('40.0');
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<Heatmap {...props()} />, TITLE);
  });

  describe('平均の列と行（rowMeans / colMeans）', () => {
    const withMeans = (): HeatmapProps =>
      props({
        rowMeans: { label: '平均', values: [5, null] },
        colMeans: { label: '平均', values: [10, null, 25] },
      });
    const meanText = (cell: HeatmapCell): string =>
      `${cell.kind} ${cell.rowLabel} ${cell.colLabel}: ${cell.value === null ? '伏せ値' : cell.value}`;

    it('渡さなければ、平均のマスも見出しも出さない', () => {
      const { container } = render(<Heatmap {...props()} />);
      expect(parts(container, 'mean-cell')).toHaveLength(0);
      expect(parts(container, 'mean-col-label')).toHaveLength(0);
      expect(parts(container, 'mean-row-label')).toHaveLength(0);
    });

    it('右端に行の数、下端に列の数の平均のマスを足し、角は空ける。濃淡は付けない', () => {
      const { container } = render(<Heatmap {...withMeans()} />);
      const means = parts(container, 'mean-cell');
      expect(means).toHaveLength(2 + 3);
      for (const node of means) {
        expect(node.getAttribute('class')).not.toMatch(/shade\d/);
        expect(node.hasAttribute('data-level')).toBe(false);
      }
      // 格子のマスは 6 つのまま。
      expect(parts(container, 'cell')).toHaveLength(6);
      expect(parts(container, 'mean-col-label')[0]?.textContent).toBe('平均');
      expect(parts(container, 'mean-row-label')[0]?.textContent).toBe('平均');
      // 数字は狭い画面でも出す（cell-value とは別のクラス）。null は「—」。
      expect(parts(container, 'mean-value').map((node) => node.textContent)).toEqual([
        '5',
        '10',
        '25',
      ]);
      expect(parts(container, 'masked-mark')).toHaveLength(1 + 2);
    });

    it('平均の濃淡の段階は、格子のマスだけで決まる（平均を渡しても変わらない）', () => {
      const levelsOf = (container: HTMLElement): string[] =>
        parts(container, 'cell').map((item) => item.getAttribute('data-level') ?? '');
      const plain = render(<Heatmap {...props()} />);
      const before = levelsOf(plain.container);
      plain.unmount();
      expect(levelsOf(render(<Heatmap {...withMeans()} />).container)).toEqual(before);
    });

    it('平均のマスを選ぶと、固定行に kind と見出しが渡る', () => {
      const { container } = render(<Heatmap {...withMeans()} cellText={meanText} />);
      const mean = (kind: string, index: number): Element => {
        const found = parts(container, 'mean-cell').filter(
          (node) => node.getAttribute('data-kind') === kind,
        )[index];
        if (!found) throw new Error(`${kind} の ${index} がありません。`);
        return found;
      };
      fireEvent.click(mean('rowMean', 0));
      expect(fixedRow(container)).toBe('rowMean 日 平均: 5');
      fireEvent.click(mean('rowMean', 1));
      expect(fixedRow(container)).toBe('rowMean 月 平均: 伏せ値');
      fireEvent.click(mean('colMean', 2));
      expect(fixedRow(container)).toBe('colMean 平均 夜: 25');
    });

    it('矢印キーで平均のマスへ移れて、角には入らない', () => {
      const { container } = render(<Heatmap {...withMeans()} cellText={meanText} />);
      const plot = container.querySelector('[role="group"]');
      if (!plot) throw new Error('操作の領域がありません。');
      // 既定はいちばん大きいマス（月 夜 = 40）。右へ行くと、その行の平均。
      expect(fixedRow(container)).toBe('cell 月 夜: 40');
      fireEvent.keyDown(plot, { key: 'ArrowRight' });
      expect(fixedRow(container)).toBe('rowMean 月 平均: 伏せ値');
      // 下は角なので動かない。
      fireEvent.keyDown(plot, { key: 'ArrowDown' });
      expect(fixedRow(container)).toBe('rowMean 月 平均: 伏せ値');
      fireEvent.keyDown(plot, { key: 'ArrowLeft' });
      fireEvent.keyDown(plot, { key: 'ArrowDown' });
      expect(fixedRow(container)).toBe('colMean 平均 夜: 25');
      // 下端の行の End は、角ではなく最後の列。
      fireEvent.keyDown(plot, { key: 'Home' });
      fireEvent.keyDown(plot, { key: 'End' });
      expect(fixedRow(container)).toBe('colMean 平均 夜: 25');
      // 右へは角なので動かない。
      fireEvent.keyDown(plot, { key: 'ArrowRight' });
      expect(fixedRow(container)).toBe('colMean 平均 夜: 25');
    });

    it('平均を足しても style 属性がない', () => {
      expectChartBasics(<Heatmap {...withMeans()} />, TITLE);
    });
  });
});
