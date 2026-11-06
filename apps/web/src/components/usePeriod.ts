'use client';

import { useCallback, useMemo } from 'react';

import { monthProgress, partialMonthStartDay } from '@/lib/derive';
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
  /**
   * 比較を止めた理由（05 §2.2）。'inProgress' は月の途中の月を選んだとき（4 日分と 31 日分のように
   * 日数がそろわない）。このとき prevId と yoyId は null で、画面は「前の期間の数字なし」ではなく
   * compare.inProgress（去年は compare.inProgress.yoy）を出す。止めていなければ null。
   */
  withheld: CompareWithheld;
  /**
   * 前の期間が、数え始めた月（1 日より後から数えている月）なら、数え始めた日（8 など）。
   * このときは差を出さず、相手の数字を「前の月は {value}（{day} 日からの数字）」と並べる。それ以外は null。
   */
  prevPartialDay: number | null;
  /** 去年の同じ月が、数え始めた月なら、数え始めた日。扱いは prevPartialDay と同じ。 */
  yoyPartialDay: number | null;
};

/** 比較を止めた理由。null は止めていない。 */
export type CompareWithheld = 'inProgress' | null;

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
 *
 * 比較の決まり（05 §2.2）: 比べる 2 つの期間の日数がそろわないときは、▲▼、差、% を出さない。
 * - 月の途中の月（monthProgress が inProgress）を選んだら、前の月・去年の同じ月との比較を止める
 *   （prevId、yoyId を null にし、withheld に理由を入れる）。
 * - 比べる相手が数え始めた月（measureStart の月で、1 日より後から数えている）なら、
 *   prevPartialDay / yoyPartialDay に数え始めた日を入れる。画面は差を出さず、相手の数字を並べる。
 *
 * @param measureStart meta.measureStart。渡さなければ、数え始めた月の扱いをしない。
 */
export function resolvePeriod(
  periods: readonly Period[],
  id: SelectablePeriodId,
  measureStart?: string,
): PeriodChoice {
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
      withheld: null,
      prevPartialDay: null,
      yoyPartialDay: null,
    };
  }
  if (period.kind === 'month' && monthProgress(period) === 'inProgress') {
    return {
      period,
      prevId: null,
      prevPeriod: null,
      prevLabel: null,
      yoyId: null,
      yoyPeriod: null,
      yoyLabel: null,
      withheld: 'inProgress',
      prevPartialDay: null,
      yoyPartialDay: null,
    };
  }
  const partial = (target: PeriodId | null): number | null =>
    measureStart === undefined ? null : partialMonthStartDay(target, measureStart);
  return {
    period,
    prevId: period.prevId,
    prevPeriod: find(period.prevId),
    prevLabel: period.prevId === null ? null : compareLabel(period, 'prev'),
    yoyId: period.yoyId,
    yoyPeriod: find(period.yoyId),
    yoyLabel: period.yoyId === null ? null : compareLabel(period, 'yoy'),
    withheld: null,
    prevPartialDay: partial(period.prevId),
    yoyPartialDay: partial(period.yoyId),
  };
}

/**
 * 比較の相手がないときの文（05 §2.2）。月の途中で止めたときは「月が終わると…」、
 * それ以外は「前の期間の数字なし」（去年は「去年の同じ月の数字なし」）。
 */
export function absentCompareText(withheld: CompareWithheld, target: 'prev' | 'yoy'): string {
  if (withheld === 'inProgress') {
    return target === 'prev' ? t('compare.inProgress') : t('compare.inProgress.yoy');
  }
  return target === 'prev' ? t('absent.prev') : t('absent.yoy');
}

/**
 * 期間だけを URL のクエリ（p）で持つ画面向けのフック（S-03、S-06、S-07、S-07b、S-08 など）。
 * 静的な HTML と最初の描画は、既定の期間（直近 28 日）になる。
 *
 * @param periods 埋め込んだ JSON の periods。描画のたびに作り直さず、同じ参照を渡す。
 * @param measureStart meta.measureStart（数え始めた月を相手に比べるときの扱いに使う）。
 */
export function usePeriod(periods: readonly Period[], measureStart?: string): PeriodSelection {
  const allow = useMemo<QueryAllow>(
    () => ({ screen: PERIOD_ONLY_SCREEN, periodIds: periods.map((item) => item.id) }),
    [periods],
  );
  const { state, update } = useQueryState(allow);
  const setPeriod = useCallback((id: SelectablePeriodId) => update({ p: id }), [update]);

  return useMemo(
    () => ({ ...resolvePeriod(periods, state.p, measureStart), setPeriod }),
    [periods, state.p, measureStart, setPeriod],
  );
}
