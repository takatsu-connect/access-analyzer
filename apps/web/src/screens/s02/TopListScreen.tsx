'use client';

import { useMemo } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleColumnId } from '@/components/ArticleTable';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { resolvePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import type { ArticleListData } from '@/lib/page-data';
import type { QueryAllow } from '@/lib/query';
import { t } from '@/lib/ui-text';

import { CountToggle } from './CountToggle';
import { PreMeasureNote } from './PreMeasureNote';
import { topRows } from './rows';

/** 列は 4 つ（FR-20）。狭い画面も同じ 4 列。 */
const COLUMNS: readonly ArticleColumnId[] = ['title', 'author', 'publishedOn', 'pageviews'];

export type TopListScreenProps = {
  data: ArticleListData;
  /** s02a = よく読まれた記事、s02c = 長く読まれている記事。構成は同じ（05 §4.3）。 */
  screen: 's02a' | 's02c';
};

/**
 * 読まれた回数の多い順の一覧（S-02a、S-02c。05 §4.1、§4.3）。
 * 並びは topIndex の順で固定し、番号も並べ替えの操作も置かない。
 */
export function TopListScreen({ data, screen }: TopListScreenProps) {
  const allow = useMemo<QueryAllow>(
    () => ({ screen, periodIds: data.periods.map((period) => period.id) }),
    [screen, data.periods],
  );
  const { state, update } = useQueryState(allow);
  const { period } = resolvePeriod(data.periods, state.p);
  const periodId = period?.id ?? null;
  const rows = useMemo(
    () => (periodId === null ? [] : topRows(data, periodId, state.n)),
    [data, periodId, state.n],
  );

  if (periodId === null) {
    return (
      <>
        <h1>{t(`${screen}.h1`)}</h1>
        <StateMessage kind="empty" />
      </>
    );
  }

  return (
    <>
      <h1>{t(`${screen}.h1`)}</h1>
      <PeriodPicker periods={data.periods} value={periodId} onChange={(id) => update({ p: id })} />
      <CountToggle value={state.n} onChange={(count) => update({ n: count })} />
      <Notice>{t(`${screen}.note`)}</Notice>
      <PreMeasureNote rows={rows} columns={COLUMNS} measureStart={data.meta.measureStart} />
      <ArticleTable
        caption={t(`${screen}.name`)}
        rows={rows}
        columns={COLUMNS}
        primaryColumn="pageviews"
      />
    </>
  );
}
