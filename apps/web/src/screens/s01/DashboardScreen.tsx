'use client';

import { useMemo } from 'react';

import { StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { resolvePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import type { DashboardData } from '@/lib/page-data';
import type { QueryAllow } from '@/lib/query';
import { t } from '@/lib/ui-text';

import { DailySection } from './DailySection';
import { KpiSection } from './KpiSection';
import { MoreSection } from './MoreSection';
import { ReadersSection } from './ReadersSection';
import styles from './s01.module.css';
import { SourceSection } from './SourceSection';

export type DashboardScreenProps = {
  /** ビルド時に組み立てた、S-01 の埋め込みデータ（04 §3.2）。 */
  data: DashboardData;
};

/**
 * S-01 全体ダッシュボード（05 §3）。問い: 「この期間、サイト全体はどれくらい読まれた？」
 *
 * 表示の状態（期間 p、折れ線の数字 line、ヒートマップの出し方 heat）は URL のクエリで持つ。
 * 静的な HTML は既定の状態（直近 28 日）で描き、マウント後に URL を読んで切り替える。
 * 選んだ期間の数字がないときは、節を出さずに「この期間の数字はまだありません。」だけを出す。
 */
export function DashboardScreen({ data }: DashboardScreenProps) {
  const allow = useMemo<QueryAllow>(
    () => ({ screen: 's01', periodIds: data.periods.map((period) => period.id) }),
    [data.periods],
  );
  const { state, update } = useQueryState(allow);
  const { period } = resolvePeriod(data.periods, state.p);
  const site = period === null ? undefined : data.sitePeriod[period.id];

  return (
    <>
      <h1 className={styles.h1}>{t('s01.h1')}</h1>
      {period === null ? null : (
        <PeriodPicker
          periods={data.periods}
          value={period.id}
          onChange={(id) => update({ p: id })}
        />
      )}

      {period === null || site === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <KpiSection data={data} period={period} site={site} />
          <MoreSection data={data} period={period} site={site} />
          <DailySection
            data={data}
            period={period}
            line={state.line}
            onLineChange={(line) => update({ line })}
          />
          <SourceSection data={data} period={period} site={site} />
          <ReadersSection
            data={data}
            period={period}
            site={site}
            heat={state.heat}
            onHeatChange={(heat) => update({ heat })}
          />
        </>
      )}
    </>
  );
}
