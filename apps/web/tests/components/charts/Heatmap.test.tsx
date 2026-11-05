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
});

describe('Heatmap（U-24）', () => {
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
});
