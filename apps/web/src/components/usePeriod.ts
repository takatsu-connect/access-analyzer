'use client';

import { useCallback, useMemo } from 'react';

import type { Period, PeriodId, SelectablePeriodId } from '@/lib/page-data';
import type { QueryAllow, QueryScreen } from '@/lib/query';
import { t } from '@/lib/ui-text';

import { useQueryState } from './useQueryState';

/** 期間だけを使う画面の許可リストに入れる画面の種類。p 以外のパラメータを持たない画面ならどれでも同じ。 */
const PERIOD_ONLY_SCREEN: QueryScreen = 's03';

const WINDOW_DAYS: Readonly<Record<string, number>> = { last7: 7, last28: 28, last90: 90 };

/** 選んだ期間と、比較の相手。 */
export type PeriodChoice = {
  /** 選んだ期間。periods が空のときだけ null（「データなし」の状態を描く）。 */
  period: Period | null;
  /** 前の期間の ID（ByPeriod の添字に使う。prev28、m2026-09 など）。なければ null。 */
  prevId: PeriodId | null;
  /** 前の期間が選べる期間（月）のときの Period。prev7 / prev28 / prev90 では null。 */
  prevPeriod: Period | null;
  /** 比較の相手の言い方（「前の 28 日と比べて」「前の月と比べて」）。prevId が null なら null。 */
  prevLabel: string | null;
  /** 前年同月の ID（月だけ）。なければ null（「前年のデータなし」）。 */
  yoyId: PeriodId | null;
  yoyPeriod: Period | null;
  /** 「去年の同じ月と比べて」。yoyId が null なら null。 */
  yoyLabel: string | null;
};

export type PeriodSelection = PeriodChoice & {
  /** 期間を選ぶ。PeriodPicker の onChange にそのまま渡せる。 */
  setPeriod: (id: SelectablePeriodId) => void;
};

/** 比較の相手の言い方（05 §2.2）。 */
export function compareLabel(period: Pick<Period, 'id' | 'kind'>, target: 'prev' | 'yoy'): string {
  if (target === 'yoy') return t('compare.yoy');
  if (period.kind === 'month') return t('compare.prevMonth');
  return t('compare.prevWindow', { days: WINDOW_DAYS[period.id] ?? '' });
}

/**
 * 期間の ID から、選んだ期間と比較の相手を引く。
 * useQueryState を直接使う画面（期間以外のパラメータも持つ画面）は、state.p をこれに渡す。
 * 一覧にない ID は、既定（直近 28 日）、それもなければ先頭の期間にする。
 */
export function resolvePeriod(periods: readonly Period[], id: SelectablePeriodId): PeriodChoice {
  const find = (target: PeriodId | null): Period | null =>
    target === null ? null : (periods.find((item) => item.id === target) ?? null);
  const period = find(id) ?? find('last28') ?? periods[0] ?? null;
  if (period === null) {
    return {
      period: null,
      prevId: null,
      prevPeriod: null,
      prevLabel: null,
      yoyId: null,
      yoyPeriod: null,
      yoyLabel: null,
    };
  }
  return {
    period,
    prevId: period.prevId,
    prevPeriod: find(period.prevId),
    prevLabel: period.prevId === null ? null : compareLabel(period, 'prev'),
    yoyId: period.yoyId,
    yoyPeriod: find(period.yoyId),
    yoyLabel: period.yoyId === null ? null : compareLabel(period, 'yoy'),
  };
}

/**
 * 期間だけを URL のクエリ（p）で持つ画面向けのフック（S-03、S-06、S-07、S-07b、S-08 など）。
 * 静的な HTML と最初の描画は、既定の期間（直近 28 日）になる。
 *
 * @param periods 埋め込んだ JSON の periods。描画のたびに作り直さず、同じ参照を渡す。
 */
export function usePeriod(periods: readonly Period[]): PeriodSelection {
  const allow = useMemo<QueryAllow>(
    () => ({ screen: PERIOD_ONLY_SCREEN, periodIds: periods.map((item) => item.id) }),
    [periods],
  );
  const { state, update } = useQueryState(allow);
  const setPeriod = useCallback((id: SelectablePeriodId) => update({ p: id }), [update]);

  return useMemo(
    () => ({ ...resolvePeriod(periods, state.p), setPeriod }),
    [periods, state.p, setPeriod],
  );
}
