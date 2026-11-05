import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LineChart } from '@/components/charts';
import type { LineChartPoint, LineChartProps } from '@/components/charts';
import { addDays } from '@/lib/derive';

import { expectChartBasics, parts, series } from './helpers';

const TITLE = '日ごとの読まれた回数';
const FIRST_DAY = '2026-10-24';

/** 7 日分（10/24〜10/30）。基準日は 10/30 で、10/28 以降があとで増えることがある日。 */
function sevenDays(overrides: Partial<LineChartProps> = {}): LineChartProps {
  return {
    title: TITLE,
    valueLabel: '読まれた回数',
    dates: [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(FIRST_DAY, offset)),
    values: [100, 120, 90, 132, 80, 60, 20],
    prevValues: [90, 98, 95, 98, 70, 88, 91],
    unconfirmedFrom: '2026-10-28',
    defaultDate: '2026-10-27',
    publishedCounts: [0, 2, 0, 1, 0, 0, 1],
    ...overrides,
  };
}

function fixedRow(container: HTMLElement): string {
  return parts(container, 'fixed-row')[0]?.textContent ?? '';
}

describe('LineChart（U-24）', () => {
  it('前期間の線は点線で、未確定の日の線とクラスが違う', () => {
    const { container } = render(<LineChart {...sevenDays()} />);
    const prev = series(container, 'prev');
    const unconfirmed = series(container, 'unconfirmed');
    const current = series(container, 'current');
    expect(prev?.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(current?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(unconfirmed?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(prev?.getAttribute('class')).not.toBe(unconfirmed?.getAttribute('class'));
    expect(prev?.getAttribute('class')).not.toBe(current?.getAttribute('class'));
    expect(unconfirmed?.getAttribute('class')).not.toBe(current?.getAttribute('class'));
    // 未確定の日の背景に帯がある。
    expect(parts(container, 'unconfirmed-band')).toHaveLength(1);
  });

  it('前期間を渡さなければ、前期間の線も凡例も出ない（S-03）', () => {
    const { container } = render(<LineChart {...sevenDays({ prevValues: undefined })} />);
    expect(series(container, 'prev')).toBeNull();
    expect(container.querySelectorAll('[stroke-dasharray]')).toHaveLength(0);
    expect(container.textContent).not.toContain('前の期間');
    expect(fixedRow(container)).toBe('10 月 27 日: 読まれた回数 132');
  });

  it('固定行は最初から最新の確定日で埋まっていて、行の前に案内がある', () => {
    const { container } = render(<LineChart {...sevenDays()} />);
    expect(fixedRow(container)).toBe('10 月 27 日: 読まれた回数 132（前の期間の同じ日: 98）');
    expect(container.textContent).toContain('グラフの日付をタップすると、その日の数字に変わります');
  });

  it('日付をクリックすると固定行が変わる', () => {
    const { container } = render(<LineChart {...sevenDays()} />);
    const target = container.querySelector('[data-part="hit"][data-date="2026-10-25"]');
    expect(target).not.toBeNull();
    if (target) fireEvent.click(target);
    expect(fixedRow(container)).toBe('10 月 25 日: 読まれた回数 120（前の期間の同じ日: 98）');
  });

  it('左右のキーで日付を選べて、端で止まる', () => {
    const { container } = render(<LineChart {...sevenDays()} />);
    const plot = container.querySelector('[role="group"]');
    expect(plot?.getAttribute('tabindex')).toBe('0');
    if (!plot) return;
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(fixedRow(container)).toContain('10 月 26 日: 読まれた回数 90');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(fixedRow(container)).toContain('10 月 28 日: 読まれた回数 80');
    fireEvent.keyDown(plot, { key: 'End' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(fixedRow(container)).toContain('10 月 30 日: 読まれた回数 20');
    fireEvent.keyDown(plot, { key: 'Home' });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(fixedRow(container)).toContain('10 月 24 日: 読まれた回数 100');
  });

  it('公開した日の点は、本数が 1 以上の日の数だけ出る', () => {
    const { container } = render(<LineChart {...sevenDays()} />);
    expect(parts(container, 'published-dot')).toHaveLength(3);
    expect(container.textContent).toContain('公開した日');
  });

  it('公開本数を渡さなければ、点も凡例も出ない', () => {
    const { container } = render(<LineChart {...sevenDays({ publishedCounts: undefined })} />);
    expect(parts(container, 'published-dot')).toHaveLength(0);
    expect(container.textContent).not.toContain('公開した日');
  });

  it('公開本数の添え書きを固定行の後ろに足す', () => {
    const publishedText = (count: number): string => `。この日に ${count} 本公開`;
    const { container } = render(<LineChart {...sevenDays({ publishedText })} />);
    expect(fixedRow(container)).toBe(
      '10 月 27 日: 読まれた回数 132（前の期間の同じ日: 98）。この日に 1 本公開',
    );
  });

  it('縦軸は 0 始まりで、値が大きくても 0 の目盛りが下端にある', () => {
    const { container } = render(
      <LineChart {...sevenDays({ values: [900, 950, 980, 990, 970, 960, 940] })} />,
    );
    const ticks = parts(container, 'y-tick');
    expect(ticks[0]?.textContent).toBe('0');
    const ys = ticks.map((tick) => Number(tick.getAttribute('y')));
    // 0 の目盛りがいちばん下（y がいちばん大きい）。
    expect(Math.max(...ys)).toBe(ys[0]);
    // 線は下端（0 の位置）から離れた上のほうにある。
    const path = series(container, 'current')?.getAttribute('d') ?? '';
    const pathYs = [...path.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((match) => Number(match[2]));
    expect(pathYs.length).toBeGreaterThan(0);
    expect(Math.max(...pathYs)).toBeLessThan((ys[0] ?? 0) - 50);
  });

  it('未確定の日がなければ、薄い線も帯も注記も出ない', () => {
    const { container } = render(<LineChart {...sevenDays({ unconfirmedFrom: undefined })} />);
    expect(series(container, 'unconfirmed')).toBeNull();
    expect(parts(container, 'unconfirmed-band')).toHaveLength(0);
    expect(container.textContent).not.toContain('あとで増えることがあります');
  });

  it('日付ラベルは 7 日なら毎日、28 日なら週ごと、月なら 1・11・21 日、90 日なら月初', () => {
    const labels = (props: LineChartProps): string[] => {
      const { container, unmount } = render(<LineChart {...props} />);
      const texts = parts(container, 'x-tick').map((tick) => tick.textContent ?? '');
      unmount();
      return texts;
    };
    const days = (first: string, count: number): string[] =>
      [...Array(count).keys()].map((offset) => addDays(first, offset));
    const zeros = (count: number): number[] => Array<number>(count).fill(0);
    const base = { title: TITLE, valueLabel: '読まれた回数' };

    expect(labels(sevenDays())).toEqual([
      '10/24',
      '10/25',
      '10/26',
      '10/27',
      '10/28',
      '10/29',
      '10/30',
    ]);
    expect(labels({ ...base, dates: days('2026-10-03', 28), values: zeros(28) })).toEqual([
      '10/3',
      '10/10',
      '10/17',
      '10/24',
    ]);
    expect(labels({ ...base, dates: days('2026-10-01', 31), values: zeros(31) })).toEqual([
      '10/1',
      '10/11',
      '10/21',
    ]);
    expect(labels({ ...base, dates: days('2026-08-02', 90), values: zeros(90) })).toEqual([
      '9/1',
      '10/1',
    ]);
  });

  it('週別に畳むと 7 日ごとの合計になり、固定行の文を差し替えられる', () => {
    const dates = [...Array(14).keys()].map((offset) => addDays('2026-10-01', offset));
    const seen: LineChartPoint[] = [];
    const fixedRowText = (point: LineChartPoint): string => {
      seen.push(point);
      return `${point.start}/${point.end}/${point.value}/${point.prev}/${point.published}`;
    };
    const { container } = render(
      <LineChart
        title={TITLE}
        valueLabel="読まれた回数"
        dates={dates}
        values={Array<number>(14).fill(10)}
        prevValues={Array<number>(14).fill(5)}
        publishedCounts={[1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]}
        unconfirmedFrom="2026-10-12"
        defaultDate="2026-10-11"
        weekly
        fixedRowText={fixedRowText}
      />,
    );
    // 2 週目は未確定の日を含むので、既定は 1 週目。
    expect(fixedRow(container)).toBe('2026-10-01/2026-10-07/70/35/2');
    expect(parts(container, 'hit')).toHaveLength(2);
    expect(parts(container, 'published-dot')).toHaveLength(1);
    expect(seen[0]?.unconfirmed).toBe(false);
  });

  it('値が全部 0 でも、点が 1 つでも落ちない', () => {
    const { container } = render(
      <LineChart title={TITLE} valueLabel="読まれた回数" dates={['2026-10-30']} values={[0]} />,
    );
    expect(fixedRow(container)).toBe('10 月 30 日: 読まれた回数 0');
    expect(parts(container, 'y-tick')[0]?.textContent).toBe('0');
  });

  it('日付がなければ何も描かない（データなしの表示は呼び出し側）', () => {
    const { container } = render(
      <LineChart title={TITLE} valueLabel="読まれた回数" dates={[]} values={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<LineChart {...sevenDays()} />, TITLE);
  });
});
