import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { PeriodPicker } from '@/components/PeriodPicker';
import { resolvePeriod, usePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import type { QueryAllow } from '@/lib/query';

import { PERIODS } from './fixtures';

/** usePeriod と PeriodPicker をつないだ、画面の代わり。 */
function PeriodScreen() {
  const selection = usePeriod(PERIODS);
  if (selection.period === null) return null;
  return (
    <>
      <PeriodPicker periods={PERIODS} value={selection.period.id} onChange={selection.setPeriod} />
      <p data-testid="period">{selection.period.id}</p>
      <p data-testid="prev">{selection.prevId}</p>
      <p data-testid="prev-label">{selection.prevLabel}</p>
    </>
  );
}

const FIFTY = 'fifty';
const S02A_ALLOW: QueryAllow = { screen: 's02a', periodIds: PERIODS.map((period) => period.id) };

function CountScreen() {
  const { state, update } = useQueryState(S02A_ALLOW);
  return (
    <>
      <p data-testid="count">{state.n}</p>
      <p data-testid="period">{state.p}</p>
      <button type="button" onClick={() => update({ n: 50 })}>
        {FIFTY}
      </button>
    </>
  );
}

const text = (id: string): string | null => screen.getByTestId(id).textContent;
const pressed = (): string[] =>
  screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '');

describe('PeriodPicker と URL の状態', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('既定は直近 28 日。比較の相手は前の 28 日', () => {
    render(<PeriodScreen />);
    expect(text('period')).toBe('last28');
    expect(text('prev')).toBe('prev28');
    expect(text('prev-label')).toBe('前の 28 日と比べて');
    expect(pressed()).toEqual(['直近 28 日']);
    expect(screen.getByText('10 月 6 日〜11 月 2 日')).toBeTruthy();
  });

  it('月は label つきの select。確定していない月には印を付ける', () => {
    render(<PeriodScreen />);
    const select = screen.getByLabelText('月') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      '年月を選ぶ',
      '2026 年 11 月（途中まで）',
      '2026 年 10 月',
    ]);
  });

  it('月が終わって確定する前は「集計中」、月の途中は「途中まで」と添える', () => {
    const periods = PERIODS.map((period) =>
      period.id === 'm2026-10' ? { ...period, isConfirmed: false } : period,
    );
    render(<PeriodPicker periods={periods} value="last28" onChange={() => undefined} />);
    const select = screen.getByLabelText('月') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      '年月を選ぶ',
      '2026 年 11 月（途中まで）',
      '2026 年 10 月（集計中）',
    ]);
  });

  it('URL の値を、マウント後に読む', () => {
    window.history.replaceState(null, '', '/?p=last7');
    render(<PeriodScreen />);
    expect(text('period')).toBe('last7');
    expect(pressed()).toEqual(['直近 7 日']);
  });

  it.each([
    ['比較用の期間', '?p=prev28'],
    ['一覧にない月', '?p=m2020-01'],
    ['形の違う値', '?p=%3Cscript%3E'],
    ['空の値', '?p='],
  ])('URL の不正な値（%s）は既定に戻る', (_name, search) => {
    window.history.replaceState(null, '', `/${search}`);
    render(<PeriodScreen />);
    expect(text('period')).toBe('last28');
  });

  it('選ぶと URL が変わる。既定値は URL に書かない', () => {
    render(<PeriodScreen />);
    fireEvent.click(screen.getByRole('button', { name: '直近 90 日' }));
    expect(window.location.search).toBe('?p=last90');
    expect(text('period')).toBe('last90');
    expect(pressed()).toEqual(['直近 90 日']);

    fireEvent.click(screen.getByRole('button', { name: '直近 28 日' }));
    expect(window.location.search).toBe('');
    expect(text('period')).toBe('last28');
  });

  it('月を選ぶと、ボタンの選択が外れ、前の月が比較の相手になる', () => {
    render(<PeriodScreen />);
    fireEvent.change(screen.getByLabelText('月'), { target: { value: 'm2026-11' } });
    expect(window.location.search).toBe('?p=m2026-11');
    expect(text('prev')).toBe('m2026-10');
    expect(text('prev-label')).toBe('前の月と比べて');
    expect(pressed()).toEqual([]);
  });

  it('未知のパラメータと、その画面が使わないパラメータは、書き戻すときに落とす', () => {
    window.history.replaceState(null, '', '/?utm_source=x&n=50&p=last7');
    render(<PeriodScreen />);
    fireEvent.click(screen.getByRole('button', { name: '直近 90 日' }));
    expect(window.location.search).toBe('?p=last90');
  });

  it('popstate（戻る・進む）で状態が戻る', () => {
    render(<PeriodScreen />);
    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(text('period')).toBe('last7');

    act(() => {
      window.history.replaceState(null, '', '/?p=last90');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(text('period')).toBe('last90');

    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(text('period')).toBe('last28');
  });

  it('useQueryState は、一部だけを変えても、ほかの検証済みの値を保つ', () => {
    window.history.replaceState(null, '', '/?p=last7');
    render(<CountScreen />);
    expect(text('count')).toBe('20');
    fireEvent.click(screen.getByRole('button', { name: 'fifty' }));
    expect(window.location.search).toBe('?p=last7&n=50');
    expect(text('count')).toBe('50');
    expect(text('period')).toBe('last7');
  });

  it('サーバーで描く HTML は、URL に関係なく既定の状態（直近 28 日）', () => {
    window.history.replaceState(null, '', '/?p=last7');
    const html = renderToString(<PeriodScreen />);
    expect(html).toContain('>last28<');
    expect(html).not.toContain('>last7<');
  });

  it('resolvePeriod: 一覧が空なら period は null', () => {
    expect(resolvePeriod([], 'last28').period).toBeNull();
  });
});
