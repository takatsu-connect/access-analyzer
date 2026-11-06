import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { PeriodPicker } from '@/components/PeriodPicker';
import { absentCompareText, resolvePeriod, usePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import type { MonthId, Period } from '@/lib/page-data';
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

  it('月を選ぶと、ボタンの選択が外れる。月の途中の月では、前の月と比べない', () => {
    render(<PeriodScreen />);
    fireEvent.change(screen.getByLabelText('月'), { target: { value: 'm2026-11' } });
    expect(window.location.search).toBe('?p=m2026-11');
    // 11 月は 2 日までの途中の月なので、10 月の 31 日分とは比べない（05 §2.2）。
    expect(text('prev')).toBe('');
    expect(text('prev-label')).toBe('');
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

describe('resolvePeriod: 比較の決まり（05 §2.2）', () => {
  /** 基準日 2026-11-04。11 月は途中、10 月は終わったが未確定（settling）、9 月は確定。 */
  const month = (id: MonthId, start: string, end: string, isConfirmed: boolean): Period => ({
    id,
    kind: 'month',
    start,
    end,
    isConfirmed,
    label: id,
    prevId: null,
    yoyId: null,
  });
  const NOV = {
    ...month('m2026-11', '2026-11-01', '2026-11-04', false),
    prevId: 'm2026-10' as const,
    yoyId: 'm2025-11' as const,
  };
  const OCT = {
    ...month('m2026-10', '2026-10-01', '2026-10-31', false),
    prevId: 'm2026-09' as const,
    yoyId: 'm2025-10' as const,
  };
  const SEP = month('m2026-09', '2026-09-01', '2026-09-30', true);
  const NOV_2025 = {
    ...month('m2025-11', '2025-11-01', '2025-11-30', true),
    prevId: 'm2025-10' as const,
  };
  const OCT_2025 = month('m2025-10', '2025-10-08', '2025-10-31', true);
  const LIST: Period[] = [NOV, OCT, SEP, NOV_2025, OCT_2025];

  it('月の途中（end 2026-11-04、未確定）は、前の月と去年の同じ月との比較を止める', () => {
    const choice = resolvePeriod(LIST, 'm2026-11', '2025-10-08');
    expect(choice.withheld).toBe('inProgress');
    expect(choice.prevId).toBeNull();
    expect(choice.yoyId).toBeNull();
    expect(choice.prevLabel).toBeNull();
    expect(absentCompareText(choice.withheld, 'prev')).toBe(
      '月が終わると、前の月と比べた数字が出ます',
    );
    expect(absentCompareText(choice.withheld, 'yoy')).toBe(
      '月が終わると、去年の同じ月と比べた数字が出ます',
    );
  });

  it('終わった月（settling）は比べる。数え始めた月を去年の同じ月とするときは、その日を返す', () => {
    const choice = resolvePeriod(LIST, 'm2026-10', '2025-10-08');
    expect(choice.withheld).toBeNull();
    expect(choice.prevId).toBe('m2026-09');
    expect(choice.prevLabel).toBe('前の月と比べて');
    expect(choice.prevPartialDay).toBeNull();
    expect(choice.yoyId).toBe('m2025-10');
    expect(choice.yoyPartialDay).toBe(8);
  });

  it('数え始めた月を前の月とするとき（2025-11）は prevPartialDay。1 日から数えていれば扱わない', () => {
    expect(resolvePeriod(LIST, 'm2025-11', '2025-10-08').prevPartialDay).toBe(8);
    expect(resolvePeriod(LIST, 'm2025-11', '2025-10-01').prevPartialDay).toBeNull();
    expect(resolvePeriod(LIST, 'm2025-11').prevPartialDay).toBeNull();
  });

  it('止めていないときの不在の文は「前の期間の数字なし」「去年の同じ月の数字なし」', () => {
    expect(absentCompareText(null, 'prev')).toBe('前の期間の数字なし');
    expect(absentCompareText(null, 'yoy')).toBe('去年の同じ月の数字なし');
  });
});
